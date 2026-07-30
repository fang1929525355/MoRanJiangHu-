import { describe, it, expect } from 'vitest';
import { normalizeStateCommandKey, 剥离强调标记 } from '../utils/stateHelpers';
import { parseJudgmentText } from '../components/features/Chat/MessageRenderers';

describe('Bug C: 状态命令 key/value 被 markdown 强调包裹时应正常解析', () => {
    it('剥离强调标记处理各种包裹形式', () => {
        expect(剥离强调标记('*角色.容貌*')).toBe('角色.容貌');
        expect(剥离强调标记('_环境.天气_')).toBe('环境.天气');
        expect(剥离强调标记('**社交[0].姓名**')).toBe('社交[0].姓名');
        expect(剥离强调标记('角色.容貌')).toBe('角色.容貌');
        expect(剥离强调标记('*+3*')).toBe('+3');
        // 不对称的强调包裹不做错误剥离
        expect(剥离强调标记('*角色.容貌')).toBe('*角色.容貌');
    });

    it('normalizeStateCommandKey 对 * 包裹的 key 与未包裹产生相同结果', () => {
        expect(normalizeStateCommandKey('*角色.容貌*')).toBe(normalizeStateCommandKey('角色.容貌'));
        expect(normalizeStateCommandKey('_角色.音响_')).toBe(normalizeStateCommandKey('角色.音响'));
        expect(normalizeStateCommandKey('**角色.身高**')).toBe(normalizeStateCommandKey('角色.身高'));
    });

    it('normalizeStateCommandKey 归一化结果以 gameState. 开头（证明命令未被静默丢弃）', () => {
        const 裸 = normalizeStateCommandKey('角色.容貌');
        const 包裹 = normalizeStateCommandKey('*角色.容貌*');
        expect(裸.startsWith('gameState.')).toBe(true);
        expect(包裹.startsWith('gameState.')).toBe(true);
        expect(包裹).toBe(裸);
    });
});

describe('Bug B: 判定块内的自由叙事正文应被保留并展示，而非被吞', () => {
    it('单判定块：未被字段匹配的自由叙事行被收集到 narrative', () => {
        const parsed = parseJudgmentText('比试｜你抢先一步踏前，刀光先敌半寸落下。');
        expect(parsed.narrative).toEqual(['你抢先一步踏前，刀光先敌半寸落下。']);
        // 自由叙事不应被误判为属性修正
        expect(parsed.modifiers).toEqual([]);
    });

    it('带属性修正后仍有叙事：两者分别保留', () => {
        const parsed = parseJudgmentText('比试｜基础+3（身法）｜你抢先一步踏前，刀光先敌半寸落下。');
        expect(parsed.modifiers.length).toBe(1);
        expect(parsed.narrative).toEqual(['你抢先一步踏前，刀光先敌半寸落下。']);
    });

    it('纯字段行不产生多余 narrative', () => {
        const parsed = parseJudgmentText('比试｜基础+3（身法）');
        expect(parsed.modifiers.length).toBe(1);
        expect(parsed.narrative).toEqual([]);
    });

    it('带分类前缀的判定块也能提取叙事', () => {
        const parsed = parseJudgmentText('【先机】比试｜你抢先一步踏前，刀光先敌半寸落下。');
        expect(parsed.category).toBe('先机');
        expect(parsed.narrative).toEqual(['你抢先一步踏前，刀光先敌半寸落下。']);
    });

    it('多段自由叙事全部保留', () => {
        const parsed = parseJudgmentText('比试｜你抢先一步踏前。｜刀光先敌半寸落下，寒风掠过巷口。');
        expect(parsed.narrative).toEqual([
            '你抢先一步踏前。',
            '刀光先敌半寸落下，寒风掠过巷口。',
        ]);
    });
});
