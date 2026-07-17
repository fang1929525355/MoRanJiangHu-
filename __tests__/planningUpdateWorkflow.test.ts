import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/ai/text', () => ({
    generatePlanningAnalysis: vi.fn(async (_params, _api, _signal, streamOptions) => {
        streamOptions?.onDelta?.('增量', '累计文本');
        return {
            shouldUpdate: false,
            reason: '无需更新',
            rawText: '累计文本',
            commands: []
        };
    })
}));

vi.mock('../utils/apiConfig', () => ({
    获取规划分析接口配置: vi.fn(() => ({ baseUrl: 'https://example.com', apiKey: 'test', model: 'test-model' })),
    接口配置是否可用: vi.fn(() => true)
}));

vi.mock('../utils/backgroundScheduling', () => ({
    后台分段执行: vi.fn(async (fn) => fn()),
    后台让出主线程: vi.fn(async () => undefined)
}));

vi.mock('../utils/gameHeavyWorkerClient', () => ({
    执行游戏后台重计算: vi.fn(async (_task, _payload, fallback) => fallback())
}));

vi.mock('../services/novelDecompositionInjection', () => ({
    获取激活小说拆分注入文本: vi.fn(async () => '')
}));

vi.mock('../services/novelDecompositionCalibration', () => ({
    同步剧情小说分解时间校准: vi.fn(async ({ nextStory }) => nextStory)
}));

import { 创建规划更新工作流 } from '../hooks/useGame/planningUpdateWorkflow';
import * as textAIService from '../services/ai/text';

const 创建基础依赖 = () => ({
    apiConfig: {},
    gameConfig: {},
    角色: { 姓名: '张三' },
    环境: {},
    世界: {},
    战斗: {},
    玩家门派: {},
    任务列表: [],
    约定列表: [],
    历史记录: [],
    规划分析进行中Ref: { current: false },
    prompts: [],
    worldbooks: [],
    规范化环境信息: (envLike?: any) => envLike || {},
    规范化社交列表: (raw?: any[]) => Array.isArray(raw) ? raw : [],
    规范化世界状态: (raw?: any) => raw || {},
    规范化战斗状态: (raw?: any) => raw || {},
    规范化门派状态: (raw?: any) => raw || {},
    规范化剧情状态: (raw?: any) => raw || {},
    规范化剧情规划状态: (raw?: any) => raw || {},
    规范化女主剧情规划状态: (raw?: any) => raw,
    规范化同人剧情规划状态: (raw?: any) => raw,
    规范化同人女主剧情规划状态: (raw?: any) => raw,
    深拷贝: <T,>(value: T): T => JSON.parse(JSON.stringify(value)),
    收集最近完整正文回合: () => [{ role: 'assistant', content: '正文' }],
    构建最近完整正文上下文: () => '正文',
    去重文本数组: (items: string[]) => [...new Set(items)],
    收集女主规划时间触发原因: () => [],
    收集女主正文命中原因: () => [],
    收集剧情规划时间触发原因: () => [],
    收集剧情正文命中原因: () => [],
    提取响应完整正文文本: () => '正文',
    设置剧情: vi.fn(),
    设置剧情规划: vi.fn(),
    设置女主剧情规划: vi.fn(),
    设置同人剧情规划: vi.fn(),
    设置同人女主剧情规划: vi.fn(),
    performAutoSave: vi.fn(async () => undefined)
});

describe('规划更新工作流', () => {
    it('隔离 onStreamDelta 消费端异常，避免打断规划分析流程', async () => {
        const workflow = 创建规划更新工作流(创建基础依赖());
        const playerInput = '本轮只观察，不要安排刺客袭击。';

        await expect(workflow.后台执行统一规划分析({
            state: {
                环境: {},
                社交: [],
                世界: {},
                剧情: {},
                剧情规划: {}
            },
            playerInput,
            gameTime: '辰时',
            response: { logs: [] } as any,
            onStreamDelta: () => {
                throw new Error('UI 更新失败');
            }
        })).resolves.toMatchObject({
            updated: false,
            message: '无需更新',
            rawText: '累计文本'
        });
        expect(vi.mocked(textAIService.generatePlanningAnalysis).mock.calls.at(-1)?.[0]).toMatchObject({
            playerInput
        });
    });
});
