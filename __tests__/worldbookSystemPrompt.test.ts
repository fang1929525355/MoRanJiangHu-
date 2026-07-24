import { describe, expect, it } from 'vitest';
import type { 世界书结构, 聊天记录结构 } from '../types';
import { 创建空记忆系统 } from '../hooks/useGame/storyState';
import { formatHistoryToScript } from '../hooks/useGame/historyUtils';
import { 酒馆预设模式可用 } from '../hooks/useGame/promptRuntime';
import { 构建系统提示词 } from '../hooks/useGame/systemPromptBuilder';
import { 构建世界书注入文本, 构建主剧情世界书作用域 } from '../utils/worldbook';

const 历史关键词测试世界书: 世界书结构[] = [{
    id: 'history-book',
    标题: '历史匹配测试',
    启用: true,
    条目: [{
        id: 'history-entry',
        标题: '青云门历史条目',
        内容: '历史关键词命中成功。',
        类型: 'world_lore',
        作用域: ['main'],
        注入模式: 'match_any',
        关键词: ['青云门'],
        优先级: 100,
        启用: true,
        创建时间: 1,
        更新时间: 1
    }],
    创建时间: 1,
    更新时间: 1
}];

const NPC变量关键词测试世界书: 世界书结构[] = [{
    id: 'npc-variable-book',
    标题: 'NPC变量匹配测试',
    启用: true,
    条目: [{
        id: 'npc-variable-entry',
        标题: '银月印记变量条目',
        内容: 'NPC变量关键词命中成功。',
        类型: 'world_lore',
        作用域: ['main'],
        注入模式: 'match_any',
        关键词: ['银月印记'],
        优先级: 100,
        启用: true,
        创建时间: 1,
        更新时间: 1
    }],
    创建时间: 1,
    更新时间: 1
}];

const 四类来源测试世界书: 世界书结构[] = [{
    id: 'four-source-book',
    标题: '四类来源匹配测试',
    启用: true,
    条目: [{
        id: 'four-source-entry',
        标题: '四源锚点条目',
        内容: '四类来源关键词命中成功。',
        类型: 'world_lore',
        作用域: ['main'],
        注入模式: 'match_any',
        关键词: ['四源锚点'],
        优先级: 100,
        启用: true,
        创建时间: 1,
        更新时间: 1
    }],
    创建时间: 1,
    更新时间: 1
}];

const 构建历史关键词测试提示词 = (history: 聊天记录结构[]) => 构建系统提示词({
    promptPool: [],
    memoryData: 创建空记忆系统(),
    socialData: [],
    statePayload: { 环境: {}, 世界: {}, 角色: {} },
    gameConfig: {} as any,
    memoryConfig: {} as any,
    worldbooks: 历史关键词测试世界书,
    worldEvolutionEnabled: false,
    options: {
        世界书作用域: ['main'],
        世界书附加文本: [formatHistoryToScript(history)]
    }
}).systemPrompt;

const 构建历史 = (structuredText: string): 聊天记录结构[] => [
    {
        role: 'assistant',
        content: 'Structured Response',
        structuredResponse: { logs: [{ sender: '旁白', text: structuredText }] },
        timestamp: 1
    },
    ...Array.from({ length: 12 }, (_, index): 聊天记录结构 => ({
        role: 'user',
        content: `后续输入 ${index + 1}`,
        timestamp: index + 2
    }))
];

describe('主剧情世界书历史匹配', () => {
    it('扫描完整上传窗口，并从真实 Structured Response 中提取正文命中 match_any', () => {
        const withoutMatchHistory = 构建历史('众人仍在山脚。');
        const withMatchHistory = 构建历史('众人抵达青云门。');

        const directMatch = 构建世界书注入文本({
            books: 历史关键词测试世界书,
            scopes: ['main'],
            history: withMatchHistory
        });
        const withoutMatchPrompt = 构建历史关键词测试提示词(withoutMatchHistory);
        const withMatchPrompt = 构建历史关键词测试提示词(withMatchHistory);

        expect(directMatch.selectedEntries.map((entry) => entry.id)).toEqual(['history-entry']);
        expect(withoutMatchPrompt).not.toContain('历史关键词命中成功。');
        expect(withMatchPrompt).toContain('历史关键词命中成功。');
    });

    it('NPC 已注入提示词的变量字段可以命中 match_any', () => {
        const systemPrompt = 构建系统提示词({
            promptPool: [],
            memoryData: 创建空记忆系统(),
            socialData: [{
                id: 'npc-1',
                姓名: '苏青萝',
                性别: '女',
                是否在场: true,
                是否主要角色: true,
                外貌描写: '眉心留有一道银月印记，夜色下会泛起微光。'
            }],
            statePayload: { 环境: {}, 世界: {}, 角色: {} },
            gameConfig: {} as any,
            memoryConfig: {} as any,
            worldbooks: NPC变量关键词测试世界书,
            worldEvolutionEnabled: false,
            options: { 世界书作用域: ['main'] }
        }).systemPrompt;

        expect(systemPrompt).toContain('外貌描写');
        expect(systemPrompt).toContain('眉心留有一道银月印记，夜色下会泛起微光。');
        expect(systemPrompt).toContain('NPC变量关键词命中成功。');
    });

    it('未进入 NPC 提示词的隐藏字段不会误触发 match_any', () => {
        const systemPrompt = 构建系统提示词({
            promptPool: [],
            memoryData: 创建空记忆系统(),
            socialData: [{
                id: 'npc-2',
                姓名: '普通路人',
                性别: '女',
                是否在场: true,
                是否主要角色: false,
                外貌描写: '银月印记：这段隐藏字段不应进入提示词。'
            }],
            statePayload: { 环境: {}, 世界: {}, 角色: {} },
            gameConfig: {} as any,
            memoryConfig: {} as any,
            worldbooks: NPC变量关键词测试世界书,
            worldEvolutionEnabled: false,
            options: { 世界书作用域: ['main'] }
        }).systemPrompt;

        expect(systemPrompt).not.toContain('这段隐藏字段不应进入提示词');
        expect(systemPrompt).not.toContain('NPC变量关键词命中成功。');
    });

    it('会把真实年龄与视觉年龄约束一起注入 NPC 上下文', () => {
        const systemPrompt = 构建系统提示词({
            promptPool: [],
            memoryData: 创建空记忆系统(),
            socialData: [{
                id: 'npc-qingshuang',
                姓名: '清霜',
                性别: '女',
                年龄: 85,
                境界: '金丹四层',
                境界层级: 17,
                身份: '玉仙宗巡查使',
                是否在场: true,
                是否主要角色: true,
                外貌描写: '容貌清寒，神情沉静。'
            }],
            statePayload: { 环境: {}, 世界: {}, 角色: {} },
            gameConfig: {} as any,
            memoryConfig: {} as any,
            worldbooks: [],
            worldEvolutionEnabled: false,
            options: { 世界书作用域: ['main'], openingConfig: { 题材模式: '仙侠' } as any }
        }).systemPrompt;

        expect(systemPrompt).toContain('真实年龄');
        expect(systemPrompt).toContain('视觉年龄约束');
        expect(systemPrompt).toContain('不得仅因真实年龄称为老妇、老妪或老太婆');
    });

    it('当前剧情、地点、NPC 或历史均可独立命中 match_any', () => {
        const sources = [
            { extraTexts: ['当前剧情出现四源锚点。'] },
            { environment: { 具体地点: '四源锚点所在的密室' } },
            { social: [{ 姓名: '四源锚点' }] },
            { history: [{ role: 'user', content: '历史中记录了四源锚点。', timestamp: 1 } as 聊天记录结构] }
        ];

        sources.forEach((source) => {
            const selected = 构建世界书注入文本({
                books: 四类来源测试世界书,
                scopes: ['main'],
                ...source
            }).selectedEntries;
            expect(selected.map((entry) => entry.id)).toEqual(['four-source-entry']);
        });
    });

    it('只在酒馆预设真实可用时追加酒馆世界书作用域', () => {
        const unavailableConfig = { 启用酒馆预设模式: true } as any;
        const availableConfig = {
            启用酒馆预设模式: true,
            酒馆预设: { prompts: [{}], prompt_order: [{}] }
        } as any;

        expect(构建主剧情世界书作用域(酒馆预设模式可用(unavailableConfig))).toEqual(['main']);
        expect(构建主剧情世界书作用域(酒馆预设模式可用(availableConfig))).toEqual(['main', 'tavern']);
    });
});
