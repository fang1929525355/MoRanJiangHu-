import { describe, expect, it } from 'vitest';
import {
    构建官方模板草稿,
    构建模式包模块,
    构建贡献模块,
    空贡献草稿,
    模块转贡献草稿,
    从模式包Payload构建模块
} from '../components/features/Workshop/CreativeWorkshopModal';
import { 规范化模式运行时配置 } from '../utils/modeRuntimeProfile';
import { 创意工坊模块列表, 整合创意工坊模式包, type 创意工坊模块条目 } from '../data/creativeWorkshopModules';
import { 规范能力类别键列表 } from '../utils/abilityCategoryLabels';
import { 功法类型列表 } from '../models/kungfu';
import { 构建世界书注入文本 } from '../utils/worldbook';

const 构建红楼式草稿 = () => {
    const draft = 空贡献草稿();
    draft.title = '红楼梦同人模式包';
    draft.subtitle = '大观园人情长卷';
    draft.description = '以贾府为轴的世情模拟。';
    draft.type = 'topic';
    draft.mode = '武侠';
    draft.tags = '红楼、世情';
    draft.auctionName = '当铺牙行';
    draft.marketVerb = '典当或转卖';
    draft.mapPrompt = '地图按天下—省府—州县—府邸—院落—房舍六层组织。';
    draft.skillNames = '才情、应酬、观人、手腕';
    draft.presetItemKeywords = '月钱袋、名帖、钥匙串';
    draft.backgroundSuggestions = '公府嫡系、旁支子弟';
    draft.talentSuggestions = '过目成诵、精于算学';
    draft.topicBody = '题材口径：清代世家生活。';
    draft.worldRulesBody = '世界规则：礼法与人情双轨。';
    draft.abilityBody = '能力体系：声望与手腕。';
    draft.usagePrompt = '注入新建存档使用。';
    draft.safetyNotes = '不含现实人物\n不含真实地址';
    draft.versionNote = '首发版本';
    draft.aiGenerateWorldDetails = false;
    draft.importantPeople = '贾母、王熙凤';
    draft.importantFactions = '荣国府、宁国府';
    draft.mapDesign = '以荣国府为中心。';
    draft.modeRuntimeProfile = 规范化模式运行时配置({
        identity: { modeId: 'suite-honglou', displayName: '红楼梦同人模式包', baseMode: '武侠' },
        economy: {
            marketName: '当铺牙行',
            marketVerb: '典当或转卖',
            marketEventTemplates: [
                { 标题: '节礼采买', 描述: '年节将近，绸缎首饰走俏。', 影响类型: '全部', 价格倍率: 1.2 }
            ]
        },
        organization: { organizationName: '门第', memberName: '府中人', contributionName: '体面' },
        uiLabels: {
            向导: { worldSizeLabel: '红楼版图' },
            菜单: { inventory: '随身箱笼' }
        }
    }, '武侠');
    return draft;
};

describe('模式包模块 round-trip', () => {
    it('表单草稿 → 模式包模块 → 草稿：关键字段无损还原', () => {
        const draft = 构建红楼式草稿();
        draft.mainStoryDirection = '主线围绕家族日常、人情往来与个人成长展开。';
        draft.hiddenPlotPolicy = '暗线只做轻量伏笔，不升级为灭门阴谋。';
        draft.worldEvolutionPolicy = '后台世界以节庆、婚丧嫁娶和产业变化平缓推进。';
        const entry = 构建模式包模块(draft, '测试贡献者');
        const restored = 模块转贡献草稿(entry);
        expect(restored).not.toBeNull();
        const r = restored!;
        expect(r.title).toBe(draft.title);
        expect(r.subtitle).toBe(draft.subtitle);
        expect(r.description).toBe(draft.description);
        expect(r.type).toBe('topic');
        expect(r.mode).toBe('武侠');
        expect(r.auctionName).toBe('当铺牙行');
        expect(r.marketVerb).toBe('典当或转卖');
        expect(r.mapPrompt).toBe(draft.mapPrompt);
        expect(r.topicBody).toBe(draft.topicBody);
        expect(r.worldRulesBody).toBe(draft.worldRulesBody);
        expect(r.abilityBody).toBe(draft.abilityBody);
        expect(r.mainStoryDirection).toBe(draft.mainStoryDirection);
        expect(r.hiddenPlotPolicy).toBe(draft.hiddenPlotPolicy);
        expect(r.worldEvolutionPolicy).toBe(draft.worldEvolutionPolicy);
        expect(r.usagePrompt).toBe(draft.usagePrompt);
        expect(r.versionNote).toBe(draft.versionNote);
        expect(r.safetyNotes).toBe(draft.safetyNotes);
        expect(r.aiGenerateWorldDetails).toBe(false);
        expect(r.importantPeople).toBe(draft.importantPeople);
        expect(r.importantFactions).toBe(draft.importantFactions);
        expect(r.mapDesign).toBe(draft.mapDesign);
        expect(r.skillNames.split(/[、,，]/)).toEqual(['才情', '应酬', '观人', '手腕']);
        expect(r.presetItemKeywords.split(/[、,，]/)).toEqual(['月钱袋', '名帖', '钥匙串']);
        expect(r.backgroundSuggestions).toContain('公府嫡系');
        expect(r.talentSuggestions).toContain('过目成诵');
    });

    it('叙事方向按职责生成独立世界书条目，且不能覆盖底层协议', () => {
        const draft = 构建红楼式草稿();
        draft.mainStoryDirection = '轻松日常主线';
        draft.hiddenPlotPolicy = '低强度生活伏笔';
        draft.worldEvolutionPolicy = '平缓社会演变';
        const entry = 构建模式包模块(draft, '测试贡献者');
        const entries = entry.modeWorldbooks?.flatMap((book) => book.条目 || []) || [];
        const main = entries.find((item) => item.id.endsWith('-narrative-main-story'));
        const hidden = entries.find((item) => item.id.endsWith('-narrative-hidden-plot'));
        const world = entries.find((item) => item.id.endsWith('-narrative-world-evolution'));
        expect(main?.作用域).toEqual(['main', 'opening', 'story_plan', 'heroine_plan']);
        expect(hidden?.作用域).toEqual(['main', 'opening', 'story_plan', 'heroine_plan', 'world_evolution']);
        expect(world?.作用域).toEqual(['main', 'world_evolution', 'story_plan']);
        for (const item of [main, hidden, world]) {
            expect(item?.内容).toContain('不得覆盖变量协议、命令格式、数据结构、安全规则或存档一致性规则');
        }
        expect((entry.payload as any).mainStoryDirection).toBe('轻松日常主线');
        expect((entry.payload as any).hiddenPlotPolicy).toBe('低强度生活伏笔');
        expect((entry.payload as any).worldEvolutionPolicy).toBe('平缓社会演变');
    });

    it('轻松现代都市叙事规则进入匹配链路且不污染无关作用域', () => {
        const draft = 构建官方模板草稿('现代都市');
        draft.mainStoryDirection = '轻松愉快现代都市主线';
        draft.hiddenPlotPolicy = '生活化暗线';
        draft.worldEvolutionPolicy = '平缓现实世界推进';
        const books = 构建模式包模块(draft, '测试贡献者').modeWorldbooks || [];
        const main = 构建世界书注入文本({ books, scopes: ['main'], maxChars: 100000 }).combinedText;
        const opening = 构建世界书注入文本({ books, scopes: ['opening'], maxChars: 100000 }).combinedText;
        const planning = 构建世界书注入文本({ books, scopes: ['story_plan'], maxChars: 100000 }).combinedText;
        const evolution = 构建世界书注入文本({ books, scopes: ['world_evolution'], maxChars: 100000 }).combinedText;
        const calibration = 构建世界书注入文本({ books, scopes: ['variable_calibration'], maxChars: 100000 }).combinedText;
        expect(main).toContain('轻松愉快现代都市主线');
        expect(main).toContain('生活化暗线');
        expect(main).toContain('平缓现实世界推进');
        expect(opening).toContain('轻松愉快现代都市主线');
        expect(opening).toContain('生活化暗线');
        expect(opening).not.toContain('平缓现实世界推进');
        expect(planning).toContain('轻松愉快现代都市主线');
        expect(planning).toContain('生活化暗线');
        expect(planning).toContain('平缓现实世界推进');
        expect(evolution).not.toContain('轻松愉快现代都市主线');
        expect(evolution).toContain('生活化暗线');
        expect(evolution).toContain('平缓现实世界推进');
        expect(calibration).not.toContain('轻松愉快现代都市主线');
        expect(calibration).not.toContain('生活化暗线');
        expect(calibration).not.toContain('平缓现实世界推进');
    });

    it('旧模式包没有叙事方向字段时不生成空覆盖条目', () => {
        const entry = 构建模式包模块(构建红楼式草稿(), '测试贡献者');
        const entries = entry.modeWorldbooks?.flatMap((book) => book.条目 || []) || [];
        expect(entries.some((item) => item.id.includes('-narrative-'))).toBe(false);
        expect((entry.payload as any).mainStoryDirection).toBeUndefined();
        expect((entry.payload as any).hiddenPlotPolicy).toBeUndefined();
        expect((entry.payload as any).worldEvolutionPolicy).toBeUndefined();
    });

    it('清空已有叙事方向后会删除受管世界书条目', () => {
        const draft = 构建红楼式草稿();
        draft.mainStoryDirection = '旧主线方向';
        draft.hiddenPlotPolicy = '旧暗线策略';
        draft.worldEvolutionPolicy = '旧世界推进';
        const first = 构建模式包模块(draft, '测试贡献者');
        const restored = 模块转贡献草稿(first)!;
        restored.mainStoryDirection = '';
        restored.hiddenPlotPolicy = '';
        restored.worldEvolutionPolicy = '';
        const rebuilt = 构建模式包模块(restored, '测试贡献者', [first]);
        const entries = rebuilt.modeWorldbooks?.flatMap((book) => book.条目 || []) || [];
        expect(entries.some((item) => item.id.includes('-narrative-'))).toBe(false);
        expect((rebuilt.payload as any).mainStoryDirection).toBeUndefined();
        expect((rebuilt.payload as any).hiddenPlotPolicy).toBeUndefined();
        expect((rebuilt.payload as any).worldEvolutionPolicy).toBeUndefined();
    });

    it('现代都市官方模板携带真实官方内容和可编辑叙事方向', () => {
        const draft = 构建官方模板草稿('现代都市');
        expect(draft.topicBody).toContain('本存档以现代都市为核心题材');
        expect(draft.worldRulesBody).toContain('人民币');
        expect(draft.abilityBody).toContain('成长体系');
        expect([draft.topicBody, draft.worldRulesBody, draft.abilityBody].join('\n')).not.toContain('模板：在此填写');
        expect(draft.mainStoryDirection).toContain('现实日常');
        expect(draft.hiddenPlotPolicy).toContain('不过度阴谋化');
        expect(draft.worldEvolutionPolicy).toContain('现实社会');
    });

    it('round-trip 保留 uiLabels 与行情模板', () => {
        const draft = 构建红楼式草稿();
        const entry = 构建模式包模块(draft, '测试贡献者');
        const restored = 模块转贡献草稿(entry)!;
        expect(restored.modeRuntimeProfile.uiLabels?.向导?.worldSizeLabel).toBe('红楼版图');
        expect(restored.modeRuntimeProfile.uiLabels?.菜单?.inventory).toBe('随身箱笼');
        expect(restored.modeRuntimeProfile.economy.marketEventTemplates?.[0]?.标题).toBe('节礼采买');
        expect(restored.modeRuntimeProfile.organization.organizationName).toBe('门第');
    });

    it('行情影响类型协议保留「装备/任务道具/杂项」', () => {
        const runtime = 规范化模式运行时配置({
            identity: { modeId: 'custom-market-types', displayName: '行情类型测试', baseMode: '武侠' },
            economy: {
                marketEventTemplates: [
                    { 标题: '军备采买', 描述: '装备走俏', 影响类型: '装备', 价格倍率: 1.2 },
                    { 标题: '凭证走俏', 描述: '任务凭证走俏', 影响类型: '任务道具', 价格倍率: 1.1 },
                    { 标题: '杂项清仓', 描述: '杂项回落', 影响类型: '杂项', 价格倍率: 0.9 }
                ]
            }
        }, '武侠');
        expect(runtime.economy.marketEventTemplates?.map((item) => item.影响类型)).toEqual(['装备', '任务道具', '杂项']);
    });

    it('运行时可视字段 kungfuTypes/realmConfig/resourceTypes/性别比例演变预设完整 round-trip', () => {
        const draft = 构建红楼式草稿();
        draft.modeRuntimeProfile = 规范化模式运行时配置({
            ...draft.modeRuntimeProfile,
            ability: {
                ...draft.modeRuntimeProfile.ability,
                kungfuTypes: ['才艺', '理家'],
                realmConfig: {
                    levelNames: ['籍籍无名', '初得脸面'],
                    parseRules: [{ pattern: '初得脸面', level: 1 }]
                }
            },
            items: { ...draft.modeRuntimeProfile.items, resourceTypes: ['体面', '心气'] },
            性别比例演变预设: true
        }, '武侠');
        const restored = 模块转贡献草稿(构建模式包模块(draft, '测试贡献者'))!;
        expect(restored.modeRuntimeProfile.ability.kungfuTypes).toEqual(['才艺', '理家']);
        expect(restored.modeRuntimeProfile.ability.realmConfig).toEqual({ levelNames: ['籍籍无名', '初得脸面'], parseRules: [{ pattern: '初得脸面', level: 1 }] });
        expect(restored.modeRuntimeProfile.items.resourceTypes).toEqual(['体面', '心气']);
        expect(restored.modeRuntimeProfile.性别比例演变预设).toBe(true);
    });

    it('能力类别编辑键覆盖全部真实功法类型', () => {
        expect(规范能力类别键列表).toEqual(expect.arrayContaining([...功法类型列表]));
    });

    it('tags 反向去掉自动附加的基底/模式包标签，只留用户标签', () => {
        const draft = 构建红楼式草稿();
        const entry = 构建模式包模块(draft, '测试贡献者');
        const restored = 模块转贡献草稿(entry)!;
        const tags = restored.tags.split(/[、,，\s]+/).filter(Boolean);
        expect(tags).toContain('红楼');
        expect(tags).toContain('世情');
        expect(tags).not.toContain('武侠');
        expect(tags).not.toContain('模式包');
    });

    it('二次构建（草稿→模块→草稿→模块）产出等效 payload 口径', () => {
        const draft = 构建红楼式草稿();
        const entry1 = 构建模式包模块(draft, '测试贡献者');
        const restored = 模块转贡献草稿(entry1)!;
        const entry2 = 构建模式包模块(restored, '测试贡献者');
        const p1 = entry1.payload as any;
        const p2 = entry2.payload as any;
        expect(p2.modeMetadata).toEqual(p1.modeMetadata);
        expect(p2.modeRuntimeProfile.uiLabels).toEqual(p1.modeRuntimeProfile.uiLabels);
        expect(p2.modeRuntimeProfile.economy.marketEventTemplates).toEqual(p1.modeRuntimeProfile.economy.marketEventTemplates);
        expect(p2.manualWorldPrompt).toBe(p1.manualWorldPrompt);
        expect(p2.manualRealmPrompt).toBe(p1.manualRealmPrompt);
        expect((entry2.modeWorldbooks || []).length).toBe((entry1.modeWorldbooks || []).length);
    });

    it('保留额外世界书、条目元数据、扩展 payload、preset 与地图 DIY，仅更新标准条目正文', () => {
        const draft = 构建红楼式草稿();
        const entry = 构建模式包模块(draft, '测试贡献者');
        const books = JSON.parse(JSON.stringify(entry.modeWorldbooks)) as any[];
        const customEntry = {
            ...books[0].条目[0],
            id: 'custom-secret-entry',
            标题: '私有判词库',
            内容: '不得丢失的额外内容',
            关键词: ['判词'],
            作用域: ['main'],
            注入模式: 'keyword',
            优先级: 777,
            启用: false
        };
        books[0].条目.push(customEntry);
        books.push({ ...books[0], id: 'second-worldbook', 标题: '第二本世界书', 条目: [{ ...customEntry, id: 'second-entry', 标题: '世界规则', 内容: '第二本私有同名规则' }] });
        const source = {
            ...entry,
            preset: { id: 'preset-keep', name: '保留预设' } as any,
            worldDetailGeneration: { ...(entry.worldDetailGeneration || {}), mapDiyDraft: { enabled: true, prompt: '保留地图草稿' } as any },
            modeWorldbooks: books,
            contentBlocks: [...(entry.contentBlocks || []), { id: 'custom-block', title: '世界规则', purpose: '保留', content: '额外同名块正文', injectionTarget: 'manualWorldPrompt' as const }],
            payload: {
                ...(entry.payload as any),
                customExtension: { keep: true },
                modeWorldbooks: books,
                worldDetailGeneration: { ...(entry.worldDetailGeneration || {}), mapDiyDraft: { enabled: true, prompt: '保留地图草稿' } },
                preset: { id: 'payload-preset-keep' }
            }
        } as 创意工坊模块条目;
        const restored = 模块转贡献草稿(source)!;
        restored.topicBody = '修改后的题材口径';
        const rebuilt = 构建模式包模块(restored, '测试贡献者');
        const rebuiltBooks = rebuilt.modeWorldbooks || [];
        expect(rebuiltBooks.find((book) => book.id === 'second-worldbook')).toBeTruthy();
        const custom = rebuiltBooks.flatMap((book) => book.条目 || []).find((item) => item.id === 'custom-secret-entry') as any;
        expect(custom).toMatchObject({ 内容: '不得丢失的额外内容', 关键词: ['判词'], 作用域: ['main'], 注入模式: 'keyword', 优先级: 777, 启用: false });
        expect(rebuiltBooks.flatMap((book) => book.条目 || []).find((item) => item.标题 === '题材口径')?.内容).toBe('修改后的题材口径');
        expect((rebuilt.payload as any).customExtension).toEqual({ keep: true });
        expect(rebuilt.preset).toEqual(source.preset);
        expect(rebuilt.worldDetailGeneration?.mapDiyDraft).toEqual(source.worldDetailGeneration?.mapDiyDraft);
        expect(rebuiltBooks.flatMap((book) => book.条目 || []).find((item) => item.id === 'second-entry')?.内容).toBe('第二本私有同名规则');
        expect(rebuilt.contentBlocks?.find((block) => block.id === 'custom-block')?.content).toBe('额外同名块正文');
    });

    it('只有同名自定义内容、没有标准 ID 时不覆写自定义正文', () => {
        const draft = 构建红楼式草稿();
        const entry = 构建模式包模块(draft, '测试贡献者');
        const customBook = {
            ...(entry.modeWorldbooks?.[0] as any),
            id: 'private-book',
            条目: [{ ...(entry.modeWorldbooks?.[0]?.条目?.[0] as any), id: 'private-world-rules', 标题: '世界规则', 内容: '私有同名世界规则' }]
        };
        const customBlock = { id: 'private-rule', title: '世界规则', purpose: '私有', content: '私有同名内容块', injectionTarget: 'worldExtraRequirement' as const };
        const source = {
            ...entry,
            modeWorldbooks: [customBook],
            contentBlocks: [customBlock],
            payload: { ...(entry.payload as any), modeWorldbooks: [customBook], contentBlocks: [customBlock] }
        } as 创意工坊模块条目;
        const restored = 模块转贡献草稿(source)!;
        restored.worldRulesBody = '表单新版世界规则';
        const rebuilt = 构建模式包模块(restored, '测试贡献者');
        expect(rebuilt.modeWorldbooks?.flatMap((book) => book.条目 || []).find((item) => item.id === 'private-world-rules')?.内容).toBe('私有同名世界规则');
        expect(rebuilt.contentBlocks?.find((block) => block.id === 'private-rule')?.content).toBe('私有同名内容块');
    });

    it('canonical payload 与同名私有块并存时，私有块不能污染标准正文', () => {
        const entry = 构建模式包模块(构建红楼式草稿(), '测试贡献者');
        const canonicalWorldRules = entry.modeWorldbooks?.flatMap((book) => book.条目 || []).find((item) => item.id.endsWith('-world-rules'))?.内容;
        const customBlocks = [
            ...(entry.contentBlocks || []).filter((block) => block.id !== 'world-rules-main'),
            { id: 'private-rule', title: '世界规则', purpose: '私有', content: '私有同名正文', injectionTarget: 'worldExtraRequirement' as const }
        ];
        const source = {
            ...entry,
            contentBlocks: customBlocks,
            payload: { ...(entry.payload as any), contentBlocks: customBlocks }
        };
        const restored = 模块转贡献草稿(source)!;
        expect(restored.worldRulesBody).toBe(canonicalWorldRules);
        const rebuilt = 构建模式包模块(restored, '测试贡献者');
        expect(rebuilt.modeWorldbooks?.flatMap((book) => book.条目 || []).find((item) => item.id.endsWith('-world-rules'))?.内容).toBe(canonicalWorldRules);
        expect(rebuilt.contentBlocks?.find((block) => block.id === 'private-rule')?.content).toBe('私有同名正文');
    });

    it('顶层与 payload 漂移时合并两侧资产，不让空顶层遮蔽 payload', () => {
        const draft = 构建红楼式草稿();
        const entry = 构建模式包模块(draft, '测试贡献者');
        const payloadBooks = JSON.parse(JSON.stringify(entry.modeWorldbooks)) as any[];
        payloadBooks.push({ ...payloadBooks[0], id: 'payload-only-book', 标题: '仅 payload 世界书', 条目: [] });
        const payloadBlocks = [...(entry.contentBlocks || []), { id: 'payload-only-block', title: '仅 payload 块', purpose: '保留', content: 'payload 块正文', injectionTarget: 'manualWorldPrompt' as const }];
        const drifted = {
            ...entry,
            modeWorldbooks: [],
            contentBlocks: [],
            modeRuntimeProfile: { identity: entry.modeRuntimeProfile?.identity } as any,
            worldDetailGeneration: { aiGenerate: false, importantPeople: '顶层人物', mapDiyDraft: { enabled: false } as any },
            payload: {
                ...(entry.payload as any),
                modeWorldbooks: payloadBooks,
                contentBlocks: payloadBlocks,
                modeRuntimeProfile: {
                    ...(entry.payload as any).modeRuntimeProfile,
                    uiLabels: { 向导: { worldSizeLabel: 'payload 红楼版图' } },
                    economy: { ...(entry.payload as any).modeRuntimeProfile.economy, marketEventTemplates: [{ 标题: 'payload 行情', 描述: '保留', 影响类型: '全部', 价格倍率: 1.1 }] }
                },
                worldDetailGeneration: { ...(entry.worldDetailGeneration || {}), mapDiyDraft: { enabled: true, prompt: 'payload 地图草稿', nodes: [{ id: 'node-1' }] } }
            }
        } as 创意工坊模块条目;
        const rebuilt = 构建模式包模块(模块转贡献草稿(drifted)!, '测试贡献者');
        expect(rebuilt.modeWorldbooks?.some((book) => book.id === 'payload-only-book')).toBe(true);
        expect(rebuilt.contentBlocks?.find((block) => block.id === 'payload-only-block')?.content).toBe('payload 块正文');
        expect(rebuilt.worldDetailGeneration?.mapDiyDraft).toMatchObject({ enabled: false, prompt: 'payload 地图草稿', nodes: [{ id: 'node-1' }] });
        expect(rebuilt.worldDetailGeneration?.importantPeople).toBe('顶层人物');
        expect(rebuilt.modeRuntimeProfile.uiLabels?.向导?.worldSizeLabel).toBe('payload 红楼版图');
        expect(rebuilt.modeRuntimeProfile.economy.marketEventTemplates?.[0]?.标题).toBe('payload 行情');
    });

    it('重建保留 runtime/worldDetailGeneration 的未知嵌套扩展字段', () => {
        const entry = 构建模式包模块(构建红楼式草稿(), '测试贡献者');
        const source = {
            ...entry,
            modeRuntimeProfile: { ...(entry.modeRuntimeProfile as any), futureRuntime: { nested: { keep: 1 } } },
            worldDetailGeneration: { ...(entry.worldDetailGeneration as any), futureWorldDetail: { keep: true } },
            payload: {
                ...(entry.payload as any),
                modeRuntimeProfile: { ...(entry.payload as any).modeRuntimeProfile, futureRuntime: { nested: { payloadKeep: 2 } } },
                worldDetailGeneration: { ...(entry.payload as any).worldDetailGeneration, futureWorldDetail: { payloadKeep: true } }
            }
        } as 创意工坊模块条目;
        const rebuilt = 构建模式包模块(模块转贡献草稿(source)!, '测试贡献者');
        expect((rebuilt.modeRuntimeProfile as any).futureRuntime.nested).toEqual({ payloadKeep: 2, keep: 1 });
        expect((rebuilt.worldDetailGeneration as any).futureWorldDetail).toEqual({ payloadKeep: true, keep: true });
    });

    it('真实官方模式包可还原三段核心正文', () => {
        const official = 创意工坊模块列表.find((entry) => (entry.payload as any)?.schema === 'moranjianghu-creative-workshop-mode-package');
        expect(official).toBeTruthy();
        const restored = 模块转贡献草稿(official!);
        expect(restored?.topicBody.trim()).toBeTruthy();
        expect(restored?.worldRulesBody.trim()).toBeTruthy();
        expect(restored?.abilityBody.trim()).toBeTruthy();
    });
});

describe('普通模块与仅 payload 模块反向', () => {
    it('普通 topic 模块 body 反向还原', () => {
        const draft = 空贡献草稿();
        draft.title = '江湖轶闻集';
        draft.type = 'topic';
        draft.body = '一段世界观补充规则。';
        draft.tags = '轶闻';
        const entry = 构建贡献模块(draft, '测试贡献者');
        const restored = 模块转贡献草稿(entry)!;
        expect(restored.title).toBe('江湖轶闻集');
        expect(restored.type).toBe('topic');
        expect(restored.moduleKind).toBe('standard');
        expect(restored.body).toBe('一段世界观补充规则。');
        const rebuilt = 构建贡献模块(restored, '测试贡献者');
        expect((rebuilt.payload as any).content).toBe('一段世界观补充规则。');
        expect(restored.tags).toContain('轶闻');
    });

    it('单块 world_rules 模块编辑后不会累积成多段（复用原始块 id）', () => {
        const source: 创意工坊模块条目 = {
            id: 'community-trails-world-rules',
            type: 'world_rules',
            formatVersion: 2,
            workshopKind: 'standard_module',
            title: '轨迹世界规则',
            subtitle: '',
            description: '',
            tags: ['武侠'],
            payload: { schema: 'moranjianghu-creative-workshop-standard-module', version: 2, mode: '武侠', content: 'A 不属于 B' },
            contentBlocks: [{ id: 'world-core', title: '世界核心', purpose: '规则', content: 'A 不属于 B', injectionTarget: 'manualWorldPrompt' }],
            usagePrompt: '',
            safetyNotes: [],
            injectionPreview: ['A 不属于 B'],
            source: 'local',
            contributor: '测试'
        };
        const draft = 模块转贡献草稿(source)!;
        draft.body = 'A 属于 B';
        const rebuilt = 构建贡献模块(draft, '测试');
        expect(rebuilt.contentBlocks).toHaveLength(1);
        expect(rebuilt.contentBlocks?.[0].id).toBe('world-core');
        expect(rebuilt.contentBlocks?.[0].content).toBe('A 属于 B');
        expect((rebuilt.payload as any).content).toBe('A 属于 B');
    });

    it('列表整合不把孤立普通 topic 伪装成完整模式包', () => {
        const ordinary: 创意工坊模块条目 = {
            id: 'ordinary-topic',
            type: 'topic',
            formatVersion: 2,
            workshopKind: 'standard_module',
            title: '江湖轶闻集',
            subtitle: '普通题材补充',
            description: '补充一段世界观。',
            tags: ['武侠'],
            payload: { schema: 'moranjianghu-creative-workshop-standard-module', version: 2, mode: '武侠', content: '普通正文' },
            contentBlocks: [{ id: 'ordinary-main', title: '正文', purpose: '补充', content: '普通正文', injectionTarget: 'manualWorldPrompt' }],
            usagePrompt: '普通模块',
            safetyNotes: [],
            injectionPreview: ['普通正文'],
            source: 'local',
            contributor: '测试'
        };
        const [integrated] = 整合创意工坊模式包([ordinary]);
        expect(integrated.id).toBe('ordinary-topic');
        expect(integrated.payload.schema).toBe('moranjianghu-creative-workshop-standard-module');
        expect(integrated.payload.packagePart).toBeUndefined();
    });

    it('分段模式包整合会合并三段 runtime、扩展 payload 与额外世界书', () => {
        const base = {
            formatVersion: 2 as const,
            workshopKind: 'standard_module' as const,
            subtitle: '', description: '', tags: ['武侠'], usagePrompt: '', safetyNotes: [], injectionPreview: [], source: 'local' as const, contributor: '测试'
        };
        const topic = {
            ...base, id: 'part-topic', type: 'topic' as const, title: '分段题材',
            payload: { suiteId: 'split-suite', suiteTitle: '分段完整包', packagePart: 'topic', mode: '武侠', manualWorldPrompt: '题材正文', modeRuntimeProfile: { identity: { modeId: 'split-suite', displayName: '分段完整包', baseMode: '武侠' } } }
        } as 创意工坊模块条目;
        const rules = {
            ...base, id: 'part-rules', type: 'world_rules' as const, title: '分段规则',
            payload: { suiteId: 'split-suite', packagePart: 'world_rules', worldExtraRequirement: '规则正文', extensionFromRules: { keep: true }, modeRuntimeProfile: { economy: { marketName: '分段市场' }, uiLabels: { 菜单: { inventory: '分段行囊' } } } }
        } as 创意工坊模块条目;
        const ability = {
            ...base, id: 'part-ability', type: 'ability' as const, title: '分段能力',
            payload: { suiteId: 'split-suite', packagePart: 'ability', manualRealmPrompt: '能力正文' },
            modeWorldbooks: [{ id: 'ability-extra-book', 标题: '额外能力书', 描述: '', 常驻大纲: '', 启用: true, 内置: false, 条目: [], 创建时间: 0, 更新时间: 0 }]
        } as 创意工坊模块条目;
        const [integrated] = 整合创意工坊模式包([topic, rules, ability]);
        expect((integrated.payload as any).extensionFromRules).toEqual({ keep: true });
        expect((integrated.modeRuntimeProfile as any).economy.marketName).toBe('分段市场');
        expect((integrated.modeRuntimeProfile as any).uiLabels.菜单.inventory).toBe('分段行囊');
        expect(integrated.modeWorldbooks?.some((book) => book.id === 'ability-extra-book')).toBe(true);
        expect((integrated.payload as any).sourceModuleParts.world_rules.payload.extensionFromRules).toEqual({ keep: true });
    });

    it('带 suiteId 但没有 packagePart 的普通 topic 仍保持普通模块', () => {
        const ordinary = 构建贡献模块(Object.assign(空贡献草稿(), { title: '普通规则', type: 'topic' as const, moduleKind: 'standard' as const, body: '普通正文' }), '测试');
        (ordinary.payload as any).suiteId = 'not-a-mode-suite';
        const [integrated] = 整合创意工坊模式包([ordinary]);
        expect(integrated.id).toBe(ordinary.id);
        expect(integrated.payload.schema).toBe('moranjianghu-creative-workshop-standard-module');
    });

    it('完整模式包切换为普通 topic 后清除模式包协议字段', () => {
        const modeEntry = 构建模式包模块(构建红楼式草稿(), '测试贡献者');
        const restored = 模块转贡献草稿(modeEntry)!;
        restored.moduleKind = 'standard';
        restored.body = '转换后的普通正文';
        const standard = 构建贡献模块(restored, '测试贡献者', [modeEntry]);
        expect(standard.payload.schema).toBe('moranjianghu-creative-workshop-standard-module');
        expect(standard.payload.packagePart).toBeUndefined();
        expect(standard.payload.suiteId).toBeUndefined();
        expect(standard.modeWorldbooks).toBeUndefined();
        expect(standard.modeRuntimeProfile).toBeUndefined();
        expect(模块转贡献草稿(standard)?.moduleKind).toBe('standard');
    });

    it('本地模式包每次保存使用唯一版本 ID，改名另开版本链', () => {
        const first = 构建模式包模块(构建红楼式草稿(), '测试贡献者');
        const second = 构建模式包模块(模块转贡献草稿(first)!, '测试贡献者', [first]);
        expect(second.id).not.toBe(first.id);
        expect(second.baseModuleId).toBe(first.baseModuleId);
        expect(second.version).toBe((first.version || 1) + 1);
        const renamedDraft = 模块转贡献草稿(second)!;
        renamedDraft.title = '红楼梦另存包';
        const renamed = 构建模式包模块(renamedDraft, '测试贡献者', [first, second]);
        expect(renamed.baseModuleId).not.toBe(first.baseModuleId);
        expect(renamed.version).toBe(1);
    });

    it('只有模块外壳与 payload、没有顶层便捷字段时也能反向', () => {
        const draft = 构建红楼式草稿();
        const full = 构建模式包模块(draft, '测试贡献者');
        const stripped = {
            id: full.id,
            type: full.type,
            title: full.title,
            subtitle: full.subtitle,
            description: full.description,
            tags: full.tags,
            payload: full.payload,
            source: 'local',
            contributor: full.contributor,
            createdAt: full.createdAt,
            updatedAt: full.updatedAt
        } as unknown as 创意工坊模块条目;
        const restored = 模块转贡献草稿(stripped)!;
        expect(restored.topicBody).toBe(draft.topicBody);
        expect(restored.modeRuntimeProfile.uiLabels?.向导?.worldSizeLabel).toBe('红楼版图');
        expect(restored.auctionName).toBe('当铺牙行');
    });

    it('真正裸 payload 文件可识别为模块并还原', () => {
        const draft = 构建红楼式草稿();
        const full = 构建模式包模块(draft, '测试贡献者');
        const barePayload = { ...(full.payload as any) };
        delete barePayload.packagePart;
        const synthesized = 从模式包Payload构建模块(barePayload);
        expect(synthesized).not.toBeNull();
        const [listed] = 整合创意工坊模式包([synthesized!]);
        expect(listed.id).toBe(synthesized!.id);
        const restored = 模块转贡献草稿(synthesized!)!;
        expect(restored.title).toBe(draft.title);
        expect(restored.topicBody).toBe(draft.topicBody);
        expect(restored.worldRulesBody).toBe(draft.worldRulesBody);
        expect(restored.abilityBody).toBe(draft.abilityBody);
    });

    it('旧包只提供三个 prompt 字段时仍可还原正文', () => {
        const draft = 构建红楼式草稿();
        const full = 构建模式包模块(draft, '测试贡献者');
        const payload = { ...(full.payload as any) };
        delete payload.contentBlocks;
        delete payload.modeWorldbooks;
        const synthesized = 从模式包Payload构建模块(payload)!;
        const restored = 模块转贡献草稿(synthesized)!;
        expect(restored.topicBody).toBe(payload.manualWorldPrompt);
        expect(restored.worldRulesBody).toBe(payload.worldExtraRequirement);
        expect(restored.abilityBody).toBe(payload.manualRealmPrompt);
    });

    it('酒馆预设等不支持底稿编辑的模块返回 null', () => {
        const entry = {
            id: 'x',
            type: 'tavern_preset',
            title: '某预设',
            tags: [],
            payload: { schema: 'moranjianghu-creative-workshop-tavern-preset' }
        } as unknown as 创意工坊模块条目;
        expect(模块转贡献草稿(entry)).toBeNull();
    });
});
