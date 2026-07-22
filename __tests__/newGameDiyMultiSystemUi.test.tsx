import { describe, expect, it } from 'vitest';
import { addRealmSystem, removeRealmSystem, updateRealmSystem } from '../components/features/NewGame/NewGameDiyTools';
import { normalizeRealmDraft } from '../utils/newGameDiy';

const row = { id: 'r1', name: '锻骨', level: 3, power: '', breakthrough: '', parameters: '', description: '' };

describe('realm DIY system editor helpers', () => {
    it('adds and edits a second realm system without changing the first rows', () => {
        const initial = normalizeRealmDraft({ rows: [row] });
        const added = addRealmSystem(initial, '道士');
        const secondId = added.systems?.[1].id || '';
        const edited = updateRealmSystem(added, secondId, { energyType: '法力' });
        expect(edited.systems?.[0].rows[0].name).toBe('锻骨');
        expect(edited.systems?.[1]).toMatchObject({ name: '道士', energyType: '法力' });
    });

    it('does not remove the final remaining realm system', () => {
        const initial = normalizeRealmDraft({ rows: [row] });
        expect(removeRealmSystem(initial, initial.systems?.[0].id || '').systems).toHaveLength(1);
    });
});
