import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useNovelModePackCompletion, 解析当前小说模式包激活记录, 计算小说模式包完善界面状态 } from '../hooks/useNovelModePackCompletion';
import type { 小说拆分数据集结构 } from '../models/novelDecomposition';
import type { 小说模式包完善记录 } from '../models/novelModePackCompletion';
import type { 当前可用接口结构 } from '../utils/apiConfig';

vi.mock('../services/novelModePackCompletionStore', () => ({
    删除小说模式包完善记录: vi.fn().mockResolvedValue(undefined),
    构建小说模式包数据集指纹: vi.fn().mockResolvedValue(''),
    读取小说模式包完善记录: vi.fn().mockResolvedValue(null),
    保存小说模式包完善记录: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../services/novelModePackCompletionWorkflow', () => ({
    执行小说模式包逐段完善: vi.fn()
}));

vi.mock('../services/ai/storyTasks', () => ({
    generateNovelModePackFinalization: vi.fn(),
    generateNovelModePackSegmentCompletion: vi.fn()
}));

vi.mock('../services/novelDecompositionWorkshopBridge', () => ({
    清洗小说模式包累积草稿: vi.fn((draft: unknown) => draft)
}));

const 构建记录 = (overrides: Partial<小说模式包完善记录> = {}): 小说模式包完善记录 => ({
    id: 'ds1::武侠',
    数据集ID: 'ds1',
    题材: '武侠',
    数据集指纹: 'fp',
    状态: 'paused',
    当前阶段: 'segment',
    总分段数: 1,
    已完成分段数: 0,
    下一个分段索引: 0,
    当前草稿: {},
    分段输入记录: [],
    用户确认字段路径: [],
    ...overrides
} as unknown as 小说模式包完善记录);

const 构建数据集 = (id = 'ds1'): 小说拆分数据集结构 => ({ id, 分段列表: [] } as unknown as 小说拆分数据集结构);

const Inner: React.FC<{ dataset: 小说拆分数据集结构 | null }> = ({ dataset }) => {
    const result = useNovelModePackCompletion({
        dataset,
        baseMode: '武侠',
        apiConfig: null as unknown as 当前可用接口结构 | null | undefined,
        onNotify: undefined
    });
    return <div>{result.record ? 'has-record' : 'no-record'}</div>;
};

describe('小说分解工作台：模式包完善记录空值防护', () => {
    it('[回归] 未选中小说时 record 与 dataset 同为 null，不得读取 null 的 题材', () => {
        // 历史崩溃写法：`record?.数据集ID === dataset?.id && record.题材 === baseMode`
        // 两侧同为 undefined 时前半段成立，继续读 record.题材 会抛
        // TypeError: Cannot read properties of null (reading '题材')。
        expect(() => 解析当前小说模式包激活记录(true, null, null, '武侠')).not.toThrow();
        expect(解析当前小说模式包激活记录(true, null, null, '武侠')).toBeNull();
    });

    it('[回归] 记录字段缺失且未选中小说时同样不激活', () => {
        const 残缺记录 = 构建记录({ 数据集ID: undefined as unknown as string });
        expect(解析当前小说模式包激活记录(true, 残缺记录, null, '武侠')).toBeNull();
    });

    it('已选中小说但尚无记录时返回 null', () => {
        expect(解析当前小说模式包激活记录(true, null, 构建数据集(), '武侠')).toBeNull();
    });

    it('进度尚未加载完成时不激活任何记录', () => {
        expect(解析当前小说模式包激活记录(false, 构建记录(), 构建数据集(), '武侠')).toBeNull();
    });

    it('记录归属的数据集与当前数据集不一致时不激活', () => {
        expect(解析当前小说模式包激活记录(true, 构建记录(), 构建数据集('ds2'), '武侠')).toBeNull();
    });

    it('记录题材与当前题材不一致时不激活', () => {
        expect(解析当前小说模式包激活记录(true, 构建记录({ 题材: '仙侠' as any }), 构建数据集(), '武侠')).toBeNull();
    });

    it('数据集与题材同时命中时返回该记录', () => {
        const record = 构建记录();
        expect(解析当前小说模式包激活记录(true, record, 构建数据集(), '武侠')).toBe(record);
    });

    it('未选中小说时界面状态可安全计算，提示尚未开始', () => {
        const uiState = 计算小说模式包完善界面状态(解析当前小说模式包激活记录(true, null, null, '武侠'), false, true, true, false);
        expect(uiState.statusText).toBe('尚未开始逐分段完善');
        expect(uiState.primaryAction).toBe('start');
        expect(uiState.showRestart).toBe(false);
    });

    it('工作台在未选中小说时可完成首屏渲染', () => {
        const html = renderToStaticMarkup(<Inner dataset={null} />);
        expect(html).toContain('no-record');
    });
});
