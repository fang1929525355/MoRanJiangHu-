import { describe, expect, it } from 'vitest';
import { 构建酒馆预设消息链 } from '../hooks/useGame/promptRuntime';
import type { 酒馆预设结构 } from '../types';

// 最小酒馆预设：只启用 worldInfoBefore 槽位，用于验证世界书文本内容。
const 构建测试预设 = (): 酒馆预设结构 => ({
    prompts: [
        { identifier: 'worldInfoBefore', name: 'World Info', role: 'system', content: '{{worldInfoBefore}}' },
    ],
    prompt_order: [
        { character_id: 100001, order: [{ identifier: 'worldInfoBefore', enabled: true }] },
    ],
} as any);

const 构建测试上下文 = () => ({
    shortMemoryContext: '【短期记忆】主角抵达客栈。',
    contextPieces: {
        worldPrompt: '【世界观】这是一个武侠世界。',
        地图建筑状态: '',
        同人设定摘要: '',
        境界体系提示词: '',
        otherPrompts: [
            '【核心规则】遵守剧情法则。',
            '【文风参考：雪中悍刀行 / 世子很凶 / 娱乐春秋（取法，不复写）】\n战斗取雪中悍刀行的气口。',
        ].join('\n\n'),
        难度设置提示词: '【当前难度摘要】普通难度。',
        叙事人称提示词: '【叙事人称】使用第二人称"你"。',
        字数设置提示词: '【字数设置】每回合不少于450字。',
        COT提示词: '【思维链】Step0 门禁确认；Step1 前文回顾；Step14 最终落地。',
        格式提示词: '【输出格式】使用<正文>标签。',
        文风提示词: '【文风参考：雪中悍刀行 / 世子很凶 / 娱乐春秋（取法，不复写）】\n战斗取雪中悍刀行的气口。',
        离场NPC档案: '',
        长期记忆: '',
        中期记忆: '',
        在场NPC档案: '【在场NPC】俞月荷。',
        剧情安排: '',
        女主剧情规划状态: '',
        世界状态: '',
        环境状态: '【环境】客栈大堂。',
        角色状态: '【角色】杨培强，炼气一层。',
        战斗状态: '',
        门派状态: '',
        任务状态: '',
        约定状态: '',
    },
});

describe('酒馆预设接管原版叙事指令', () => {
    const config = {
        启用酒馆预设模式: true,
        酒馆预设: 构建测试预设(),
        酒馆预设角色ID: 100001,
    } as any;

    const messages = 构建酒馆预设消息链({
        config,
        context: 构建测试上下文() as any,
        chatHistory: [],
        latestUserInput: '我走进客栈。',
        playerName: '杨培强',
        playerRole: null,
    });
    const allText = messages.map((m) => m.content).join('\n\n');

    it('生成了非空世界书消息', () => {
        expect(allText.length).toBeGreaterThan(0);
        expect(allText).toContain('这是一个武侠世界');
    });

    it('世界书不再注入原版思维链(COT Step0-14)', () => {
        expect(allText).not.toContain('Step0 门禁确认');
        expect(allText).not.toContain('Step14 最终落地');
    });

    it('世界书不再注入原版难度/叙事人称/字数指令', () => {
        expect(allText).not.toContain('当前难度摘要');
        expect(allText).not.toContain('每回合不少于450字');
        expect(allText).not.toContain('使用第二人称');
    });

    it('世界书不再注入原版参考文风(write_style)', () => {
        expect(allText).not.toContain('雪中悍刀行');
        expect(allText).not.toContain('世子很凶');
    });

    it('游戏数据状态（角色/环境/在场NPC/记忆）仍然保留', () => {
        expect(allText).toContain('杨培强，炼气一层');
        expect(allText).toContain('客栈大堂');
        expect(allText).toContain('俞月荷');
        expect(allText).toContain('主角抵达客栈');
    });

    it('核心游戏规则（非文风部分）仍保留在世界书中', () => {
        expect(allText).toContain('遵守剧情法则');
    });

    it('世界书注入主剧情叙事总约束（防止 NPC 无理由围绕主角）', () => {
        expect(allText).toContain('叙事必须去魅主');
        expect(allText).toContain('不要让 NPC 或群体无理由地围绕主角倾倒');
    });
});
