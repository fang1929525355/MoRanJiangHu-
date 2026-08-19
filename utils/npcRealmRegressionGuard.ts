import type { GameResponse, TavernCommand } from '../types';
import { 获取境界配置, 获取境界层级 } from './realmConfig';
import { 命令存在社交删除风险 } from './npcRetentionGuard';
import { applyStateCommand, normalizeStateCommandKey } from './stateHelpers';

const 题材模式列表 = ['武侠', '仙侠', '西方奇幻', '灵气复苏', '都市修仙', '现代都市', '末日丧尸', '无限流'] as const;

const 深拷贝 = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const 读取文本 = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const 规范化NPC键 = (value: unknown): string => 读取文本(value)
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase();

const 读取NPC稳定键 = (npc: any): { ids: string[]; names: string[] } => ({
    ids: [npc?.id, npc?.ID].map(规范化NPC键).filter(Boolean),
    names: [npc?.姓名, npc?.名称].map(规范化NPC键).filter(Boolean)
});

const NPC互相匹配 = (left: any, right: any): boolean => {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftKeys = 读取NPC稳定键(left);
    const rightKeys = 读取NPC稳定键(right);
    const rightIds = new Set(rightKeys.ids);
    if (leftKeys.ids.some((id) => rightIds.has(id))) return true;
    const rightNames = new Set(rightKeys.names);
    return leftKeys.names.some((name) => rightNames.has(name));
};

const 提取响应事实文本 = (response?: GameResponse): string => {
    if (!response || typeof response !== 'object') return '';
    const parts: string[] = [];
    [
        (response as any).body,
        (response as any).正文
    ].forEach((value) => {
        const text = 读取文本(value);
        if (text) parts.push(text);
    });
    if (Array.isArray(response.logs)) {
        response.logs.forEach((log: any) => {
            [log?.text, log?.content, log?.message].forEach((value) => {
                const text = 读取文本(value);
                if (text) parts.push(text);
            });
        });
    }
    return parts.join('\n');
};

const 拆分事实句 = (text: string): string[] => text
    .split(/[。！？!?\n\r]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const 永久跌境事实正则 = /修为(?:[^。！？\n\r]{0,10})?(?:被废|废去|废除|尽废|全废)|(?:废去|废除|自废)(?:了)?(?:全部|一身)?修为|功力(?:尽失|全失|被废)|散功|道基(?:彻底)?(?:破碎|崩毁)|金丹(?:破碎|被毁)|境界(?:永久|彻底|不可逆)?(?:跌落|跌境|下降)|永久跌境/u;
const 永久跌境否定正则 = /(?:并未|并非|不是|没有|并没有|未曾|尚未|不曾|险些|差点|几乎)(?:[^。！？\n\r]{0,18})?(?:散功|修为[^。！？\n\r]{0,8}(?:被废|废去|尽废)|功力尽失|境界[^。！？\n\r]{0,8}(?:跌落|跌境|下降))|(?:修为|功力|境界)(?:[^。！？\n\r]{0,8})?(?:并未|并非|不是|没有|未曾|尚未|不曾)(?:[^。！？\n\r]{0,8})?(?:被废|废去|尽废|尽失|跌落|跌境|下降)|(?:散功|修为[^。！？\n\r]{0,8}(?:被废|废去|尽废)|功力尽失|境界[^。！？\n\r]{0,8}(?:跌落|跌境|下降))(?:[^。！？\n\r]{0,18})?(?:并未发生|没有发生|不成立|只是临时|仅是临时|并非永久|不是永久|可以恢复|可恢复|会恢复)/u;
const 临时境界影响正则 = /临时|暂时|短暂|一时|封印|压制|受伤|重伤|战败|力竭|虚弱|休养后|恢复后|即可恢复/u;
const 境界纠错事实正则 = /(?:境界|修为)(?:记录|档案|记载|判断|判定)?(?:有误|错误|错记|误判)|此前(?:境界|修为)(?:记录|档案|记载)?(?:有误|错误|错记|误判)/u;
const 境界纠错确认正则 = /确认|证实|核对|查明|查证|纠正|更正|实际|原来/u;
const 境界纠错否定正则 = /(?:尚未|未曾|并未|没有|未能|无法|待核实|有待核实)(?:[^。！？\n\r]{0,12})?(?:确认|证实|核对|查明|查证|纠正|更正|实际|原来)/u;
const 非现实跌境语境正则 = /如果|若是|若非|倘若|假如|一旦|可能|或许|也许|打算|计划|企图|想要|梦见|梦中|幻觉|幻象|假装|谎称|传闻|据说/u;

const 事实正则明确指向NPC = (sentence: string, name: string, pattern: RegExp): boolean => {
    const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(sentence)) !== null) {
        const factStart = match.index;
        const nameStart = sentence.lastIndexOf(name, factStart);
        if (nameStart < 0) continue;
        const beforeFact = sentence.slice(0, factStart).trim();
        const afterFact = sentence.slice(factStart + match[0].length);
        const factDescribesFollowingPerson = /^的[\p{Script=Han}]{2,8}(?=[，、；。！？\s]|$)/u.test(afterFact)
            && !beforeFact.endsWith(name)
            && !beforeFact.endsWith(`${name}的`);
        if (!factDescribesFollowingPerson) return true;
    }
    return false;
};

const NPC存在明确永久跌境依据 = (npc: any, response?: GameResponse): boolean => {
    const name = 读取文本(npc?.姓名) || 读取文本(npc?.名称);
    if (!name) return false;
    return 拆分事实句(提取响应事实文本(response)).some((sentence) => {
        if (!sentence.includes(name)) return false;
        if (非现实跌境语境正则.test(sentence)) return false;
        if (
            境界纠错事实正则.test(sentence)
            && 境界纠错确认正则.test(sentence)
            && !境界纠错否定正则.test(sentence)
            && 事实正则明确指向NPC(sentence, name, 境界纠错事实正则)
        ) return true;
        if (!永久跌境事实正则.test(sentence)) return false;
        if (永久跌境否定正则.test(sentence)) return false;
        if (临时境界影响正则.test(sentence) && !/永久|彻底|不可逆|尽废|全废/u.test(sentence)) return false;
        return 事实正则明确指向NPC(sentence, name, 永久跌境事实正则);
    });
};

const 境界文本匹配配置 = (text: string, config: ReturnType<typeof 获取境界配置>): boolean => {
    const compact = text.replace(/\s+/g, '');
    if (!compact) return false;
    if (config.levelNames.some((name) => compact.includes(String(name || '').replace(/\s+/g, '')))) return true;
    if ((config.stageNames || []).some((stage) => compact.includes(stage))) return true;
    return (config.parseRules || []).some(({ pattern }) => {
        try {
            return new RegExp(pattern).test(compact);
        } catch {
            return false;
        }
    });
};

const 解析已知境界文本层级 = (value: unknown): number | null => {
    const text = 读取文本(value);
    if (!text) return null;
    const levels = 题材模式列表
        .map((mode) => 获取境界配置(mode, null))
        .filter((config) => 境界文本匹配配置(text, config))
        .map((config) => 获取境界层级(text, config))
        .filter((level) => Number.isFinite(level) && level >= 1);
    return levels.length > 0 ? Math.max(...levels) : null;
};

const 读取有效境界层级 = (value: unknown): number | null => {
    const level = Number(value);
    return Number.isFinite(level) && level >= 1 ? Math.floor(level) : null;
};

const 境界占位文本正则 = /^(?:未知|未明|未定|不详|未知境界|未明境界|未定境界|境界未知|境界未定)$/u;

const 计算NPC当前境界层级 = (npc: any): number => (
    读取有效境界层级(npc?.境界层级)
    || 解析已知境界文本层级(npc?.境界)
    || 1
);

const 命令包含境界字段 = (cmd: any, normalizedKey: string): { realmText: boolean; realmLevel: boolean } => {
    if (/^gameState\.社交\[\d+\]\.境界$/u.test(normalizedKey)) {
        return { realmText: true, realmLevel: false };
    }
    if (/^gameState\.社交\[\d+\]\.境界层级$/u.test(normalizedKey)) {
        return { realmText: false, realmLevel: true };
    }
    if (/^gameState\.社交\[\d+\]$/u.test(normalizedKey)) {
        const value = cmd?.value;
        return {
            realmText: Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '境界')),
            realmLevel: Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '境界层级'))
        };
    }
    return { realmText: false, realmLevel: false };
};

type NPC境界命令状态 = {
    commandIndices: Set<number>;
    realmTextCommandIndices: Set<number>;
    realmLevelCommandIndices: Set<number>;
};

const 创建NPC境界命令状态 = (): NPC境界命令状态 => ({
    commandIndices: new Set<number>(),
    realmTextCommandIndices: new Set<number>(),
    realmLevelCommandIndices: new Set<number>()
});

const 模拟社交命令 = (social: any[], cmd: any): any[] => applyStateCommand(
    {} as any,
    {} as any,
    social as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    {} as any,
    [],
    [],
    cmd.key,
    cmd.value,
    cmd.action || 'set'
).social as any[];

const 分析NPC境界回退 = (
    commands: TavernCommand[] | any[],
    currentSocial: any[],
    response?: GameResponse
): Array<{ npcIndex: number; issue: string; commandIndices: Set<number> }> => {
    if (!Array.isArray(commands) || !Array.isArray(currentSocial) || currentSocial.length <= 0) return [];

    const existingSocial = 深拷贝(currentSocial);
    let socialBuffer = 深拷贝(currentSocial);
    let socialOrigins: Array<number | null> = existingSocial.map((_, index) => index);
    const commandStates = new Map<number, NPC境界命令状态>();
    const ensureState = (npcIndex: number): NPC境界命令状态 => {
        const existing = commandStates.get(npcIndex);
        if (existing) return existing;
        const next = 创建NPC境界命令状态();
        commandStates.set(npcIndex, next);
        return next;
    };

    commands.forEach((cmd: any, commandIndex) => {
        const normalizedKey = normalizeStateCommandKey(typeof cmd?.key === 'string' ? cmd.key : '');
        if (!normalizedKey.startsWith('gameState.社交')) return;
        const action = typeof cmd?.action === 'string' && cmd.action ? cmd.action : 'set';

        if (命令存在社交删除风险(cmd, socialBuffer)) return;

        if (normalizedKey === 'gameState.社交' && action === 'set' && Array.isArray(cmd?.value)) {
            const nextOrigins = cmd.value.map((nextNpc: any) => {
                const currentBufferIndex = socialBuffer.findIndex((candidate) => NPC互相匹配(candidate, nextNpc));
                return currentBufferIndex >= 0 ? (socialOrigins[currentBufferIndex] ?? null) : null;
            });
            cmd.value.forEach((nextNpc: any, nextIndex: number) => {
                const npcIndex = nextOrigins[nextIndex];
                if (npcIndex == null) return;
                const currentNpc = existingSocial[npcIndex];
                const hasRealmText = Object.prototype.hasOwnProperty.call(nextNpc, '境界');
                const hasRealmLevel = Object.prototype.hasOwnProperty.call(nextNpc, '境界层级');
                const removesRealmText = Boolean(读取文本(currentNpc?.境界)) && !hasRealmText;
                const removesRealmLevel = 读取有效境界层级(currentNpc?.境界层级) != null && !hasRealmLevel;
                if (!hasRealmText && !hasRealmLevel && !removesRealmText && !removesRealmLevel) return;
                const state = ensureState(npcIndex);
                state.commandIndices.add(commandIndex);
                if (hasRealmText || removesRealmText) state.realmTextCommandIndices.add(commandIndex);
                if (hasRealmLevel || removesRealmLevel) state.realmLevelCommandIndices.add(commandIndex);
            });
            socialOrigins = nextOrigins;
        } else {
            const match = normalizedKey.match(/^gameState\.社交\[(\d+)\](?:\..+)?$/u);
            if (match) {
                const bufferIndex = Number(match[1]);
                const npcIndex = socialOrigins[bufferIndex];
                const affected = 命令包含境界字段(cmd, normalizedKey);
                if (npcIndex != null && (affected.realmText || affected.realmLevel)) {
                    const state = ensureState(npcIndex);
                    state.commandIndices.add(commandIndex);
                    if (affected.realmText) state.realmTextCommandIndices.add(commandIndex);
                    if (affected.realmLevel) state.realmLevelCommandIndices.add(commandIndex);
                }
            }
            if (normalizedKey === 'gameState.社交' && action === 'push') {
                socialOrigins.push(null);
            }
        }

        socialBuffer = 模拟社交命令(socialBuffer, { ...cmd, action });
    });

    const issues: Array<{ npcIndex: number; issue: string; commandIndices: Set<number> }> = [];
    commandStates.forEach((state, npcIndex) => {
        const currentNpc = existingSocial[npcIndex];
        const targetBufferIndex = socialOrigins.findIndex((origin) => origin === npcIndex);
        const targetNpc = targetBufferIndex >= 0 ? socialBuffer[targetBufferIndex] : undefined;
        if (!targetNpc || NPC存在明确永久跌境依据(currentNpc, response)) return;

        const currentLevel = 计算NPC当前境界层级(currentNpc);
        const currentNumericLevel = 读取有效境界层级(currentNpc?.境界层级);
        const currentRealmText = 读取文本(currentNpc?.境界);
        const targetRealmText = 读取文本(targetNpc?.境界);
        const targetNumericLevel = 读取有效境界层级(targetNpc?.境界层级);
        const targetTextLevel = 解析已知境界文本层级(targetNpc?.境界);
        const finalLevel = Math.max(targetNumericLevel || 0, targetTextLevel || 0, 1);
        const numericRegression = state.realmLevelCommandIndices.size > 0
            && (
                targetNumericLevel == null
                    ? currentNumericLevel != null
                    : targetNumericLevel < currentLevel
            );
        const textRegression = state.realmTextCommandIndices.size > 0
            && (
                (targetTextLevel != null && targetTextLevel < currentLevel)
                || (Boolean(currentRealmText) && (!targetRealmText || 境界占位文本正则.test(targetRealmText)))
            );
        const finalRegression = finalLevel < currentLevel;
        if (!numericRegression && !textRegression && !finalRegression) return;

        const nextLevels = [
            numericRegression ? targetNumericLevel : null,
            textRegression ? targetTextLevel : null,
            finalRegression ? finalLevel : null
        ].filter((value): value is number => value != null);
        const targetLabel = nextLevels.length > 0 ? String(Math.min(...nextLevels)) : '空/未知';
        const name = 读取文本(currentNpc?.姓名) || 读取文本(currentNpc?.名称) || `社交[${npcIndex}]`;
        issues.push({
            npcIndex,
            issue: `${name} 境界层级 ${currentLevel} -> ${targetLabel}，正文没有明确的永久跌境或旧档案纠错事实`,
            commandIndices: state.commandIndices
        });
    });

    return issues;
};

export const 检测NPC境界回退风险命令 = (
    commands: TavernCommand[] | any[],
    currentSocial: any[],
    response?: GameResponse
): string[] => 分析NPC境界回退(commands, currentSocial, response).map(({ issue }) => issue);

export const 提取NPC境界回退风险命令索引 = (
    commands: TavernCommand[] | any[],
    currentSocial: any[],
    response?: GameResponse
): Set<number> => {
    const indices = new Set<number>();
    分析NPC境界回退(commands, currentSocial, response).forEach(({ commandIndices }) => {
        commandIndices.forEach((index) => indices.add(index));
    });
    return indices;
};
