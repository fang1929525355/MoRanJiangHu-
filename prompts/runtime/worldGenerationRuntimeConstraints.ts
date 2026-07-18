import type { ModeRuntimeProfile, OpeningRuntimeSnapshot } from '../../types';
import type { 世界书条目结构 } from '../../models/worldbook';

const 取文本 = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const 格式化倍率 = (value: number): string => (
    Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
);

export const 构建世界观货币口径 = (
    runtimeProfile: ModeRuntimeProfile | null | undefined,
    officialFallback: string
): string => {
    const currencySystem = runtimeProfile?.economy?.currencySystem;
    const units = currencySystem?.units
        ?.filter((unit) => unit && 取文本(unit.id) && 取文本(unit.name) && Number.isFinite(unit.baseRate) && unit.baseRate > 0)
        .slice()
        .sort((a, b) => a.order - b.order);

    if (currencySystem && units?.length === 1) {
        const unit = units[0];
        const extras = [
            unit.symbol ? `符号=${unit.symbol}` : '',
            unit.aliases?.length ? `别名=${unit.aliases.join('、')}` : ''
        ].filter(Boolean).join('；');
        return `本世界仅使用“${unit.name}”作为唯一记账与结算货币${extras ? `（${extras}）` : ''}；不存在上层、中层、底层货币及层级兑换；不得恢复基底题材的三层货币。`;
    }

    if (currencySystem && units && units.length > 1) {
        const baseUnit = units.find((unit) => unit.id === currencySystem.baseUnitId) || units[0];
        const relations = units.map((unit) => {
            if (unit.id === baseUnit.id) return `${unit.name}=基础单位`;
            return `1 ${unit.name}=${格式化倍率(unit.baseRate / baseUnit.baseRate)} ${baseUnit.name}`;
        });
        return `本世界使用“${currencySystem.name}”：${relations.join('；')}。所有价格与结算只使用这些单位，不得混入旧版货币层级。`;
    }

    return 取文本(runtimeProfile?.economy?.exchangeRules) || 取文本(officialFallback);
};

const 选择受管条目 = (
    snapshot: OpeningRuntimeSnapshot | null | undefined,
    suffix: string,
    title: string
): 世界书条目结构 | undefined => (
    (snapshot?.modeWorldbooks || [])
        .filter((book) => book.启用 !== false)
        .flatMap((book) => book.条目 || [])
        .filter((entry) => entry.启用 !== false && 取文本(entry.内容))
        .filter((entry) => entry.id.endsWith(suffix) || entry.标题 === title)
        .sort((a, b) => {
            const idScore = Number(b.id.endsWith(suffix)) - Number(a.id.endsWith(suffix));
            if (idScore !== 0) return idScore;
            const priorityScore = (b.优先级 || 0) - (a.优先级 || 0);
            return priorityScore || (b.更新时间 || 0) - (a.更新时间 || 0);
        })[0]
);

const 清理受管叙事正文 = (content: string, heading: string): string => content
    .replace(new RegExp(`^【模式包${heading}】\\s*`), '')
    .replace(/\n+边界：[\s\S]*$/u, '')
    .trim();

export const 构建模式包世界观叙事约束 = (
    snapshot: OpeningRuntimeSnapshot | null | undefined
): string => {
    const mainEntry = 选择受管条目(snapshot, '-narrative-main-story', '主线方向');
    const hiddenEntry = 选择受管条目(snapshot, '-narrative-hidden-plot', '暗线策略');
    const main = mainEntry
        ? 清理受管叙事正文(mainEntry.内容, '主线方向')
        : 取文本((snapshot as any)?.mainStoryDirection);
    const hidden = hiddenEntry
        ? 清理受管叙事正文(hiddenEntry.内容, '暗线策略')
        : 取文本((snapshot as any)?.hiddenPlotPolicy);
    if (!main && !hidden) return '';

    return [
        '【模式包世界观生成约束】',
        main ? `- 主线承载方向：${main}` : '',
        main ? '- 只据此塑造社会结构、资源压力、冲突来源与可持续活动空间，不把主线写成已经发生的固定事件。' : '',
        hidden ? `- 暗线生长边界：${hidden}` : '',
        hidden ? '- 只据此塑造信息差、秘密与可回收伏笔的生长条件，不得点名幕后黑手、公开真相、确定最终反派或预告结局。' : '',
        '- 当前阶段只生成世界母本，不生成玩家专属任务线、主角专属机缘或围绕主角量身定做的世界。',
        '- 具体事件必须留给开场和后续回合依据玩家行动生成。'
    ].filter(Boolean).join('\n');
};
