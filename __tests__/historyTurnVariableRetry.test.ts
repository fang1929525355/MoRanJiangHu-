import { describe, expect, it } from 'vitest';
import { 创建历史回合工作流 } from '../hooks/useGame/historyTurnWorkflow';

describe('history turn variable retry', () => {
    const createSnapshot = () => ({
        玩家输入: '继续探索',
        游戏时间: '1:01:01:00:00',
        回档前状态: {
            角色: {},
            环境: {},
            社交: [],
            世界: {},
            战斗: {},
            玩家门派: {},
            任务列表: [],
            约定列表: [],
            剧情: {},
            女主剧情规划: {},
            记忆系统: {
                回忆档案: [],
                即时记忆: [],
                短期记忆: [],
                中期记忆: [],
                长期记忆: []
            }
        },
        回档前历史: []
    });

    const createBaseDeps = (overrides: Record<string, unknown> = {}) => ({
        历史记录: [
            { role: 'user', content: '继续探索' },
            {
                role: 'assistant',
                content: 'Structured Response',
                structuredResponse: { body: '正文仍应保留', logs: [], tavern_commands: [] },
                rawJson: '<正文>正文仍应保留</正文>',
                inputTokens: 12,
                responseDurationSec: 3
            }
        ],
        记忆系统: { 回忆档案: [], 即时记忆: [], 短期记忆: [], 中期记忆: [], 长期记忆: [] },
        memoryConfig: {},
        gameConfig: {},
        prompts: [],
        内置提示词列表: [],
        世界书列表: [],
        loading: false,
        变量生成中: false,
        记忆总结阶段: 'idle',
        社交: [],
        visualConfig: {},
        visualConfigRef: { current: {} },
        场景图片档案Ref: { current: {} },
        scrollRef: { current: { scrollTop: 0 } },
        获取最新快照: createSnapshot,
        回档到快照: () => undefined,
        弹出重Roll快照: () => null,
        删除最近自动存档并重置状态: async () => undefined,
        深拷贝: <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)),
        环境时间转标准串: () => '1:01:01:00:00',
        获取开局配置: () => ({}),
        规范化记忆配置: () => ({ 即时消息上传条数N: 10, 短期记忆阈值: 10, 中期记忆阈值: 10 }),
        规范化记忆系统: (value: unknown) => value,
        规范化社交列表: (value: unknown) => value,
        规范化视觉设置: (value: unknown) => value,
        规范化场景图片档案: (value: unknown) => value,
        normalizeCanonicalGameTime: (value: string) => value,
        构建即时记忆条目: () => ({}),
        构建短期记忆条目: () => ({}),
        写入四段记忆: (memory: unknown) => memory,
        估算AI输出Token: () => 1,
        提取解析失败原始信息: (error: any) => error?.message || '',
        提取原始报错详情: (error: any) => error?.message || '',
        构建标签解析选项: () => ({}),
        parseStoryRawText: () => ({ body: '正文仍应保留', logs: [], tavern_commands: [] }),
        执行正文润色: async (response: unknown) => ({ applied: false, response }),
        规范化游戏设置: () => ({}),
        processResponseCommands: (_response: unknown, baseState: unknown) => baseState,
        按世界演变分流净化响应: (response: unknown) => ({ response }),
        世界演变功能已开启: () => false,
        执行重解析变量生成: async (params: any) => params.parsedResponse,
        应用并同步记忆系统: () => undefined,
        performAutoSave: async () => undefined,
        设置剧情: () => undefined,
        设置历史记录: () => undefined,
        设置玩家门派: () => undefined,
        设置任务列表: () => undefined,
        设置约定列表: () => undefined,
        设置社交: () => undefined,
        记录变量生成上下文: () => undefined,
        set聊天区自动滚动抑制令牌: () => undefined,
        获取NPC唯一标识: (_npc: unknown, index?: number) => String(index ?? 0),
        合并NPC图片档案: (npc: unknown) => npc,
        ...overrides
    });

    it('继续变量生成失败时不先回档清空正文，并向输入栏回传进度与错误', async () => {
        const events: string[] = [];
        const progress: Array<{ phase?: string; text?: string }> = [];
        const workflow = 创建历史回合工作流(createBaseDeps({
            回档到快照: () => {
                events.push('rollback');
            },
            执行重解析变量生成: async () => {
                events.push('legacy-variable-reparse');
                throw new Error('不应走旧的静默重解析链路');
            },
            后台执行变量生成: async (params: any) => {
                events.push('background-variable');
                params.onProgress?.({ phase: 'start', text: '正在请求变量模型...' });
                throw new Error('MiMo variable failed');
            }
        }) as any);

        const result = await (workflow.handleRetryLatestVariableGeneration as any)({
            onVariableGenerationProgress: (item: { phase?: string; text?: string }) => progress.push(item)
        });

        expect(events).toEqual(['background-variable']);
        expect(progress.some(item => item.phase === 'start')).toBe(true);
        expect(result).toContain('MiMo variable failed');
    });

    it('可以基于最新正文单独重试失败的动态世界阶段', async () => {
        const progress: Array<{ phase?: string; text?: string; commandTexts?: string[] }> = [];
        const workflow = 创建历史回合工作流(createBaseDeps({
            执行世界演变更新: async (params: any) => {
                expect(params.applyCommands).toBe(true);
                expect(params.playerInput).toBe('继续探索');
                expect(params.currentResponse.body).toBe('正文仍应保留');
                params.onStreamDelta?.('世界', '世界演变流式内容');
                return {
                    ok: true,
                    phase: 'done',
                    commands: [{ action: 'set', key: '世界.传闻', value: ['新传闻'] }],
                    updates: ['新传闻流入江湖'],
                    rawText: '<世界演变>完成</世界演变>',
                    statusText: '动态世界更新完成'
                };
            }
        }) as any);

        const result = await (workflow.handleRetryLatestStage as any)('world', {
            onWorldEvolutionProgress: (item: { phase?: string; text?: string; commandTexts?: string[] }) => progress.push(item)
        });

        expect(result).toBeNull();
        expect(progress.some(item => item.phase === 'stream' && item.text === '世界演变流式内容')).toBe(true);
        expect(progress.at(-1)?.phase).toBe('done');
        expect(progress.at(-1)?.commandTexts?.[0]).toContain('世界.传闻');
    });
});
