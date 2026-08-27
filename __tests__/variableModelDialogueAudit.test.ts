import { describe, expect, it } from 'vitest';
import { 构建正文对白人物审计提示 } from '../hooks/useGame/variableModelWorkflow';

describe('variable model dialogue NPC audit', () => {
    it('requires dialogue speakers missing from social records to be created by variable generation', () => {
        const prompt = 构建正文对白人物审计提示({
            logs: [
                { sender: '旁白', text: '雨声压低了屋檐。' },
                { sender: '沈墨', text: '你是谁？' },
                { sender: '林婉儿', text: '我只是奉命守在这里。' }
            ]
        } as any, {
            角色: { 姓名: '沈墨' },
            环境: {},
            世界: {},
            社交: [],
            战斗: {},
            玩家门派: {},
            任务列表: [],
            约定列表: []
        });

        expect(prompt).toContain('本回合正文对白人物审计');
        expect(prompt).toContain('林婉儿');
        expect(prompt).toContain('push 社交');
        expect(prompt).toContain('完整 NPC 档案');
        expect(prompt).toContain('当前装备未确认的槽位写“无”');
        expect(prompt).toContain('不得凭身份、性别、门派、境界');
        expect(prompt).not.toContain('沈墨：本回合有独立对白框');
    });

    it('requires incomplete existing dialogue NPCs to be repaired instead of kept as story placeholders', () => {
        const prompt = 构建正文对白人物审计提示({
            logs: [
                { sender: '林婉儿', text: '我记得你上一回合让我去后山。' }
            ]
        } as any, {
            角色: { 姓名: '沈墨' },
            环境: {},
            世界: {},
            社交: [
                {
                    姓名: '林婉儿',
                    身份: '剧情对话人物',
                    性别: '未知',
                    境界: '未知'
                }
            ],
            战斗: {},
            玩家门派: {},
            任务列表: [],
            约定列表: []
        });

        expect(prompt).toContain('社交[0]');
        expect(prompt).toContain('性别');
        expect(prompt).toContain('境界');
        expect(prompt).toContain('剧情对话人物');
        expect(prompt).toContain('不能继续保留半残');
    });

    it('requires title-like enemy dialogue speakers to be created in social records', () => {
        const prompt = 构建正文对白人物审计提示({
            logs: [
                { sender: '旁白', text: '冷雾压低了竹林。' },
                { sender: '散修首领', text: '“把灵石交出来。”' }
            ]
        } as any, {
            角色: { 姓名: '杨培强' },
            环境: {},
            世界: {},
            社交: [],
            战斗: {},
            玩家门派: {},
            任务列表: [],
            约定列表: []
        });

        expect(prompt).toContain('散修首领');
        expect(prompt).toContain('push 社交');
        expect(prompt).toContain('完整 NPC 档案');
    });

    it('does not map a merchant speaker onto the first heroine (女一) when her profile mentions silk/merchant', () => {
        const prompt = 构建正文对白人物审计提示({
            logs: [
                { sender: '旁白', text: '绸缎庄里人流如织。' },
                { sender: '丝绸商号掌柜', text: '客官要看些什么料子？' }
            ]
        } as any, {
            角色: { 姓名: '沈墨' },
            环境: {},
            世界: {},
            社交: [
                {
                    姓名: '苏婉儿',
                    身份: '明月圣女',
                    简介: '经营丝绸商号的掌柜之女',
                    是否主要角色: true
                }
            ],
            战斗: {},
            玩家门派: {},
            任务列表: [],
            约定列表: []
        });

        // 修复前：'丝绸商号掌柜' 会被反向子串命中到 女一(社交[0])，导致商人档案写进女一。
        // 修复后：该发送者应被视为未建档，必须 push 社交 新建独立 NPC。
        expect(prompt).toContain('丝绸商号掌柜：本回合有独立对白框');
        expect(prompt).toContain('push 社交');
        expect(prompt).not.toContain('丝绸商号掌柜：已匹配');
    });
});
