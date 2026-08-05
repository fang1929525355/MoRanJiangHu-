import type { 小说拆分数据集结构, 小说拆分分段结构 } from '../types';

const 广义跨世界关键词正则 = /(异世界|平行世界|不同世界|跨世界|进入.+世界|穿越|时间流速|流速|相隔|间隔|世界线)/u;
const 无限流关键词正则 = /(无限流|无限恐怖|主神|轮回者|轮回小队|轮回空间|轮回任务|副本|任务世界|剧情世界|奖励点|支线剧情|基因锁|兑换强化|回归倒计时)/u;
const 否定无限流证据正则 = /(?:(?:没有|不存在|并非|不是|不属于|不含|未出现|不得出现|禁止出现|禁止使用)(?:[^。！？；;，,]{0,24})?(无限流|主神|轮回者|轮回小队|轮回空间|副本|任务世界|剧情世界|奖励点|支线剧情|基因锁|兑换强化)|无(?:主神|轮回者|轮回小队|轮回空间|副本|任务世界|剧情世界|奖励点|支线剧情|基因锁|兑换强化)|非(?:无限流|主神|轮回者|轮回小队|轮回空间|副本|任务世界|剧情世界|奖励点|支线剧情|基因锁|兑换强化))/u;
const 时间关键词正则 = /(时间|年代|纪年|历法|时代|年份|相隔|间隔|流速|过去|未来|回归|进入|离开|江户|现代|古代|Z市|年|月|日)/iu;

const 读取文本 = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const 去重文本列表 = (items: string[], maxCount = 24): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of items) {
        const normalized = 读取文本(raw).replace(/\s+/g, ' ');
        if (!normalized || normalized === '无') continue;
        const key = normalized.replace(/\s+/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
        if (result.length >= maxCount) break;
    }
    return result;
};

const 可见条目内容 = (items: 小说拆分分段结构['原著硬约束']): string[] => (
    (Array.isArray(items) ? items : [])
        .map((item) => 读取文本(item?.内容))
        .filter(Boolean)
);

const 事件文本 = (segment: 小说拆分分段结构): string[] => (
    (Array.isArray(segment.关键事件) ? segment.关键事件 : []).flatMap((event) => [
        event.事件名,
        event.事件说明,
        event.开始时间,
        event.结束时间,
        ...(Array.isArray(event.前置条件) ? event.前置条件 : []),
        ...(Array.isArray(event.触发条件) ? event.触发条件 : []),
        ...(Array.isArray(event.阻断条件) ? event.阻断条件 : []),
        ...(Array.isArray(event.事件结果) ? event.事件结果 : []),
        ...(Array.isArray(event.对下一组影响) ? event.对下一组影响 : [])
    ].map(读取文本).filter(Boolean))
);

const 收集候选文本 = (dataset: 小说拆分数据集结构): string[] => {
    const segments = Array.isArray(dataset.分段列表) ? dataset.分段列表 : [];
    return 去重文本列表([
        dataset.标题,
        dataset.作品名,
        dataset.原始文本摘要,
        dataset.当前阶段概括,
        ...(Array.isArray(dataset.世界观规则) ? dataset.世界观规则 : []),
        ...(Array.isArray(dataset.世界边界规则) ? dataset.世界边界规则 : []),
        ...(Array.isArray(dataset.章节节奏) ? dataset.章节节奏 : []),
        ...segments.flatMap((segment) => [
            segment.标题,
            segment.章节范围,
            segment.本组概括,
            segment.时间线起点,
            segment.时间线终点,
            ...(Array.isArray(segment.开局已成立事实) ? segment.开局已成立事实 : []),
            ...(Array.isArray(segment.前组延续事实) ? segment.前组延续事实 : []),
            ...(Array.isArray(segment.本组结束状态) ? segment.本组结束状态 : []),
            ...(Array.isArray(segment.给下一组参考) ? segment.给下一组参考 : []),
            ...(Array.isArray(segment.世界观规则) ? segment.世界观规则 : []),
            ...(Array.isArray(segment.世界边界规则) ? segment.世界边界规则 : []),
            ...可见条目内容(segment.原著硬约束),
            ...可见条目内容(segment.可提前铺垫),
            ...事件文本(segment)
        ])
    ], 120);
};

const 是有效无限流证据 = (line: string): boolean => (
    无限流关键词正则.test(line) && !否定无限流证据正则.test(line)
);

export const 小说拆分疑似无限流题材 = (dataset: 小说拆分数据集结构): boolean => (
    收集候选文本(dataset).some(是有效无限流证据)
);

export const 小说拆分疑似跨世界题材 = (dataset: 小说拆分数据集结构): boolean => (
    收集候选文本(dataset).some((line) => 广义跨世界关键词正则.test(line) || 是有效无限流证据(line))
);

export const 构建小说拆分跨世界时间线规则 = (dataset: 小说拆分数据集结构): string[] => {
    const candidates = 收集候选文本(dataset);
    const evidence = candidates
        .filter((line) => (广义跨世界关键词正则.test(line) || 是有效无限流证据(line)) && 时间关键词正则.test(line))
        .slice(0, 12);
    const hasCrossWorld = evidence.length > 0;
    if (!hasCrossWorld) return [];

    return 去重文本列表([
        '跨世界时间线硬约束：章节距离不等于世界内时间距离；不得因为两段原文相邻，就把不同世界或同一外部世界两次进入之间的原著间隔压缩。',
        '必须分开记录主世界时间、外部世界本地时间、进入/离开世界事件与两次进入同一世界之间的本地间隔；原文写明“相隔200年”时必须按200年处理，不得改写成一个月或数日。',
        '不同世界可以拥有不同时间流速；没有原文证据时，只能保守标注“流速未知”，不能自动套用主世界时间推进。',
        '时代标签必须跟随对应世界本地时间线：江户、现代Z市、灾变后、古代王朝等不得无依据叠加到同一时刻或同一地点。',
        '势力、角色、城市与社会制度必须受世界本地时代约束；相隔数十年或数百年的势力不得同时出场，除非原文明确说明融合、穿越、沉睡、长生或时间异常。',
        ...evidence.map((line) => `原著时间线证据：${line}`)
    ], 18);
};
