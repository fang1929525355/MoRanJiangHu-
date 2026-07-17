import { describe, expect, it } from 'vitest';
import {
    构建规划性别比例约束摘要,
    构建统一规划分析系统提示词,
    构建统一规划分析用户提示词
} from '../prompts/runtime/planningAnalysis';
import { 构建开局规划初始化审计重点, 开局规划初始化附加提示词 } from '../prompts/runtime/openingPlanningInit';

describe('planning prompts', () => {
    it('requires planning analysis to apply world gender ratio constraints to new character pools', () => {
        const systemPrompt = 构建统一规划分析系统提示词({ heroineEnabled: true });
        const userPrompt = 构建统一规划分析用户提示词({
            currentStoryJson: '{}',
            currentHeroinePlanJson: '{}',
            worldJson: '{"NPC系统":{"男女比例":"1:9"}}',
            socialJson: '[]',
            envJson: '{}',
            recentBodiesText: '正文',
            auditFocusText: '常规回合固定审计',
            genderRatioConstraintText: 构建规划性别比例约束摘要('1:9'),
            heroineEnabled: true
        });

        expect(systemPrompt).toContain('新增 NPC、公共场景路人、组织成员、敌友角色池或女主候选补位');
        expect(systemPrompt).toContain('男女比例或性别比例设定');
        expect(systemPrompt).toContain('新增人物池的分布约束');
        expect(systemPrompt).toContain('已有事实、角色身份边界、后宫/后院/妻妾等特殊场景和玩家明确要求优先于比例');

        expect(userPrompt).toContain('世界观/NPC系统男女比例或性别比例设定');
        expect(userPrompt).toContain('【规划性别比例约束】');
        expect(userPrompt).toContain('当前开局配置性别比例：1:9');
        expect(userPrompt).toContain('按该比例保持新增人物池分布');
    });

    it('renders structured gender ratio values into an explicit planning constraint block', () => {
        const summary = 构建规划性别比例约束摘要({ 男: 10, 女: 80, 男娘: 5, 扶她: 5 });

        expect(summary).toContain('【规划性别比例约束】');
        expect(summary).toContain('男:10，女:80，男娘:5，扶她:5');
        expect(summary).toContain('按该比例保持新增人物池分布');
    });

    it('does not imply heroine planning exists when heroine planning is disabled', () => {
        const userPrompt = 构建统一规划分析用户提示词({
            currentStoryJson: '{}',
            currentHeroinePlanJson: '{}',
            worldJson: '{}',
            socialJson: '[]',
            envJson: '{}',
            recentBodiesText: '正文里提到一位女性路人。',
            auditFocusText: '常规回合固定审计',
            heroineEnabled: false
        });

        expect(userPrompt).toContain('【女主规划状态】');
        expect(userPrompt).toContain('女主剧情规划未启用');
        expect(userPrompt).toContain('不得新增、推断、补位、修订或输出任何 `女主剧情规划.*` / `同人女主剧情规划.*` 命令');
        expect(userPrompt).toContain('即使正文提到女性角色，也只能按普通社交、剧情或世界状态处理');
        expect(userPrompt).not.toContain('【当前女主规划树】');
    });

    it('injects current player input as intent constraints without treating it as facts', () => {
        const userPrompt = 构建统一规划分析用户提示词({
            playerInput: '本轮暂缓主线，只观察，不要安排刺客袭击。',
            currentStoryJson: '{}',
            currentHeroinePlanJson: '{}',
            worldJson: '{}',
            socialJson: '[]',
            envJson: '{}',
            recentBodiesText: '旁白：主角坐在窗边观察雨夜。',
            auditFocusText: '常规回合固定审计',
            heroineEnabled: false
        });

        expect(userPrompt).toContain('【本轮玩家原始指令】');
        expect(userPrompt).toContain('本轮暂缓主线，只观察，不要安排刺客袭击。');
        expect(userPrompt).toContain('不代表已经发生');
        expect(userPrompt).toContain('不得违背玩家明确提出的“不要、暂缓、禁止、只观察”等限制');
        expect(userPrompt).toContain('不应因为玩家表达想法，就直接把它安排为已完成或已触发事件');
    });

    it('omits current player input block when player input is empty', () => {
        const userPrompt = 构建统一规划分析用户提示词({
            playerInput: '   ',
            currentStoryJson: '{}',
            currentHeroinePlanJson: '{}',
            worldJson: '{}',
            socialJson: '[]',
            envJson: '{}',
            recentBodiesText: '旁白：主角坐在窗边观察雨夜。',
            auditFocusText: '常规回合固定审计',
            heroineEnabled: false
        });

        expect(userPrompt).not.toContain('【本轮玩家原始指令】');
        expect(userPrompt).not.toContain('【玩家原始指令使用说明】');
    });

    it('requires opening planning initialization to preserve gender ratio constraints', () => {
        const auditFocus = 构建开局规划初始化审计重点({ heroineEnabled: true });

        expect(开局规划初始化附加提示词).toContain('新增 NPC、公共场景路人、组织成员、敌友角色池或女主候选补位');
        expect(开局规划初始化附加提示词).toContain('男女比例或性别比例设定');
        expect(开局规划初始化附加提示词).toContain('已有事实、角色身份边界、后宫/后院/妻妾等特殊场景和玩家明确要求优先于比例');

        expect(auditFocus).toContain('世界观/NPC系统男女比例或性别比例设定');
        expect(auditFocus).toContain('按该比例保持新增人物池分布');
    });
});
