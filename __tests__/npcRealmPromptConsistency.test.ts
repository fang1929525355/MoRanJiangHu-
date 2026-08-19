import { describe, expect, it } from 'vitest';
import { 构建数值公式速查提示词 } from '../prompts/runtime/variableCalibrationReference';
import { 数值_NPC参考 } from '../prompts/stats/npc';

describe('NPC realm prompt consistency', () => {
    it('treats NPC realm text and numeric level as persistent synchronized truths', () => {
        const runtimePrompt = 构建数值公式速查提示词({ 启用修炼体系: true } as any);
        const npcPrompt = 数值_NPC参考.内容;

        expect(runtimePrompt).not.toContain('NPC / 敌方默认只维护 `境界` 文案，不补数值层级字段');
        expect(runtimePrompt).toContain('玩家与已有 NPC 的 `境界`、`境界层级` 都是持久真值');
        expect(runtimePrompt).toContain('不得因为缺字段补全、模型默认值或重新建档而把 `社交[i].境界层级` 写成 `1`');
        expect(runtimePrompt).toContain('战败、临时封印与战损结果都不能反推永久境界变更');
        expect(runtimePrompt).toContain('变量规划或内部思考单独声称发生变化不算事实依据');

        expect(npcPrompt).toContain('已建档 NPC 的 `境界 / 境界层级` 属于持久真值');
        expect(npcPrompt).toContain('禁止重猜、默认补成 `1`');
        expect(npcPrompt).toContain('只有明确破境、永久跌境、修为被废或证实旧档案有误时');
    });
});
