import { describe, expect, it } from 'vitest';
import {
    构建小说拆分失败汇总,
    获取小说拆分自动重试次数,
    获取小说拆分待处理索引
} from '../services/novelDecompositionRuntime';

describe('小说分解失败续跑', () => {
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
});
