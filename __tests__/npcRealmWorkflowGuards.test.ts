import { describe, expect, it, vi } from 'vitest';
import { 校验响应未无依据降低NPC境界 } from '../hooks/useGame/sendWorkflow';
import { 执行变量模型校准工作流 } from '../hooks/useGame/variableModelWorkflow';
import * as textAIService from '../services/ai/text';

vi.mock('../services/ai/text', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/ai/text')>();
    return {
        ...actual,
        generateVariableCalibrationUpdate: vi.fn()
    };
});

const social = [
    {
        id: 'npc_xie_bin',
        姓名: '谢斌',
        性别: '男',
        境界: '聚息境四重',
        境界层级: 8,
        是否队友: true
    }
];

const 创建变量接口配置 = () => ({
    configs: [
        {
            id: 'main',
            name: '测试接口',
            apiKey: 'test-key',
            model: 'test-model',
            baseUrl: 'https://example.com/v1',
            供应商: 'openai',
            协议覆盖: 'auto'
        }
    ],
    currentConfigId: 'main',
    功能模型占位: {
        变量计算独立模型开关: true,
        变量计算渠道ID: 'main',
        变量计算使用模型: 'test-model'
    }
});

const baseState = {
    角色: { 姓名: '杨培强' },
    环境: {},
    世界: {},
    社交: social,
    战斗: {},
    玩家门派: {},
    任务列表: [],
    约定列表: []
} as any;

describe('NPC realm workflow guards', () => {
    it('makes the main-story validation throw a retryable parse error for an unsupported realm regression', () => {
        const response = {
            logs: [{ sender: '旁白', text: '谢斌与众人继续赶路，本回合没有发生境界变化。' }],
            tavern_commands: [
                { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
                { action: 'set', key: '社交[0].境界层级', value: 1 }
            ]
        } as any;

        expect(() => 校验响应未无依据降低NPC境界(
            response,
            social,
            '<正文>普通赶路</正文>',
            '主剧情'
        )).toThrow(/无依据降低既有 NPC 境界/);

        try {
            校验响应未无依据降低NPC境界(response, social, '<正文>普通赶路</正文>', '主剧情');
        } catch (error: any) {
            expect(error.name).toBe('StoryResponseParseError');
            expect(error.parseDetail).toContain('谢斌');
            expect(error.parseDetail).toContain('8 -> 1');
        }
    });

    it('retries the independent variable model after a realm regression and returns only the safe retry result', async () => {
        vi.mocked(textAIService.generateVariableCalibrationUpdate)
            .mockResolvedValueOnce({
                commands: [
                    { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
                    { action: 'set', key: '社交[0].境界层级', value: 1 }
                ],
                reports: ['错误重算谢斌境界。'],
                rawText: '<命令>set 社交[0].境界层级 = 1</命令>'
            } as any)
            .mockResolvedValueOnce({
                commands: [
                    { action: 'add', key: '社交[0].好感度', value: 2 }
                ],
                reports: ['只更新本回合好感度。'],
                rawText: '<命令>add 社交[0].好感度 = 2</命令>'
            } as any);

        const result = await 执行变量模型校准工作流({
            playerInput: '继续赶路。',
            parsedResponse: {
                logs: [{ sender: '旁白', text: '谢斌与众人继续赶路，本回合没有发生境界变化。' }],
                tavern_commands: []
            } as any,
            baseState,
            promptPool: [],
            worldEvolutionEnabled: false
        }, {
            apiConfig: 创建变量接口配置(),
            gameConfig: {}
        });

        expect(textAIService.generateVariableCalibrationUpdate).toHaveBeenCalledTimes(2);
        const retryPrompt = vi.mocked(textAIService.generateVariableCalibrationUpdate).mock.calls[1]?.[3] || '';
        expect(retryPrompt).toContain('无依据降低既有 NPC 境界');
        expect(result?.commands).toEqual([
            { action: 'add', key: '社交[0].好感度', value: 2 }
        ]);
    });
});
