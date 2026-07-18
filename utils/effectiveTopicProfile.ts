import type { ModeRuntimeProfile, 模式界面文案覆盖, 题材模式类型 } from '../models/system';
import { 获取题材模式配置, 题材模式顺序 } from './topicModeProfiles';
import type { 题材模式配置 } from './topicModeProfiles';
import { 构建世界观货币口径 } from '../prompts/runtime/worldGenerationRuntimeConstraints';

/**
 * 生效题材配置：官方题材配置 + 模式包 runtime 覆盖后的单一真实来源。
 * 所有 UI/服务/prompt 消费点都应通过它读取题材口径，而不是直接查官方配置表。
 */
export interface 生效题材配置 extends 题材模式配置 {
    /** 市场/拍卖行显示名，与 auctionName 保持一致，语义上属于 runtime economy */
    marketName: string;
    /** 是否由自定义模式包 runtime 驱动（官方模式与官方生成的 runtime 均为 false） */
    usesCustomRuntime: boolean;
}

const 非空文本 = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const 非空文本列表 = (value: unknown): string[] => (
    Array.isArray(value) ? value.map(非空文本).filter(Boolean) : []
);

const 官方题材值集合 = new Set<string>(题材模式顺序 as readonly string[]);
const 官方题材标签集合 = new Set<string>(题材模式顺序.map((item) => 获取题材模式配置(item).label));

/**
 * 判断 runtime 是否来自自定义模式包。
 * 官方模式通过 `构建官方模式运行时配置` 生成的 runtime，其 modeId 恒为官方题材值、
 * displayName 恒为官方 label；因此：
 * 1. modeId 存在且不属于官方题材值集合 → 自定义包（displayName 为空或与官方同名也能识别）；
 * 2. 兜底：displayName 存在且不属于任何官方 label → 自定义包
 *    （用全集而非当前模式的 label 比对，避免官方 runtime 与存档模式暂时不配对时被误判为自定义）。
 */
export const 是否自定义模式运行时配置 = (
    runtimeProfile?: ModeRuntimeProfile | null,
    _mode?: 题材模式类型 | null
): boolean => {
    if (!runtimeProfile) return false;
    const modeId = 非空文本(runtimeProfile.identity?.modeId);
    if (modeId && !官方题材值集合.has(modeId)) return true;
    const displayName = 非空文本(runtimeProfile.identity?.displayName);
    return Boolean(displayName && !官方题材标签集合.has(displayName));
};

/**
 * 读取 uiLabels 指定分区的合法覆盖项：只保留非空字符串值，键名裁剪空白。
 * 非法键的剥离由消费侧按官方结构合并时完成（未知键不会被拷贝进结果）。
 */
export const 读取界面文案覆盖分区 = (
    runtimeProfile?: ModeRuntimeProfile | null,
    section?: keyof 模式界面文案覆盖
): Record<string, string> => {
    if (!runtimeProfile || !section) return {};
    const raw = runtimeProfile.uiLabels?.[section];
    if (!raw || typeof raw !== 'object') return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
        const label = 非空文本(value);
        const trimmedKey = key.trim();
        if (trimmedKey && label) result[trimmedKey] = label;
    }
    return result;
};

/**
 * 以官方文案对象为键集合基准，应用覆盖项；官方结构之外的键被剥离。
 */
export const 按官方键合并覆盖 = <T extends Record<string, string>>(
    official: T,
    ...overrides: Array<Record<string, string | undefined>>
): T => {
    const result: Record<string, string> = { ...official };
    for (const override of overrides) {
        for (const [key, value] of Object.entries(override)) {
            if (!Object.prototype.hasOwnProperty.call(official, key)) continue;
            const label = 非空文本(value);
            if (label) result[key] = label;
        }
    }
    return result as T;
};

/**
 * 解析生效题材配置：无 runtime 或官方 runtime 时逐字段等于官方配置；
 * 自定义模式包 runtime 时按既有字段派生换源，并应用 uiLabels.向导 显式覆盖。
 */
export const 解析生效题材配置 = (
    mode?: 题材模式类型 | null,
    runtimeProfile?: ModeRuntimeProfile | null
): 生效题材配置 => {
    const custom = 是否自定义模式运行时配置(runtimeProfile, mode);
    const baseMode = custom && runtimeProfile?.identity?.baseMode
        ? runtimeProfile.identity.baseMode
        : mode || runtimeProfile?.identity?.baseMode;
    const official = 获取题材模式配置(baseMode);
    if (!custom || !runtimeProfile) {
        return { ...official, marketName: official.auctionName, usesCustomRuntime: false };
    }

    const runtimeLabel = 非空文本(runtimeProfile.identity.displayName) || official.label;
    const marketName = 非空文本(runtimeProfile.economy?.marketName) || official.auctionName;
    const skillPool = 非空文本列表(runtimeProfile.ability?.skillPool);
    const itemPool = 非空文本列表(runtimeProfile.items?.initialItemPool);
    const 向导覆盖 = 读取界面文案覆盖分区(runtimeProfile, '向导');
    const 密度选项覆盖 = 读取界面文案覆盖分区(runtimeProfile, '密度选项');
    const 组织名 = 非空文本(runtimeProfile.organization?.organizationName) || '组织';
    const 成员名 = 非空文本(runtimeProfile.organization?.memberName) || '成员';
    const 组织口径片段 = [
        非空文本(runtimeProfile.organization?.organizationName),
        非空文本(runtimeProfile.organization?.memberName),
        非空文本(runtimeProfile.organization?.contributionName)
    ].filter(Boolean).join(' / ');
    const 能力口径片段 = [
        非空文本(runtimeProfile.ability?.primaryAxis),
        非空文本(runtimeProfile.ability?.combatResolution)
    ].filter(Boolean).join('；');
    const currencyRules = 构建世界观货币口径(runtimeProfile, official.currencyExchangePrompt);

    const runtimePromptLines = [
        `本存档使用「${runtimeLabel}」自定义模式包，请严格使用模式包自身的世界观与用词口径。`,
        `交易口径：${非空文本(runtimeProfile.economy?.primaryCurrency) || official.currencyPrompt}`,
        `统一换算口径：${currencyRules}`,
        `地图/势力口径：${非空文本(runtimeProfile.map?.mapPrompt) || official.mapPrompt}`,
        组织口径片段 ? `组织口径：${组织口径片段}` : '',
        能力口径片段 ? `能力口径：${能力口径片段}` : ''
    ].filter(Boolean);

    const 向导标签 = <K extends keyof 题材模式配置>(key: K & string, fallback: string): string => (
        向导覆盖[key] || fallback
    );

    return {
        ...official,
        label: runtimeLabel,
        shortLabel: runtimeLabel.slice(0, 4) || official.shortLabel,
        hint: '自定义模式包，使用该模式包保存的世界观、交易、地图和能力口径。',
        auctionName: marketName,
        marketName,
        marketVerb: 非空文本(runtimeProfile.economy?.marketVerb) || official.marketVerb,
        currencyPrompt: 非空文本(runtimeProfile.economy?.primaryCurrency) || official.currencyPrompt,
        currencyExchangePrompt: currencyRules,
        mapPrompt: 非空文本(runtimeProfile.map?.mapPrompt) || official.mapPrompt,
        skillNames: skillPool.length > 0 ? skillPool : official.skillNames,
        presetItemKeywords: itemPool.length > 0 ? itemPool : official.presetItemKeywords,
        promptLines: runtimePromptLines,
        promptBoundary: `开局可以生成${组织名}、${成员名}与相关据点或组织关系；请严格使用本模式包世界书与运行时配置的口径，不要混入基底题材的默认组织、市场或能力词汇。`,
        densityOptions: official.densityOptions.map((option) => (
            密度选项覆盖[option.value] ? { ...option, label: 密度选项覆盖[option.value] } : option
        )),
        worldSizeLabel: 向导标签('worldSizeLabel', official.worldSizeLabel),
        worldSizeHint: 向导标签('worldSizeHint', official.worldSizeHint),
        dynastyLabel: 向导标签('dynastyLabel', official.dynastyLabel),
        dynastyHint: 向导标签('dynastyHint', official.dynastyHint),
        densityLabel: 向导标签('densityLabel', official.densityLabel),
        densityPromptLabel: 向导标签('densityPromptLabel', official.densityPromptLabel),
        tianjiaoLabel: 向导标签('tianjiaoLabel', official.tianjiaoLabel),
        usesCustomRuntime: true
    };
};
