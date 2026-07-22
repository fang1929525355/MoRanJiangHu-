import { describe, expect, it } from 'vitest';
import { calculateEffectivePowerLevel, normalizeAbilitySystems } from '../utils/abilitySystems';
import { buildRealmPromptFromDraft, normalizeRealmDraft } from '../utils/newGameDiy';

const realmRow = (name: string, level: number) => ({
    id: `${name}-${level}`,
    name,
    level,
    power: '',
    breakthrough: '',
    parameters: '',
    description: ''
});

describe('multi-system realm DIY', () => {
    it('migrates legacy rows into one primary-capable default system', () => {
        const draft = normalizeRealmDraft({ rows: [realmRow('锻体境', 1)] });
        expect(draft.systems).toHaveLength(1);
        expect(draft.systems?.[0]).toMatchObject({ name: '默认体系', role: 'primary_or_secondary' });
        expect(draft.systems?.[0].rows[0].name).toBe('锻体境');
    });

    it('normalizes independent rows for every system', () => {
        const draft = normalizeRealmDraft({
            systems: [
                { id: 'martial', name: '武者', description: '体魄近战', energyType: '气血', role: 'primary_or_secondary', rows: [realmRow('锻骨', 3)] },
                { id: 'dao', name: '道士', description: '符箓术法', energyType: '法力', role: 'primary_or_secondary', rows: [realmRow('炼气', 3)] }
            ]
        });
        expect(draft.systems?.map((system) => system.name)).toEqual(['武者', '道士']);
        expect(draft.systems?.[0].rows[0].name).toBe('锻骨');
        expect(draft.systems?.[1].rows[0].name).toBe('炼气');
    });

    it('uses bounded secondary-system synergy instead of adding all levels', () => {
        expect(calculateEffectivePowerLevel({ powerLevel: 6 }, [])).toBe(6);
        expect(calculateEffectivePowerLevel({ powerLevel: 6 }, [{ powerLevel: 2 }])).toBe(6);
        expect(calculateEffectivePowerLevel({ powerLevel: 6 }, [{ powerLevel: 4 }])).toBe(7);
        expect(calculateEffectivePowerLevel({ powerLevel: 6 }, [{ powerLevel: 6 }, { powerLevel: 8 }])).toBe(8);
    });

    it('adapts legacy realm fields as a single primary system', () => {
        expect(normalizeAbilitySystems({ 境界: '锻骨境', 境界层级: 3 })).toMatchObject({
            primary: { systemName: '默认体系', realmName: '锻骨境', powerLevel: 3 },
            secondary: []
        });
    });

    it('emits separate system mappings plus one compatibility mapping', () => {
        const prompt = buildRealmPromptFromDraft({
            systems: [
                { id: 'martial', name: '武者', description: '近战', energyType: '气血', role: 'primary_or_secondary', rows: [realmRow('武者第二境', 3)] },
                { id: 'dao', name: '道士', description: '术法', energyType: '法力', role: 'primary_or_secondary', rows: [realmRow('道士第一境', 3)] }
            ]
        });
        expect(prompt).toContain('【能力体系：武者】');
        expect(prompt).toContain('【能力体系：道士】');
        expect(prompt).toContain('3 => 武者第二境');
        expect(prompt).toContain('3 => 道士第一境');
        expect(prompt).toContain('同档不等于能力相同');
        expect(prompt.match(/【境界映射母板】/g)).toHaveLength(1);
    });
});
