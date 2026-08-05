import { describe, expect, it } from 'vitest';
import { 创建空小说拆分数据集 } from '../services/novelDecompositionStore';
import { 聚合小说拆分数据集, 基于分段构建注入树 } from '../services/novelDecompositionPipeline';
import {
    构建小说拆分模式包创意工坊模块,
    解析小说模式包题材,
    清洗小说模式包累积草稿
} from '../services/novelDecompositionWorkshopBridge';
import type { 小说拆分分段结构 } from '../types';

const 创建分段 = (patch: Partial<小说拆分分段结构>): 小说拆分分段结构 => ({
    id: patch.id || `segment-${patch.组号 || 1}`,
    数据集ID: 'dataset-opm',
    组号: patch.组号 || 1,
    标题: patch.标题 || '测试分段',
    章节范围: patch.章节范围 || '第1章',
    章节标题: patch.章节标题 || ['第1章'],
    是否开局组: patch.是否开局组 ?? true,
    起始章序号: patch.起始章序号 || 1,
    结束章序号: patch.结束章序号 || 1,
    启用注入: patch.启用注入 ?? true,
    原文内容: patch.原文内容 || '',
    字数: patch.字数 || 0,
    原文摘要: patch.原文摘要 || '',
    本组概括: patch.本组概括 || '',
    开局已成立事实: patch.开局已成立事实 || [],
    前组延续事实: patch.前组延续事实 || [],
    本组结束状态: patch.本组结束状态 || [],
    给下一组参考: patch.给下一组参考 || [],
    原著硬约束: patch.原著硬约束 || [],
    可提前铺垫: patch.可提前铺垫 || [],
    关键事件: patch.关键事件 || [],
    角色推进: patch.角色推进 || [],
    登场角色: patch.登场角色 || [],
    角色档案: patch.角色档案 || [],
    势力档案: patch.势力档案 || [],
    地图地点档案: patch.地图地点档案 || [],
    物品档案: patch.物品档案 || [],
    世界观规则: patch.世界观规则 || [],
    世界边界规则: patch.世界边界规则 || [],
    人物关系: patch.人物关系 || [],
    势力关系: patch.势力关系 || [],
    伏笔线索: patch.伏笔线索 || [],
    回收点: patch.回收点 || [],
    章节节奏: patch.章节节奏 || [],
    时间线: patch.时间线 || [],
    时间线起点: patch.时间线起点 || '0001:01:01:00:00',
    时间线终点: patch.时间线终点 || '0001:01:01:00:00',
    处理状态: patch.处理状态 || '已完成',
    最近错误: patch.最近错误 || '',
    createdAt: patch.createdAt || 1,
    updatedAt: patch.updatedAt || 1
});

const 序列化客户可见运行时配置 = (profile: any): string => JSON.stringify({
    economy: profile?.economy,
    time: profile?.time,
    organization: profile?.organization,
    ability: profile?.ability,
    items: profile?.items,
    map: profile?.map,
    task: profile?.task,
    npc: profile?.npc,
    image: profile?.image,
    opening: profile?.opening,
    validation: profile?.validation
});

describe('novelDecompositionWorkshopBridge', () => {
    it('每轮累积草稿都会过滤无证据的末日和无限流模板', () => {
        const dataset = 创建空小说拆分数据集({
            标题: '普通武侠',
            世界边界规则: ['不得出现主神空间、丧尸或避难所。']
        });
        const cleaned = 清洗小说模式包累积草稿(dataset, '武侠', {
            economy: { primaryCurrency: '奖励点' },
            map: { locationTypes: ['感染区', '客栈'] },
            image: { visualStyle: '写实末日风' },
            time: { calendarName: '大梁历' }
        });
        expect(JSON.stringify(cleaned)).not.toMatch(/奖励点|感染区|写实末日风/u);
        expect(cleaned.time?.calendarName).toBe('大梁历');
    });

    it('手动选择题材时覆盖自动识别结果', () => {
        const dataset = 聚合小说拆分数据集(创建空小说拆分数据集({
            id: 'dataset-manual-wuxia',
            标题: '轮回刀客',
            作品名: '轮回刀客',
            来源类型: 'txt',
            原始文本摘要: '江湖刀客被人称作轮回者，但故事始终发生在武林门派与镖局之间。',
            世界观规则: ['传闻中有人把秘境称为任务世界。']
        }));

        expect(解析小说模式包题材(dataset)).toBe('无限流');
        expect(解析小说模式包题材(dataset, '武侠')).toBe('武侠');

        const module = 构建小说拆分模式包创意工坊模块({
            dataset,
            baseMode: '武侠',
            now: 1
        });
        expect(module.modeRuntimeProfile?.identity.baseMode).toBe('武侠');
    });

    it('非主神异世界小说不会被误判成无限流模式包', () => {
        const dataset = 聚合小说拆分数据集(创建空小说拆分数据集({
            id: 'dataset-yaotian',
            标题: '遥天',
            作品名: '遥天',
            来源类型: 'txt',
            原始文本摘要: '少年在遥天大陆醒来，卷入王朝、学院与古老遗迹的纷争。',
            世界观规则: ['遥天大陆存在多国、学院、古老遗迹和异世界来客传说。'],
            世界边界规则: ['没有主神、轮回小队、任务世界或奖励点体系。'],
            地图地点档案: [
                { 名称: '遥天大陆', 层级: '寰宇', 地貌功能: '主舞台' } as any,
                { 名称: '星桥学院', 层级: '大地点', 地貌功能: '修行与求学场所' } as any
            ],
            分段列表: [
                创建分段({
                    标题: '遥天初醒',
                    本组概括: '主角在遥天大陆醒来，遇见学院巡查队。',
                    世界观规则: ['遥天大陆有学院、王朝和古代遗迹。'],
                    世界边界规则: ['不存在主神空间。'],
                    地图地点档案: [
                        { 名称: '遥天大陆', 层级: '寰宇', 地貌功能: '主舞台' } as any
                    ]
                })
            ]
        }));

        const module = 构建小说拆分模式包创意工坊模块({ dataset, now: 1 });
        const runtimeText = JSON.stringify(module.modeRuntimeProfile);

        expect(module.modeRuntimeProfile?.identity.baseMode).not.toBe('无限流');
        expect(runtimeText).not.toMatch(/主神商城|主神空间|任务世界|奖励点|支线剧情/);
    });

    it('仙侠小说里否定提到末日丧尸时不会被误判成末日模式包', () => {
        const dataset = 聚合小说拆分数据集(创建空小说拆分数据集({
            id: 'dataset-jianlai',
            标题: '剑来',
            作品名: '剑来',
            来源类型: 'txt',
            原始文本摘要: '骊珠洞天、山上宗门、剑修与儒释道共同构成古典仙侠江湖。',
            世界观规则: ['骊珠洞天、剑修、山上宗门和儒释道传承是主要世界观。'],
            世界边界规则: ['不得写成末日丧尸、生化感染、避难所、幸存者营地题材。'],
            地图地点档案: [
                { 名称: '骊珠洞天', 层级: '大地点', 地貌功能: '仙侠开局舞台' } as any,
                { 名称: '落魄山', 层级: '中地点', 地貌功能: '宗门与山水道场' } as any
            ],
            分段列表: [
                创建分段({
                    标题: '骊珠洞天',
                    本组概括: '少年在骊珠洞天牵涉剑修、山水气运和宗门因果。',
                    世界观规则: ['山上修士、剑修、洞天福地和宗门因果是核心设定。'],
                    世界边界规则: ['这不是末日丧尸或感染区生存故事。']
                })
            ]
        }));

        const module = 构建小说拆分模式包创意工坊模块({ dataset, now: 1 });
        const runtimeText = 序列化客户可见运行时配置(module.modeRuntimeProfile);

        expect(module.modeRuntimeProfile?.identity.baseMode).toBe('仙侠');
        expect(runtimeText).not.toMatch(/apocalypse|感染区|避难所|幸存者|丧尸|末日物资券/iu);
    });

    it('非无限流小说模式包会丢弃 AI 补全里照抄的主神模板字段', () => {
        const dataset = 聚合小说拆分数据集(创建空小说拆分数据集({
            id: 'dataset-yaotian-cleanup',
            标题: '遥天',
            作品名: '遥天',
            来源类型: 'txt',
            原始文本摘要: '遥天大陆由王朝、学院和遗迹构成，没有主神规则。',
            世界观规则: ['遥天大陆以学院试炼、王朝边境和遗迹探索推进。'],
            地图地点档案: [
                { 名称: '遥天大陆', 层级: '寰宇', 地貌功能: '主舞台' } as any,
                { 名称: '星桥学院', 层级: '大地点', 地貌功能: '修行与求学场所' } as any
            ]
        }));

        const module = 构建小说拆分模式包创意工坊模块({
            dataset,
            baseMode: '武侠',
            now: 1,
            aiCompletion: {
                economy: {
                    primaryCurrency: '奖励点',
                    accountingUnit: '奖励点',
                    marketName: '主神商城',
                    marketVerb: '进入主神兑换列表',
                    currencyTiers: {
                        upperName: 'C级支线剧情',
                        middleName: 'D级支线剧情',
                        lowerName: '奖励点'
                    }
                },
                map: {
                    locationTypes: ['主神空间', '队伍房间', '训练场', '任务世界'],
                    poiTypes: ['主神光球', '补给点', '隐藏支线地点', '回归通道'],
                    mapPrompt: '世界版图应按主神空间、队伍房间、训练场、主神广场、任务世界、剧情地点、安全屋、补给点、隐藏支线地点和回归通道组织。'
                },
                time: {
                    calendarName: 'infinite',
                    narrativeStyle: '正文使用无限流/任务世界时间表达：数字钟点、任务倒计时、回归倒计时、电影世界时间线。'
                }
            } as any
        });

        const runtimeText = JSON.stringify(module.modeRuntimeProfile);

        expect(module.modeRuntimeProfile?.identity.baseMode).toBe('武侠');
        expect(runtimeText).not.toMatch(/主神商城|主神空间|任务世界|奖励点|支线剧情|回归倒计时|infinite/);
        expect(module.modeRuntimeProfile?.economy.marketName).not.toBe('主神商城');
    });

    it('非末日小说模式包会丢弃 AI 补全里照抄的末日丧尸模板字段', () => {
        const dataset = 聚合小说拆分数据集(创建空小说拆分数据集({
            id: 'dataset-jianlai-cleanup',
            标题: '剑来',
            作品名: '剑来',
            来源类型: 'txt',
            原始文本摘要: '骊珠洞天、剑修、山水气运和宗门因果构成仙侠世界。',
            世界观规则: ['剑修、宗门、洞天福地和儒释道传承是核心设定。'],
            地图地点档案: [
                { 名称: '骊珠洞天', 层级: '大地点', 地貌功能: '仙侠开局舞台' } as any
            ]
        }));

        const module = 构建小说拆分模式包创意工坊模块({
            dataset,
            baseMode: '仙侠',
            now: 1,
            aiCompletion: {
                economy: {
                    primaryCurrency: '末日物资券',
                    accountingUnit: '瓶盖',
                    marketName: '避难所市场',
                    marketVerb: '流入市场',
                    currencyTiers: ['高级物资券', '瓶盖', '罐头']
                },
                map: {
                    locationTypes: ['感染区', '医院', '商超', '避难所'],
                    poiTypes: ['封锁线', '营地', '临时市场', '资源点'],
                    mapPrompt: '世界版图应按感染区、医院、商超、仓库、避难所、封锁线、营地、临时市场和资源点组织。'
                },
                image: {
                    visualStyle: '写实末日风',
                    sceneMaterials: '废墟、血污、防护服、封锁线'
                }
            } as any
        });

        const runtimeText = 序列化客户可见运行时配置(module.modeRuntimeProfile);

        expect(module.modeRuntimeProfile?.identity.baseMode).toBe('仙侠');
        expect(runtimeText).not.toMatch(/apocalypse|感染区|避难所|幸存者|丧尸|末日物资券|瓶盖|封锁线|防护服/iu);
        expect(module.modeRuntimeProfile?.economy.marketName).not.toBe('避难所市场');
    });

    it('把无限流跨世界时间流速写入标准创意工坊模式包', () => {
        const dataset = 聚合小说拆分数据集(创建空小说拆分数据集({
            id: 'dataset-opm',
            标题: '无限同人测试',
            作品名: '无限同人测试',
            来源类型: 'txt',
            原始文本摘要: '原文明说两次进入一拳世界相隔200年，不同世界时间流速不同。',
            分段列表: [
                创建分段({
                    id: 'segment-1',
                    组号: 1,
                    标题: '第一次进入一拳世界',
                    本组概括: '轮回者第一次进入一拳世界，此时当地仍有江户时代遗留势力。',
                    世界观规则: ['无限流任务世界和主神空间时间流速不同，不能按章节距离换算。'],
                    世界边界规则: ['一拳世界本地时代标签必须按进入时点判断。'],
                    原著硬约束: [{
                        内容: '第一次进入一拳世界与第二次进入一拳世界在任务世界本地相隔200年。',
                        信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: true }
                    }],
                    关键事件: [{
                        事件名: '第一次进入一拳世界',
                        事件说明: '主角进入江户残影仍存在的一拳世界。',
                        开始时间: '0001:01:01:00:00',
                        最早开始时间: '0001:01:01:00:00',
                        最迟开始时间: '0001:01:01:00:00',
                        结束时间: '0001:01:02:00:00',
                        前置条件: ['主神任务开启'],
                        触发条件: ['进入一拳世界'],
                        阻断条件: [],
                        事件结果: ['离开任务世界'],
                        对下一组影响: ['下一次进入同一世界时本地已过去200年'],
                        信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: false }
                    }],
                    时间线起点: '0001:01:01:00:00',
                    时间线终点: '0001:01:02:00:00'
                }),
                创建分段({
                    id: 'segment-2',
                    组号: 2,
                    标题: '第二次进入一拳世界',
                    本组概括: '章节只隔很短，但原文明说一拳世界本地已相隔200年，现代Z市已成立。',
                    前组延续事实: ['不能把两次进入的任务世界本地间隔压缩成一个月。'],
                    世界观规则: ['第二次进入一拳世界时本地进入现代Z市时代。'],
                    世界边界规则: ['江户时代势力和现代Z市不能无依据叠加为同一时期。'],
                    原著硬约束: [{
                        内容: '江户时代势力不得与现代Z市社会结构同时活跃，除非原文明确写融合或时间异常。',
                        信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: true }
                    }],
                    时间线起点: '0001:01:02:00:00',
                    时间线终点: '0001:01:03:00:00'
                })
            ]
        }));

        const module = 构建小说拆分模式包创意工坊模块({ dataset, now: 1 });
        const worldbookText = JSON.stringify(module.modeWorldbooks, null, 2);

        expect(module.payload.schema).toBe('moranjianghu-creative-workshop-mode-package');
        expect(module.payload.version).toBe(3);
        expect(module.payload.packagePart).toBe('mode_package');
        expect(module.modeRuntimeProfile?.identity.baseMode).toBe('无限流');
        expect(module.modeWorldbooks?.[0]?.条目.some((entry) => entry.标题 === '跨世界时间线硬约束')).toBe(true);
        expect(worldbookText).toContain('200年');
        expect(worldbookText).toContain('章节距离不等于世界内时间距离');
        expect(worldbookText).toContain('时间流速');
        expect(worldbookText).toContain('江户');
        expect(worldbookText).toContain('现代Z市');
        expect(worldbookText).toContain('不得无依据叠加');
    });

    it('注入树会同步携带跨世界时间线硬约束节点', () => {
        const dataset = 创建空小说拆分数据集({
            id: 'dataset-opm',
            标题: '无限同人测试',
            作品名: '无限同人测试',
            分段列表: [
                创建分段({
                    世界观规则: ['任务世界时间流速不同；两次进入一拳世界相隔200年。'],
                    时间线起点: '0001:01:01:00:00',
                    时间线终点: '0001:01:02:00:00'
                })
            ]
        });

        const tree = 基于分段构建注入树(聚合小说拆分数据集(dataset));
        const node = tree.find((item) => item.标题 === '跨世界时间线硬约束');

        expect(node?.内容).toContain('200年');
        expect(node?.内容).toContain('章节距离不等于世界内时间距离');
        expect(node?.目标链路).toContain('planning');
        expect(node?.目标链路).toContain('world_evolution');
    });
});
