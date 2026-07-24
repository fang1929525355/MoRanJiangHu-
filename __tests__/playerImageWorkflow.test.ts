import { describe, expect, it, vi } from 'vitest';
import { 创建主角图片工作流 } from '../hooks/useGame/playerImageWorkflow';

const 创建依赖 = (
    执行生图: ReturnType<typeof vi.fn>,
    featureOverride?: Record<string, unknown>,
    anchorOverride: any = null
): any => ({
    获取角色: () => ({ 姓名: '刀哥', 头像图片URL: '' }),
    设置角色: vi.fn(),
    规范化角色物品容器映射: (value: any) => value,
    执行自动存档: vi.fn(),
    获取历史记录: () => [],
    推送右下角提示: vi.fn(),
    加载NPC生图工作流: vi.fn(async () => ({ 执行NPC生图工作流: 执行生图 })),
    apiConfig: {},
    获取文生图接口配置: vi.fn(),
    获取生图词组转化器接口配置: vi.fn(),
    获取生图画师串预设: vi.fn(),
    获取当前PNG画风预设: vi.fn(),
    读取主角角色锚点: () => anchorOverride,
    提取主角角色锚点: vi.fn(async () => null),
    自动角色锚点已启用: () => false,
    获取词组转化器预设提示词: vi.fn(),
    接口配置是否可用: vi.fn(),
    读取文生图功能配置: () => ({ 总开关: true, NPC开关: true, ...featureOverride }),
    主角生图进行中集合: new Set<string>(),
    提取主角生图基础数据: (character: any) => character,
    创建NPC生图任务: (params: any) => params,
    生成NPC生图记录ID: () => 'record-1',
    追加NPC生图任务: vi.fn(),
    更新NPC生图任务: vi.fn(),
    构建文生图额外要求: (extra?: string) => extra || ''
});

describe('playerImageWorkflow', () => {
    it('keeps manual player image failures handled by toast instead of leaking a rejection', async () => {
        const 执行生图 = vi.fn(async () => {
            throw new Error('ComfyUI 后端在线，但浏览器直连失败');
        });
        const deps = 创建依赖(执行生图);
        const workflow = 创建主角图片工作流(deps as any);

        await expect(workflow.generatePlayerImageManually({ 构图: '头像' })).resolves.toBeUndefined();
        expect(deps.推送右下角提示).toHaveBeenCalledWith(expect.objectContaining({
            title: '主角生图失败',
            tone: 'error'
        }));
    });

    it('cools down automatic avatar补全 after an image backend failure', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const 执行生图 = vi.fn(async () => {
            throw new Error('ComfyUI 后端在线，但浏览器直连失败');
        });
        const workflow = 创建主角图片工作流(创建依赖(执行生图) as any);

        await workflow.ensurePlayerAvatarEachTurn({ 姓名: '刀哥', 头像图片URL: '' } as any);
        await workflow.ensurePlayerAvatarEachTurn({ 姓名: '刀哥', 头像图片URL: '' } as any);

        expect(执行生图).toHaveBeenCalledTimes(1);
        warnSpy.mockRestore();
    });

    it('keeps automatic player补图 independent from the NPC automatic image switch', async () => {
        const 执行生图 = vi.fn(async () => undefined);
        const workflow = 创建主角图片工作流(创建依赖(执行生图, { NPC开关: false }) as any);

        await workflow.generatePlayerImagesAutomatically({ 姓名: '刀哥', 头像图片URL: '' } as any);
        await workflow.ensurePlayerAvatarEachTurn({ 姓名: '刀哥', 头像图片URL: '' } as any);

        expect(执行生图).toHaveBeenCalledTimes(4);
    });

    it('does not run automatic player补图 when the image generation master switch is off', async () => {
        const 执行生图 = vi.fn(async () => undefined);
        const workflow = 创建主角图片工作流(创建依赖(执行生图, { 总开关: false, NPC开关: true }) as any);

        await workflow.generatePlayerImagesAutomatically({ 姓名: '刀哥', 头像图片URL: '' } as any);
        await workflow.ensurePlayerAvatarEachTurn({ 姓名: '刀哥', 头像图片URL: '' } as any);

        expect(执行生图).not.toHaveBeenCalled();
    });

    it('uses an existing manual player anchor without calling AI extraction first', async () => {
        const 执行生图 = vi.fn(async () => undefined);
        const manualAnchor = {
            id: 'manual-player-anchor',
            npcId: '__player__',
            名称: '手动主控锚点',
            是否启用: true,
            生成时默认附加: true,
            正面提示词: 'black hair, red robe',
            负面提示词: 'extra fingers',
            来源: 'manual'
        };
        const deps = 创建依赖(执行生图, undefined, manualAnchor);
        deps.自动角色锚点已启用 = () => true;
        const workflow = 创建主角图片工作流(deps as any);

        await workflow.generatePlayerImageManually({ 构图: '头像' });

        expect(deps.提取主角角色锚点).not.toHaveBeenCalled();
        expect(执行生图).toHaveBeenCalledTimes(1);
    });

    it('passes explicit visual age and realm level into the shared npc workflow', async () => {
        const 执行生图 = vi.fn(async () => undefined);
        const deps = 创建依赖(执行生图);
        deps.获取角色 = () => ({
            姓名: '刀哥',
            性别: '男',
            年龄: 120,
            外观年龄: 30,
            境界: '金丹境',
            境界层级: 17,
            出身背景: { 名称: '散修', 描述: '久历风霜。' }
        } as any);
        const workflow = 创建主角图片工作流(deps as any);

        await workflow.generatePlayerImageManually({ 构图: '头像' });

        expect(执行生图).toHaveBeenCalledWith(
            expect.objectContaining({ 外观年龄: 30, 境界层级: 17, 年龄: 120 }),
            expect.anything(),
            expect.anything()
        );
    });

    it('binds a successful generated player avatar so it remains visible after refresh/load', async () => {
        const avatarRecord = {
            id: 'player-avatar-1',
            构图: '头像',
            状态: 'success',
            图片URL: 'https://img.example/player-avatar.webp',
            生成时间: 1000
        };
        let role: any = { 姓名: '刀哥', 头像图片URL: '' };
        const 执行生图 = vi.fn(async (_npc: any, _options: any, imageDeps: any) => {
            imageDeps.更新NPC最近生图结果('player', (player: any) => ({
                ...player,
                最近生图结果: avatarRecord,
                图片档案: {
                    最近生图结果: avatarRecord,
                    生图历史: [avatarRecord]
                }
            }));
        });
        const deps = 创建依赖(执行生图);
        deps.获取角色 = () => role;
        deps.设置角色 = vi.fn((updater: any) => {
            role = updater(role);
        });
        const workflow = 创建主角图片工作流(deps as any);

        await workflow.generatePlayerImageManually({ 构图: '头像' });

        expect(role.图片档案?.已选头像图片ID).toBe('player-avatar-1');
        expect(role.图片档案?.生图历史?.[0]?.id).toBe('player-avatar-1');
        expect(deps.执行自动存档).toHaveBeenCalledWith(expect.objectContaining({
            role: expect.objectContaining({
                图片档案: expect.objectContaining({
                    已选头像图片ID: 'player-avatar-1'
                })
            }),
            force: true
        }));
    });

    it('skips automatic player image slots that already have recoverable records', async () => {
        const 执行生图 = vi.fn(async () => undefined);
        const workflow = 创建主角图片工作流(创建依赖(执行生图) as any);
        await workflow.generatePlayerImagesAutomatically({
            姓名: '刀哥',
            头像图片URL: '',
            图片档案: {
                已选头像图片ID: 'avatar-1',
                已选立绘图片ID: 'portrait-1',
                生图历史: [
                    { id: 'avatar-1', 构图: '头像', 状态: 'success', 图片URL: 'https://img.example/avatar.webp' },
                    { id: 'portrait-1', 构图: '半身', 状态: 'success', 图片URL: 'https://img.example/portrait.webp' }
                ]
            }
        } as any);

        expect(执行生图).toHaveBeenCalledTimes(1);
        const [, optionsArg] = 执行生图.mock.calls[0] as any[];
        expect(optionsArg).toEqual(expect.objectContaining({ 构图: '立绘' }));
    });

    it('does not resubmit a player avatar when the current role already has a pending avatar from an earlier opening trigger', async () => {
        const 执行生图 = vi.fn(async () => undefined);
        const pendingAvatar = {
            id: 'pending-avatar-1',
            构图: '头像',
            状态: 'pending',
            生成时间: Date.now(),
            生图词组: 'opening avatar prompt'
        };
        const currentRole: any = {
            姓名: '刀哥',
            头像图片URL: '',
            图片档案: {
                最近生图结果: pendingAvatar,
                生图历史: [pendingAvatar]
            }
        };
        const deps = 创建依赖(执行生图);
        deps.获取角色 = () => currentRole;
        const workflow = 创建主角图片工作流(deps as any);

        await workflow.ensurePlayerAvatarEachTurn({ 姓名: '刀哥', 头像图片URL: '' } as any);

        expect(执行生图).not.toHaveBeenCalled();
    });

    it('persists every generated player secret part image into the player archive', async () => {
        let role: any = {
            姓名: '前月荷',
            性别: '女',
            年龄: 22,
            胸部描述: '胸部描述',
            小穴描述: '小穴描述',
            屁穴描述: '屁穴描述',
            图片档案: {
                生图历史: []
            }
        };
        const 执行香闺秘档部位生图 = vi.fn(async (_npc: any, part: string, _options: any, imageDeps: any) => {
            imageDeps.更新NPC香闺秘档部位结果('__player__', part, (current: any) => ({
                ...current,
                id: `pending-${part}`,
                部位: part,
                构图: '部位特写',
                状态: 'pending'
            }));
            return imageDeps.写入NPC香闺秘档部位记录('__player__', part, {
                id: `secret-${part}`,
                部位: part,
                构图: '部位特写',
                状态: 'success',
                本地路径: `wuxia-asset://secret-${part}`,
                生成时间: 1000 + 执行香闺秘档部位生图.mock.calls.length
            }, { 同步最近结果: false });
        });
        const deps = 创建依赖(vi.fn());
        deps.获取角色 = () => role;
        deps.设置角色 = vi.fn((updater: any) => {
            role = updater(role);
        });
        deps.加载NPC生图工作流 = vi.fn(async () => ({
            执行NPC香闺秘档部位生图: 执行香闺秘档部位生图
        }));
        const workflow = 创建主角图片工作流(deps as any);

        await workflow.generatePlayerSecretPartImage('胸部');
        await workflow.generatePlayerSecretPartImage('小穴');
        await workflow.generatePlayerSecretPartImage('屁穴');

        expect(role.图片档案?.香闺秘档部位档案?.胸部?.本地路径).toBe('wuxia-asset://secret-胸部');
        expect(role.图片档案?.香闺秘档部位档案?.小穴?.本地路径).toBe('wuxia-asset://secret-小穴');
        expect(role.图片档案?.香闺秘档部位档案?.屁穴?.本地路径).toBe('wuxia-asset://secret-屁穴');
        expect(role.图片档案?.生图历史.map((item: any) => item.id)).toEqual([
            'secret-屁穴',
            'secret-小穴',
            'secret-胸部'
        ]);
        expect(deps.执行自动存档).toHaveBeenCalledTimes(6);
        expect(deps.执行自动存档).toHaveBeenLastCalledWith(expect.objectContaining({
            role: expect.objectContaining({
                图片档案: expect.objectContaining({
                    香闺秘档部位档案: expect.objectContaining({
                        胸部: expect.objectContaining({ 本地路径: 'wuxia-asset://secret-胸部' }),
                        小穴: expect.objectContaining({ 本地路径: 'wuxia-asset://secret-小穴' }),
                        屁穴: expect.objectContaining({ 本地路径: 'wuxia-asset://secret-屁穴' })
                    })
                })
            }),
            force: true
        }));
    });

    it('blocks player secret part generation for real minors even at high realm', async () => {
        const deps = 创建依赖(vi.fn());
        deps.获取角色 = () => ({
            姓名: '未成年的主角',
            性别: '女',
            年龄: 16,
            境界: '元婴境',
            境界层级: 24,
            胸部描述: '已有描述。'
        } as any);
        const workflow = 创建主角图片工作流(deps as any);

        await workflow.generatePlayerSecretPartImage('胸部');

        expect(deps.加载NPC生图工作流).not.toHaveBeenCalled();
        expect(deps.推送右下角提示).toHaveBeenCalledWith(expect.objectContaining({
            title: '主角胸部图片生成失败',
            message: '角色真实年龄或明确视觉年龄不满足成人私密生图要求。'
        }));
    });

    it('blocks player secret part generation for explicit childlike appearance', async () => {
        const deps = 创建依赖(vi.fn());
        deps.获取角色 = () => ({
            姓名: '返老者',
            性别: '女',
            年龄: 200,
            外观年龄: '幼童外貌',
            境界: '化神境',
            境界层级: 40,
            胸部描述: '已有描述。'
        } as any);
        const workflow = 创建主角图片工作流(deps as any);

        await workflow.generatePlayerSecretPartImage('胸部');

        expect(deps.加载NPC生图工作流).not.toHaveBeenCalled();
        expect(deps.推送右下角提示).toHaveBeenCalledWith(expect.objectContaining({
            title: '主角胸部图片生成失败',
            message: '角色真实年龄或明确视觉年龄不满足成人私密生图要求。'
        }));
    });
});
