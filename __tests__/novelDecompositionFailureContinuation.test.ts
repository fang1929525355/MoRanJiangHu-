import { beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建空小说拆分数据集, 规范化小说拆分任务进度 } from '../services/novelDecompositionStore';

const runtimeMocks = vi.hoisted(() => ({
    parseSegment: vi.fn(),
    writeDataset: vi.fn(),
    updateTaskProgress: vi.fn(),
    updateTaskStatus: vi.fn()
}));

vi.mock('../services/novelDecompositionPipeline', async () => {
    const actual = await vi.importActual<typeof import('../services/novelDecompositionPipeline')>('../services/novelDecompositionPipeline');
    return { ...actual, 解析小说拆分分段: runtimeMocks.parseSegment };
});

vi.mock('../services/novelDecompositionStore', async () => {
    const actual = await vi.importActual<typeof import('../services/novelDecompositionStore')>('../services/novelDecompositionStore');
    return {
        ...actual,
        写入小说拆分数据集: runtimeMocks.writeDataset,
        更新小说拆分任务进度: runtimeMocks.updateTaskProgress,
        更新小说拆分任务状态: runtimeMocks.updateTaskStatus,
        读取小说拆分注入快照列表: vi.fn().mockResolvedValue([]),
        保存小说拆分注入快照列表: vi.fn().mockResolvedValue(undefined)
    };
});

vi.mock('../services/novelDecompositionInjection', () => ({
    构建全部小说拆分注入快照: vi.fn().mockReturnValue([])
}));

vi.mock('../services/dbService', () => ({
    读取设置: vi.fn().mockResolvedValue({})
}));

vi.mock('../utils/apiConfig', async () => {
    const actual = await vi.importActual<typeof import('../utils/apiConfig')>('../utils/apiConfig');
    return {
        ...actual,
        规范化接口设置: vi.fn().mockReturnValue({ 功能模型占位: { 小说拆分RPM限制: 60_000 } }),
        获取小说拆分接口配置: vi.fn().mockReturnValue({ baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' }),
        接口配置是否可用: vi.fn().mockReturnValue(true)
    };
});

vi.mock('../utils/gameSettings', async () => {
    const actual = await vi.importActual<typeof import('../utils/gameSettings')>('../utils/gameSettings');
    return {
        ...actual,
        规范化游戏设置: vi.fn().mockReturnValue({ 独立APIGPT模式: {}, 额外提示词: '' })
    };
});

import {
    构建小说拆分失败汇总,
    默认小说拆分执行器,
    获取小说拆分自动重试次数,
    获取小说拆分待处理索引
} from '../services/novelDecompositionRuntime';

describe('小说分解失败续跑', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('window', {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis)
        });
    });

    it('即使任务配置为零也至少局部自动重试三次', () => {
        expect(获取小说拆分自动重试次数(0)).toBe(3);
        expect(获取小说拆分自动重试次数(5)).toBe(5);
    });

    it('跳过失败分段并继续选择后续待处理分段', () => {
        const indexes = 获取小说拆分待处理索引([
            { 处理状态: '失败' },
            { 处理状态: '待处理' },
            { 处理状态: '已完成' },
            { 处理状态: '待处理' }
        ] as any, 0, 10);

        expect(indexes).toEqual([1, 3]);
    });

    it('执行结束后统一汇总所有失败分段', () => {
        const summary = 构建小说拆分失败汇总([
            { 标题: '序幕篇', 处理状态: '失败', 最近错误: '缺少信息可见性标注' },
            { 标题: '第一章', 处理状态: '已完成', 最近错误: '' },
            { 标题: '第二章', 处理状态: '失败', 最近错误: '缺少完整时间字段' }
        ] as any);

        expect(summary).toContain('共 2 个分段');
        expect(summary).toContain('序幕篇：缺少信息可见性标注');
        expect(summary).toContain('第二章：缺少完整时间字段');
    });

    it('终态执行进度把失败分段计为已处理', () => {
        expect(规范化小说拆分任务进度({
            总分段数: 10,
            已完成分段数: 9,
            失败分段数: 1,
            当前分段索引: 10
        }).百分比).toBe(100);
    });

    it('真实执行链在首段重试耗尽后继续第二段并最终汇总失败', async () => {
        const dataset = 创建空小说拆分数据集({
            id: 'dataset-runtime-retry',
            标题: '续跑测试',
            章节列表: [{ id: 'chapter-1', 标题: '第一章', 序号: 1, 原文内容: '第一段原文', 字数: 5 } as any],
            分段列表: [
                { id: 'segment-1', 数据集ID: 'dataset-runtime-retry', 组号: 1, 标题: '失败段', 原文内容: '第一段原文', 处理状态: '待处理' },
                { id: 'segment-2', 数据集ID: 'dataset-runtime-retry', 组号: 2, 标题: '成功段', 原文内容: '第二段原文', 处理状态: '待处理' }
            ] as any
        });
        runtimeMocks.parseSegment
            .mockRejectedValueOnce(new Error('格式错误'))
            .mockRejectedValueOnce(new Error('格式错误'))
            .mockRejectedValueOnce(new Error('格式错误'))
            .mockRejectedValueOnce(new Error('格式错误'))
            .mockImplementationOnce(async ({ segment }: any) => ({
                ...segment,
                本组概括: '第二段完成',
                处理状态: '已完成'
            }));

        const result = await 默认小说拆分执行器({
            task: {
                id: 'task-runtime-retry',
                名称: '续跑测试',
                单次处理批量: 2,
                自动重试次数: 0,
                进度: {}
            },
            dataset
        });

        expect(runtimeMocks.parseSegment).toHaveBeenCalledTimes(5);
        expect(runtimeMocks.parseSegment.mock.calls.map((call) => call[0].segment.id)).toEqual([
            'segment-1', 'segment-1', 'segment-1', 'segment-1', 'segment-2'
        ]);
        expect(result.type).toBe('failed');
        expect(result.message).toContain('已执行全部分段');
        expect(result.message).toContain('失败段：');

        const finalDataset = runtimeMocks.writeDataset.mock.calls.at(-1)?.[0];
        expect(finalDataset.分段列表.map((item: any) => item.处理状态)).toEqual(['失败', '已完成']);
        expect(runtimeMocks.updateTaskProgress).toHaveBeenLastCalledWith('task-runtime-retry', expect.objectContaining({
            当前阶段: 'failed',
            当前游标: 2,
            进度: expect.objectContaining({ 百分比: 100 })
        }));
    });
});
