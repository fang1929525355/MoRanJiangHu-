import { describe, expect, it, vi } from 'vitest';
import { 创建手动图片动作工作流 } from '../hooks/useGame/image/manualImageActionsWorkflow';

const 创建依赖 = (socialList: any[]): any => ({
    获取社交列表: () => socialList,
    获取开局配置: undefined,
    NSFW模式已启用: () => true,
    记录后台手动生图监控: vi.fn(),
    记录后台私密生图监控: vi.fn(),
    推送右下角提示: vi.fn(),
    执行单个NPC生图: vi.fn(async () => undefined),
    执行NPC香闺秘档部位生图: vi.fn(async () => undefined),
    男娘NSFW内容已启用: () => true
});

describe('manualImageActionsWorkflow', () => {
    it('retryNpcImageGeneration forwards the selected composition', async () => {
        const deps = 创建依赖([{
            id: 'npc_portrait',
            姓名: '沈照雪',
            性别: '女',
            图片档案: {}
        }]);
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.retryNpcImageGeneration('npc_portrait', { 构图: '立绘' });

        expect(deps.执行单个NPC生图).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'npc_portrait' }),
            expect.objectContaining({ force: true, source: 'retry', 构图: '立绘' })
        );
    });

    it('retryNpcImageGeneration ignores invalid requested composition and falls back to the last valid one', async () => {
        const deps = 创建依赖([{
            id: 'npc_portrait',
            姓名: '沈照雪',
            性别: '女',
            图片档案: { 最近生图结果: { 构图: '半身' } }
        }]);
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.retryNpcImageGeneration('npc_portrait', { 构图: '场景' as any });

        expect(deps.执行单个NPC生图).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'npc_portrait' }),
            expect.objectContaining({ force: true, source: 'retry', 构图: '半身' })
        );
    });

    it('全部生成时男娘主要角色只生成男性两处特写', async () => {
        const deps = 创建依赖([{
            id: 'npc_femboy',
            姓名: '霁月',
            性别: '男娘',
            是否主要角色: true,
            男娘设定: '女性化衣着与气质明确。',
            肉棒描述: '已有私密档案。',
            屁穴描述: '已有后庭档案。',
            图片档案: {}
        }]);
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.generateNpcSecretPartImage('npc_femboy', '全部');

        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenCalledTimes(2);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'npc_femboy' }), '屁穴', undefined);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'npc_femboy' }), '肉棒', undefined);
        expect(deps.推送右下角提示).toHaveBeenCalledWith(expect.objectContaining({
            title: '香闺秘档特写生成完成',
            message: '霁月的两处特写已全部写入图片档案。'
        }));
    });

    it('全部生成时不会把 false 扶她设定的男性误判为扶她', async () => {
        const deps = 创建依赖([{
            id: 'npc_male_false_futa',
            姓名: '陆沉',
            性别: '男',
            是否主要角色: true,
            男娘设定: '无',
            扶她设定: 'false',
            胸部描述: '不应生成胸部特写。',
            小穴描述: '不应生成小穴特写。',
            肉棒描述: '已有男性私密档案。',
            屁穴描述: '已有后庭档案。',
            图片档案: {}
        }]);
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.generateNpcSecretPartImage('npc_male_false_futa', '全部');

        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenCalledTimes(2);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'npc_male_false_futa' }), '屁穴', undefined);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'npc_male_false_futa' }), '肉棒', undefined);
    });

    it('全部生成时扶她主要角色走肉棒和屁穴两处特写', async () => {
        const deps = 创建依赖([{
            id: 'npc_futa',
            姓名: '绯影',
            性别: '扶她',
            是否主要角色: true,
            扶她设定: '扶她身份与身体结构明确。',
            胸部描述: '已有胸部档案。',
            小穴描述: '已有小穴档案。',
            肉棒描述: '已有扶她私密档案。',
            屁穴描述: '已有后庭档案。',
            图片档案: {}
        }]);
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.generateNpcSecretPartImage('npc_futa', '全部');

        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenCalledTimes(4);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'npc_futa' }), '胸部', undefined);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'npc_futa' }), '小穴', undefined);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(3, expect.objectContaining({ id: 'npc_futa' }), '屁穴', undefined);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(4, expect.objectContaining({ id: 'npc_futa' }), '肉棒', undefined);
    });

    it('私密描述为空或占位时不提交生图任务', async () => {
        const deps = 创建依赖([{
            id: 'npc_empty',
            姓名: '青岚',
            性别: '女',
            是否主要角色: true,
            胸部描述: '空无',
            小穴描述: '暂无记录',
            屁穴描述: '',
            图片档案: {}
        }]);
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.generateNpcSecretPartImage('npc_empty', '胸部');

        expect(deps.执行NPC香闺秘档部位生图).not.toHaveBeenCalled();
        expect(deps.推送右下角提示).toHaveBeenCalledWith(expect.objectContaining({
            title: '暂无可生成的私密描述',
            message: expect.stringContaining('胸部描述为空或仍是占位文本')
        }));
    });

    it('全部生成时会跳过空描述部位，只提交已有描述部位', async () => {
        const deps = 创建依赖([{
            id: 'npc_partial',
            姓名: '红绡',
            性别: '女',
            是否主要角色: true,
            胸部描述: '稳定胸部档案。',
            小穴描述: '空无',
            屁穴描述: '稳定后庭档案。',
            图片档案: {}
        }]);
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.generateNpcSecretPartImage('npc_partial', '全部');

        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenCalledTimes(2);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'npc_partial' }), '胸部', undefined);
        expect(deps.执行NPC香闺秘档部位生图).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'npc_partial' }), '屁穴', undefined);
    });

    it('总 NSFW 关闭时直接提示总开关未开启', async () => {
        const deps = 创建依赖([{
            id: 'npc_femboy',
            姓名: '霁月',
            性别: '男娘',
            是否主要角色: true,
            图片档案: {}
        }]);
        deps.NSFW模式已启用 = () => false;
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.generateNpcSecretPartImage('npc_femboy', '全部');

        expect(deps.执行NPC香闺秘档部位生图).not.toHaveBeenCalled();
        expect(deps.推送右下角提示).toHaveBeenCalledWith(expect.objectContaining({
            title: '私密特写未启用',
            message: '当前已关闭 NSFW 模式，男性/男娘/扶她角色不会生成私密部位特写。'
        }));
    });

    it('子开关关闭时提示男娘相关 NSFW 未开启', async () => {
        const deps = 创建依赖([{
            id: 'npc_femboy',
            姓名: '霁月',
            性别: '男娘',
            是否主要角色: true,
            图片档案: {}
        }]);
        deps.男娘NSFW内容已启用 = () => false;
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.generateNpcSecretPartImage('npc_femboy', '全部');

        expect(deps.执行NPC香闺秘档部位生图).not.toHaveBeenCalled();
        expect(deps.推送右下角提示).toHaveBeenCalledWith(expect.objectContaining({
            title: '私密特写未启用',
            message: '当前已关闭男娘 / 扶她相关 NSFW 内容，男性/男娘/扶她角色不会生成私密部位特写。'
        }));
    });

    it('未成年高境界角色不会进入私密特写生成', async () => {
        const deps = 创建依赖([{
            id: 'npc_minor',
            姓名: '青禾',
            性别: '女',
            年龄: 16,
            境界: '元婴境',
            境界层级: 24,
            是否主要角色: true,
            胸部描述: '已有档案。',
            图片档案: {}
        }]);
        deps.获取开局配置 = () => ({ 题材模式: '仙侠' } as any);
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.generateNpcSecretPartImage('npc_minor', '胸部');

        expect(deps.执行NPC香闺秘档部位生图).not.toHaveBeenCalled();
        expect(deps.推送右下角提示).toHaveBeenCalledWith(expect.objectContaining({
            title: '私密特写未启用',
            message: '角色真实年龄或明确视觉年龄不满足成人私密生图要求。'
        }));
    });

    it('明确幼态外观的成年角色不会进入私密特写生成', async () => {
        const deps = 创建依赖([{
            id: 'npc_childlike',
            姓名: '白露',
            性别: '女',
            年龄: 200,
            外观年龄: '幼童外貌',
            境界: '化神境',
            境界层级: 32,
            是否主要角色: true,
            胸部描述: '已有档案。',
            图片档案: {}
        }]);
        deps.获取开局配置 = () => ({ 题材模式: '仙侠' } as any);
        const workflow = 创建手动图片动作工作流(deps);

        await workflow.generateNpcSecretPartImage('npc_childlike', '胸部');

        expect(deps.执行NPC香闺秘档部位生图).not.toHaveBeenCalled();
        expect(deps.推送右下角提示).toHaveBeenCalledWith(expect.objectContaining({
            title: '私密特写未启用',
            message: '角色真实年龄或明确视觉年龄不满足成人私密生图要求。'
        }));
    });
});
