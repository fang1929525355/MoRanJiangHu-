import { describe, expect, it } from 'vitest';
import { buildNpcSettlementCommands, mergeNpcSettlementCandidates } from '../hooks/useGame/npcEvolutionSettlement';

const npc = (name = '沈青萝') => ({
    id: `npc-${name}`,
    姓名: name,
    境界: '炼气圆满',
    境界层级: 4,
    当前装备: {},
    背包: []
});

const activeNpc = (settlement: any, extra: any = {}) => ({
    npcId: 'npc-沈青萝',
    姓名: '沈青萝',
    当前行动: '闭关修炼',
    settlement,
    ...extra
});

describe('NPC background settlement bridge', () => {
    it('preserves a successful settlement that was pruned from the final active list', () => {
        const settled = activeNpc({ status: 'success', reason: '闭关完成' });
        expect(mergeNpcSettlementCandidates([settled], [])).toEqual([settled]);
    });

    it('persists a successful realm settlement by npc id', () => {
        const result = buildNpcSettlementCommands({
            social: [npc()],
            activeNpcs: [activeNpc({
                status: 'success',
                reason: '完成七日闭关并服用筑基丹后突破',
                realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '筑基初期', systemLevel: 1, powerLevel: 5 }
            })]
        });
        expect(result.commands).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'set', key: '社交[0].境界', value: '筑基初期' }),
            expect.objectContaining({ action: 'set', key: '社交[0].境界层级', value: 5 })
        ]));
    });

    it.each(['pending', 'failed', 'interrupted'] as const)('does not persist %s settlements', (status) => {
        const result = buildNpcSettlementCommands({ social: [npc()], activeNpcs: [activeNpc({ status, reason: '未成功' })] });
        expect(result.commands).toEqual([]);
    });

    it('rejects ambiguous name matches', () => {
        const result = buildNpcSettlementCommands({
            social: [{ ...npc(), id: 'one' }, { ...npc(), id: 'two' }],
            activeNpcs: [activeNpc({
                status: 'success', reason: '完成闭关',
                realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '筑基初期', systemLevel: 1, powerLevel: 5 }
            }, { npcId: '' })]
        });
        expect(result.commands).toEqual([]);
        expect(result.rejections[0]).toContain('姓名不唯一');
    });

    it('falls back to a unique name when the provided npc id is stale', () => {
        const result = buildNpcSettlementCommands({
            social: [npc()],
            activeNpcs: [activeNpc({
                status: 'success', reason: '闭关完成',
                realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '筑基初期', systemLevel: 5, powerLevel: 5 }
            }, { npcId: 'stale-id' })]
        });
        expect(result.commands.some((command) => command.key === '社交[0].境界')).toBe(true);
    });

    it('rejects a realm change whose previous realm does not match', () => {
        const result = buildNpcSettlementCommands({
            social: [npc()],
            activeNpcs: [activeNpc({
                status: 'success', reason: '完成闭关',
                realmChange: { systemName: '道士', fromRealm: '炼气初期', toRealm: '筑基初期', systemLevel: 1, powerLevel: 5 }
            })]
        });
        expect(result.commands).toEqual([]);
        expect(result.rejections[0]).toContain('旧境界不匹配');
    });

    it('updates secondary progress without replacing the primary legacy realm', () => {
        const result = buildNpcSettlementCommands({
            social: [{
                ...npc(),
                境界: '武道宗师',
                境界层级: 12,
                能力体系: {
                    primary: { systemName: '武者', realmName: '武道宗师', systemLevel: 12, powerLevel: 12 },
                    secondary: [{ systemName: '道士', realmName: '炼气圆满', systemLevel: 4, powerLevel: 4 }]
                }
            }],
            activeNpcs: [activeNpc({
                status: 'success',
                reason: '完成闭关后道法突破',
                realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '筑基初期', systemLevel: 5, powerLevel: 5 }
            })]
        });

        expect(result.rejections).toEqual([]);
        expect(result.commands).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: '社交[0].能力体系',
                value: expect.objectContaining({
                    primary: expect.objectContaining({ realmName: '武道宗师' }),
                    secondary: [expect.objectContaining({ systemName: '道士', realmName: '筑基初期', powerLevel: 5 })]
                })
            }),
            expect.objectContaining({ key: '社交[0].境界层级', value: 12 })
        ]));
        expect(result.commands.some((command) => command.key === '社交[0].境界')).toBe(false);
    });

    it('rejects an unknown system when the npc already has structured systems', () => {
        const result = buildNpcSettlementCommands({
            social: [{
                ...npc(),
                能力体系: {
                    primary: { systemName: '武者', realmName: '炼气圆满', systemLevel: 4, powerLevel: 4 },
                    secondary: []
                }
            }],
            activeNpcs: [activeNpc({
                status: 'success',
                reason: '后台声称发生突破',
                realmChange: { systemName: '不存在的体系', fromRealm: '炼气圆满', toRealm: '筑基初期', systemLevel: 5, powerLevel: 5 }
            })]
        });

        expect(result.commands).toEqual([]);
        expect(result.rejections[0]).toContain('能力体系不存在');
    });

    it('uses system id before an ambiguous system name', () => {
        const result = buildNpcSettlementCommands({
            social: [{
                ...npc(),
                能力体系: {
                    primary: { systemId: 'primary-dao', systemName: '道士', realmName: '炼气圆满', systemLevel: 4, powerLevel: 4 },
                    secondary: [{ systemId: 'secondary-dao', systemName: '道士', realmName: '符师初境', systemLevel: 2, powerLevel: 2 }]
                }
            }],
            activeNpcs: [activeNpc({
                status: 'success', reason: '符法修炼完成',
                realmChange: { systemId: 'secondary-dao', systemName: '道士', fromRealm: '符师初境', toRealm: '符师中境', systemLevel: 3, powerLevel: 3 }
            })]
        });
        const systemsCommand = result.commands.find((command) => command.key === '社交[0].能力体系');
        expect((systemsCommand?.value as any)?.primary.realmName).toBe('炼气圆满');
        expect((systemsCommand?.value as any)?.secondary[0].realmName).toBe('符师中境');
    });

    it('updates only the secondary system selected by id when names repeat', () => {
        const result = buildNpcSettlementCommands({
            social: [{
                ...npc(),
                能力体系: {
                    primary: { systemId: 'martial', systemName: '武者', realmName: '武道宗师', systemLevel: 12, powerLevel: 12 },
                    secondary: [
                        { systemId: 'dao-a', systemName: '道士', realmName: '符师初境', systemLevel: 2, powerLevel: 2 },
                        { systemId: 'dao-b', systemName: '道士', realmName: '炼气圆满', systemLevel: 4, powerLevel: 4 }
                    ]
                },
                境界: '武道宗师',
                境界层级: 12
            }],
            activeNpcs: [activeNpc({
                status: 'success', reason: '符法修炼完成',
                realmChange: { systemId: 'dao-a', systemName: '道士', fromRealm: '符师初境', toRealm: '符师中境', systemLevel: 3, powerLevel: 3 }
            })]
        });
        const secondary = (result.commands.find((command) => command.key === '社交[0].能力体系')?.value as any)?.secondary;
        expect(secondary).toEqual([
            expect.objectContaining({ systemId: 'dao-a', realmName: '符师中境' }),
            expect.objectContaining({ systemId: 'dao-b', realmName: '炼气圆满' })
        ]);
    });

    it('rejects an ambiguous system name when no system id is provided', () => {
        const result = buildNpcSettlementCommands({
            social: [{
                ...npc(),
                能力体系: {
                    primary: { systemId: 'primary-dao', systemName: '道士', realmName: '炼气圆满', systemLevel: 4, powerLevel: 4 },
                    secondary: [{ systemId: 'secondary-dao', systemName: '道士', realmName: '炼气圆满', systemLevel: 4, powerLevel: 4 }]
                }
            }],
            activeNpcs: [activeNpc({
                status: 'success', reason: '闭关完成',
                realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '筑基初期', systemLevel: 5, powerLevel: 5 }
            })]
        });
        expect(result.commands).toEqual([]);
        expect(result.rejections[0]).toContain('能力体系名称不唯一');
    });

    it('rejects an oversized breakthrough without a major opportunity', () => {
        const result = buildNpcSettlementCommands({
            social: [npc()],
            activeNpcs: [activeNpc({
                status: 'success', reason: '短暂闭关后突然突破',
                realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '元婴初期', systemLevel: 13, powerLevel: 13 }
            })]
        });
        expect(result.commands).toEqual([]);
        expect(result.rejections[0]).toContain('跨越多个大阶段');
    });

    it('rejects every successful settlement when the same npc has conflicting results', () => {
        const first = activeNpc({
            status: 'success', reason: '闭关完成',
            realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '筑基初期', systemLevel: 5, powerLevel: 5 }
        });
        const second = activeNpc({
            status: 'success', reason: '另一份互相冲突的结果',
            realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '筑基中期', systemLevel: 6, powerLevel: 6 }
        });
        const result = buildNpcSettlementCommands({ social: [npc()], activeNpcs: [first, second] });
        expect(result.commands).toEqual([]);
        expect(result.rejections[0]).toContain('冲突');
    });

    it('allows gain then equip of the same sourced item', () => {
        const result = buildNpcSettlementCommands({ social: [npc()], activeNpcs: [activeNpc({
            status: 'success', reason: '在宗门库房完成兑换', equipmentChanges: [
                { action: 'gain', itemName: '青锋剑', source: '宗门贡献兑换' },
                { action: 'equip', itemName: '青锋剑', source: '从新获得物品中穿戴', slot: '主武器' }
            ]
        })] });
        expect(result.commands).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'set', key: '社交[0].当前装备.主武器', value: '青锋剑' }),
            expect.objectContaining({ action: 'set', key: '社交[0].背包' })
        ]));
        expect(result.commands.find((command) => command.key === '社交[0].背包')?.value).toEqual([]);
    });

    it('allows equip before gain in the same settlement and leaves no backpack duplicate', () => {
        const result = buildNpcSettlementCommands({ social: [npc()], activeNpcs: [activeNpc({
            status: 'success', reason: '在宗门库房完成兑换', equipmentChanges: [
                { action: 'equip', itemName: '青锋剑', source: '从本轮兑换物品中穿戴', slot: '主武器' },
                { action: 'gain', itemName: '青锋剑', source: '宗门贡献兑换' }
            ]
        })] });
        expect(result.rejections).toEqual([]);
        expect(result.commands).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: '社交[0].当前装备.主武器', value: '青锋剑' }),
            expect.objectContaining({ key: '社交[0].背包', value: [] })
        ]));
    });

    it('rejects equipment gain without a source', () => {
        const result = buildNpcSettlementCommands({ social: [npc()], activeNpcs: [activeNpc({
            status: 'success', reason: '获得装备', equipmentChanges: [{ action: 'gain', itemName: '青锋剑', source: '' }]
        })] });
        expect(result.commands).toEqual([]);
        expect(result.rejections[0]).toContain('来源');
    });

    it('keeps valid realm changes when one equipment change is invalid', () => {
        const result = buildNpcSettlementCommands({ social: [npc()], activeNpcs: [activeNpc({
            status: 'success', reason: '闭关成功，但传闻中的宝剑没有找到',
            realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '筑基初期', systemLevel: 1, powerLevel: 5 },
            equipmentChanges: [{ action: 'gain', itemName: '青锋剑', source: '' }]
        })] });
        expect(result.commands.some((command) => command.key === '社交[0].境界')).toBe(true);
        expect(result.commands.some((command) => command.key.includes('当前装备') || command.key.endsWith('.背包'))).toBe(false);
    });
});
