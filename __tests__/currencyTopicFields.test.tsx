import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LeftPanel from '../components/layout/LeftPanel';
import { 默认游戏设置 } from '../utils/gameSettings';
import {
    构建角色金钱显示快照,
    获取角色金钱补充字段,
    获取角色金钱BaseAmount,
    规范化角色金钱
} from '../utils/currencyDisplay';

const 仙侠开局配置 = {
    配置约束启用: true,
    题材模式: '仙侠',
    modeRuntimeProfile: undefined
} as any;

const 建立角色 = (金钱: Record<string, number>) => ({
    姓名: '沈砚',
    称号: '外门弟子',
    境界: '练气三层',
    头像图片URL: '',
    头部当前血量: 30,
    头部最大血量: 30,
    头部状态: '正常',
    胸部当前血量: 45,
    胸部最大血量: 45,
    胸部状态: '正常',
    腹部当前血量: 40,
    腹部最大血量: 40,
    腹部状态: '正常',
    左手当前血量: 20,
    左手最大血量: 20,
    左手状态: '正常',
    右手当前血量: 20,
    右手最大血量: 20,
    右手状态: '正常',
    左腿当前血量: 20,
    左腿最大血量: 20,
    左腿状态: '正常',
    右腿当前血量: 20,
    右腿最大血量: 20,
    右腿状态: '正常',
    当前精力: 88,
    最大精力: 120,
    当前内力: 0,
    最大内力: 0,
    当前饱腹: 0,
    最大饱腹: 0,
    当前口渴: 0,
    最大口渴: 0,
    当前经验: 10,
    升级经验: 100,
    玩家BUFF: [],
    物品列表: [],
    金钱,
    装备: {
        头部: '无', 胸部: '无', 背部: '无', 腰部: '无', 腿部: '无',
        足部: '无', 手部: '无', 主武器: '无', 副武器: '无', 暗器: '无', 坐骑: '无'
    }
} as any);

describe('题材专属货币字段显示（左栏钱财恒为 0 的修复）', () => {
    it('仙侠题材“灵石/灵玉”字段能折算进三层货币', () => {
        const 金钱 = { 灵石: 5000, 灵玉: 2 };
        const 规范化 = 规范化角色金钱(金钱);

        expect((规范化 as any).底层货币).toBe(5000);
        expect((规范化 as any).上层货币).toBe(2);
        expect(获取角色金钱BaseAmount(金钱, undefined, 'xianxia')).toBeGreaterThan(0);
    });

    it('现代题材“现金/存款”字段能折算进三层货币', () => {
        const 规范化 = 规范化角色金钱({ 现金: 3000, 存款: 120 });

        expect((规范化 as any).底层货币).toBe(3000);
        expect((规范化 as any).上层货币).toBe(120);
    });

    it('奇幻题材“金币/银币/铜币”字段能折算进三层货币', () => {
        const 规范化 = 规范化角色金钱({ 金币: 3, 银币: 25, 铜币: 40 });

        expect((规范化 as any).上层货币).toBe(3);
        expect((规范化 as any).中层货币).toBe(25);
        expect((规范化 as any).底层货币).toBe(40);
    });

    it('武侠题材旧三层字段不受影响', () => {
        const 规范化 = 规范化角色金钱({ 金元宝: 1, 银子: 20, 铜钱: 300 });

        expect((规范化 as any).上层货币).toBe(1);
        expect((规范化 as any).中层货币).toBe(20);
        expect((规范化 as any).底层货币).toBe(300);
    });

    it('仙侠角色左栏钱财不再显示 0', () => {
        const html = renderToStaticMarkup(
            <LeftPanel
                角色={建立角色({ 灵石: 5000, 灵玉: 2 })}
                openingConfig={仙侠开局配置}
                gameConfig={{ ...默认游戏设置, 启用修炼体系: false, 启用饱腹口渴系统: false }}
            />
        );

        // 修复前：三层货币全部读成 0，页面显示“上品灵石 0 / 中品灵石 0 / 下品灵石 0”
        expect(html).toContain('下品灵石  5000');
        expect(html).toContain('上品灵石  2');
        expect(html).not.toContain('下品灵石  0');
    });

    it('未知币种字段也有兜底显示，不会一律归零', () => {
        const 补充 = 获取角色金钱补充字段({ 香火: 30, 情报额度: 5 });

        expect(补充).toEqual([{ key: '香火', value: 30 }, { key: '情报额度', value: 5 }]);
        expect(构建角色金钱显示快照({ 香火: 30 }, 仙侠开局配置, null).显示).toBe('香火 30');
    });

    it('常规武侠金钱不触发兜底字段', () => {
        expect(获取角色金钱补充字段({ 金元宝: 1, 银子: 2, 铜钱: 3 })).toEqual([]);
    });
});
