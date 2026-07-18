import { describe, expect, it } from 'vitest';
import type { OpeningRuntimeSnapshot } from '../types';
import { 构建官方模式运行时配置 } from '../utils/modeRuntimeProfile';
import {
    构建世界观货币口径,
    构建模式包世界观叙事约束
} from '../prompts/runtime/worldGenerationRuntimeConstraints';

describe('世界观货币口径', () => {
    it('单币种 currencySystem 压制旧三层换算说明', () => {
        const runtime = 构建官方模式运行时配置('武侠');
        runtime.identity.modeId = 'custom-single-currency';
        runtime.identity.displayName = '单币种模式';
        runtime.economy.exchangeRules = '三层货币：铜钱、银子、金元宝。';
        runtime.economy.currencySystem = {
            id: 'credits',
            name: '信用点体系',
            baseUnitId: 'credit',
            units: [{
                id: 'credit',
                name: '信用点',
                symbol: 'CR',
                aliases: ['积分'],
                baseRate: 1,
                order: 0
            }]
        };

        const text = 构建世界观货币口径(runtime, '官方三层货币');
        expect(text).toContain('仅使用“信用点”');
        expect(text).toContain('不存在上层、中层、底层货币');
        expect(text).not.toContain('铜钱');
        expect(text).not.toContain('金元宝');
    });

    it('多币种按 baseRate 输出统一换算', () => {
        const runtime = 构建官方模式运行时配置('武侠');
        runtime.economy.currencySystem = {
            id: 'coins',
            name: '王国铸币',
            baseUnitId: 'copper',
            units: [
                { id: 'gold', name: '金币', symbol: 'G', aliases: [], baseRate: 10000, order: 2 },
                { id: 'copper', name: '铜币', symbol: 'C', aliases: [], baseRate: 1, order: 0 },
                { id: 'silver', name: '银币', symbol: 'S', aliases: [], baseRate: 100, order: 1 }
            ]
        };

        const text = 构建世界观货币口径(runtime, '旧说明');
        expect(text).toContain('1 银币=100 铜币');
        expect(text).toContain('1 金币=10000 铜币');
        expect(text).not.toContain('旧说明');
    });

    it('没有 currencySystem 时保留 exchangeRules 回退', () => {
        const runtime = 构建官方模式运行时配置('武侠');
        delete runtime.economy.currencySystem;
        runtime.economy.exchangeRules = '一两银等于一千文。';

        expect(构建世界观货币口径(runtime, '官方回退')).toBe('一两银等于一千文。');
    });
});

describe('模式包世界观叙事约束', () => {
    it('主线与暗线转换为不剧透的世界背景约束', () => {
        const snapshot = {
            modeWorldbooks: [{
                id: 'demo-worldbook',
                标题: '演示世界书',
                启用: true,
                条目: [
                    {
                        id: 'demo-narrative-main-story',
                        标题: '主线方向',
                        内容: '【模式包主线方向】\n围绕市井生活和个人成长展开。',
                        类型: 'system_rule',
                        作用域: ['main', 'opening'],
                        注入模式: 'always',
                        启用: true
                    },
                    {
                        id: 'demo-narrative-hidden-plot',
                        标题: '暗线策略',
                        内容: '【模式包暗线策略】\n只保留轻量人情误会和可回收伏笔。',
                        类型: 'system_rule',
                        作用域: ['main', 'opening'],
                        注入模式: 'always',
                        启用: true
                    }
                ]
            }]
        } satisfies OpeningRuntimeSnapshot;

        const text = 构建模式包世界观叙事约束(snapshot);
        expect(text).toContain('市井生活和个人成长');
        expect(text).toContain('轻量人情误会');
        expect(text).toContain('不得点名幕后黑手');
        expect(text).toContain('不生成玩家专属任务线');
    });
});
