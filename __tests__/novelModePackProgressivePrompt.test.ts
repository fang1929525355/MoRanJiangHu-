import { describe, expect, it } from 'vitest';
import {
    构建小说模式包分段完善用户提示词,
    构建小说模式包最终整理用户提示词
} from '../prompts/runtime/novelModePackCompletion';

describe('小说模式包逐段完善提示词', () => {
    it('后续分段同时包含上一版完整草稿、当前分段原文和用户确认字段', () => {
        const result = 构建小说模式包分段完善用户提示词({
            workName: '测试小说',
            baseMode: '武侠',
            segmentIndex: 1,
            totalSegments: 3,
            segment: {
                id: 'seg-2',
                标题: '第二段',
                原文内容: '后文确认通用货币是银票。',
                世界观规则: ['银票通行天下。']
            } as any,
            currentDraft: { economy: { primaryCurrency: '铜钱' } } as any,
            confirmedFieldPaths: ['economy.primaryCurrency']
        });
        expect(result.prompt).toContain('后文确认通用货币是银票');
        expect(result.prompt).toContain('"primaryCurrency":"铜钱"');
        expect(result.prompt).toContain('economy.primaryCurrency');
        expect(result.prompt).toContain('用户确认字段不得覆盖');
        expect(result.prompt).toContain('输出更新后的完整模式包草稿');
        expect(result.inputStats).toEqual({
            原文总字符数: 12,
            实际输入字符数: 12,
            是否完整输入: true
        });
    });

    it('最终整理禁止凭空新增设定并保留冲突提示', () => {
        const prompt = 构建小说模式包最终整理用户提示词({
            workName: '测试小说',
            baseMode: '武侠',
            currentDraft: { economy: { primaryCurrency: '银票' } } as any,
            conflictHints: ['早期称为铜钱，后文明确改为银票'],
            confirmedFieldPaths: []
        });
        expect(prompt).toContain('不得新增没有证据的设定');
        expect(prompt).toContain('"primaryCurrency":"银票"');
        expect(prompt).toContain('早期称为铜钱，后文明确改为银票');
    });
});
