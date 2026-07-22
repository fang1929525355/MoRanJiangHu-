import type { AbilitySystemProgress, CharacterAbilitySystems } from '../types';

type PowerLevelLike = Pick<AbilitySystemProgress, 'powerLevel'> | { powerLevel?: unknown };

const 读取正整数 = (value: unknown, fallback = 1): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(1, Math.round(numeric)) : fallback;
};

const 读取文本 = (value: unknown, fallback = ''): string => (
    typeof value === 'string' && value.trim() ? value.trim() : fallback
);

export const calculateEffectivePowerLevel = (
    primary: PowerLevelLike,
    secondary: PowerLevelLike[],
    maxLevel = 43
): number => {
    const primaryLevel = 读取正整数(primary?.powerLevel);
    const strongestSecondary = Math.max(0, ...(Array.isArray(secondary) ? secondary : []).map((item) => {
        const value = Number(item?.powerLevel);
        return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    }));
    const gap = primaryLevel - strongestSecondary;
    const bonus = strongestSecondary <= 0 || gap >= 4 ? 0 : gap >= 1 ? 1 : 2;
    return Math.min(Math.max(1, Math.round(maxLevel)), primaryLevel + bonus);
};

const normalizeProgress = (raw: any, fallback?: Partial<AbilitySystemProgress>): AbilitySystemProgress => ({
    systemId: 读取文本(raw?.systemId || fallback?.systemId) || undefined,
    systemName: 读取文本(raw?.systemName, 读取文本(fallback?.systemName, '默认体系')),
    realmName: 读取文本(raw?.realmName, 读取文本(fallback?.realmName, '未知境界')),
    systemLevel: 读取正整数(raw?.systemLevel, 读取正整数(fallback?.systemLevel)),
    powerLevel: 读取正整数(raw?.powerLevel, 读取正整数(fallback?.powerLevel))
});

export const normalizeAbilitySystems = (source: any): CharacterAbilitySystems => {
    const structured = source?.能力体系;
    const legacyRealm = 读取文本(source?.境界, '未知境界');
    const legacyLevel = 读取正整数(source?.境界层级);
    const primary = normalizeProgress(structured?.primary, {
        systemName: '默认体系',
        realmName: legacyRealm,
        systemLevel: legacyLevel,
        powerLevel: legacyLevel
    });
    const secondary = Array.isArray(structured?.secondary)
        ? structured.secondary.map((item: any) => normalizeProgress(item))
        : [];
    return { primary, secondary };
};
