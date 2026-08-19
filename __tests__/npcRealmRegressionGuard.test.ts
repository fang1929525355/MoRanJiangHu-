import { describe, expect, it } from 'vitest';
import type { GameResponse, TavernCommand } from '../types';
import type { 境界配置 } from '../utils/realmConfig';
import {
    检测NPC境界回退风险命令,
    提取NPC境界回退风险命令索引
} from '../utils/npcRealmRegressionGuard';

const existingSocial = [
    {
        id: 'npc_xie_bin',
        姓名: '谢斌',
        境界: '聚息境四重',
        境界层级: 8,
        是否队友: true
    }
];

const 构建响应 = (text: string): GameResponse => ({
    logs: [{ sender: '旁白', text }],
    tavern_commands: []
});

const 检测 = (
    commands: TavernCommand[],
    text = '谢斌与众人继续赶路，本回合没有发生境界变化。',
    social = existingSocial,
    realmConfig?: 境界配置
) => (
    检测NPC境界回退风险命令(commands, social, 构建响应(text), realmConfig)
);

describe('NPC realm regression guard', () => {
    it('rejects a direct realm-level reset on an existing teammate', () => {
        const issues = 检测([
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ]);

        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('谢斌');
        expect(issues[0]).toContain('8 -> 1');
    });

    it('rejects realm text and level as one command group', () => {
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '开脉境初期' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测(commands)).toHaveLength(1);
        expect([...提取NPC境界回退风险命令索引(commands, existingSocial, 构建响应('谢斌只是受了轻伤。'))])
            .toEqual([0, 1]);
    });

    it('rejects deleting or clearing persistent realm truths', () => {
        expect(检测([
            { action: 'delete', key: '社交[0].境界层级', value: null }
        ])).toHaveLength(1);

        expect(检测([
            { action: 'set', key: '社交[0].境界', value: '未知境界' }
        ])).toHaveLength(1);
    });

    it('rejects a realm reset inside a whole-slot update', () => {
        expect(检测([
            {
                action: 'set',
                key: '社交[0]',
                value: {
                    id: 'npc_xie_bin',
                    姓名: '谢斌',
                    好感度: 60,
                    境界: '开脉境一重',
                    境界层级: 1
                }
            }
        ])).toHaveLength(1);
    });

    it('rejects a realm reset inside a whole social-list update', () => {
        expect(检测([
            {
                action: 'set',
                key: '社交',
                value: [{
                    id: 'npc_xie_bin',
                    姓名: '谢斌',
                    境界: '开脉境一重',
                    境界层级: 1,
                    是否队友: true
                }]
            }
        ])).toHaveLength(1);
    });

    it('rejects a whole social-list replacement that omits existing realm truths', () => {
        expect(检测([
            {
                action: 'set',
                key: '社交',
                value: [{
                    id: 'npc_xie_bin',
                    姓名: '谢斌',
                    好感度: 61
                }]
            }
        ])).toHaveLength(1);
    });

    it.each([
        { action: 'sub', key: '社交[0].境界层级', value: 7 },
        { action: 'add', key: '社交[0].境界层级', value: -7 }
    ] as TavernCommand[])('rejects arithmetic commands that lower the realm level', (command) => {
        expect(检测([command])).toHaveLength(1);
    });

    it('keeps tracking the original NPC when an earlier deletion command will be rejected elsewhere', () => {
        const social = [
            existingSocial[0],
            { id: 'npc_second', 姓名: '林岳', 境界: '开脉境四重', 境界层级: 4 }
        ];
        const commands: TavernCommand[] = [
            { action: 'delete', key: '社交[0]', value: null },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测NPC境界回退风险命令(commands, social, 构建响应('谢斌仍与队伍同行。')))
            .toHaveLength(1);
    });

    it('keeps tracking an existing placeholder NPC after a same-turn name repair', () => {
        const social = [
            { 姓名: '角色9', 境界: '聚息境四重', 境界层级: 8 }
        ];
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].姓名', value: '陈成' },
            { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测NPC境界回退风险命令(commands, social, 构建响应('陈成只是报上了真名。')))
            .toHaveLength(1);
    });

    it('keeps origin tracking aligned after an add-style whole-social append', () => {
        const commands: TavernCommand[] = [
            { action: 'add', key: '社交', value: { id: 'npc_new', 姓名: '林岳', 境界: '开脉境一重', 境界层级: 1 } },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测NPC境界回退风险命令(commands, existingSocial, 构建响应('林岳加入队伍，谢斌境界未变。')))
            .toHaveLength(1);
    });

    it('uses the active topic realm config instead of cross-topic maximum aliases', () => {
        const westernConfig: 境界配置 = {
            levelNames: Array.from({ length: 24 }, (_, index) => `西幻境界${index + 1}`),
            stageNames: ['见习', '初阶', '中阶', '高阶', '大师'],
            tierAliases: { 一: '一', 二: '二', 三: '三', 四: '四' },
            format: '{stage}{tier}阶',
            parseRules: [
                { pattern: '大师', level: 17 },
                { pattern: '英雄|传奇', level: 21 }
            ]
        };
        const social = [{ id: 'npc_west', 姓名: '艾琳', 境界: '英雄级', 境界层级: 20 }];
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '大师级' }
        ];

        expect(检测NPC境界回退风险命令(commands, social, 构建响应('艾琳继续赶路。'), westernConfig))
            .toHaveLength(1);
    });

    it('uses custom runtime realm level names for regression detection', () => {
        const customConfig: 境界配置 = {
            levelNames: ['纸境', '木境', '石境', '铁境'],
            stageNames: ['纸', '木', '石', '铁'],
            parseRules: [],
            tierAliases: {},
            format: '{stage}境'
        };
        const social = [{ id: 'npc_custom', 姓名: '墨离', 境界: '铁境', 境界层级: 4 }];
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '木境' }
        ];

        expect(检测NPC境界回退风险命令(commands, social, 构建响应('墨离没有境界变化。'), customConfig))
            .toHaveLength(1);
    });

    it('allows new NPC initialization, unchanged realms, and normal breakthroughs', () => {
        const commands: TavernCommand[] = [
            {
                action: 'push',
                key: '社交',
                value: { id: 'npc_new', 姓名: '新人弟子', 境界: '开脉境一重', 境界层级: 1 }
            },
            { action: 'set', key: '社交[0].境界层级', value: 8 },
            { action: 'set', key: '社交[0].境界', value: '归元境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 9 }
        ];

        expect(检测(commands, '谢斌气机贯通，正式突破到归元境一重。')).toEqual([]);
    });

    it('allows an explicit permanent cultivation loss for the named NPC', () => {
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测(
            commands,
            '谢斌为救众人逆转经脉，修为被彻底废去，境界永久跌落至开脉境一重。'
        )).toEqual([]);
    });

    it('allows direct affirmative wording that the named NPC cultivation was destroyed', () => {
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测(commands, '谢斌修为已被废，只能从开脉境一重重新开始。')).toEqual([]);
    });

    it('allows a confirmed correction of an incorrect historical realm record', () => {
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测(
            commands,
            '核对门中玉册后确认，谢斌此前境界记录有误，实际一直只是开脉境一重。'
        )).toEqual([]);
    });

    it('requires the permanent-loss fact to describe the protected NPC', () => {
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测(commands, '谢斌扶住修为被废的林岳，自己并未受损。')).toHaveLength(1);
        expect(检测(commands, '谢斌扶起同伴；林岳修为被废。')).toHaveLength(1);
        expect(检测(commands, '谢斌扶起同伴; 林岳修为被废。')).toHaveLength(1);
    });

    it('does not accept an unconfirmed historical-record claim as a correction fact', () => {
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测(commands, '传闻谢斌此前境界记录有误，但尚未核实。')).toHaveLength(1);
    });

    it('does not trust variable-planning text as permanent realm-loss evidence', () => {
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];
        const response = 构建响应('谢斌与众人继续赶路，本回合没有发生境界变化。');
        response.t_var_plan = '把谢斌写成修为被废并永久跌境，以便重算变量。';

        expect(检测NPC境界回退风险命令(commands, existingSocial, response)).toHaveLength(1);
    });

    it.each([
        '如果谢斌修为被废，才会跌落到开脉境一重；但现在只是正常赶路。',
        '传闻谢斌已经散功，但本人仍在聚息境四重。'
    ])('does not accept hypothetical or hearsay realm loss as a fact', (text) => {
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测(commands, text)).toHaveLength(1);
    });

    it.each([
        '谢斌虽遭重创，但修为并未被废，只是被临时封印。',
        '谢斌境界没有跌落，气息紊乱只是暂时现象。',
        '谢斌战败倒地，境界受到压制，休养后即可恢复。',
        '谢斌险些散功，最终稳住经脉，没有永久跌境。'
    ])('does not accept negated or temporary combat effects as permanent realm loss', (text) => {
        const commands: TavernCommand[] = [
            { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
            { action: 'set', key: '社交[0].境界层级', value: 1 }
        ];

        expect(检测(commands, text)).toHaveLength(1);
    });
});
