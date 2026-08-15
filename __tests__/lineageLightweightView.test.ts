import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { 投影存档谱系轻量视图, type 存档谱系轻量视图 } from '../services/dbService';

describe('投影存档谱系轻量视图', () => {
    it('投影后不含完整存档的大字段(社交/世界/战斗/剧情/图片)', () => {
        const fullSave: any = {
            id: 1,
            类型: 'manual',
            时间戳: 1779000001000,
            元数据: {
                存档哈希: 'aaa111',
                存档系列ID: 'series-test',
                存档谱系版本: 1
            },
            游戏初始时间: '1:01:01:00:00',
            角色数据: { 姓名: '张三', 境界: '炼气', 境界层级: 3 },
            环境信息: { 大地点: '中原', 中地点: '洛阳', 小地点: '集市', 具体地点: '药铺' },
            历史记录: [
                { role: 'user', content: '买药' },
                { role: 'assistant', structuredResponse: { logs: [] } },
                { role: 'user', content: '继续' },
                { role: 'assistant', content: '你买到了丹药。' }
            ],
            // 以下是大字段，投影后不应出现
            社交: [{ 姓名: 'NPC甲', 是否在场: true }],
            世界: { 活跃NPC列表: ['NPC甲'] },
            战斗: { 状态: 'idle' },
            剧情: { 当前章节: '第一章' },
            任务列表: [{ 描述: '测试任务' }],
            约定列表: [{ 描述: '测试约定' }],
            玩家门派: { 名称: '武当' },
            女主剧情规划: {},
            同人剧情规划: {},
            同人女主剧情规划: {}
        };

        const view = 投影存档谱系轻量视图(fullSave, fullSave.id);

        // 谱系必需字段保留
        expect(view.id).toBe(1);
        expect(view.时间戳).toBe(1779000001000);
        expect(view.类型).toBe('manual');
        expect(view.元数据.存档哈希).toBe('aaa111');
        expect(view.元数据.存档系列ID).toBe('series-test');
        expect(view.游戏初始时间).toBe('1:01:01:00:00');
        expect(view.角色数据?.姓名).toBe('张三');
        expect(view.环境信息?.大地点).toBe('中原');
        expect(view.环境信息?.具体地点).toBe('药铺');

        // 大字段不在视图上
        expect((view as any).社交).toBeUndefined();
        expect((view as any).世界).toBeUndefined();
        expect((view as any).战斗).toBeUndefined();
        expect((view as any).剧情).toBeUndefined();
        expect((view as any).任务列表).toBeUndefined();
        expect((view as any).约定列表).toBeUndefined();
        expect((view as any).玩家门派).toBeUndefined();
        expect((view as any).女主剧情规划).toBeUndefined();
        expect((view as any).同人剧情规划).toBeUndefined();
        expect((view as any).同人女主剧情规划).toBeUndefined();

        // 角色数据只有姓名,没有境界
        expect((view.角色数据 as any)?.境界).toBeUndefined();

        // 历史记录只保留首条和首条 user,不保留中间正文
        expect(Array.isArray(view.历史记录)).toBe(true);
        expect(view.历史记录!.length).toBeLessThanOrEqual(2);
        expect(view.历史记录!.length).toBeGreaterThanOrEqual(1);
        // 首条保留
        expect(view.历史记录![0]?.role).toBe('user');
    });

    it('投影含 base64 图片的存档时，图片数据不会进入视图', () => {
        const saveWithImage: any = {
            id: 2,
            类型: 'auto',
            时间戳: 1779000002000,
            元数据: { 存档哈希: 'bbb222', 存档系列ID: 'series-img' },
            角色数据: { 姓名: '李四' },
            环境信息: { 具体地点: '密室' },
            历史记录: [
                { role: 'user', content: '探索' }
            ],
            // 模拟 base64 图片数据
            背景图片: 'data:image/png;base64,iVBOR...很长的base64字符串...',
            角色数据_头像: 'data:image/jpeg;base64,/9j/...另一段base64...'
        };

        const view = 投影存档谱系轻量视图(saveWithImage, saveWithImage.id);

        expect((view as any).背景图片).toBeUndefined();
        expect((view as any).角色数据_头像).toBeUndefined();
        expect(view.角色数据?.姓名).toBe('李四');
    });

    it('空元数据存档投影后元数据为空对象而非 undefined', () => {
        const saveNoMetadata: any = {
            id: 3,
            类型: 'manual',
            时间戳: 1779000003000,
            历史记录: []
        };

        const view = 投影存档谱系轻量视图(saveNoMetadata, saveNoMetadata.id);

        expect(view.元数据).toBeDefined();
        expect(typeof view.元数据).toBe('object');
        expect(view.id).toBe(3);
    });

    it('历史记录只有首条和首条 user 输入', () => {
        const save: any = {
            id: 4,
            类型: 'manual',
            时间戳: 1779000004000,
            元数据: {},
            历史记录: [
                { role: 'system', content: '系统提示' },
                { role: 'user', content: '第一回合行动' },
                { role: 'assistant', structuredResponse: { logs: [] } },
                { role: 'user', content: '第二回合行动' },
                { role: 'assistant', structuredResponse: { logs: [] } },
                { role: 'user', content: '第三回合行动' }
            ]
        };

        const view = 投影存档谱系轻量视图(save, save.id);

        // 历史最多2条：首条 + 首条 user
        expect(view.历史记录!.length).toBeLessThanOrEqual(2);
        // 首条是 system
        expect(view.历史记录![0]?.role).toBe('system');
        // 首条 user 是"第一回合行动"
        const userEntry = view.历史记录!.find((h: any) => h?.role === 'user');
        expect(userEntry?.content).toBe('第一回合行动');
        // 中间的 assistant 和后面的 user 不在视图里
        expect(view.历史记录!.length).toBeLessThan(save.历史记录.length);
    });

    it('谱系齐全的轻量视图不会被校正路径 fallback 到完整存档', async () => {
        // 模拟两个谱系完整的轻量视图，传给修复函数检测
        // 轻量视图历史记录只有边界元素，读取存档游玩回合数 会算出 0，
        // 但 读取谱系回合数 优先读 元数据.游戏回合数，所以谱系算法会认为
        // 连接关系和回合数都正确，不会触发修复。
        const { 修复本地存档谱系列表 } = await import('../utils/saveLineage');

        const views: 存档谱系轻量视图[] = [
            {
                id: 1,
                时间戳: 1779000001000,
                类型: 'manual',
                元数据: {
                    存档哈希: 'hash1',
                    存档系列ID: 'series-x',
                    存档父节点哈希: '',
                    存档根节点哈希: 'hash1',
                    存档谱系深度: 0,
                    存档谱系版本: 1,
                    游戏回合数: 0,
                    存档分支输入: '开局'
                } as any,
                历史记录: []
            },
            {
                id: 2,
                时间戳: 1779000002000,
                类型: 'auto',
                元数据: {
                    存档哈希: 'hash2',
                    存档系列ID: 'series-x',
                    存档父节点哈希: 'hash1',
                    存档根节点哈希: 'hash1',
                    存档谱系深度: 1,
                    存档谱系版本: 1,
                    游戏回合数: 1,
                    存档分支输入: '继续游玩'
                } as any,
                历史记录: []
            }
        ];

        // 谱系完整的轻量视图不应触发修复
        const result = 修复本地存档谱系列表(views as any);
        expect(result.changed).toBe(false);
        expect(result.saves.length).toBe(2);
    });

    it('边界历史含 structuredResponse 时仍使用轻量视图中的准确回合数', async () => {
        const { 修复本地存档谱系列表 } = await import('../utils/saveLineage');
        const boundaryHistory = [
            { role: 'assistant', structuredResponse: { logs: [] } } as any,
            { role: 'user', content: '继续' } as any
        ];
        const views: 存档谱系轻量视图[] = [
            {
                id: 11,
                时间戳: 1779000011000,
                类型: 'manual',
                元数据: {
                    存档哈希: 'root-hash',
                    存档系列ID: 'series-structured-boundary',
                    存档父节点哈希: '',
                    存档根节点哈希: 'root-hash',
                    存档谱系深度: 0,
                    存档谱系版本: 1,
                    历史记录条数: 10,
                    游戏回合数: 0,
                    存档分支输入: '开局'
                } as any,
                历史记录: boundaryHistory
            },
            {
                id: 12,
                时间戳: 1779000012000,
                类型: 'auto',
                元数据: {
                    存档哈希: 'child-hash',
                    存档系列ID: 'series-structured-boundary',
                    存档父节点哈希: 'root-hash',
                    存档根节点哈希: 'root-hash',
                    存档谱系深度: 1,
                    存档谱系版本: 1,
                    历史记录条数: 20,
                    游戏回合数: 5,
                    存档分支输入: '继续'
                } as any,
                历史记录: boundaryHistory
            }
        ];

        const result = 修复本地存档谱系列表(views as any);

        expect(result.changed).toBe(false);
        expect(result.saves[1].元数据?.游戏回合数).toBe(5);
    });

    it('边界历史也只保留谱系签名字段，不引用大正文或 structuredResponse', () => {
        const hugeContent = '长正文'.repeat(20000);
        const view = 投影存档谱系轻量视图({
            id: 6,
            类型: 'manual',
            时间戳: 1779000006000,
            元数据: {},
            历史记录: [
                {
                    role: 'assistant',
                    content: hugeContent,
                    structuredResponse: { logs: [{ raw: hugeContent }] }
                } as any,
                { role: 'user', content: `行动${hugeContent}` }
            ]
        } as any, 6);

        expect(JSON.stringify(view.历史记录).length).toBeLessThan(2048);
        expect((view.历史记录?.[0] as any)?.structuredResponse).toEqual({});
        expect(String(view.历史记录?.[0]?.content || '').length).toBeLessThanOrEqual(256);
        expect(String(view.历史记录?.[1]?.content || '').length).toBeLessThanOrEqual(256);
    });

    it('轻量投影保留准确的历史条数与游戏回合数供谱系排序使用', () => {
        const view = 投影存档谱系轻量视图({
            id: 5,
            类型: 'manual',
            时间戳: 1779000005000,
            元数据: {},
            历史记录: [
                { role: 'user', content: '开局' },
                { role: 'assistant', structuredResponse: { logs: [] } } as any,
                { role: 'user', content: '继续' },
                { role: 'assistant', structuredResponse: { logs: [] } } as any,
                { role: 'user', content: '再继续' },
                { role: 'assistant', structuredResponse: { logs: [] } } as any,
            ]
        } as any, 5);

        expect(view.元数据?.历史记录条数).toBe(6);
        expect(view.元数据?.游戏回合数).toBe(2);
        expect(view.历史记录).toHaveLength(1);
    });

    it('旧档迁移的存档哈希必须基于完整存档计算', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'services/dbService.ts'), 'utf8');
        const start = source.indexOf('export const 启动旧存档谱系迁移');
        const end = source.indexOf('export const 获取旧存档谱系迁移状态', start);
        const migrationSource = source.slice(start, end);

        expect(migrationSource).toContain('存档哈希: 计算存档同步哈希(save)');
        expect(migrationSource).not.toContain('计算存档同步哈希(saveViewForHash as unknown as Partial<存档结构>)');
    });
});
