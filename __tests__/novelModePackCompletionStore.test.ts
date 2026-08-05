import { beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建空小说拆分数据集 } from '../services/novelDecompositionStore';
import {
    删除小说模式包完善记录,
    构建小说模式包数据集指纹,
    读取小说模式包完善记录,
    保存小说模式包完善记录,
    标准化小说模式包完善记录
} from '../services/novelModePackCompletionStore';
import * as dbService from '../services/dbService';

beforeEach(() => vi.restoreAllMocks());

describe('小说模式包累积完善记录', () => {
    it('把越界游标和无效状态规范为可继续的暂停记录', () => {
        expect(标准化小说模式包完善记录({
            id: 'dataset-1::武侠',
            数据集ID: 'dataset-1',
            题材: '武侠',
            数据集指纹: 'fingerprint',
            状态: 'broken',
            当前阶段: 'segment',
            总分段数: 3,
            已完成分段数: 2,
            下一个分段索引: 99,
            当前草稿: { economy: { primaryCurrency: '铜钱' } }
        })).toEqual(expect.objectContaining({
            状态: 'paused',
            当前阶段: 'segment',
            总分段数: 3,
            已完成分段数: 2,
            下一个分段索引: 2
        }));
    });

    it('分段内容变化会改变数据集指纹', async () => {
        const dataset = 创建空小说拆分数据集({ 标题: '测试小说' });
        dataset.分段列表 = [{
            id: 'seg-1',
            数据集ID: dataset.id,
            组号: 1,
            标题: '第一段',
            原文内容: '甲',
            updatedAt: 1
        } as any];
        const first = await 构建小说模式包数据集指纹(dataset);
        dataset.分段列表[0].原文内容 = '乙';
        const second = await 构建小说模式包数据集指纹(dataset);
        expect(second).not.toBe(first);
    });

    it('作品名或结构化证据变化会改变数据集指纹', async () => {
        const dataset = 创建空小说拆分数据集({ 标题: '测试小说' });
        dataset.作品名 = '作品甲';
        dataset.世界观规则 = ['规则甲'];
        dataset.分段列表 = [{
            id: 'seg-1', 标题: '第一段', 原文内容: '相同原文', 世界观规则: ['段落规则甲'], updatedAt: 1
        } as any];
        const first = await 构建小说模式包数据集指纹(dataset);
        dataset.作品名 = '作品乙';
        expect(await 构建小说模式包数据集指纹(dataset)).not.toBe(first);
        dataset.作品名 = '作品甲';
        dataset.分段列表[0].世界观规则 = ['段落规则乙'];
        expect(await 构建小说模式包数据集指纹(dataset)).not.toBe(first);
    });

    it('按数据集和题材保存、读取并删除记录', async () => {
        let stored: unknown = [];
        vi.spyOn(dbService, '读取设置').mockImplementation(async () => stored as any);
        vi.spyOn(dbService, '保存设置').mockImplementation(async (_key, value) => { stored = value; });
        const record = 标准化小说模式包完善记录({
            id: 'dataset-1::武侠',
            数据集ID: 'dataset-1',
            题材: '武侠',
            数据集指纹: 'fp',
            状态: 'paused',
            当前阶段: 'segment',
            总分段数: 2,
            已完成分段数: 1,
            下一个分段索引: 1,
            当前草稿: {}
        });
        await 保存小说模式包完善记录(record);
        expect(await 读取小说模式包完善记录('dataset-1', '武侠')).toEqual(record);
        await 删除小说模式包完善记录('dataset-1', '武侠');
        expect(await 读取小说模式包完善记录('dataset-1', '武侠')).toBeNull();
    });

    it('并发保存不同目标时不会互相覆盖', async () => {
        let stored: unknown = [];
        vi.spyOn(dbService, '读取设置').mockImplementation(async () => {
            await Promise.resolve();
            return structuredClone(stored) as any;
        });
        vi.spyOn(dbService, '保存设置').mockImplementation(async (_key, value) => {
            await Promise.resolve();
            stored = structuredClone(value);
        });
        const buildRecord = (datasetId: string) => 标准化小说模式包完善记录({
            id: `${datasetId}::武侠`, 数据集ID: datasetId, 题材: '武侠', 数据集指纹: 'fp',
            状态: 'paused', 当前阶段: 'segment', 总分段数: 1, 已完成分段数: 0,
            下一个分段索引: 0, 当前草稿: {}
        });
        await Promise.all([
            保存小说模式包完善记录(buildRecord('dataset-a')),
            保存小说模式包完善记录(buildRecord('dataset-b'))
        ]);
        expect(await 读取小说模式包完善记录('dataset-a', '武侠')).not.toBeNull();
        expect(await 读取小说模式包完善记录('dataset-b', '武侠')).not.toBeNull();
    });
});
