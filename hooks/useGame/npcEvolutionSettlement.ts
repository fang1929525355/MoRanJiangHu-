import type { NPC后台结算结构, TavernCommand } from '../../types';
import { calculateEffectivePowerLevel, normalizeAbilitySystems } from '../../utils/abilitySystems';

type SettlementInput = {
    social: any[];
    activeNpcs: any[];
};

export type NpcSettlementResult = {
    commands: TavernCommand[];
    rejections: string[];
};

const equipmentSlots = new Set(['主武器', '副武器', '服装', '饰品', '内衣', '内裤', '袜饰', '鞋履']);
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const normalizedName = (value: unknown): string => text(value).replace(/\s+/g, '').replace(/^\[女主\]/, '');
const activeNpcKey = (npc: any): string => text(npc?.npcId) || normalizedName(npc?.姓名);

export const mergeNpcSettlementCandidates = (beforePruning: any[], finalActiveNpcs: any[]): any[] => {
    const merged = Array.isArray(finalActiveNpcs) ? [...finalActiveNpcs] : [];
    const retainedKeys = new Set(merged.map(activeNpcKey).filter(Boolean));
    for (const npc of Array.isArray(beforePruning) ? beforePruning : []) {
        if (npc?.settlement?.status !== 'success') continue;
        const key = activeNpcKey(npc);
        if (key && retainedKeys.has(key)) continue;
        merged.push(npc);
        if (key) retainedKeys.add(key);
    }
    return merged;
};

export const findNpcIndex = (social: any[], activeNpc: any): { index: number; error?: string } => {
    const npcId = text(activeNpc?.npcId);
    if (npcId) {
        const matches = social.map((npc, index) => ({ npc, index })).filter(({ npc }) => text(npc?.id) === npcId);
        if (matches.length === 1) return { index: matches[0].index };
        if (matches.length > 1) return { index: -1, error: `NPC ID 不唯一：${npcId}` };
    }
    const name = normalizedName(activeNpc?.姓名);
    const matches = social.map((npc, index) => ({ npc, index })).filter(({ npc }) => normalizedName(npc?.姓名) === name);
    if (matches.length === 1) return { index: matches[0].index };
    return { index: -1, error: matches.length > 1 ? `NPC 姓名不唯一：${name}` : `未找到 NPC 档案：${name || '未命名'}` };
};

const realmCommands = (npc: any, index: number, settlement: NPC后台结算结构, rejections: string[]): TavernCommand[] => {
    const change = settlement.realmChange;
    if (!change) return [];
    const systemName = text(change.systemName);
    const systemId = text(change.systemId);
    const fromRealm = text(change.fromRealm);
    const toRealm = text(change.toRealm);
    const powerLevel = Math.round(Number(change.powerLevel));
    const systemLevel = Math.round(Number(change.systemLevel));
    const systems = normalizeAbilitySystems(npc);
    const allProgress = [systems.primary, ...systems.secondary];
    const matches = systemId
        ? allProgress.filter((item) => text(item.systemId) === systemId)
        : allProgress.filter((item) => item.systemName === systemName);
    if (matches.length > 1) {
        rejections.push(`${text(npc?.姓名)}：${systemId ? '能力体系 ID' : '能力体系名称'}不唯一（${systemId || systemName}）`);
        return [];
    }
    const matchingProgress = matches[0];
    const hasStructuredSystems = npc?.能力体系 && typeof npc.能力体系 === 'object';
    if (hasStructuredSystems && !matchingProgress) {
        rejections.push(`${text(npc?.姓名)}：能力体系不存在（${systemName || '未填写'}）`);
        return [];
    }
    const isPrimary = !matchingProgress || matchingProgress === systems.primary;
    const currentRealm = matchingProgress?.realmName || text(npc?.境界);
    const currentPower = matchingProgress?.powerLevel || Number(npc?.境界层级) || systems.primary.powerLevel;
    if (!systemName || !fromRealm || !toRealm || !Number.isFinite(powerLevel) || !Number.isFinite(systemLevel)) {
        rejections.push(`${text(npc?.姓名)}：境界结算字段不完整`);
        return [];
    }
    if (currentRealm !== fromRealm) {
        rejections.push(`${text(npc?.姓名)}：旧境界不匹配（当前 ${currentRealm}，结算 ${fromRealm}）`);
        return [];
    }
    if (powerLevel < currentPower || powerLevel < 1 || systemLevel < 1) {
        rejections.push(`${text(npc?.姓名)}：境界档位非法`);
        return [];
    }
    const majorStageThresholds = [1, 5, 9, 13, 17, 21, 27, 33, 43];
    const majorStageIndex = (level: number) => majorStageThresholds.filter((threshold) => level >= threshold).length - 1;
    if (majorStageIndex(powerLevel) - majorStageIndex(currentPower) > 1 && !/(机缘|传承|长期|多年|数年|积累|奇遇|秘境)/.test(settlement.reason)) {
        rejections.push(`${text(npc?.姓名)}：跨越多个大阶段但缺少重大机缘、传承或长期积累说明`);
        return [];
    }
    const progress = { systemId: matchingProgress?.systemId || systemId || undefined, systemName, realmName: toRealm, systemLevel, powerLevel };
    const nextSystems = !isPrimary
        ? { ...systems, secondary: systems.secondary.map((item) => item === matchingProgress ? progress : item) }
        : { ...systems, primary: progress };
    const effectiveLevel = calculateEffectivePowerLevel(nextSystems.primary, nextSystems.secondary);
    return [
        { action: 'set', key: `社交[${index}].能力体系`, value: nextSystems },
        ...(isPrimary ? [{ action: 'set' as const, key: `社交[${index}].境界`, value: toRealm }] : []),
        { action: 'set', key: `社交[${index}].境界层级`, value: effectiveLevel }
    ];
};

const equipmentCommands = (npc: any, index: number, settlement: NPC后台结算结构, rejections: string[]): TavernCommand[] => {
    const changes = Array.isArray(settlement.equipmentChanges) ? settlement.equipmentChanges : [];
    if (changes.length === 0) return [];
    const equipment = { ...(npc?.当前装备 && typeof npc.当前装备 === 'object' ? npc.当前装备 : {}) };
    const backpack = Array.isArray(npc?.背包) ? npc.背包.map((item: any) => ({ ...item })) : [];
    const commands: TavernCommand[] = [];
    let backpackChanged = false;
    const addToBackpack = (itemName: string, description: string) => {
        const found = backpack.find((item: any) => text(item?.名称) === itemName);
        if (found) found.数量 = Math.max(0, Number(found.数量) || 0) + 1;
        else backpack.push({ 名称: itemName, 数量: 1, 描述: description });
        backpackChanged = true;
    };
    const consumeFromBackpack = (itemName: string): boolean => {
        const itemIndex = backpack.findIndex((item: any) => text(item?.名称) === itemName);
        if (itemIndex < 0) return false;
        const count = Math.max(1, Number(backpack[itemIndex]?.数量) || 1);
        if (count > 1) backpack[itemIndex].数量 = count - 1;
        else backpack.splice(itemIndex, 1);
        backpackChanged = true;
        return true;
    };
    const validGains = changes.filter((change) => change?.action === 'gain').filter((change) => {
        const itemName = text(change?.itemName);
        const source = text(change?.source);
        if (itemName && source) return true;
        rejections.push(`${text(npc?.姓名)}：装备变化缺少具体物品或来源`);
        return false;
    });
    for (const change of validGains) {
        addToBackpack(text(change.itemName), text(change.description) || `来源：${text(change.source)}`);
    }
    for (const change of changes.filter((item) => item?.action !== 'gain')) {
        const itemName = text(change?.itemName);
        const source = text(change?.source);
        const slot = text(change?.slot);
        if (!itemName || !source) {
            rejections.push(`${text(npc?.姓名)}：装备变化缺少具体物品或来源`);
            continue;
        }
        if (change.action === 'equip') {
            if (!equipmentSlots.has(slot)) {
                rejections.push(`${text(npc?.姓名)}：穿戴槽位非法（${slot || '未填写'}）`);
                continue;
            }
            const equippedSlot = Object.keys(equipment).find((key) => text(equipment[key]) === itemName);
            const fromBackpack = consumeFromBackpack(itemName);
            if (!fromBackpack && !equippedSlot) {
                rejections.push(`${text(npc?.姓名)}：无法穿戴未持有的装备 ${itemName}`);
                continue;
            }
            if (equippedSlot && equippedSlot !== slot) {
                equipment[equippedSlot] = '无';
                commands.push({ action: 'set', key: `社交[${index}].当前装备.${equippedSlot}`, value: '无' });
            }
            equipment[slot] = itemName;
            commands.push({ action: 'set', key: `社交[${index}].当前装备.${slot}`, value: itemName });
            continue;
        }
        if (change.action === 'unequip') {
            if (!equipmentSlots.has(slot) || text(equipment[slot]) !== itemName) {
                rejections.push(`${text(npc?.姓名)}：无法卸下不存在的装备 ${itemName}`);
                continue;
            }
            equipment[slot] = '无';
            addToBackpack(itemName, `卸下：${source}`);
            commands.push({ action: 'set', key: `社交[${index}].当前装备.${slot}`, value: '无' });
            continue;
        }
        if (change.action === 'lose') {
            const before = backpack.length;
            for (let i = backpack.length - 1; i >= 0; i -= 1) if (text(backpack[i]?.名称) === itemName) backpack.splice(i, 1);
            let found = backpack.length !== before;
            Object.keys(equipment).forEach((key) => {
                if (text(equipment[key]) === itemName) {
                    equipment[key] = '无';
                    found = true;
                    commands.push({ action: 'set', key: `社交[${index}].当前装备.${key}`, value: '无' });
                }
            });
            if (!found) rejections.push(`${text(npc?.姓名)}：无法失去未持有的装备 ${itemName}`);
            else backpackChanged = true;
            continue;
        }
        if (change.action === 'damage') {
            const equippedSlot = Object.keys(equipment).find((key) => text(equipment[key]) === itemName);
            const found = backpack.find((item: any) => text(item?.名称) === itemName);
            if (equippedSlot) {
                equipment[equippedSlot] = `${itemName}（受损）`;
                commands.push({ action: 'set', key: `社交[${index}].当前装备.${equippedSlot}`, value: equipment[equippedSlot] });
            } else if (found) {
                found.描述 = `${text(found.描述)}；受损：${text(change.description) || source}`.replace(/^；/, '');
                backpackChanged = true;
            } else rejections.push(`${text(npc?.姓名)}：无法损坏未持有的装备 ${itemName}`);
        }
    }
    if (backpackChanged) commands.push({ action: 'set', key: `社交[${index}].背包`, value: backpack });
    return commands;
};

export const buildNpcSettlementCommands = ({ social, activeNpcs }: SettlementInput): NpcSettlementResult => {
    const commands: TavernCommand[] = [];
    const rejections: string[] = [];
    const candidates = [] as Array<{ activeNpc: any; settlement: NPC后台结算结构; index: number }>;
    for (const activeNpc of Array.isArray(activeNpcs) ? activeNpcs : []) {
        const settlement = activeNpc?.settlement as NPC后台结算结构 | undefined;
        if (!settlement || settlement.status !== 'success') continue;
        if (!text(settlement.reason)) {
            rejections.push(`${text(activeNpc?.姓名)}：成功结算缺少原因`);
            continue;
        }
        const match = findNpcIndex(Array.isArray(social) ? social : [], activeNpc);
        if (match.index < 0) {
            rejections.push(match.error || 'NPC 匹配失败');
            continue;
        }
        candidates.push({ activeNpc, settlement, index: match.index });
    }
    const grouped = new Map<number, typeof candidates>();
    for (const candidate of candidates) grouped.set(candidate.index, [...(grouped.get(candidate.index) || []), candidate]);
    for (const [index, group] of grouped) {
        const signatures = new Set(group.map(({ settlement }) => JSON.stringify({
            realmChange: settlement.realmChange || null,
            equipmentChanges: settlement.equipmentChanges || []
        })));
        if (signatures.size > 1) {
            rejections.push(`${text(social[index]?.姓名)}：同一轮存在互相冲突的成功结算`);
            continue;
        }
        const settlement = group[0].settlement;
        const npc = social[index];
        commands.push(...realmCommands(npc, index, settlement, rejections));
        commands.push(...equipmentCommands(npc, index, settlement, rejections));
    }
    return { commands, rejections };
};
