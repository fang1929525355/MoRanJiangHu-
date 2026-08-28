import type { 接口设置结构, 物品生图结果 } from '../../types';
import type { 游戏物品 } from '../../models/item';
import type { 题材模式类型 } from '../../models/system';
import type { 当前可用接口结构 } from '../../utils/apiConfig';
import { 获取文生图接口配置, 接口配置是否可用 } from '../../utils/apiConfig';
import { 合并物品图片档案, 查询用户图库图片 as 查询图库工具, 提取图库物品名称 } from '../../utils/itemImage';
import { 删除用户图库条目, 读取图片资源 } from '../dbService';
import { 创建图片资源引用 } from '../../utils/imageAssets';
import { 默认NSFWComfyUI工作流JSON } from '../../data/defaultComfyWorkflow';
import { 查找结构化物品 } from '../../data/structuredItemLibrary';
import { generateImageByPrompt, persistImageAssetLocally, 全局无文字正向提示词, 全局无文字负面提示词 } from './image';
import { recordDiagnosticLog } from '../diagnosticLog';
import { 请求模型文本, 规范化文本补全消息链 } from './chatCompletionClient';
import { 获取生图词组转化器接口配置, 获取主剧情接口配置 } from '../../utils/apiConfig';
import type { 接口设置结构 } from '../../types';

type 物品生图来源位置 = '背包' | '拍卖行';

export interface 物品图标生成选项 {
    source?: 'auto' | 'manual' | 'retry';
    sourceLocation?: 物品生图来源位置;
    force?: boolean;
    size?: string;
    extraPrompt?: string;
    imageApi?: 当前可用接口结构 | null;
    signal?: AbortSignal;
    题材模式?: 题材模式类型;
    创意工坊模块ID?: string;
    recordId?: string;
}

export interface 物品图标生成结果 {
    nextItem: 游戏物品;
    imageRecord: 物品生图结果;
    prompt: string;
    imageApi: 当前可用接口结构 | null;
}

const 读取文本 = (value: unknown, fallback = '') => (
    typeof value === 'string' ? value.trim() : fallback
);

const 构建物品生图接口配置 = (imageApi: 当前可用接口结构 | null): 当前可用接口结构 | null => {
    if (!imageApi) return null;
    if (imageApi?.图片后端类型 !== 'comfyui') return imageApi;
    const workflow = 读取文本(imageApi.ComfyUI工作流JSON);
    // 当前 CNB 的 NunchakuZImageDiTLoader 对部分 z_image_turbo_bf16 模型会抛 KeyError: 'weight'。
    // 物品图标优先稳定产出，因此避开该节点，复用已验证可执行的 mPMix + Lightning 工作流。
    if (!/NunchakuZImageDiTLoader/i.test(workflow)) return imageApi;
    return {
        ...imageApi,
        ComfyUI工作流JSON: 默认NSFWComfyUI工作流JSON
    };
};

/**
 * 仅用于写入 `视觉描述` 字段的原始文本。
 * 注意：物品生图的 prompt 必须避免出现"名称:X 类型:Y 品质:Z"这种结构化中文键值对，
 * 否则大量模型会直接把它当成要画在图上的文字/标签 (历史事故：青钢剑图上出现 "名称:青钢剑 类型:武型 品质:良品")。
 * 这里只保留描述性自然语言，不保留字段标签。
 *
 * 当结构化物品有 `生图描述` 时，只使用 `生图描述` + `视觉标签`，
 * 不再混入 `描述`、`词条列表`、`来源描述`、`关联事件` 等游戏机制文字，
 * 否则 AI 会把"承载一段c级支线剧情用于兑换高级强化"这类文案画进图片。
 */
/**
 * 判断文本是否包含明确的游戏机制数值/属性文案。
 * 放宽过滤规则：只拦截明确的数值属性表述（如"属性+10"、"伤害+20"、"冷却-5秒"）
 * 以及明确的功能性机制文案（如"承载支线剧情"、"用于兑换"、"强化券"），
 * 保留描述性自然语言（如"干粮"、"打火用的"、"装着"等合理描述）。
 */
const 是否游戏机制文案 = (text: string): boolean => {
    const 数值模式 = /属性[+\-]\d+|伤害[+\-]\d+|生命值[+\-]\d+|法力值[+\-]\d+|冷却[+\-]?\d+秒|暴击率[+\-]\d+%|命中率[+\-]\d+%|闪避率[+\-]\d+%|经验[+\-]\d+|等级[+\-]\d+|持续\d+回合|概率\d+%|倍率\d+\.?\d*x|充能\d+层|触发几率\d+%|[+\-]\s*\d+|\d+\s*回合/i;
    const 功能模式 = /承载.*支线剧情|用于兑换|兑换.*强化|强化券|奖励点数|技能点|解锁.*技能|提升.*等级|获得.*经验|触发.*事件/i;
    return 数值模式.test(text) || 功能模式.test(text);
};

/**
 * 描述里典型的"游戏效果"句式开头：只要从句以这些词起头，整句都在讲数值收益，
 * 与外观无关，必须整句剔除（历史事故："提供微弱的身体防护"被塞进披风生图 prompt）。
 */
const 强效果从句开头 = /^(提供|给予|带来|产生|造成|减少|降低|增加|提升|增强|恢复|回复|免疫|抵挡|抵御|抵抗|防止|避免|减免|抵消|便于|有助|有助于|以便)/;
/**
 * 弱效果标记：只有"可/能/会/用于…"后面确实接效果语义时才判定为机制从句，
 * 避免误删"可折叠的斗笠""会发光的玉佩"这类纯外观描述。
 */
const 弱效果从句开头 = /^(可|可以|能|能够|会|适合|适用于|用于|用来|可用于|可以用于|使用后|使用时|装备后|穿戴后|携带时|需|需要)/;
const 效果语义模式 = /遮挡|防护|防御|抵御|抵挡|减免|抵消|恢复|回复|增加|减少|提升|降低|伤害|气血|生命|内力|精力|体力|属性|经验|概率|几率|持续|冷却|回合|翻倍|加成|buff|debuff/i;

/**
 * 判断单个从句是否属于"游戏机制/效果"文案，属于则不应进入生图 prompt。
 */
const 是否效果从句 = (clause: string): boolean => {
    if (!clause) return false;
    if (强效果从句开头.test(clause)) return true;
    if (弱效果从句开头.test(clause) && 效果语义模式.test(clause)) return true;
    return 是否游戏机制文案(clause);
};

/**
 * 去掉"李方文用野麻叶……制成的简易披风"这类句子里的人名/制作者前缀，
 * 只保留制作工艺与物品本身。仅当"…而成/制成…的<物品>"结构成立时才剥离，
 * 避免把"青钢剑用玄铁打造而成"里的物品名本身误删。
 */
export const 移除制作者前缀 = (text: string): string => {
    if (!text) return text;
    if (!/(而成|制成|做成|织成|编成|扎成|串成|缝制|打造|锻造|雕琢|缝成)[^，。；]*的[\u4e00-\u9fff]+$/.test(text)) return text;
    return text.replace(/^[\u4e00-\u9fff]{2,4}(?=用|由|以|将|把|拿|采|取)/, '');
};

/**
 * 清洗描述文本：按句读切分后逐条剔除效果/用途/数值从句，移除人称与量词前缀，
 * 只保留可用于生图的外观描述。
 */
export const 清洗描述文本 = (text: string): string => {
    const 原文 = (text || '').trim();
    if (!原文) return '';
    const 从句列表 = 原文
        .split(/[，。；、\n]/)
        .map((part) => 移除制作者前缀(part.trim()))
        .map((part) => part.replace(/^(这是一个|这是|是一个|是|有一个|有)\s*/, '').trim())
        .filter(Boolean)
        .filter((part) => !是否效果从句(part));
    const 清洗后 = (从句列表.length > 0
        ? 从句列表.join('，')
        : 移除制作者前缀(原文).replace(/^(这是一个|这是|是一个|是|有一个|有)\s*/, '').trim()
    ).trim();
    return 清洗后.length > 0 ? 清洗后 : 原文;
};

export const 物品无文字正向约束 = `${全局无文字正向提示词}, blank unmarked object surface, plain empty panels, clean material texture where markings would appear`;
export const 物品符箓正向约束 = 'label-free talisman design, no readable characters, no legible writing, abstract unreadable cinnabar strokes are allowed, decorative non-linguistic talisman linework is allowed';

const 物品是否符纸符箓 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.标签) ? item.标签.join(' ') : '',
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /符纸|纸符|黄符|符箓|符材|符咒|符篆|火球符|冰锥符|雷光符|金刚符|神行符|隐身符|传音符|传送符/u.test(text);
};

const 过滤符箓负面提示词 = (negativePrompt: string): string => {
    const allowForTalisman = new Set([
        'glyphs',
        'runes',
        'ideograms',
        'seal',
        'vertical calligraphy',
        'calligraphy',
        'brush strokes'
    ]);
    return negativePrompt
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => !allowForTalisman.has(part.toLowerCase()))
        .join(', ');
};

const 获取物品正向无文字约束 = (item: any): string => (
    物品是否符纸符箓(item) ? 物品符箓正向约束 : 物品无文字正向约束
);

/**
 * 按物品名称链查结构化物品库，供生图主体与调用方共用同一套匹配口径。
 */
export const 查找物品结构化定义 = (item: any) => 查找结构化物品(
    读取文本(item?.规范物品名称)
    || 读取文本(item?.预设物品名称)
    || 读取文本(item?.标准物品名称)
    || 读取文本(item?.基础物品名称)
    || 读取文本(item?.图片匹配名称)
    || 读取文本(item?.名称)
);

export const 构建物品视觉描述 = (item: any): string => {
    const structured = 查找物品结构化定义(item);
    if (structured?.生图描述) {
        const parts: string[] = [structured.生图描述];
        if (Array.isArray(structured.视觉标签) && structured.视觉标签.length > 0) {
            parts.push(`结构化材质与物品：${structured.视觉标签.join('，')}`);
        }
        return parts.join('\n');
    }
    const 描述 = 读取文本(item?.描述);
    const parts: string[] = [];
    if (描述 && !是否游戏机制文案(描述)) {
        parts.push(清洗描述文本(描述));
    }
    if (Array.isArray(item?.词条列表) && item.词条列表.length > 0) {
        const 词条文案 = item.词条列表
            .map((entry: any) => [entry?.名称, entry?.属性, entry?.数值].filter(Boolean).join(' '))
            .filter(Boolean)
            .join('；');
        if (词条文案 && !是否游戏机制文案(词条文案)) parts.push(词条文案);
    }
    const 来源 = 读取文本(item?.来源描述);
    if (来源 && !是否游戏机制文案(来源)) parts.push(来源);
    const 关联 = 读取文本(item?.关联事件);
    if (关联 && !是否游戏机制文案(关联)) parts.push(关联);
    return parts.join('\n');
};

const 获取渲染风格要求 = (style: string): string => {
    switch (style) {
        case '写实道具':
            return 'isolated single prop product photography, studio lighting, tactile material detail, neutral matte background';
        case '像素图标':
            return 'high-end pixel art item icon, crisp silhouette, readable at small size, clean transparent-style asset presentation';
        case '3D渲染':
            return 'stylized 3D single prop render, centered product lighting, soft shadow, clean asset presentation';
        case '国风插画':
        default:
            return 'Chinese wuxia illustration style, ink wash texture, refined golden rim light';
    }
};

const 物品类型转英文 = (type: string): string => {
    const map: Record<string, string> = {
        '武器': 'weapon', '武型': 'weapon', '剑': 'sword', '刀': 'saber',
        '防具': 'armor', '盔甲': 'armor', '衣服': 'garment',
        '消耗品': 'consumable', '丹药': 'medicinal pill', '药': 'medicine',
        '材料': 'crafting material', '符箓': 'talisman', '秘籍': 'scroll',
        '法宝': 'xianxia magical artifact', '法器': 'xianxia magical artifact',
        '任务': 'key item', '杂物': 'miscellaneous object',
        '饰品': 'accessory', '暗器': 'hidden weapon'
    };
    for (const [cn, en] of Object.entries(map)) {
        if (type.includes(cn)) return en;
    }
    return 'prop';
};

const 物品名称是否柔性服装 = (name: string): boolean => (
    /弟子服|门派服|内门服|外门服|制式服|练功服|武服|劲装|布衣|布衫|青衫|衣服|衣裳|衣物|服装|长衫|短衫|衫|袍|法袍|道袍|僧衣|寝衣|内衬|内衣|裤|长裤|短裤|裙|鞋|靴|袜|披风|斗篷|罩衫|外袍|长袍|便服|常服|军装|旧军装|作训服|迷彩服|制服|夹克|外套|战术服/.test(name)
);

const 物品是否柔性服装 = (item: any): boolean => {
    const name = 读取文本(item?.名称);
    if (物品名称是否柔性服装(name)) return true;
    const type = 读取文本(item?.类型);
    const equipSlot = [
        item?.装备位置,
        item?.当前装备部位,
        Array.isArray(item?.覆盖部位) ? item.覆盖部位.join(' ') : item?.覆盖部位
    ].map((value) => 读取文本(value)).join(' ');
    return /衣服|服装|内衬|鞋履/.test(type)
        || (/内衬|腿部|足部|胸部/.test(equipSlot) && 物品名称是否柔性服装(`${name}${equipSlot}`));
};

const 物品是否浅色月白服装 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return 物品是否柔性服装(item) && /月白|月白色|牙白|霜白|素白|白衣|白袍|白色/.test(text);
};

const 物品是否门派弟子服 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return 物品是否柔性服装(item) && /弟子服|门派服|内门服|外门服|制式服|门派弟子|内门弟子|外门弟子/.test(text);
};

const 物品是否可穿戴护甲 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /战术背心|防弹背心|防刺背心|负重背心|战术护具|防弹衣|软甲|内甲|宝甲|甲衣|护身甲|护心甲|胸甲|背甲|护甲|铠甲|甲胄|皮甲|锁子甲|链甲|鳞甲/.test(text)
        || (/防具/.test(text) && /甲片|护身|护胸|贴身|内穿|穿戴|甲衣|胸腹|躯干/.test(text));
};

const 物品是否现代枪械 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /自动步枪|突击步枪|步枪|手枪|霰弹枪|散弹枪|冲锋枪|狙击枪|机枪|枪械|火器|弹匣|枪托|枪管|扳机|消音器|瞄准镜|子弹|弹药|AK|AR-?15|M4|M16/i.test(text);
};

const 物品是否弩 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /弩机|改装弩|消音弩|十字弩|弩\b|crossbow/i.test(text);
};

const 物品是否装箭容器 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /箭囊|箭袋|箭筒|箭匣|quiver|arrow case|arrow bag/i.test(text);
};

const 物品是否箭矢弹药 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /弩箭|箭矢|羽箭|箭枝|箭头|箭簇|箭束|箭矢弹药|箭矢类|arrow bundle|arrows|arrowhead|crossbow bolt/i.test(text);
};

const 物品是否科幻能量武器 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /光剑|光刃|激光剑|能量剑|等离子剑|光枪|激光枪|能量枪|粒子枪|脉冲枪|光矛|激光矛|lightsaber|laser sword|energy blade|plasma blade|laser rifle|plasma rifle|energy spear/i.test(text);
};

const 物品是否战术背心 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /战术背心|防弹背心|防刺背心|负重背心|MOLLE|模块化织带|弹挂背心|防弹衣/i.test(text);
};

const 物品是否布鞋 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /布鞋|旧布鞋|千层底|布靴|麻鞋|草鞋/.test(text);
};

const 物品是否绷带敷料 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /绷带|纱布|布条|包扎布|止血布|敷料|药棉|棉布卷|白布卷/.test(text);
};

const 物品是否香烟 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /香烟|烟盒|半包烟|受潮.*烟|烟草|cigarette|tobacco/i.test(text);
};

const 物品是否坐骑生物 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /坐骑|骏马|马匹|马\b|黑马|白马|赤兔|的卢|汗血|乌骓|青骢|黄骠|驴|骡|骆驼|牦牛/.test(text);
};

const 物品是否活体生物 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    if (/皮毛|毛皮|皮革|兽皮|骨|牙|犬牙|爪|角|筋|肉|标本|玩偶|手办|摆件|雕像|模型|饰品|挂件|毛绒|stuffed|plush|figurine|statue|taxidermy/i.test(text)) {
        return false;
    }
    const hasLivingContext = /宠物|灵宠|灵兽|幼崽|幼兽|活物|活体|兽宠|伙伴|饲养|喂养|会动|会叫|生命|跟着主人|pet\b|familiar\b/i.test(text);
    const hasAnimalSpecies = /狐狸|狐妖|白狐|赤狐|灵狐|黑猫|白猫|狸花猫|猫咪|小猫|小狗|猎犬|狼犬|白兔|灵兔|鹦鹉|乌鸦|鸽子|cat\b|dog\b|fox\b|rabbit\b|bird\b/i.test(text);
    const explicitSmallAnimal = /小狐狸|小猫|小狗|小兔|白兔/.test(text);
    return hasAnimalSpecies && (hasLivingContext || explicitSmallAnimal);
};

const 物品是否武器 = (item: any): boolean => {
    if (物品是否装箭容器(item) || 物品是否箭矢弹药(item)) return false;
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return 物品是否现代枪械(item)
        || 物品是否科幻能量武器(item)
        || 物品是否弩(item)
        || /武器|武型|主手|副手|暗器|兵器|刀|短刀|匕首|剑|长剑|短剑|弓|弩|箭|枪|矛|戟|棍|棒|杖|斧|锤|鞭|刃|飞刀|袖箭|镖/.test(text);
};

// 这里只服务于生图时的外形纠偏，用来约束主视觉轮廓，避免模型被名称里的用途词或题材先验带偏。
// 它不是正式的物品系统分类，不参与背包/装备栏/拍卖行等游戏语义判断。
type 物品外形纠偏类别 = '无' | '科幻能量武器' | '现代枪械' | '弩' | '装箭容器' | '箭矢弹药' | '弓' | '长柄锐器' | '锐器' | '钝器';

const 获取物品外形纠偏类别 = (item: any): 物品外形纠偏类别 => {
    const name = 读取文本(item?.名称);
    const text = [
        name,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    if (物品是否装箭容器(item)) return '装箭容器';
    if (物品是否箭矢弹药(item)) return '箭矢弹药';
    if (物品是否科幻能量武器(item)) return '科幻能量武器';
    if (物品是否现代枪械(item)) return '现代枪械';
    if (物品是否弩(item)) return '弩';
    if (/弓|长弓|短弓/.test(text)) return '弓';
    if (/枪|矛|戟|叉|矟|槊/.test(text) && !/步枪|手枪|枪械|光枪|激光枪|能量枪|粒子枪|脉冲枪/.test(text)) return '长柄锐器';
    if (/棍|棒|杖|锤|锏|锄|棒槌|baton|club|mace/i.test(text)) return '钝器';
    if (/刀|短刀|匕首|剑|刃|斧|镰|飞刀|袖箭|镖/.test(text)) return '锐器';
    if (/武器|武型|主手|副手|暗器|兵器/.test(text)) return '锐器';
    if (/箭/.test(name)) return '箭矢弹药';
    return '无';
};

const 获取外形纠偏强调描述 = (category: 物品外形纠偏类别): string => {
    switch (category) {
        case '科幻能量武器':
            return 'strict sci-fi energy weapon prop: futuristic hilt, emitter, barrel or energy core clearly visible, luminous energy edge or beam source, clear advanced-technology silhouette';
        case '现代枪械':
            return 'strict modern firearm prop: rifle or gun receiver, barrel, stock, magazine, grip and trigger guard clearly visible; the silhouette must be a firearm, not a spear or polearm';
        case '弩':
            return 'strict crossbow prop: horizontal bow limbs, short stock, trigger, taut string, bolt rail and compact ranged-weapon silhouette; not a spear, not a polearm, not a staff';
        case '装箭容器':
            return 'strict quiver or arrow container prop: carrying container with strap, mouth opening and visible feathered arrow ends; container silhouette must be the main subject, not a bow or blade';
        case '箭矢弹药':
            return 'strict arrow ammunition prop: grouped arrows or bolts, shafts, arrowheads and fletching clearly visible; not a bow, not a quiver as main subject';
        case '弓':
            return 'strict bow weapon prop: curved bow limbs, taut bowstring and bow grip clearly visible; the bow itself must be the main subject';
        case '长柄锐器':
            return 'strict polearm weapon prop: long shaft and spearhead, blade or pointed head clearly visible; polearm silhouette must be the main subject';
        case '锐器':
            return 'strict edged weapon prop: blade, edge, hilt, handle or scabbard clearly visible';
        case '钝器':
            return 'strict blunt weapon prop: solid striking head or sturdy shaft clearly visible, impact-focused non-bladed weapon silhouette';
        default:
            return '';
    }
};

const 物品是否折扇 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.装备位置,
        item?.当前装备部位,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /扇|折扇|玉骨扇|纸扇|团扇|羽扇|法扇/u.test(text);
};

const 物品是否古代药物 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /丹药|药丸|药散|散剂|药粉|药膏|膏药|药液|伤药|止血|凝血|金疮|解毒|疗伤|丸|散\b|膏\b/.test(text);
};

const 物品是否现代药剂 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.标签) ? item.标签.join(' ') : '',
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /稳定剂|镇定剂|精神稳定|精神防护|药剂|针剂|注射剂|安瓿|药水|试剂|血清|解药|医疗喷雾|medical vial|ampoule|serum/i.test(text)
        || /病毒|原液|样本|培养液|病原体|生物制剂|毒素提取/i.test(text)
        || (/消耗品/.test(text) && /精神|恐怖|污染|防护|稳定|镇定|医疗|药/.test(text));
};

const 物品是否草药植物 = (item: any): boolean => {
    const text = [
        item?.名称,
        item?.类型,
        item?.描述,
        item?.视觉描述,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    return /冰莲|雪莲|莲花|莲\b|灵芝|人参|血参|药草|灵草|仙草|毒草|药材|草药|花瓣|花蕊|花朵|花\b|灵花|异花|奇花|根茎|藤蔓|叶片|果实|灵果/.test(text);
};

const 物品品质转英文 = (quality: string): string => {
    const map: Record<string, string> = {
        '传说': 'legendary', '绝世': 'mythic', '极品': 'top grade',
        '稀有': 'rare', '珍品': 'rare', '良品': 'fine', '精品': 'fine',
        '普通': 'common', '凡品': 'common', '杂物': 'cheap'
    };
    for (const [cn, en] of Object.entries(map)) {
        if (quality.includes(cn)) return en;
    }
    return 'common';
};

const 物品名称转英文描述 = (name: string): string => {
    // 常见武侠物品名称到英文视觉描述的映射
    const map: Record<string, string> = {
        '采药短刀': 'short herbal-gathering knife, small rusty utility blade with a simple wooden handle, handheld cutting tool for harvesting herbs, blade and handle clearly visible',
        '短刀': 'short knife, compact single edged metal blade, simple hilt and handle',
        '匕首': 'dagger, short double edged metal blade, hilt and grip',
        '长剑': 'jian sword, long straight metal blade with guard and handle',
        '短剑': 'short jian sword, straight compact metal blade with guard and handle',
        '飞刀': 'throwing knife, slim metal blade, small handle, hidden weapon prop',
        '袖箭': 'sleeve dart launcher or small dart projectile, hidden weapon prop',
        '弩箭': 'crossbow bolt, slender wooden shaft with metal arrowhead and fletching',
        '箭囊': 'leather quiver for carrying arrows, shoulder strap, mouth opening and visible arrow feathers, no bow',
        '箭袋': 'soft leather quiver or arrow bag with strap and visible feathered arrow ends, no bow',
        '箭筒': 'rigid arrow tube quiver with strap and visible arrow feathers, no bow',
        '箭匣': 'compact arrow case for storing bolts or arrows, fitted container with strap, no blade',
        '改装弩': 'modified compact crossbow, horizontal bow limbs, short stock, trigger, taut string, rail and bolt groove clearly visible, improvised survival weapon',
        '消音弩': 'quiet compact crossbow, horizontal bow limbs, stock, trigger, taut string, bolt rail, modern survival crossbow silhouette',
        '弩机': 'crossbow mechanism, horizontal bow limbs, wooden or metal stock, trigger and string, compact ranged weapon',
        '自动步枪': 'worn modern assault rifle, black metal firearm receiver, barrel, magazine, stock, trigger guard, scratched tactical finish, clearly a rifle not a spear',
        '突击步枪': 'modern assault rifle, firearm barrel, magazine, stock, receiver and grip clearly visible',
        '步枪': 'modern rifle firearm, long gun body with stock, barrel, receiver and magazine',
        '手枪': 'modern pistol firearm, compact handgun with grip, trigger guard, slide and barrel',
        '九毫米手枪': '9mm semi-automatic pistol prop, compact black handgun with slide, short barrel, grip, trigger guard and magazine baseplate, clearly a pistol, not a submachine gun',
        '9毫米手枪': '9mm semi-automatic pistol prop, compact black handgun with slide, short barrel, grip, trigger guard and magazine baseplate, clearly a pistol, not a submachine gun',
        '9mm手枪': '9mm semi-automatic pistol prop, compact black handgun with slide, short barrel, grip, trigger guard and magazine baseplate, clearly a pistol, not a submachine gun',
        '霰弹枪': 'modern shotgun firearm, pump or break-action body with stock and barrel',
        '散弹枪': 'modern shotgun firearm, pump or break-action body with stock and barrel',
        '冲锋枪': 'modern submachine gun firearm, compact receiver, magazine, grip and stock',
        '狙击枪': 'modern sniper rifle firearm, long barrel, scope, stock and magazine',
        '战术背心': 'wearable tactical vest, MOLLE webbing, shoulder straps, front buckles, pouch panels, torso garment shape, no shield',
        '轻型防护背心': 'light protective tactical vest, wearable fabric torso vest with shoulder straps, front zipper or buckles, thin padded panels, arm holes and waist hem, no cutting board, no shield',
        '防弹背心': 'wearable bulletproof vest, soft ballistic torso vest with shoulder straps and front panels, no shield',
        '负重背心': 'wearable load-bearing tactical vest, fabric torso gear with pouches and straps, no shield',
        '半包受潮的香烟': 'opened damp cigarette pack, crumpled stained cardboard cigarette box, half-empty paper pack with visible bent cigarettes and water damage, realistic survival prop, not a pouch, not a bag',
        '受潮的香烟': 'damp cigarette pack, stained cardboard cigarette box with soggy paper edges and visible cigarettes, not leather, not cloth pouch',
        '香烟': 'paper cigarette pack with visible cigarettes, cardboard box, crumpled soft pack or opened hard pack, tobacco product prop, no pouch',
        '基础精神稳定剂': 'small unlabelled amber glass medicine vial or ampoule kit, calming stabilizer serum, plain blank cap, transparent brown glass, small protective medicine case, no book, no label, no text',
        '精神稳定剂': 'small unlabelled amber glass medicine vial or ampoule kit, calming stabilizer serum, plain blank cap, transparent brown glass, small protective medicine case, no book, no label, no text',
        'T病毒原液': 'small sealed laboratory glass vial containing a small amount of translucent greenish liquid, biohazard sample container, medical specimen vial with rubber stopper, no label, no text',
        'T病毒': 'small sealed laboratory glass vial containing translucent greenish liquid, biohazard sample, medical specimen container, no label',
        '旧军装': 'worn modern military uniform, faded cloth jacket and trousers, fabric patches, frayed seams, soft garment only, no armor plates',
        '军装': 'modern military uniform, cloth jacket and trousers, soft textile garment, no armor plates',
        '作训服': 'modern combat training uniform, cloth shirt and trousers, fabric folds, no armor plates',
        '战术服': 'modern tactical clothing, dark fabric shirt and trousers, utility pockets, soft textile garment, no armor plates, no metal plating',
        '青竹法剑': 'xianxia flying sword, jian sword, translucent green jade-bamboo blade, bamboo segment texture, gold guard, green bamboo hilt, subtle magical aura',
        '青竹灵剑': 'xianxia flying sword, jian sword, translucent green jade-bamboo blade, bamboo segment texture, gold guard, green bamboo hilt, subtle magical aura',
        '灵竹剑': 'xianxia flying sword, jian sword, translucent green jade-bamboo blade, visible bamboo nodes, gold guard, refined cultivation sword prop',
        '法剑': 'xianxia ritual jian sword, translucent green jade or spirit bamboo blade when bamboo is mentioned, refined gold guard, subtle magical aura',
        '弓': 'traditional bow weapon, curved wooden bow with taut string',
        '弩': 'crossbow weapon, horizontal bow limbs, stock, trigger, taut string and bolt rail clearly visible',
        '枪': 'spear weapon, long shaft with metal spearhead',
        '矛': 'spear weapon, long polearm with pointed metal head',
        '棍': 'staff weapon, long wooden fighting staff',
        '杖': 'staff weapon, carved wooden staff',
        '斧': 'battle axe, metal axe head with wooden handle',
        '锤': 'war hammer, heavy metal hammer head with handle',
        '鞭': 'flexible whip weapon, braided leather or metal chain',
        '剑': 'jian sword, straight metal blade with guard and handle',
        '刀': 'saber knife weapon, curved or single edged metal blade with hilt and handle',
        '玉骨扇': 'folded jade-rib hand fan, elegant Chinese fan with pale jade ribs and silk or paper fan leaf, decorative tassel, no blade',
        '折扇': 'folded Chinese hand fan with visible ribs and paper or silk fan leaf, decorative tassel, no blade',
        '纸扇': 'folded paper hand fan with bamboo ribs, no blade',
        '羽扇': 'feather fan, layered feathers on a short handle, no blade',
        '灵石': 'raw translucent spirit stone crystal mineral with soft inner glow',
        '灵晶': 'dense faceted spirit crystal with concentrated inner glow',
        '妖丹': 'round beast core crystal with layered inner glow, cultivation material',
        '玉简': 'bundle of jade slips tied with silk cord, abstract unreadable etched marks',
        '符纸': 'small stack of thin yellow paper talisman sheets, handmade paper slips with slightly uneven edges, a few abstract unreadable cinnabar strokes, no readable characters',
        '符箓': 'single talisman paper charm with abstract unreadable ink strokes',
        '符': 'single talisman paper charm with abstract unreadable ink strokes',
        '飞剑': 'slender xianxia flying sword artifact, ceremonial decorative prop, no person',
        '葫芦': 'jade or lacquered gourd magical vessel with cork stopper and silk cord',
        '铃': 'small bronze magical bell artifact with cord and tassel',
        '宝镜': 'round bronze magical mirror artifact with polished cloudy surface',
        '阵盘': 'round jade or bronze array disk with abstract geometric grooves, no readable text',
        '罗盘': 'bronze spirit compass artifact with central pointer and abstract rings',
        '丹炉': 'small three-legged alchemy furnace with lid and handles',
        '储物袋': 'small embroidered drawstring storage pouch, cultivation artifact bag',
        '储物戒': 'single storage ring artifact with gemstone, photographed alone, no hand',
        '灵兽袋': 'small spirit beast pouch made of leather and brocade, no animal visible',
        '法袍': 'soft cultivation robe laid flat, woven fabric and trim, no person',
        '法冠': 'cultivation hair crown accessory, jade or metal headwear prop, no person',
        '法靴': 'pair of empty cloth cultivation boots side by side, visible hollow openings',
        '乌金软甲': 'wearable blackened gold soft armor vest, flexible torso protection, fine overlapping dark metal scales sewn onto black cloth, sleeveless martial arts body armor',
        '软甲': 'wearable soft armor vest, flexible torso protection, overlapping small armor scales sewn onto cloth, sleeveless martial arts body armor',
        '内甲': 'wearable inner armor vest, thin flexible torso protection worn under robes, cloth-backed armor panels',
        '宝甲': 'wearable ornate armor vest, protective torso garment with fitted chest and waist panels',
        '甲衣': 'wearable armored garment, torso-shaped protective clothing with arm openings and waist hem',
        '护身甲': 'wearable protective armor vest for the torso, fitted chest and back panels',
        '护心甲': 'wearable heart-protecting breast armor, compact torso armor plate on a cloth backing',
        '练功服': 'cloth kung fu training uniform, soft fabric robe and trousers, folded garment',
        '武服': 'cloth martial arts uniform, soft fabric outfit, folded garment',
        '劲装': 'fitted cloth martial arts outfit, soft fabric clothing',
        '布衣': 'plain cloth robe, soft fabric garment',
        '布衫': 'plain cloth shirt robe, soft fabric garment',
        '青衫': 'blue green cloth robe, soft fabric garment',
        '长衫': 'long cloth robe, soft fabric garment',
        '道袍': 'taoist cloth robe, soft flowing fabric garment',
        '内门弟子服': 'inner sect disciple uniform robe, soft cloth garment, folded pale fabric with subtle trim, cloth-only clothing item',
        '弟子服': 'sect disciple uniform robe, soft cloth garment, folded pale fabric with trim, cloth-only clothing item',
        '门派服': 'sect uniform robe, soft cloth garment, folded fabric with trim, cloth-only clothing item',
        '外袍': 'outer cloth robe, soft flowing fabric garment',
        '长袍': 'long robe, soft fabric garment',
        '内衬': 'inner cloth lining garment, soft fabric clothing',
        '长裤': 'cloth trousers, folded fabric clothing',
        '旧草鞋': 'a pair of old straw sandals, woven straw footwear, two worn empty sandals placed side by side',
        '草鞋': 'a pair of straw sandals, woven straw footwear, two empty sandals placed side by side',
        '旧布鞋': 'a pair of old cloth shoes, worn fabric footwear, two empty shoes placed side by side',
        '布鞋': 'cloth shoes, woven fabric upper, layered stitched cloth sole, soft worn fabric footwear',
        '靴': 'boots, leather or cloth footwear',
        '绷带': 'rolled medical bandage, folded white cloth strip roll, gauze bandage spool, clean first-aid fabric supply',
        '纱布': 'folded sterile gauze pads and rolled gauze bandage, white medical dressing cloth',
        '止血布': 'folded hemostatic cloth dressing, white fabric bandage roll, first-aid supply',
        '木牌': 'wooden plaque tablet', '身份木牌': 'wooden identity plaque with carved text',
        '令牌': 'metal command token', '腰牌': 'waist badge token',
        '铜牌': 'bronze badge', '铁牌': 'iron plaque',
        '玉佩': 'jade pendant', '玉牌': 'jade plaque',
        '信物': 'keepsake token', '印章': 'seal stamp',
        '钥匙': 'ornate key', '锦囊': 'silk pouch',
        '卷轴': 'scroll', '书信': 'letter scroll',
        '地图': 'map scroll', '银票': 'silver banknote',
        '食盒': 'wooden food box', '酒壶': 'wine gourd',
        '灯笼': 'paper lantern', '火折子': 'fire starter flint',
        '绳索': 'hemp rope', '包袱': 'cloth bundle',
        '银两': 'silver ingots', '铜钱': 'copper coins',
        '凝血散': 'ancient hemostatic medicinal powder in a small folded paper packet or ceramic medicine vial, herbal powder for stopping bleeding',
        '金疮药': 'ancient wound medicine powder in a small ceramic medicine bottle or folded paper packet',
        '止血散': 'ancient hemostatic powder in a folded paper packet, herbal medicinal powder',
        '解毒散': 'ancient antidote powder in a folded paper packet or ceramic medicine vial',
        '幽冥冰莲': 'rare mystical ice lotus flower, dark blue translucent lotus petals, frosted botanical herb, glowing cold aura, intact flower bloom and stem',
        '冰莲': 'ice lotus flower, translucent blue white lotus petals, frosted botanical herb, intact flower bloom and stem',
        '雪莲': 'snow lotus flower, pale white alpine medicinal flower, layered petals, botanical herb specimen',
        '血参': 'red ginseng root medicinal herb, branching natural root shape, organic plant texture',
        '人参': 'ginseng root medicinal herb, branching natural root shape, organic plant texture',
        '灵芝': 'lingzhi mushroom medicinal herb, glossy red brown fungus cap, organic botanical specimen',
        '狐狸': 'real living fox, full body animal, natural fur coat, pointed ears, narrow snout and bushy tail',
        '白狐': 'real living white fox, full body animal, natural white fur coat, pointed ears and bushy tail',
        '赤狐': 'real living red fox, full body animal, orange-red fur coat, pointed ears and bushy tail',
        '灵狐': 'real living fox-like spirit beast, full body animal, natural fur, elegant posture and bushy tail',
        '黑猫': 'real living black cat, full body animal, natural fur coat, upright ears and long tail',
        '白猫': 'real living white cat, full body animal, natural fur coat, upright ears and long tail',
        '小猫': 'real living kitten or young cat, full body animal, natural fur coat and upright ears',
        '小狗': 'real living puppy or young dog, full body animal, natural fur coat and alert posture',
        '兔子': 'real living rabbit, full body animal, natural fur coat, long ears and small paws',
        '白兔': 'real living white rabbit, full body animal, natural fur coat, long ears and small paws',
        '骏马': 'real living horse, full body animal, natural coat and mane',
        '马匹': 'real living horse, full body animal, natural coat and mane',
        '黑马': 'real living black horse, full body animal, natural coat and mane',
        '白马': 'real living white horse, full body animal, natural coat and mane',
        '赤兔': 'real living chestnut red horse, full body animal, natural coat and mane',
        '的卢': 'real living horse, full body animal, natural coat and mane',
        '汗血': 'real living Akhal-Teke style horse, full body animal, natural coat and mane',
        '乌骓': 'real living dark horse, full body animal, natural coat and mane',
        '青骢': 'real living dapple gray horse, full body animal, natural coat and mane',
        '黄骠': 'real living dun horse, full body animal, natural coat and mane',
        '驴': 'real living donkey, full body animal, natural fur',
        '骡': 'real living mule, full body animal, natural fur',
        '骆驼': 'real living camel, full body animal, natural fur',
        '牦牛': 'real living yak, full body animal, natural fur',
    };
    for (const [cn, en] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
        if (name.includes(cn)) return en;
    }
    // 通用关键词推断
    if (/扇|折扇|玉骨扇|纸扇|团扇|羽扇|法扇/u.test(name)) return 'folded Chinese hand fan prop, visible fan ribs and fan leaf, decorative tassel, no blade';
    if (/灵石|灵晶|晶石|矿石|妖丹/.test(name)) return 'raw cultivation mineral or crystal core specimen with natural glow, no text';
    if (/玉简|剑诀|心法|功法|入门|心得/.test(name)) return 'bundle of jade slips tied with silk cord, abstract unreadable etched marks and diagrams';
    if (/符箓|火球符|冰锥符|雷光符|金刚符|神行符|隐身符|传音符|传送符/.test(name)) return 'single talisman paper charm with abstract unreadable ink strokes, no readable characters';
    if (/阵盘|罗盘/.test(name)) return 'round cultivation array disk or compass artifact with abstract geometric grooves, no readable text';
    if (/丹炉/.test(name)) return 'small three-legged alchemy furnace with lid and handles, tabletop bronze or iron cultivation tool';
    if (/储物袋|灵兽袋/.test(name)) return 'small embroidered drawstring pouch cultivation treasure, no animal visible';
    if (/储物戒/.test(name)) return 'single ring magical artifact, photographed alone, no hand';
    if (/葫芦|铃|宝镜|镜|索/.test(name)) return 'xianxia magical artifact treasure prop, ancient Chinese material, clear single object silhouette';
    if (/箭囊|箭袋|箭筒|箭匣|quiver/i.test(name)) return 'arrow-carrying quiver or arrow case, leather or wood container with strap and visible feathered arrow ends, no bow';
    if (/弩箭|箭矢|羽箭|箭枝|箭头|箭簇|箭束|arrow bundle|arrowhead|arrows|bolt/i.test(name)) return 'grouped arrow ammunition prop, fletched shafts with visible arrowheads and nocks, bundled or laid together, not a bow, not a blade weapon';
    if (/弩|弩机/.test(name)) return 'crossbow weapon prop, horizontal bow limbs, stock, trigger, taut string and bolt rail clearly visible, compact ranged weapon';
    if (/青竹.*剑|灵竹.*剑|竹.*法剑|法剑/.test(name)) return 'xianxia flying sword, jian sword, translucent green jade-bamboo blade, bamboo segment texture, gold guard, green bamboo hilt, subtle magical aura';
    if (/暗器|兵器|刀|短刀|匕首|剑|弓|枪|矛|戟|棍|棒|杖|斧|锤|鞭|刃|镖/.test(name)) return 'traditional weapon prop, clearly visible blade, bow, hilt, shaft, grip or scabbard';
    if (/牌|令|符/.test(name)) return 'wooden or metal plaque token';
    if (/壶|瓶|罐/.test(name)) return 'ceramic or metal container vessel';
    if (/匣|盒|箱/.test(name)) return 'wooden box or case';
    if (/书|卷|册|经/.test(name)) return 'ancient book or scroll';
    if (/香烟|烟盒|半包烟|受潮.*烟|烟草/.test(name)) return 'opened damp paper cigarette pack, crumpled stained cardboard cigarette box, visible bent cigarettes, tobacco paper and water damage, not a pouch or bag';
    if (/袋|囊|包/.test(name)) return 'cloth pouch or bag';
    if (/丹|药|散|丸|膏/.test(name)) return 'ancient medicinal item, herbal powder or pills stored in a folded paper packet, cloth sachet, or small ceramic medicine vial';
    if (/病毒|原液|血清|样本|培养液|病原体|生物制剂/.test(name)) return 'small sealed laboratory glass vial or ampoule containing translucent liquid, medical specimen sample container, biohazard research sample, no label, no text';
    if (/冰莲|雪莲|莲|花|草|参|芝|根|藤|果|叶/.test(name)) return 'botanical medicinal herb specimen, natural plant or flower form, organic petals leaves roots or stems';
    if (/软甲|内甲|宝甲|甲衣|护身甲|护心甲|胸甲|背甲|护甲|铠甲|甲胄|皮甲|锁子甲|链甲|鳞甲/.test(name)) return 'wearable torso armor vest, protective garment shape, arm openings, shoulder straps, chest and back panels, waist hem';
    if (物品名称是否柔性服装(name)) return 'soft cloth martial arts garment, folded fabric clothing';
    return '';
};

const 提炼中文物品描述为英文材质 = (item: any, description: string): string => {
    const text = [
        item?.名称,
        item?.类型,
        description,
        Array.isArray(item?.视觉标签) ? item.视觉标签.join(' ') : ''
    ].map((value) => 读取文本(value)).join(' ');
    const cues: string[] = [];
    if (/灵竹|青竹|竹/.test(text)) {
        cues.push('green spirit bamboo material, translucent green jade-bamboo blade, bamboo segment texture, polished bamboo grain, pale green natural texture');
    }
    if (/法剑|法器|法宝|灵力|御使|灵气/.test(text)) {
        cues.push('xianxia flying sword, subtle xianxia magical aura, restrained glow, refined ritual weapon finish, gold guard');
    }
    if (/轻剑|轻便|轻盈/.test(text)) {
        cues.push('slender lightweight sword silhouette');
    }
    return Array.from(new Set(cues)).join(', ');
};

const 构建物品描述材质提示 = (item: any): string => {
    const description = 读取文本(item?.视觉描述) || (!是否游戏机制文案(读取文本(item?.描述) || '') ? 读取文本(item?.描述) : '');
    const name = 读取文本(item?.名称);
    if (/青竹.*剑|灵竹.*剑|竹.*法剑/.test(name)) return 'slender lightweight sword silhouette';
    if (!description) return '';
    const translated = 提炼中文物品描述为英文材质(item, description);
    if (translated) return translated;
    return /[\u4e00-\u9fff]/.test(description) ? '' : description;
};

const 构建物品视觉主体描述 = (item: any): string => {
    const name = 读取文本(item?.名称);
    const isLivingAnimal = 物品是否活体生物(item);
    const isLivingMount = 物品是否坐骑生物(item);
    const isFan = 物品是否折扇(item);
    const shapeCorrection = 获取物品外形纠偏类别(item);
    const isQuiver = shapeCorrection === '装箭容器';
    const isArrowAmmo = shapeCorrection === '箭矢弹药';
    const isCrossbow = shapeCorrection === '弩';
    const isModernFirearm = shapeCorrection === '现代枪械';
    const isEnergyWeapon = shapeCorrection === '科幻能量武器';
    const isTacticalVest = 物品是否战术背心(item);
    const isCigarette = 物品是否香烟(item);
    const isWeapon = !isFan && 物品是否武器(item);
    const isClothShoe = 物品是否布鞋(item);
    const isBandageDressing = 物品是否绷带敷料(item);
    const isSoftGarment = 物品是否柔性服装(item);
    const isPaleMoonWhiteGarment = 物品是否浅色月白服装(item);
    const isSectDiscipleUniform = 物品是否门派弟子服(item);
    const isWearableArmor = !isSoftGarment && 物品是否可穿戴护甲(item);
    const isAncientMedicine = !isCigarette && 物品是否古代药物(item);
    const isModernMedicine = !isCigarette && !isAncientMedicine && 物品是否现代药剂(item);
    const isBotanicalHerb = !isWeapon && !isAncientMedicine && 物品是否草药植物(item);
    const isTalismanPaper = 物品是否符纸符箓(item);
    const typeEn = isLivingMount ? 'living mount animal' : isLivingAnimal ? 'living animal' : isFan ? 'folded Chinese hand fan' : isModernFirearm ? 'modern firearm' : isEnergyWeapon ? 'sci-fi energy weapon' : isCrossbow ? 'crossbow' : isQuiver ? 'arrow container' : isArrowAmmo ? 'arrow ammunition' : isWeapon ? 'weapon' : isSoftGarment ? 'cloth garment' : isTacticalVest ? 'wearable tactical vest' : isWearableArmor ? 'wearable torso armor vest' : isAncientMedicine ? 'ancient medicinal powder or pills' : isModernMedicine ? 'modern medicine vial or ampoule' : isBotanicalHerb ? 'botanical medicinal herb' : 物品类型转英文(读取文本(item?.类型, '物品'));
    const qualityEn = 物品品质转英文(读取文本(item?.品质, '普通'));
    const nameEn = 物品名称转英文描述(name);
    const description = 构建物品描述材质提示(item);
    const tags = Array.isArray(item?.视觉标签)
        ? item.视觉标签.map((tag: unknown) => 读取文本(tag)).filter(Boolean).join(', ')
        : '';
    return [
        isLivingMount || isLivingAnimal
            ? (nameEn ? `a single real living ${qualityEn} ${isLivingMount ? 'mount animal' : 'animal'}, ${nameEn}` : `a single real living ${qualityEn} ${typeEn}`)
            : (nameEn ? `a single ${qualityEn} ${nameEn}` : `a single ${qualityEn} ${typeEn} prop`),
        isLivingMount || isLivingAnimal ? 'alive organic animal anatomy, natural fur, visible eyes, nose or snout, ears, paws or hooves, and tail when applicable, standing or sitting naturally on real ground, full body animal portrait' : '',
        isFan ? 'strict hand fan prop: folded or half-open fan, visible ribs, silk or paper leaf, jade/bamboo/wood spine, decorative tassel; absolutely no sword blade, no knife, no spearhead' : '',
        获取外形纠偏强调描述(shapeCorrection),
        isCigarette ? 'strict cigarette prop: opened damp cardboard cigarette pack, half-empty paper pack, visible bent cigarettes, water-stained paper and soggy edges; absolutely not a pouch, not a leather bag, not a drawstring bag' : '',
        isClothShoe ? 'strict footwear prop: a pair of empty shoes or sandals placed side by side, visible soles and woven fabric or straw texture, unworn product still life' : '',
        isBandageDressing ? 'strict first-aid dressing prop: standalone rolled bandage or folded gauze cloth, white fabric strip spool, clean product still life' : '',
        isSoftGarment ? 'soft textile clothing item, fabric seams, cloth folds, woven texture, flexible silhouette' : '',
        isPaleMoonWhiteGarment ? 'moon-white pale ivory fabric, light-colored cloth, clean soft textile surface, bright gentle robe color' : '',
        isSectDiscipleUniform ? 'Chinese sect disciple uniform robe, ceremonial training clothing, fabric collar and trim, cloth sash, cloth-only garment design' : '',
        isTacticalVest ? 'strict wearable tactical vest garment: MOLLE webbing, shoulder straps, front zipper or buckles, pouch panels, fabric torso vest shape, arm openings, displayed alone as gear' : '',
        isWearableArmor && !isTacticalVest ? 'strict wearable armor garment: torso vest shape, chest panel, back panel, shoulder straps, arm openings, waist hem, fitted to human upper body silhouette, displayed flat or on a simple invisible dress form' : '',
        isAncientMedicine ? 'ancient Chinese medicine presentation, herbal powder or pills, folded paper packet, cloth sachet, small ceramic medicine vial, apothecary prop, pre-modern wuxia era' : '',
        isModernMedicine ? 'strict medicine stabilizer prop: small amber glass vial, ampoule, syringe-free serum bottle or compact blank medicine case, sealed cap, transparent liquid, no label, no text, no book shape' : '',
        isBotanicalHerb ? 'strict botanical herb or flower specimen: organic petals, leaves, roots or stems, natural plant anatomy, no manufactured device, no electronics' : '',
        isTalismanPaper ? 'strict talisman paper material: thin yellow paper slips, handmade paper fiber texture, slightly curled corners, stacked sheets or bundled paper charms, red cinnabar abstract unreadable talisman strokes, not a plastic panel, not a blank board' : '',
        '',
        description,
        tags
    ].filter(Boolean).join('\n');
};

export const 构建物品负面提示词 = (item: any): string => {
    const isFan = 物品是否折扇(item);
    const shapeCorrection = 获取物品外形纠偏类别(item);
    const isModernFirearm = shapeCorrection === '现代枪械';
    const isCrossbow = shapeCorrection === '弩';
    const isQuiver = shapeCorrection === '装箭容器';
    const isArrowAmmo = shapeCorrection === '箭矢弹药';
    const isEnergyWeapon = shapeCorrection === '科幻能量武器';
    const isTacticalVest = 物品是否战术背心(item);
    const isCigarette = 物品是否香烟(item);
    const isWeapon = !isFan && 物品是否武器(item);
    const isSoftGarment = 物品是否柔性服装(item);
    const isPaleMoonWhiteGarment = 物品是否浅色月白服装(item);
    const isWearableArmor = !isSoftGarment && 物品是否可穿戴护甲(item);
    const isClothShoe = 物品是否布鞋(item);
    const isBandageDressing = 物品是否绷带敷料(item);
    const isLivingAnimal = 物品是否活体生物(item);
    const isLivingMount = 物品是否坐骑生物(item);
    const isAncientMedicine = !isCigarette && 物品是否古代药物(item);
    const isModernMedicine = !isCigarette && !isAncientMedicine && 物品是否现代药剂(item);
    const isBotanicalHerb = !isWeapon && !isAncientMedicine && 物品是否草药植物(item);
    const isTalismanPaper = 物品是否符纸符箓(item);
    const negativePrompt = [
        全局无文字负面提示词,
        isLivingMount ? 'rider, saddle covering the body, harness covering the body, cart, carriage, vehicle, boat' : isLivingAnimal ? 'person, human handler, leash held by person, cage, carrier bag, framed portrait, stuffed display, taxidermy scene' : 'person, human, face, hand, foot, feet, body part, skin, portrait, headshot, framed portrait, photo frame, picture frame',
        isLivingMount ? 'toy horse, plastic horse, resin figurine, statue, sculpture, ceramic, porcelain, model horse, miniature, collectible figurine, carousel horse, rocking horse, fake animal, mannequin, doll, glossy plastic, product prop, studio toy photography' : isLivingAnimal ? 'plush toy, stuffed animal, toy fox, toy cat, toy dog, plush doll, resin figurine, statue, sculpture, ceramic animal, porcelain animal, taxidermy mount, fake animal, mannequin, glossy plastic pet toy, chibi animal illustration' : '',
        isLivingMount || isLivingAnimal ? '' : 'toy, plastic figurine, resin model, statue, sculpture, mannequin',
        isFan ? 'sword, saber, knife, dagger, blade, spear, spearhead, arrowhead, metal cutting edge, sharpened weapon, polearm, staff weapon' : '',
        'game controller, gamepad, joystick, console controller, d-pad, analog stick, buttons, electronic device, gadget, plastic controller, remote control, keyboard, mouse',
        isModernFirearm ? 'spear, polearm, lance, staff, sword, saber, knife, medieval weapon, fantasy weapon, wooden shaft, spearhead, bow, crossbow, shield, helmet, armor suit' : isEnergyWeapon ? 'ancient spear, polearm, wooden shaft, bow, crossbow, medieval weapon, leather scabbard, rustic wooden weapon, modern ballistic firearm, tactical rifle' : 'modern weapon, firearm, gun, rifle, pistol, shotgun, assault rifle, sniper rifle, machine gun, firearm stock, trigger guard, gun barrel, magazine, bullet, ammunition, grenade, rocket launcher, cannon, sci-fi weapon, futuristic weapon, tactical gear, plastic gun, mechanical firearm',
        isCrossbow ? 'spear, polearm, lance, staff, baton, walking stick, sword, saber, knife, shield, rifle, pistol, firearm, gun barrel, magazine, armor suit, helmet' : '',
        isQuiver ? 'bow as main subject, crossbow as main subject, sword, dagger, spearhead, blade weapon, shield, helmet' : '',
        isArrowAmmo ? 'bow as main subject, quiver as main subject, sword, shield, helmet, armor suit' : '',
        isTacticalVest ? 'shield only, medieval shield, riot shield, round shield, kite shield, helmet only, spear, polearm, sword, breastplate-only medieval armor, full armor suit, hard cuirass without fabric straps' : '',
        isWearableArmor ? 'sword, saber, knife, dagger, blade, spear, staff, scabbard, sheath, hilt, handle, pommel, long narrow weapon, umbrella, baton, column, tower, statue, helmet only, shield only' : '',
        isWeapon ? 'flower, plant, potted plant, bonsai, grass, herb specimen, petals, leaves as main subject, vase, flowerpot, medicine bottle, pill packet' : '',
        isCigarette ? 'leather pouch, drawstring bag, cloth bag, medicine pouch, coin pouch, sack, bottle, jar, canister, food can, metal tin, ancient medicine packet, pill, herbal powder' : '',
        'item card, game card, trading card, UI overlay, interface, badge, quality badge, rarity badge, speech bubble, dialogue box, border frame, decorative frame',
        'white background, cluttered background, ink wash, guofeng illustration, Chinese painting, brush strokes, anime, cartoon, flat illustration',
        isSoftGarment ? 'armor, cuirass, breastplate, metal armor, metal plates, gauntlet, shield, helmet, hard shell, leather jacket, shiny leather garment, black armor, dark armor, lamellar armor, scale armor' : '',
        isPaleMoonWhiteGarment ? 'black clothing, dark outfit, black robe, dark robe, black fabric, dark fabric, black leather, dark leather' : '',
        isAncientMedicine ? 'weapon, blade, sword, dagger, knife, armor plate, metal weapon, hardware tool, industrial object, modern container, syringe, capsule bottle, plastic medical bottle, laboratory vial' : '',
        isModernMedicine ? 'book, scroll, manual, document, paper stack, card, talisman, weapon, armor, cutting board, food package, drink bottle, labeled bottle, printed label, visible writing, syringe needle in skin' : '',
        isBotanicalHerb ? 'machine, mechanism, tool, container, box, bottle, vial, weapon, armor, toy, controller, manufactured object, plastic, metal gadget' : '',
        isClothShoe ? 'feet, toes, legs, socks, person wearing shoes, shoe model, leather dress shoe, polished leather shoe, oxford shoe, loafer, business shoe, high heel, glossy leather, hard stacked heel' : '',
        isBandageDressing ? 'patient, wounded person, nurse, doctor, face, portrait, hand wrapping bandage, arm, leg, injury, blood, hospital bed, medical scene, photo frame, framed portrait' : ''
    ].filter(Boolean).join(', ');
    return isTalismanPaper ? 过滤符箓负面提示词(negativePrompt) : negativePrompt;
};

export const 构建物品图提示词 = (
    item: any,
    options?: { 画风?: string; 渲染风格?: string; 来源位置?: 物品生图来源位置 }
): string => {
    const style = options?.画风 || '写实';
    const renderStyle = options?.渲染风格 || '写实道具';
    const isLivingAnimal = 物品是否活体生物(item);
    const isLivingMount = 物品是否坐骑生物(item);
    const isFan = 物品是否折扇(item);
    const shapeCorrection = 获取物品外形纠偏类别(item);
    const isCrossbow = shapeCorrection === '弩';
    const isModernFirearm = shapeCorrection === '现代枪械';
    const isEnergyWeapon = shapeCorrection === '科幻能量武器';
    const isTacticalVest = 物品是否战术背心(item);
    const isCigarette = 物品是否香烟(item);
    const isWeapon = !isFan && 物品是否武器(item);
    const isClothShoe = 物品是否布鞋(item);
    const isBandageDressing = 物品是否绷带敷料(item);
    const isSoftGarment = 物品是否柔性服装(item);
    const isPaleMoonWhiteGarment = 物品是否浅色月白服装(item);
    const isSectDiscipleUniform = 物品是否门派弟子服(item);
    const isWearableArmor = !isSoftGarment && 物品是否可穿戴护甲(item);
    const isAncientMedicine = !isCigarette && 物品是否古代药物(item);
    const isModernMedicine = !isCigarette && !isAncientMedicine && 物品是否现代药剂(item);
    const isBotanicalHerb = !isWeapon && !isAncientMedicine && !isModernMedicine && 物品是否草药植物(item);
    const isTalismanPaper = 物品是否符纸符箓(item);
    const softGarmentGuard = isSoftGarment
        ? 'for clothing items: soft fabric garment laid flat or neatly folded, visible cloth weave, seams, wrinkles, flexible drape'
        : '';
    if (isLivingMount || isLivingAnimal) {
        return [
            isLivingMount
                ? 'photorealistic full-body portrait of one real living mount animal, alive animal, standing naturally on real ground, no rider'
                : 'photorealistic full-body portrait of one real living animal or pet, alive animal, standing or sitting naturally on real ground, no toy treatment, no person holding it',
            isLivingMount
                ? 'natural animal anatomy, organic body, realistic fur coat, real eyes, nostrils, mane and tail, subtle muscle structure, natural posture'
                : 'natural animal anatomy, organic body, realistic fur coat or feathers, real eyes, nose or snout, ears, paws or claws, natural posture, lifelike pet photography',
            'outdoor natural light or neutral natural light, clean background, clear silhouette, documentary animal photography',
            style === '写实' ? 'photorealistic' : style,
            构建物品视觉主体描述(item)
        ].filter(Boolean).join('\n');
    }
    // 精简 prompt：正向只描述目标画面，排除项交给独立负面提示词。
    return [
        renderStyle === '写实道具'
            ? (isModernFirearm || isTacticalVest || isCrossbow
                ? 'photorealistic product photo of a single modern survival inventory item, centered on a plain neutral background, realistic materials and soft shadow'
                : isEnergyWeapon
                ? 'photorealistic product photo of a single sci-fi inventory weapon prop, centered on a plain neutral background, realistic materials and soft shadow'
                : 'photorealistic product photo of a single physical inventory item, centered on a plain neutral background, realistic materials and soft shadow')
            : (isModernFirearm || isTacticalVest || isCrossbow
                ? 'single modern survival inventory item asset on a plain neutral background, centered composition, clean silhouette'
                : isEnergyWeapon
                ? 'single sci-fi inventory weapon asset on a plain neutral background, centered composition, clean silhouette'
                : 'single inventory item asset on a plain neutral background, centered composition, clean silhouette'),
        获取渲染风格要求(renderStyle),
        style === '写实' ? (renderStyle === '写实道具' ? '' : 'photorealistic') : style,
        isFan ? 'strict Chinese hand fan prop only: folded or half-open fan, visible ribs and fan leaf, jade or bamboo frame, tassel, elegant accessory; no blade, no knife, no sword, no spear' : '',
        isModernFirearm ? 'strict modern firearm prop only: rifle or gun body with receiver, barrel, magazine, stock, grip and trigger guard; not a spear, not a polearm, not a sword' : '',
        isCrossbow ? 'strict crossbow prop only: horizontal bow limbs, stock, trigger, taut string and bolt rail; compact survival ranged weapon, not a spear, not a staff, not a firearm' : '',
        isEnergyWeapon ? 'strict sci-fi energy weapon prop only: futuristic hilt, emitter, barrel or energy core clearly visible, luminous energy edge or beam source, advanced-technology silhouette' : '',
        isClothShoe ? 'strict empty footwear prop only: two unworn sandals or cloth shoes side by side, product still life' : '',
        isBandageDressing ? 'strict bandage dressing prop only: standalone rolled gauze bandage or folded cloth strips, first-aid supply still life' : '',
        isCigarette ? 'strict cigarette pack prop only: opened damp cardboard cigarette pack, crumpled paper box, half-empty pack, visible bent cigarettes, stained soggy paper edges; not a pouch, not a leather bag, not a drawstring bag' : '',
        isPaleMoonWhiteGarment ? 'strict color requirement: moon-white pale ivory cloth, light warm white fabric, soft non-metal textile, bright clean garment surface' : '',
        isSectDiscipleUniform ? 'strict sect uniform garment: inner-disciple robe or training uniform, cloth collar, sash, woven trim, folded or laid flat as clothing' : '',
        isAncientMedicine ? 'strict ancient wuxia medicine prop only: folded paper medicine packet, small cloth sachet, ceramic medicine vial, herbal powder or pills; absolutely pre-modern, no modern technology' : '',
        isModernMedicine ? 'strict medicine stabilizer prop only: one small unlabelled amber glass vial or ampoule kit, sealed cap, transparent liquid, compact blank medical case, no book, no label, no text' : '',
        isBotanicalHerb ? 'strict botanical herb or flower only: natural plant specimen, visible petals leaves roots or stems, organic plant anatomy, not a manufactured object' : '',
        isTalismanPaper ? 'strict talisman paper prop only: small stack of thin yellow paper sheets, visible handmade paper fiber, soft curled corners, red cinnabar abstract unreadable talisman strokes, not a plastic panel, not a blank rectangular board' : '',
        '',
        isTacticalVest ? 'strict wearable tactical vest item: fabric upper-body vest with MOLLE webbing, shoulder straps, front buckles or zipper, pouch panels, arm holes and waist hem; product photo of clothing-shaped protective gear, no shield' : '',
        isWearableArmor && !isTacticalVest ? 'strict wearable armor item: upper-body vest or cuirass garment shape, sleeveless torso armor with arm holes, shoulder straps, chest and back panels, waist hem; product photo of clothing-shaped protective gear' : '',
        构建物品视觉主体描述(item),
        softGarmentGuard,
        'plain neutral background, centered object, clear silhouette, product catalog lighting'
    ].filter(Boolean).join('\n');
};

// ── 弱主体检测 + AI 中译英兜底 ────────────────────────────────────────────
// 根因修复：当名称未命中英文映射表、材质描述为空、且无外形纠偏/特殊类目命中时，
// 规则主体退化为泛化兜底词（如 "a single 凡品 key item prop"）。此时正向里堆叠的
// "blank unlabeled surfaces / label-free / blank unmarked object surface / plain empty panels"
// 等无文字模板会占主导，模型缺少可锚定的具体物体，收敛成居中无标记的空白塑料板。
// 对策：① 弱主体时用文本模型把中文视觉描述译成英文物品外观短语，补回主体语义；
//        ② 弱主体时收敛无文字模板，避免空白约束压过主体。
export const 物品规则主体是否弱 = (item: any): boolean => {
    // 命中任一特殊类目或外形纠偏都自带强主体描述，不算弱主体。
    if (物品是否活体生物(item) || 物品是否坐骑生物(item) || 物品是否折扇(item)) return false;
    const 纠偏 = 获取物品外形纠偏类别(item);
    if (纠偏 && 纠偏 !== '无') return false;
    if (物品是否战术背心(item) || 物品是否香烟(item) || 物品是否布鞋(item)) return false;
    if (物品是否绷带敷料(item) || 物品是否柔性服装(item) || 物品是否可穿戴护甲(item)) return false;
    if (物品是否古代药物(item) || 物品是否现代药剂(item) || 物品是否草药植物(item)) return false;
    if (物品是否符纸符箓(item) || 物品是否武器(item)) return false;
    if (物品名称转英文描述(读取文本(item?.名称))) return false;
    if (构建物品描述材质提示(item)) return false;
    return true;
};

/**
 * 判断是否需要调用文本模型重写视觉主体。
 *
 * 修复前只有"弱主体"才走 AI 中译英，于是披风/斗笠这类命中"柔性服装"类目的物品
 * 会跳过重写，把 `描述` 原文（"李方文用野麻叶和粗麻绳穿扎固定而成的简易披风，
 * 能遮挡小雨，提供微弱的身体防护。"）整段塞进 prompt，模型照着简介生图。
 * 只要最终要进 prompt 的视觉描述仍是中文整句，就说明规则侧没有可用的英文主体锚点，
 * 必须交给模型重写成纯外观短语；重写失败时再退回已清洗过的中文描述。
 */
export const 物品主体需要AI重写 = (item: any): boolean => {
    const 视觉描述 = 读取文本(item?.视觉描述);
    if (视觉描述 && /[\u4e00-\u9fff]/.test(视觉描述)) return true;
    return 物品规则主体是否弱(item);
};

const 物品英文主体缓存 = new Map<string, string>();
export const 清洗物品英文主体 = (raw: string): string => {
    let text = (raw || '').replace(/\r/g, ' ').trim();
    // 去掉可能出现的引号包裹、Markdown 代码围栏、"English:" 前缀
    text = text.replace(/^```[a-zA-Z]*|```$/g, '').trim();
    text = text.replace(/^(english|answer|output|prompt|result|描述|英文)\s*[:：]\s*/i, '').trim();
    text = text.replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim();
    // 只保留首段（防止模型输出多行解释）
    const firstBlock = text.split(/\n{2,}/)[0].trim();
    text = firstBlock.split('\n').map((line) => line.trim()).filter(Boolean).join(', ');
    // 含中文说明整段舍弃，避免污染英文 prompt
    if (/[\u4e00-\u9fff]/.test(text)) return '';
    return text.slice(0, 400);
};

const 生成物品英文视觉主体 = async (
    item: any,
    apiConfig: 接口设置结构 | null | undefined,
    signal?: AbortSignal
): Promise<string> => {
    if (!apiConfig) return '';
    const name = 读取文本(item?.名称);
    // 视觉描述缺失时才回落到 `描述`，且必须走同一套清洗流程，
    // 否则"能遮挡小雨，提供微弱的身体防护"这类效果文案会一起被译成 prompt。
    const rawDesc = 读取文本(item?.视觉描述) || 构建物品视觉描述(item);
    if (!name && !rawDesc) return '';
    const cacheKey = `${name}|${rawDesc}`.slice(0, 200);
    const cached = 物品英文主体缓存.get(cacheKey);
    if (typeof cached === 'string') return cached;

    const textApi = 获取生图词组转化器接口配置(apiConfig as any) || 获取主剧情接口配置(apiConfig as any);
    if (!接口配置是否可用(textApi)) return '';

    const 类型 = 读取文本(item?.类型);
    const 品质 = 读取文本(item?.品质);
    const 视觉标签 = Array.isArray(item?.视觉标签)
        ? item.视觉标签.map((t: unknown) => 读取文本(t)).filter(Boolean).join('，')
        : '';
    const systemPrompt = [
        'You convert a Chinese game item into a concise English visual subject phrase for a product-photography image generator.',
        'Output ONLY the English phrase describing the physical object appearance: what it is, its shape, material, color and notable physical features.',
        'Rules: describe a single tangible physical object; keep it under 40 words; no game mechanics, no stats, no lore, no proper names.',
        'Ignore any clause about gameplay benefit, protection value, damage, cooldown, duration, drop source or who made or owned the item.',
        'If the source text mixes appearance with gameplay effects, keep only the appearance.',
        'Never include any text/label/logo/number to be drawn on the object. No Chinese characters. No quotes. No explanation. No preamble.',
        'If the item is a container holding something (bag/sack/pouch of grain, jar of pills), describe both the container and its visible contents.'
    ].join('\n');
    const taskPayload = {
        名称: name,
        类型: 类型,
        品质: 品质,
        视觉描述: rawDesc,
        视觉标签: 视觉标签
    };
    const messages = 规范化文本补全消息链([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Chinese item:\n${JSON.stringify(taskPayload, null, 2)}\n\nEnglish visual subject phrase:` }
    ], { 保留System: true, 合并同角色: false });

    try {
        const raw = await 请求模型文本(textApi, messages, {
            temperature: 0.4,
            signal,
            disableThinking: true,
            stripReasoning: true
        });
        const cleaned = 清洗物品英文主体(raw);
        物品英文主体缓存.set(cacheKey, cleaned);
        recordDiagnosticLog('info', '[物品生图链路] AI 中译英兜底主体', {
            itemName: name,
            hasResult: Boolean(cleaned),
            resultPreview: cleaned.slice(0, 120)
        });
        return cleaned;
    } catch (error) {
        recordDiagnosticLog('warn', '[物品生图链路] AI 中译英兜底失败', {
            itemName: name,
            error: error instanceof Error ? error.message : String(error)
        });
        物品英文主体缓存.set(cacheKey, '');
        return '';
    }
};


export const 生成物品图标 = async (
    item: 游戏物品,
    apiConfig: 接口设置结构,
    options?: 物品图标生成选项
): Promise<物品图标生成结果> => {
    // --- 图库复用拦截 ---
    // 注意：调用方必须传入 题材模式 和 创意工坊模块ID，否则跳过图库查询
    if (options?.题材模式 && options?.创意工坊模块ID) {
        try {
            const itemName = 提取图库物品名称(item);
            if (itemName) {
                const workshopModuleId = String(options.创意工坊模块ID || '').trim();
                const galleryEntry = await 查询图库工具(item, options.题材模式, workshopModuleId);
                if (galleryEntry?.assetId || galleryEntry?.imageUrl) {
                    recordDiagnosticLog('info', '[物品生图链路] 命中图库复用，跳过生图', {
                        itemName,
                        galleryId: galleryEntry.id,
                        hasAssetId: Boolean(galleryEntry.assetId),
                        hasImageUrl: Boolean(galleryEntry.imageUrl),
                    });
                    const imageRecord: 物品生图结果 = {
                        id: galleryEntry.id,
                        ...(galleryEntry.assetId
                            ? { 本地路径: 创建图片资源引用(galleryEntry.assetId) }
                            : { 图片URL: galleryEntry.imageUrl }),
                        生图词组: galleryEntry.prompt,
                        使用模型: 'gallery_reuse',
                        生成时间: galleryEntry.createdAt,
                        来源: 'gallery'
                    } as any;
                    return {
                        nextItem: { ...(item as any), 图片: galleryEntry.assetId ? 创建图片资源引用(galleryEntry.assetId) : galleryEntry.imageUrl } as 游戏物品,
                        imageRecord,
                        prompt: galleryEntry.prompt || '',
                        imageApi: null,
                    };
                }
            }
        } catch (galleryError: any) {
            recordDiagnosticLog('warn', '[物品生图链路] 图库查询失败，继续走生图流程', {
                error: galleryError?.message || String(galleryError),
            });
        }
    }

    const imageApi = 构建物品生图接口配置(options?.imageApi || 获取文生图接口配置(apiConfig));
    if (!接口配置是否可用(imageApi)) {
        throw new Error('请先在设置的"文生图"中配置可用接口，再生成物品图。');
    }

    const feature = apiConfig?.功能模型占位;
    const style = feature?.自动物品生图画风 || '写实';
    const renderStyle = feature?.自动物品生图渲染风格 || '写实道具';
    const size = 读取文本(options?.size || feature?.自动物品生图分辨率, '1024x1024') || '1024x1024';
    const sourceLocation = options?.sourceLocation || '背包';
    const structuredItem = 查找物品结构化定义(item);
    const 结构化生图描述 = 读取文本(structuredItem?.生图描述);
    const enrichedItem: 游戏物品 = {
        ...(item as any),
        ...(structuredItem ? {
            类型: (item as any)?.类型 || structuredItem.类型,
            品质: (item as any)?.品质 || structuredItem.品质,
            视觉标签: Array.from(new Set([
                ...(((item as any)?.视觉标签 && Array.isArray((item as any).视觉标签)) ? (item as any).视觉标签 : []),
                ...structuredItem.视觉标签
            ])),
        } : {}),
        视觉描述: 读取文本((item as any)?.视觉描述) || 构建物品视觉描述(item),
    };
    // 主体兜底分两种：① 规则映射无法产出明确英文主体（如“百斤灵谷”这类中文自由描述物品）；
    // ② 视觉描述仍是中文整句（如“简易披风：李方文用野麻叶和粗麻绳穿扎固定而成，能遮挡小雨，
    // 提供微弱的身体防护。”）。两者都必须交给文本模型重写成纯外观短语，
    // 否则中文简介会被原样塞进 prompt，模型照着简介而不是外观生图。
    // 结构化物品库自带 `生图描述` 时说明文案已是清洗过的外观描述，无需重写。
    let 物品主体已AI补强 = false;
    if (!结构化生图描述 && 物品主体需要AI重写(enrichedItem)) {
        const aiSubject = await 生成物品英文视觉主体(enrichedItem, apiConfig, options?.signal);
        if (aiSubject) {
            (enrichedItem as any).视觉描述 = aiSubject;
            (enrichedItem as any).视觉描述来源 = 'AI中译英兜底';
            物品主体已AI补强 = true;
        }
    }
    const enrichedItemIsSoftGarment = 物品是否柔性服装(enrichedItem);
    const enrichedItemIsLivingAnimal = 物品是否活体生物(enrichedItem);
    const enrichedItemIsLivingMount = 物品是否坐骑生物(enrichedItem);
    const enrichedItemShapeCorrection = 获取物品外形纠偏类别(enrichedItem);
    const enrichedItemIsModernFirearm = enrichedItemShapeCorrection === '现代枪械';
    const enrichedItemIsEnergyWeapon = enrichedItemShapeCorrection === '科幻能量武器';
    const enrichedItemIsQuiver = enrichedItemShapeCorrection === '装箭容器';
    const enrichedItemIsArrowAmmo = enrichedItemShapeCorrection === '箭矢弹药';
    const enrichedItemIsTacticalVest = 物品是否战术背心(enrichedItem);
    const enrichedItemIsWeapon = 物品是否武器(enrichedItem);
    const enrichedItemIsClothShoe = 物品是否布鞋(enrichedItem);
    const enrichedItemIsBandageDressing = 物品是否绷带敷料(enrichedItem);
    const enrichedItemIsAncientMedicine = 物品是否古代药物(enrichedItem);
    // 云端大模型（Grok/GPT）支持中文提示词且理解能力强，无需冗长英文描述
    const isChineseSupported = /grok|imagine|gpt|image/i.test(imageApi.model || '');
    // 弱主体且 AI 未能补强时，收敛无文字模板：去掉“空白面板/空白表面”这类会诱导塑料板的措辞，
    // 只保留基础的“无文字/无标签”约束，避免空白约束在缺乏主体锚点时占主导。
    const 主体仍然薄弱 = 物品主体需要AI重写(enrichedItem) && !物品主体已AI补强;
    const noTextGuard = 主体仍然薄弱
        ? 全局无文字正向提示词
        : 获取物品正向无文字约束(enrichedItem);
    // 云端大模型：直接用物品中文描述 + 画风约束
    // 本地/CNB 模型：用完整的英文描述堆砌（原有逻辑）
    const prompt = isChineseSupported
        ? (() => {
            const 结构化描述 = 结构化生图描述;
            // 兜底不能再用 `描述` 原文：那是一段带人名和数值收益的装备简介，
            // 必须走同一套清洗（剔效果从句、去制作者前缀、过机制文案过滤）。
            const 清洗后描述 = 构建物品视觉描述(enrichedItem) || '';
            const 视觉描述 = 读取文本(enrichedItem?.视觉描述) || '';
            const 主体描述 = 结构化描述 || 视觉描述 || 清洗后描述 || `${读取文本(enrichedItem?.名称)}，${读取文本(enrichedItem?.类型)}`;
            const 画风约束: Record<string, string> = {
                '写实': '写实风格', '卡通': '卡通风格', '水墨': '水墨画风格', '像素': '像素风格',
                '油画': '油画风格', '素描': '素描风格', '国风': '中国风', '赛博朋克': '赛博朋克风格',
            };
            const 画风 = 画风约束[style] || style || '写实风格';
            return `${主体描述}，${画风}，简约背景，物品居中展示`;
        })()
        : 构建物品图提示词(enrichedItem, {
            画风: style,
            渲染风格: renderStyle,
            来源位置: sourceLocation
        });
    const extraPrompt = 读取文本(options?.extraPrompt);
    const finalPrompt = extraPrompt
        ? (isChineseSupported ? `${prompt}，${extraPrompt}` : `${prompt}\n\nuser requested extra visual direction:\n${extraPrompt}`)
        : prompt;
    const recordId = options?.recordId || `item_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    recordDiagnosticLog('info', '[物品生图链路] 准备调用图片后端', {
        recordId,
        itemId: (item as any)?.ID || '',
        itemName: (item as any)?.名称 || '未命名物品',
        itemType: (item as any)?.类型 || '',
        itemQuality: (item as any)?.品质 || '',
        source: options?.source || 'manual',
        sourceLocation,
        backendType: imageApi.图片后端类型 || '',
        model: imageApi.model || '',
        size,
        promptLength: finalPrompt.length,
        hasExtraPrompt: Boolean(extraPrompt),
        renderStyle
    });
    // 云端大模型：不塞额外提示词（模型理解能力强，物品中文描述已足够）
    // 本地/CNB 模型：用完整的英文描述堆砌（原有逻辑）
    const 附加正向 = isChineseSupported
        ? ''
        : `${enrichedItemIsLivingMount
            ? 'real living animal, alive mount, full body animal portrait, natural fur, organic anatomy, standing on real ground, no toy, no statue'
            : enrichedItemIsLivingAnimal
            ? 'real living animal, alive pet or beast, full body animal portrait, natural fur or feathers, organic anatomy, natural posture on real ground, not a plush toy, not a figurine, not a doll, photorealistic animal photo'
            : enrichedItemIsModernFirearm
            ? 'single physical modern firearm prop, receiver, barrel, magazine, stock, grip and trigger guard clearly visible, not a spear, photorealistic product photo, neutral matte studio background'
            : enrichedItemIsEnergyWeapon
            ? 'single physical sci-fi energy weapon prop, futuristic hilt, emitter, barrel or energy core clearly visible, luminous energy edge or beam source, advanced-technology silhouette, photorealistic product photo, neutral matte studio background'
            : enrichedItemIsQuiver
            ? 'single physical quiver or arrow case, strap and opening clearly visible, feathered arrow ends visible, carrying container prop, photorealistic product photo, neutral matte studio background'
            : enrichedItemIsArrowAmmo
            ? 'single grouped arrow ammunition prop, shafts fletching and arrowheads clearly visible, not a bow, photorealistic product photo, neutral matte studio background'
            : enrichedItemIsTacticalVest
            ? 'single wearable tactical vest prop, MOLLE webbing, shoulder straps, front buckles, pouch panels, fabric torso gear, no shield, photorealistic product photo, neutral matte studio background'
            : enrichedItemIsWeapon
            ? 'single physical weapon prop, defining blade, striking head, bow limbs, shaft, hilt, scabbard or handle clearly visible according to the object type, no plant as main subject, photorealistic product photo, neutral matte studio background'
            : enrichedItemIsClothShoe
            ? 'single pair of empty cloth shoes or straw sandals, footwear prop, side by side, unworn product still life, photorealistic product photo, neutral matte studio background'
            : enrichedItemIsBandageDressing
            ? 'rolled gauze bandage and folded white cloth dressing, standalone first-aid supply still life, photorealistic product photo, neutral matte studio background'
            : !enrichedItemIsAncientMedicine && !物品是否现代药剂(enrichedItem) && 物品是否草药植物(enrichedItem)
            ? 'botanical medicinal herb specimen, natural plant anatomy, petals leaves roots or stems, single organic flower or herb, pre-modern wuxia material, photorealistic product photo, neutral matte studio background'
            : enrichedItemIsAncientMedicine
            ? 'ancient Chinese medicine prop, folded paper medicine packet, ceramic medicine vial, herbal powder or pills, pre-modern wuxia era, single physical object, photorealistic product photo, neutral matte studio background'
            : 物品是否现代药剂(enrichedItem)
            ? 'single small unlabelled amber glass medicine vial or ampoule kit, sealed stabilizer serum bottle, blank cap, no label, no text, not a book, photorealistic product photo, neutral matte studio background'
            : renderStyle === '写实道具'
            ? `single physical ${enrichedItemIsModernFirearm || enrichedItemIsTacticalVest ? 'modern survival' : 'non-modern'} inventory item, photorealistic product photo, centered product composition, neutral matte studio background, clean silhouette, realistic material${enrichedItemIsSoftGarment ? ', soft fabric garment, cloth folds, flexible drape' : ''}`
            : 'single physical object, centered composition, clean silhouette, plain asset presentation'}; ${noTextGuard}`;
    const 附加负面提示词 = isChineseSupported ? '' : 构建物品负面提示词(enrichedItem);
    const rawResult = await generateImageByPrompt(finalPrompt, imageApi, options?.signal, {
        构图: '物品图标',
        尺寸: size,
        附加正向提示词: 附加正向,
        附加负面提示词: 附加负面提示词,
        跳过基础负面提示词: isChineseSupported ? true : undefined,
        随机种子生成: feature?.随机种子生成 !== false,
    });
    recordDiagnosticLog('info', '[物品生图链路] 图片后端已返回', {
        recordId,
        itemName: (item as any)?.名称 || '未命名物品',
        hasImageUrl: Boolean(rawResult?.图片URL),
        imageUrlPrefix: typeof rawResult?.图片URL === 'string' ? rawResult.图片URL.slice(0, 80) : '',
        hasLocalPath: Boolean(rawResult?.本地路径),
        localPathPrefix: typeof rawResult?.本地路径 === 'string' ? rawResult.本地路径.slice(0, 80) : '',
        hasFinalPositivePrompt: Boolean(rawResult?.最终正向提示词),
        promptPrefix: finalPrompt.slice(0, 120),
        backendType: imageApi.图片后端类型 || 'unknown',
        model: imageApi.model || ''
    });
    let localResult: any;
    try {
        localResult = await persistImageAssetLocally(rawResult);
    } catch (persistError: any) {
        recordDiagnosticLog('error', '[物品生图链路] 图片本地化异常！图片数据丢失', {
            recordId,
            itemName: (item as any)?.名称 || '未命名物品',
            errorMessage: persistError?.message || String(persistError),
            rawHasUrl: Boolean(rawResult?.图片URL),
            rawHasPath: Boolean(rawResult?.本地路径)
        });
        throw persistError;
    }
    recordDiagnosticLog('info', '[物品生图链路] 图片资源本地化完成', {
        recordId,
        itemName: (item as any)?.名称 || '未命名物品',
        hasImageUrl: Boolean(localResult?.图片URL),
        imageUrlPrefix: typeof localResult?.图片URL === 'string' ? localResult.图片URL.slice(0, 80) : '',
        hasLocalPath: Boolean(localResult?.本地路径),
        localPathPrefix: typeof localResult?.本地路径 === 'string' ? localResult.本地路径.slice(0, 80) : '',
        displayable: Boolean(localResult?.图片URL || localResult?.本地路径)
    });
    const imageRecord: 物品生图结果 = {
        id: recordId,
        图片URL: localResult.图片URL,
        本地路径: localResult.本地路径,
        生图词组: finalPrompt,
        最终正向提示词: localResult.最终正向提示词,
        最终负向提示词: localResult.最终负向提示词,
        原始描述: JSON.stringify(enrichedItem, null, 2),
        使用模型: ((): string => {
            switch (imageApi.图片后端类型) {
                case 'comfyui': return 'ComfyUI';
                case 'sd_webui': return 'Stable Diffusion WebUI';
                case 'novelai': case 'openai': default: return (imageApi.model || '').trim() || '图片模型';
            }
        })(),
        生成时间: Date.now(),
        构图: '物品图标',
        画风: style as 物品生图结果['画风'],
        渲染风格: renderStyle as 物品生图结果['渲染风格'],
        尺寸: size,
        状态: 'success',
        来源: 'generated',
        调试链路: rawResult.调试链路,
    };
    const nextArchive = 合并物品图片档案(enrichedItem, imageRecord);
    recordDiagnosticLog('info', '[物品生图链路] 图片记录已合并入物品档案', {
        recordId,
        itemId: (item as any)?.ID || '',
        itemName: (item as any)?.名称 || '未命名物品',
        selectedIconId: nextArchive?.已选图标图片ID || '',
        historyCount: Array.isArray(nextArchive?.生图历史) ? nextArchive.生图历史.length : 0,
        recentId: nextArchive?.最近生图结果?.id || '',
        hasRecentImageUrl: Boolean(nextArchive?.最近生图结果?.图片URL),
        hasRecentLocalPath: Boolean(nextArchive?.最近生图结果?.本地路径)
    });
    const nextItem: 游戏物品 = {
        ...(enrichedItem as any),
        视觉描述来源: (enrichedItem as any).视觉描述来源 || '规则生成',
        图片档案: nextArchive,
    };

    return { nextItem, imageRecord, prompt, imageApi };
};
