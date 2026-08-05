import { afterEach, describe, expect, it, vi } from 'vitest';
import { 创建空小说拆分数据集 } from '../services/novelDecompositionStore';
import {
    generateNovelModePackCompletion,
    generateNovelModePackFinalization,
    generateNovelModePackSegmentCompletion,
    generateNovelSegmentFieldCompletion
} from '../services/ai/storyTasks';
import type { 当前可用接口结构 } from '../utils/apiConfig';
import { AI补全小说模式包配置 } from '../services/novelDecompositionWorkshopBridge';

const apiConfig: 当前可用接口结构 = {
    id: 'mode-pack-test',
    名称: '模式包补全测试',
    供应商: 'openai_compatible',
    baseUrl: 'https://mode-pack.example/v1',
    apiKey: 'test-key',
    model: 'test-model'
};

describe('novel mode pack completion', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('accepts partial AI completion patches and lets the mode package use official fallbacks', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            choices: [{
                message: {
                    content: JSON.stringify({
                        image: {
                            visualStyle: '写实国风'
                        },
                        time: {
                            calendarName: '大骊历',
                            narrativeStyle: '以甲子为度，岁月流转中蕴含因果'
                        }
                    })
                }
            }]
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        const dataset = 创建空小说拆分数据集({
            标题: '剑来',
            作品名: '剑来',
            原始文本摘要: '骊珠洞天、山水气运、剑修和宗门因果构成仙侠世界。'
        });

        const result = await generateNovelModePackCompletion(dataset, apiConfig, { stream: false });

        expect(result.completion).toEqual({
            image: {
                visualStyle: '写实国风'
            },
            time: {
                calendarName: '大骊历',
                narrativeStyle: '以甲子为度，岁月流转中蕴含因果'
            }
        });
    });

    it('accepts segment field completion JSON patches', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            choices: [{
                message: {
                    content: JSON.stringify({
                        角色档案: [
                            {
                                名称: '陈平安',
                                身份: '骊珠洞天少年',
                                性格: '沉稳坚韧'
                            }
                        ],
                        世界观规则: ['山水气运会影响人物命数。']
                    })
                }
            }]
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        const result = await generateNovelSegmentFieldCompletion({
            segmentTitle: '骊珠洞天',
            segmentOriginalText: '陈平安在骊珠洞天牵涉山水气运。'
        }, apiConfig, { stream: false });

        expect(result.completion).toEqual({
            角色档案: [
                {
                    名称: '陈平安',
                    身份: '骊珠洞天少年',
                    性格: '沉稳坚韧'
                }
            ],
            世界观规则: ['山水气运会影响人物命数。']
        });
    });

    it('filters off-topic apocalypse template fields before showing the AI completion draft', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            choices: [{
                message: {
                    content: JSON.stringify({
                        economy: {
                            primaryCurrency: '末日物资券',
                            accountingUnit: '瓶盖',
                            marketName: '避难所市场'
                        },
                        map: {
                            locationTypes: ['感染区', '医院', '商超', '避难所'],
                            poiTypes: ['封锁线', '营地', '临时市场', '资源点'],
                            mapPrompt: '世界版图应按感染区、医院、商超、仓库、避难所、封锁线、营地、临时市场和资源点组织。'
                        },
                        image: {
                            visualStyle: '写实末日风',
                            sceneMaterials: '废墟、血污、防护服、封锁线'
                        },
                        time: {
                            calendarName: '大骊历',
                            narrativeStyle: '以甲子为度，岁月流转中蕴含因果'
                        }
                    })
                }
            }]
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        const dataset = 创建空小说拆分数据集({
            标题: '剑来',
            作品名: '剑来',
            原始文本摘要: '骊珠洞天、山水气运、剑修和宗门因果构成仙侠世界。',
            世界观规则: ['骊珠洞天、剑修、山上宗门和儒释道传承是主要世界观。'],
            世界边界规则: ['不得写成末日丧尸、生化感染、避难所、幸存者营地题材。']
        });

        const result = await AI补全小说模式包配置({
            dataset,
            apiConfig,
            onDelta: undefined
        });

        const draftText = JSON.stringify(result.completion);
        expect(result.completion.time).toEqual({
            calendarName: '大骊历',
            narrativeStyle: '以甲子为度，岁月流转中蕴含因果'
        });
        expect(draftText).not.toMatch(/apocalypse|感染区|避难所|幸存者|丧尸|末日物资券|瓶盖|封锁线|防护服|写实末日风/iu);
    });

    it('passes the previous full draft into the next segment request', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify({
                choices: [{ message: { content: JSON.stringify({
                    completion: { economy: { primaryCurrency: '铜钱' } },
                    conflictHints: []
                }) } }]
            }), { status: 200, headers: { 'content-type': 'application/json' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                choices: [{ message: { content: JSON.stringify({
                    completion: { economy: { primaryCurrency: '银票' } },
                    conflictHints: ['后文明确使用银票']
                }) } }]
            }), { status: 200, headers: { 'content-type': 'application/json' } }));
        const dataset = 创建空小说拆分数据集({ 标题: '测试小说', 作品名: '测试小说' });
        dataset.分段列表 = [
            { id: 'seg-1', 标题: '第一段', 原文内容: '市面使用铜钱。' } as any,
            { id: 'seg-2', 标题: '第二段', 原文内容: '后文改用银票。' } as any
        ];

        const first = await generateNovelModePackSegmentCompletion({
            dataset,
            segmentIndex: 0,
            baseMode: '武侠',
            currentDraft: {},
            confirmedFieldPaths: []
        }, apiConfig, { stream: false });
        const second = await generateNovelModePackSegmentCompletion({
            dataset,
            segmentIndex: 1,
            baseMode: '武侠',
            currentDraft: first.completion,
            confirmedFieldPaths: []
        }, apiConfig, { stream: false });

        const secondRequest = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
        expect(JSON.stringify(secondRequest.messages)).toContain('primaryCurrency');
        expect(JSON.stringify(secondRequest.messages)).toContain('铜钱');
        expect(second.completion.economy?.primaryCurrency).toBe('银票');
        expect(second.conflictHints).toEqual(['后文明确使用银票']);
    });

    it('parses finalization output as a complete draft', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
                completion: { economy: { primaryCurrency: '银票' } },
                conflictHints: []
            }) } }]
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        const dataset = 创建空小说拆分数据集({ 标题: '测试小说' });
        const result = await generateNovelModePackFinalization({
            dataset,
            baseMode: '武侠',
            currentDraft: { economy: { primaryCurrency: '银票' } },
            conflictHints: ['使用后文货币名'],
            confirmedFieldPaths: []
        }, apiConfig, { stream: false });
        expect(result.completion.economy?.primaryCurrency).toBe('银票');
    });

    it('accepts a direct full draft when the model follows the legacy system-level JSON shape', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
                economy: { primaryCurrency: '银票' },
                ability: { primaryAxis: '武学境界' }
            }) } }]
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        const dataset = 创建空小说拆分数据集({ 标题: '测试小说' });
        dataset.分段列表 = [{ id: 'seg-1', 标题: '第一段', 原文内容: '银票通行。' } as any];
        const result = await generateNovelModePackSegmentCompletion({
            dataset,
            segmentIndex: 0,
            baseMode: '武侠',
            currentDraft: {},
            confirmedFieldPaths: []
        }, apiConfig, { stream: false });
        expect(result.completion.economy?.primaryCurrency).toBe('银票');
        expect(result.conflictHints).toEqual([]);
    });
});
