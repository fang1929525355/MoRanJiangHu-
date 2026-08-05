import { describe, expect, it } from 'vitest';
import { 创建空小说拆分数据集 } from '../services/novelDecompositionStore';
import { 执行小说模式包逐段完善 } from '../services/novelModePackCompletionWorkflow';
import { generateNovelModePackFinalization, generateNovelModePackSegmentCompletion } from '../services/ai/storyTasks';
import type { 当前可用接口结构 } from '../utils/apiConfig';

const 读取端到端AI配置 = (): 当前可用接口结构 | null => {
    const baseUrl = process.env.MORAN_E2E_AI_BASE_URL?.trim();
    const apiKey = process.env.MORAN_E2E_AI_API_KEY?.trim();
    const model = process.env.MORAN_E2E_AI_MODEL?.trim();
    return baseUrl && apiKey && model ? {
        id: 'novel-mode-pack-e2e',
        名称: '小说模式包端到端测试',
        供应商: 'openai_compatible',
        协议覆盖: 'auto',
        baseUrl,
        apiKey,
        model
    } : null;
};

describe('小说模式包逐分段真实 AI 端到端测试', () => {
    it('依次处理全部分段并完成最终一致性整理', async () => {
        const apiConfig = 读取端到端AI配置();
        if (!apiConfig) {
            console.log('跳过：未配置 MORAN_E2E_AI_BASE_URL/MORAN_E2E_AI_API_KEY/MORAN_E2E_AI_MODEL');
            return;
        }
        const dataset = 创建空小说拆分数据集({ id: 'mode-pack-real-e2e', 标题: '听雪江湖' });
        dataset.作品名 = '听雪江湖';
        dataset.分段列表 = [{
            id: 'segment-1', 标题: '山村初入江湖', 章节范围: '第1-2章',
            原文内容: '沈砚出身山村，以铜钱和碎银交易。他拜入听雪门，门中分外门弟子、内门弟子与长老。武学由炼体、通脉、先天逐级提升。',
            世界观规则: ['货币以铜钱和碎银为主', '武学境界依次为炼体、通脉、先天'],
            角色档案: [], 势力档案: [], 地图地点档案: [], 物品档案: [], 人物关系: [], 势力关系: [], 时间线: []
        }, {
            id: 'segment-2', 标题: '州城风波', 章节范围: '第3-4章',
            原文内容: '沈砚进入临川州城，确认大额交易使用银票。听雪门弟子以门派贡献兑换剑法，州城设有牙行、镖局与拍卖行。',
            世界观规则: ['大额交易使用银票', '门派贡献可兑换武学'],
            角色档案: [], 势力档案: [], 地图地点档案: [], 物品档案: [], 人物关系: [], 势力关系: [], 时间线: []
        }].map((item, index) => ({
            数据集ID: dataset.id, 组号: index + 1, 章节标题: [], 是否开局组: index === 0,
            起始章序号: index * 2 + 1, 结束章序号: index * 2 + 2, 启用注入: true, 字数: item.原文内容.length,
            原文摘要: '', 本组概括: '', 开局已成立事实: [], 前组延续事实: [], 本组结束状态: [], 给下一组参考: [],
            原著硬约束: [], 可提前铺垫: [], 关键事件: [], 角色推进: [], 登场角色: [], 世界边界规则: [],
            伏笔线索: [], 回收点: [], 章节节奏: [], 时间线起点: '', 时间线终点: '', 处理状态: '已完成' as const,
            createdAt: Date.now(), updatedAt: Date.now(), ...item
        }));

        const result = await 执行小说模式包逐段完善({
            dataset,
            baseMode: '武侠',
            initialRecord: null,
            signal: new AbortController().signal,
            completeSegment: (params) => generateNovelModePackSegmentCompletion({
                dataset: params.dataset,
                segmentIndex: params.segmentIndex,
                baseMode: params.baseMode,
                currentDraft: params.currentDraft as Record<string, any>,
                confirmedFieldPaths: params.confirmedFieldPaths
            }, apiConfig, undefined, params.signal),
            finalize: (params) => generateNovelModePackFinalization({
                dataset: params.dataset,
                baseMode: params.baseMode,
                currentDraft: params.currentDraft as Record<string, any>,
                conflictHints: params.conflictHints,
                confirmedFieldPaths: params.confirmedFieldPaths
            }, apiConfig, undefined, params.signal),
            sanitize: (_dataset, _mode, draft) => draft,
            save: async () => undefined,
            wait: async () => undefined
        });

        expect(result.状态).toBe('completed');
        expect(result.已完成分段数).toBe(2);
        expect(result.分段输入记录.map((item) => item.分段ID)).toEqual(['segment-1', 'segment-2']);
        expect(Object.keys(result.当前草稿).length).toBeGreaterThan(0);
    }, 240_000);
});
