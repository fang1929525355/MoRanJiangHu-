import * as textAIService from './ai/text';
import type {
    小说拆分数据集结构,
    小说拆分分段结构,
    小说拆分树节点结构,
    小说拆分章节结构,
    小说拆分注入目标类型,
    小说拆分时间线事件结构
} from '../types';
import type { 当前可用接口结构 } from '../utils/apiConfig';
import { 过滤疑似目录章节, 重排章节序号, 规范化标题, 识别TXT章节标题行 } from './novelStructureHeuristics';
import { 增加小说时间线天数, 默认小说时间线起点, 尝试规范化小说时间锚点, 规范化小说时间锚点, 小说时间锚点转分钟序数 } from './novelDecompositionTime';
import { 构建小说拆分跨世界时间线规则 } from './novelDecompositionTimelineConstraints';

const 时间锚点格式正则 = /^\d{4,6}:\d{2}:\d{2}:\d{2}:\d{2}$/;
const 读取文本 = (value: unknown): string => (typeof value === 'string' ? value : '');
const 去空白 = (value: string): string => value.replace(/\r\n/g, '\n').replace(/\uFEFF/g, '').trim();
const 生成ID = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const 修复明确跨午夜时间 = (candidate: string, reference?: string): string => {
    if (!时间锚点格式正则.test(candidate) || !reference || !时间锚点格式正则.test(reference)) return candidate;
    const candidateParts = candidate.split(':').map(Number);
    const referenceParts = reference.split(':').map(Number);
    const sameDate = candidateParts[0] === referenceParts[0]
        && candidateParts[1] === referenceParts[1]
        && candidateParts[2] === referenceParts[2];
    const candidateMinutes = 小说时间锚点转分钟序数(candidate);
    const referenceMinutes = 小说时间锚点转分钟序数(reference);
    if (
        sameDate
        && referenceParts[3] >= 18
        && candidateParts[3] <= 12
        && candidateMinutes !== null
        && referenceMinutes !== null
        && candidateMinutes < referenceMinutes
    ) {
        return 增加小说时间线天数(candidate, 1);
    }
    return candidate;
};
const 规范化信息可见性 = (value: any) => ({
    谁知道: 去重文本列表(Array.isArray(value?.谁知道) ? value.谁知道 : [], 12),
    谁不知道: 去重文本列表(Array.isArray(value?.谁不知道) ? value.谁不知道 : [], 12),
    是否仅读者视角可见: value?.是否仅读者视角可见 === true
});

const 从内容恢复信息可见性 = (value: unknown): {
    内容: string;
    信息可见性: ReturnType<typeof 规范化信息可见性>;
    已识别读者视角: boolean;
} => {
    const raw = 读取文本(value).trim();
    const labelPattern = /(?:谁知道|谁不知道|是否仅读者视角可见)\s*[:：]/gu;
    const firstLabel = labelPattern.exec(raw);
    if (!firstLabel) {
        return {
            内容: raw,
            信息可见性: 规范化信息可见性(undefined),
            已识别读者视角: false
        };
    }

    const 读取字段 = (label: string): string => {
        const match = raw.match(new RegExp(`${label}\\s*[:：]\\s*([^/\\n）)]*)`, 'u'));
        return match?.[1]?.trim() || '';
    };
    const 拆分人员 = (text: string): string[] => 去重文本列表(
        text.split(/[、，,；;]/u).map((item) => item.trim()).filter(Boolean),
        12
    );
    const readerOnlyText = 读取字段('是否仅读者视角可见');

    return {
        内容: raw.slice(0, firstLabel.index).replace(/[\\/\s（(]+$/u, '').trim(),
        信息可见性: {
            谁知道: 拆分人员(读取字段('谁知道')),
            谁不知道: 拆分人员(读取字段('谁不知道')),
            是否仅读者视角可见: /^(?:是|true)$/iu.test(readerOnlyText)
        },
        已识别读者视角: /^(?:是|否|true|false)$/iu.test(readerOnlyText)
    };
};

const 合并信息可见性 = (
    left: 小说拆分分段结构['关键事件'][number]['信息可见性'],
    right: 小说拆分分段结构['关键事件'][number]['信息可见性']
) => ({
    谁知道: 去重文本列表([...(left?.谁知道 || []), ...(right?.谁知道 || [])], 12),
    谁不知道: 去重文本列表([...(left?.谁不知道 || []), ...(right?.谁不知道 || [])], 12),
    是否仅读者视角可见: left?.是否仅读者视角可见 === true || right?.是否仅读者视角可见 === true
});

const 规范化可见信息条目 = (value: any): 小说拆分分段结构['原著硬约束'][number] => {
    const recovered = 从内容恢复信息可见性(value?.内容);
    const structured = 规范化信息可见性(value?.信息可见性);
    const hasStructuredReaderOnly = typeof value?.信息可见性?.是否仅读者视角可见 === 'boolean';
    return {
        内容: 清理章节编号文本(recovered.内容),
        信息可见性: {
            谁知道: structured.谁知道.length > 0 ? structured.谁知道 : recovered.信息可见性.谁知道,
            谁不知道: structured.谁不知道.length > 0 ? structured.谁不知道 : recovered.信息可见性.谁不知道,
            是否仅读者视角可见: hasStructuredReaderOnly
                ? structured.是否仅读者视角可见
                : recovered.已识别读者视角 && recovered.信息可见性.是否仅读者视角可见
        }
    };
};

const 去重可见信息条目 = (
    items: 小说拆分分段结构['原著硬约束'],
    maxCount?: number
): 小说拆分分段结构['原著硬约束'] => {
    const ordered: 小说拆分分段结构['原著硬约束'] = [];
    const indexMap = new Map<string, number>();

    for (const raw of Array.isArray(items) ? items : []) {
        const item = 规范化可见信息条目(raw);
        if (!item.内容) continue;
        const key = item.内容.replace(/\s+/g, '');
        const existingIndex = indexMap.get(key);
        if (typeof existingIndex === 'number') {
            ordered[existingIndex] = {
                ...ordered[existingIndex],
                信息可见性: 合并信息可见性(ordered[existingIndex].信息可见性, item.信息可见性)
            };
            continue;
        }
        indexMap.set(key, ordered.length);
        ordered.push(item);
        if (typeof maxCount === 'number' && ordered.length >= maxCount) break;
    }

    return ordered;
};

const 构建信息可见性行 = (value: any): string[] => {
    const normalized = 规范化信息可见性(value);
    const lines = [`是否仅读者视角可见：${normalized.是否仅读者视角可见 ? '是' : '否'}`];
    if (normalized.谁知道.length > 0) lines.unshift(`谁知道：${normalized.谁知道.join('、')}`);
    if (normalized.谁不知道.length > 0) lines.splice(lines.length - 1, 0, `谁不知道：${normalized.谁不知道.join('、')}`);
    return lines;
};

const 格式化信息可见性摘要 = (value: any): string => {
    const normalized = 规范化信息可见性(value);
    const parts: string[] = [];
    if (normalized.谁知道.length > 0) parts.push(`谁知道:${normalized.谁知道.join('、')}`);
    if (normalized.谁不知道.length > 0) parts.push(`谁不知道:${normalized.谁不知道.join('、')}`);
    if (normalized.是否仅读者视角可见) parts.push('仅读者视角');
    return parts.length > 0 ? `可见性:${parts.join('｜')}` : '';
};

const 格式化可见信息条目摘要 = (item: 小说拆分分段结构['原著硬约束'][number]): string => {
    const normalized = 规范化可见信息条目(item);
    const visibility = 格式化信息可见性摘要(normalized.信息可见性);
    return [normalized.内容, visibility].filter(Boolean).join('｜');
};
const 合成层级章节标题 = (卷标题: string, 章节标题: string): string => {
    const volume = 读取文本(卷标题).trim();
    const chapter = 读取文本(章节标题).trim();
    if (!chapter) return volume;
    if (!volume) return chapter;
    if (chapter === volume || chapter.startsWith(`${volume}｜`) || chapter.includes(volume)) return chapter;
    return `${volume}｜${chapter}`;
};

const 清理章节编号文本 = (value: string): string => 去空白(value)
    .replace(/【\s*第[0-9零一二三四五六七八九十百千万两〇○]+[章节回卷部篇集][^】]*】/gu, '')
    .replace(/^第[0-9零一二三四五六七八九十百千万两〇○]+[章节回卷部篇集]\s*/gmu, '')
    .replace(/\s+/g, ' ')
    .trim();

const 清理章节范围文本 = (value: string): string => 去空白(value)
    .replace(/^【\s*(.*?)\s*】$/u, '$1')
    .replace(/\s*[-~～—]+\s*/gu, '-')
    .replace(/\s+/g, ' ')
    .trim();

const 分段落 = (text: string): string[] => 去空白(text)
    .split(/\n\s*\n+/)
    .map((item) => 清理章节编号文本(item))
    .filter(Boolean);

const 取完整句摘要 = (items: string[], maxLength: number): string => {
    const result: string[] = [];
    let length = 0;
    for (const item of items) {
        const normalized = 清理章节编号文本(item);
        if (!normalized) continue;
        const nextLength = length + normalized.length + (result.length > 0 ? 1 : 0);
        if (result.length > 0 && nextLength > maxLength) break;
        result.push(normalized);
        length = nextLength;
        if (length >= maxLength) break;
    }
    return result.join('；');
};

const 去重文本列表 = (items: string[], maxCount?: number): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of items) {
        const normalized = 清理章节编号文本(raw);
        if (!normalized) continue;
        const key = normalized.replace(/\s+/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
        if (typeof maxCount === 'number' && result.length >= maxCount) break;
    }
    return result;
};

const 规范化章节概括文本 = (value: unknown): string => {
    const source = 读取文本(value).replace(/\r\n/g, '\n').trim();
    if (!source || /^无$/i.test(source)) return '';
    return source
        .split('\n')
        .map((line) => line.trim().replace(/[^\S\r\n]+/g, ' '))
        .filter(Boolean)
        .join('\n')
        .trim();
};

const 压缩章节概括为摘要 = (value: unknown): string => {
    const source = 读取文本(value).replace(/\r\n/g, '\n').trim();
    if (!source || /^无$/i.test(source)) return '';
    return source
        .split('\n')
        .map((line) => line.trim().replace(/[^\S\r\n]+/g, ' '))
        .map((line) => 清理章节编号文本(line))
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const 构建分段时间线 = (params: {
    标题: string;
    关键事件: 小说拆分分段结构['关键事件'];
    referenceStart: string;
}): 小说拆分时间线事件结构[] => {
    const candidates: Array<{
        标题: string;
        原始时间: string;
        描述: string;
        涉及角色: string[];
        order: number;
    }> = [];

    params.关键事件.forEach((event, index) => {
        candidates.push({
            标题: 清理章节编号文本(event.事件名 || '') || `关键事件 ${index + 1}`,
            原始时间: 读取文本(event.开始时间).trim()
                || 读取文本(event.最早开始时间).trim()
                || 读取文本(event.最迟开始时间).trim()
                || 读取文本(event.结束时间).trim(),
            描述: 去重文本列表([
                event.事件说明,
                ...(Array.isArray(event.事件结果) ? event.事件结果 : [])
            ]).join('；'),
            涉及角色: [],
            order: index
        });
    });

    const normalized: 小说拆分时间线事件结构[] = [];
    let 最近已知时间 = params.referenceStart;
    candidates
        .sort((a, b) => a.order - b.order)
        .forEach((item, index) => {
            const rawAnchor = item.原始时间 || '';
            const anchor = 尝试规范化小说时间锚点(
                rawAnchor,
                最近已知时间 || params.referenceStart,
                最近已知时间 || params.referenceStart
            );
            if (!anchor) return;
            最近已知时间 = anchor;
            const event: 小说拆分时间线事件结构 = {
                标题: 清理章节编号文本(item.标题 || '') || `事件 ${index + 1}`,
                时间锚点: anchor,
                描述: 清理章节编号文本(item.描述 || ''),
                涉及角色: 去重文本列表(item.涉及角色 || [], 12)
            };
            if (event.标题 || event.描述) {
                normalized.push(event);
            }
        });

    return normalized;
};

const 选择有效小说时间锚点 = (...values: string[]): string => (
    values
        .map((value) => 读取文本(value).trim())
        .find((value) => 时间锚点格式正则.test(value)) || ''
);

const 比较小说时间锚点 = (left: string, right: string): number => {
    const leftMinutes = 小说时间锚点转分钟序数(left);
    const rightMinutes = 小说时间锚点转分钟序数(right);
    if (leftMinutes === null || rightMinutes === null) {
        return left.localeCompare(right);
    }
    return leftMinutes - rightMinutes;
};

const 小说时间早于 = (left: string, right: string): boolean => 比较小说时间锚点(left, right) < 0;
const 小说时间晚于 = (left: string, right: string): boolean => 比较小说时间锚点(left, right) > 0;

const 补齐关键事件时间字段 = (
    event: 小说拆分分段结构['关键事件'][number],
    fallback: {
        本组时间线起点: string;
        本组时间线终点: string;
        上一事件时间参考: string;
        默认时间参考: string;
    }
): 小说拆分分段结构['关键事件'][number] => {
    const 开始时间 = 选择有效小说时间锚点(
        event.开始时间,
        event.最早开始时间,
        event.最迟开始时间,
        event.结束时间,
        fallback.上一事件时间参考,
        fallback.本组时间线起点,
        fallback.默认时间参考
    );
    const 最早开始时间 = 选择有效小说时间锚点(
        event.最早开始时间,
        event.开始时间,
        开始时间
    );
    const 最迟开始时间 = 选择有效小说时间锚点(
        event.最迟开始时间,
        event.开始时间,
        最早开始时间,
        开始时间
    );
    const 结束时间 = 选择有效小说时间锚点(
        event.结束时间,
        event.最迟开始时间,
        event.开始时间,
        最迟开始时间,
        开始时间,
        fallback.本组时间线终点
    );

    return {
        ...event,
        开始时间,
        最早开始时间,
        最迟开始时间,
        结束时间
    };
};

const 合成阶段概括 = (
    segments: 小说拆分分段结构[],
    mode: 'stage'
): string => {
    const source = segments.slice(-3);
    if (source.length <= 0) return '';

    const summaries = 去重文本列表(source.flatMap((segment) => (
        segment.本组概括
            ? [segment.本组概括]
            : [segment.原文摘要 || segment.标题]
    )), 4);
    const endStates = 去重文本列表(source.flatMap((segment) => segment.本组结束状态 || []), 4);
    const hardConstraints = 去重文本列表(
        source.flatMap((segment) => (segment.原著硬约束 || []).map((item) => item.内容)),
        4
    );
    const parts: string[] = [];

    if (summaries[0]) {
        parts.push(`当前阶段主要推进为${summaries[0]}`);
    }
    if (summaries[summaries.length - 1] && summaries.length > 1) {
        parts.push(`最近停在${summaries[summaries.length - 1]}`);
    }
    if (endStates.length > 0) parts.push(`已落定状态包括${endStates.slice(0, 2).join('、')}`);
    if (hardConstraints.length > 0) parts.push(`仍需遵守的原著边界有${hardConstraints.slice(0, 2).join('、')}`);
    return 取完整句摘要(parts, 220);
};

const 统计核心角色 = (segments: 小说拆分分段结构[]): Array<[string, number]> => {
    const counter = new Map<string, number>();
    segments.forEach((segment) => {
        const names = new Set<string>([
            ...(Array.isArray(segment.登场角色) ? segment.登场角色 : []),
            ...(Array.isArray(segment.角色推进) ? segment.角色推进.map((item) => item.角色名) : [])
        ].filter(Boolean));
        names.forEach((name) => {
            counter.set(name, (counter.get(name) || 0) + 1);
        });
    });
    return Array.from(counter.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
        .slice(0, 8);
};

const 合并同名结构 = <T extends { 名称: string }>(
    items: T[],
    merge: (left: T, right: T) => T
): T[] => {
    const ordered: T[] = [];
    const indexMap = new Map<string, number>();
    items.forEach((item) => {
        const name = (item?.名称 || '').trim();
        if (!name) return;
        const key = name.replace(/\s+/g, '');
        const existingIndex = indexMap.get(key);
        if (typeof existingIndex === 'number') {
            ordered[existingIndex] = merge(ordered[existingIndex], item);
            return;
        }
        indexMap.set(key, ordered.length);
        ordered.push(item);
    });
    return ordered;
};

const 聚合角色档案 = (segments: 小说拆分分段结构[]): 小说拆分数据集结构['角色档案'] => (
    合并同名结构(
        segments.flatMap((segment) => segment.角色档案 || []),
        (left, right) => ({
            ...left,
            身份: left.身份 || right.身份,
            所属势力: left.所属势力 || right.所属势力,
            初始立场: left.初始立场 || right.初始立场,
            关系摘要: 去重文本列表([...(left.关系摘要 || []), ...(right.关系摘要 || [])], 20),
            状态摘要: 去重文本列表([...(left.状态摘要 || []), ...(right.状态摘要 || [])], 20),
            首次出现: left.首次出现 || right.首次出现,
            重要性: left.重要性 === '核心' || right.重要性 === '核心'
                ? '核心'
                : left.重要性 === '重要' || right.重要性 === '重要'
                    ? '重要'
                    : '一般'
        })
    ).slice(0, 120)
);

const 聚合势力档案 = (segments: 小说拆分分段结构[]): 小说拆分数据集结构['势力档案'] => (
    合并同名结构(
        segments.flatMap((segment) => segment.势力档案 || []),
        (left, right) => ({
            ...left,
            类型: left.类型 || right.类型,
            地盘: left.地盘 || right.地盘,
            代表人物: 去重文本列表([...(left.代表人物 || []), ...(right.代表人物 || [])], 20),
            立场目标: left.立场目标 || right.立场目标,
            当前状态: right.当前状态 || left.当前状态,
            关系摘要: 去重文本列表([...(left.关系摘要 || []), ...(right.关系摘要 || [])], 20),
            首次出现: left.首次出现 || right.首次出现
        })
    ).slice(0, 80)
);

const 聚合地图地点档案 = (segments: 小说拆分分段结构[]): 小说拆分数据集结构['地图地点档案'] => (
    合并同名结构(
        segments.flatMap((segment) => segment.地图地点档案 || []),
        (left, right) => ({
            ...left,
            层级: left.层级 !== '未知' ? left.层级 : right.层级,
            上级地点: left.上级地点 || right.上级地点,
            所属势力: left.所属势力 || right.所属势力,
            地貌功能: left.地貌功能 || right.地貌功能,
            关键设施: 去重文本列表([...(left.关键设施 || []), ...(right.关键设施 || [])], 20),
            首次出现: left.首次出现 || right.首次出现
        })
    ).slice(0, 120)
);

const 聚合物品档案 = (segments: 小说拆分分段结构[]): 小说拆分数据集结构['物品档案'] => (
    合并同名结构(
        segments.flatMap((segment) => segment.物品档案 || []),
        (left, right) => ({
            ...left,
            类型: left.类型 || right.类型,
            用途: left.用途 || right.用途,
            所属人物: left.所属人物 || right.所属人物,
            所属势力: left.所属势力 || right.所属势力,
            首次出现: left.首次出现 || right.首次出现
        })
    ).slice(0, 120)
);

const 聚合文本列表字段 = (
    segments: 小说拆分分段结构[],
    selector: (segment: 小说拆分分段结构) => string[]
): string[] => 去重文本列表(segments.flatMap((segment) => selector(segment) || []), 40);

const 构建树节点 = (params: {
    datasetId: string;
    title: string;
    content?: string;
    type: 小说拆分树节点结构['类型'];
    order: number;
    targets: 小说拆分注入目标类型[];
    parentId?: string;
    relatedSegmentIds?: string[];
    children?: 小说拆分树节点结构[];
}): 小说拆分树节点结构 => ({
    id: 生成ID('novel_node'),
    数据集ID: params.datasetId,
    父节点ID: params.parentId,
    类型: params.type,
    标题: params.title,
    内容: params.content || '',
    目标链路: params.targets,
    关联分段ID列表: params.relatedSegmentIds || [],
    排序: params.order,
    子节点: params.children || []
});

export const 从原始文本提取章节 = (dataset: 小说拆分数据集结构): 小说拆分章节结构[] => {
    const rawText = 去空白(dataset.原始文本 || '');
    if (!rawText) return [];

    const lines = rawText.split('\n');
    const result: 小说拆分章节结构[] = [];
    let currentTitle = '';
    let currentVolumeTitle = '';
    let buffer: string[] = [];
    const now = Date.now();

    const pushCurrent = () => {
        const content = 去空白(buffer.join('\n'));
        if (!content) return;
        const index = result.length + 1;
        result.push({
            id: 生成ID('novel_chapter'),
            数据集ID: dataset.id,
            序号: index,
            标题: currentTitle || `第${index}章`,
            内容: content,
            字数: content.length,
            createdAt: now,
            updatedAt: now
        });
    };

    lines.forEach((line, index) => {
        const heading = 识别TXT章节标题行(line, {
            上一行: index > 0 ? lines[index - 1] : '',
            下一行: index < lines.length - 1 ? lines[index + 1] : ''
        });
        if (heading) {
            if (buffer.length > 0) {
                pushCurrent();
                buffer = [];
            }
            if (heading.层级 === 'volume') {
                currentVolumeTitle = heading.标题;
                currentTitle = heading.标题;
                return;
            }
            currentTitle = 合成层级章节标题(currentVolumeTitle, heading.标题);
            return;
        }
        buffer.push(line);
    });
    pushCurrent();

    if (result.length > 0) return 重排章节序号(过滤疑似目录章节(result));

    const paragraphs = 分段落(rawText);
    if (paragraphs.length <= 0) return [];
    const fallback: 小说拆分章节结构[] = [];
    let chunk = '';
    paragraphs.forEach((paragraph) => {
        const nextChunk = chunk ? `${chunk}\n\n${paragraph}` : paragraph;
        if (nextChunk.length > 3200 && chunk) {
            const index = fallback.length + 1;
            fallback.push({
                id: 生成ID('novel_chapter'),
                数据集ID: dataset.id,
                序号: index,
                标题: `第${index}段`,
                内容: chunk,
                字数: chunk.length,
                createdAt: now,
                updatedAt: now
            });
            chunk = paragraph;
            return;
        }
        chunk = nextChunk;
    });
    if (chunk) {
        const index = fallback.length + 1;
        fallback.push({
            id: 生成ID('novel_chapter'),
            数据集ID: dataset.id,
            序号: index,
            标题: `第${index}段`,
            内容: chunk,
            字数: chunk.length,
            createdAt: now,
            updatedAt: now
        });
    }
    return 重排章节序号(过滤疑似目录章节(fallback));
};

export const 根据章节生成分段列表 = (dataset: 小说拆分数据集结构, chapters?: 小说拆分章节结构[]): 小说拆分分段结构[] => {
    const chapterList = Array.isArray(chapters) ? chapters : dataset.章节列表;
    if (!Array.isArray(chapterList) || chapterList.length <= 0) return [];

    const configuredGroupSize = Math.max(1, Math.floor(Number(dataset?.每批章数) || 1));
    const groupSize = dataset?.分段模式 === 'single_chapter' ? 1 : configuredGroupSize;
    const result: 小说拆分分段结构[] = [];
    const now = Date.now();

    for (let index = 0; index < chapterList.length; index += groupSize) {
        const group = chapterList.slice(index, index + groupSize);
        if (group.length <= 0) continue;
        const 起始章序号 = group[0].序号;
        const 结束章序号 = group[group.length - 1].序号;
        const 原文内容 = group
            .map((item) => 去空白(item.内容 || ''))
            .filter(Boolean)
            .join('\n\n');
        const startTitle = 规范化标题(group[0].标题 || '').trim() || `章节 ${起始章序号}`;
        const endTitle = 规范化标题(group[group.length - 1].标题 || '').trim() || `章节 ${结束章序号}`;
        const 标题 = group.length === 1
            ? startTitle
            : startTitle === endTitle
                ? `${startTitle}（多章合并）`
                : `${startTitle} ~ ${endTitle}`;
        result.push({
            id: 生成ID('novel_segment'),
            数据集ID: dataset.id,
            组号: result.length + 1,
            标题,
            章节范围: 起始章序号 === 结束章序号 ? `第${起始章序号}章` : `第${起始章序号}章-第${结束章序号}章`,
            章节标题: group.map((item) => 规范化标题(item.标题 || '').trim()).filter(Boolean),
            是否开局组: result.length <= 0,
            起始章序号,
            结束章序号,
            启用注入: true,
            原文内容,
            字数: 原文内容.length,
            原文摘要: '',
            本组概括: '',
            开局已成立事实: [],
            前组延续事实: [],
            本组结束状态: [],
            给下一组参考: [],
            原著硬约束: [],
            可提前铺垫: [],
            关键事件: [],
            角色推进: [],
            登场角色: [],
            角色档案: [],
            势力档案: [],
            地图地点档案: [],
            物品档案: [],
            世界观规则: [],
            世界边界规则: [],
            人物关系: [],
            势力关系: [],
            伏笔线索: [],
            回收点: [],
            章节节奏: [],
            时间线: [],
            时间线起点: '',
            时间线终点: '',
            处理状态: '待处理',
            最近错误: '',
            createdAt: now,
            updatedAt: now
        });
    }

    return result;
};

const 规范化AI结果到分段 = (
    result: Awaited<ReturnType<typeof textAIService.generateNovelDecomposition>>,
    options: {
        标题: string;
        chapterRange: string;
        referenceStart: string;
    }
): Pick<
    小说拆分分段结构,
    | '组号'
    | '章节范围'
    | '章节标题'
    | '是否开局组'
    | '原文摘要'
    | '本组概括'
    | '开局已成立事实'
    | '前组延续事实'
    | '本组结束状态'
    | '给下一组参考'
    | '原著硬约束'
    | '可提前铺垫'
    | '关键事件'
    | '角色推进'
    | '登场角色'
    | '角色档案'
    | '势力档案'
    | '地图地点档案'
    | '物品档案'
    | '世界观规则'
    | '世界边界规则'
    | '人物关系'
    | '势力关系'
    | '伏笔线索'
    | '回收点'
    | '章节节奏'
    | '时间线'
    | '时间线起点'
    | '时间线终点'
> => {
    const 规范化AI时间锚点 = (value: unknown, reference?: string): string => 尝试规范化小说时间锚点(
        value,
        reference || options.referenceStart,
        reference || options.referenceStart
    );
    const 本组概括 = 规范化章节概括文本(result.summary);
    const 原文摘要 = 压缩章节概括为摘要(本组概括) || 清理章节编号文本(options.标题 || '');
    const 开局已成立事实 = 去重文本列表(result.openingFacts || [], 12);
    const 前组延续事实 = 去重文本列表(result.continuationFacts || [], 12);
    const 本组结束状态 = 去重文本列表(result.endStates || [], 12);
    const 给下一组参考 = 去重文本列表(result.nextGroupReferences || [], 12);
    const 原著硬约束 = 去重可见信息条目(result.hardConstraints || [], 12);
    const 可提前铺垫 = 去重可见信息条目(result.foreshadowing || [], 12);
    const 时间线起点 = 规范化AI时间锚点(result.timelineStart, options.referenceStart);
    const 时间线终点 = 修复明确跨午夜时间(
        规范化AI时间锚点(result.timelineEnd, 时间线起点 || options.referenceStart),
        时间线起点 || options.referenceStart
    );

    const 关键事件: 小说拆分分段结构['关键事件'] = [];
    if (Array.isArray(result.keyEvents)) {
        let 上一事件时间参考 = 时间线起点 || options.referenceStart;
        result.keyEvents.forEach((event) => {
            const 跨午夜参考 = 上一事件时间参考;
            const 开始时间 = 修复明确跨午夜时间(
                规范化AI时间锚点(event.开始时间, 跨午夜参考),
                跨午夜参考
            );
            const 最早开始时间 = 修复明确跨午夜时间(
                规范化AI时间锚点(event.最早开始时间, 开始时间 || 跨午夜参考),
                跨午夜参考
            );
            const 最迟开始时间 = 修复明确跨午夜时间(
                规范化AI时间锚点(event.最迟开始时间, 最早开始时间 || 开始时间 || 跨午夜参考),
                跨午夜参考
            );
            const 结束时间 = 修复明确跨午夜时间(
                规范化AI时间锚点(event.结束时间, 最迟开始时间 || 开始时间 || 跨午夜参考),
                跨午夜参考
            );
            const normalizedEvent = 补齐关键事件时间字段({
                事件名: 清理章节编号文本(event.事件名 || ''),
                事件说明: 清理章节编号文本(event.事件说明 || ''),
                开始时间,
                最早开始时间,
                最迟开始时间,
                结束时间,
                前置条件: 去重文本列表(event.前置条件 || [], 12),
                触发条件: 去重文本列表(event.触发条件 || [], 12),
                阻断条件: 去重文本列表(event.阻断条件 || [], 12),
                事件结果: 去重文本列表(event.事件结果 || [], 12),
                对下一组影响: 去重文本列表(event.对下一组影响 || [], 12),
                信息可见性: 规范化信息可见性(event.信息可见性)
            }, {
                本组时间线起点: 时间线起点,
                本组时间线终点: 时间线终点,
                上一事件时间参考,
                默认时间参考: options.referenceStart
            });
            if (normalizedEvent.事件名 || normalizedEvent.事件说明) {
                关键事件.push(normalizedEvent);
                上一事件时间参考 = normalizedEvent.结束时间
                    || normalizedEvent.最迟开始时间
                    || normalizedEvent.开始时间
                    || 上一事件时间参考;
            }
        });
    }

    const 角色推进 = Array.isArray(result.characterProgressions)
        ? result.characterProgressions.map((item) => ({
            角色名: 清理章节编号文本(item.角色名 || ''),
            本组前状态: 去重文本列表(item.本组前状态 || [], 12),
            本组变化: 去重文本列表(item.本组变化 || [], 12),
            本组后状态: 去重文本列表(item.本组后状态 || [], 12),
            对下一组影响: 去重文本列表(item.对下一组影响 || [], 12)
        })).filter((item) => item.角色名)
        : [];
    const 角色档案 = Array.isArray(result.characterProfiles)
        ? result.characterProfiles.map((item) => ({
            名称: 清理章节编号文本(item.名称 || ''),
            身份: 清理章节编号文本(item.身份 || ''),
            所属势力: 清理章节编号文本(item.所属势力 || ''),
            初始立场: 清理章节编号文本(item.初始立场 || ''),
            关系摘要: 去重文本列表(item.关系摘要 || [], 12),
            状态摘要: 去重文本列表(item.状态摘要 || [], 12),
            首次出现: 清理章节编号文本(item.首次出现 || ''),
            重要性: item.重要性 === '核心' || item.重要性 === '重要' ? item.重要性 : '一般' as const
        })).filter((item) => item.名称)
        : [];
    const 势力档案 = Array.isArray(result.factionProfiles)
        ? result.factionProfiles.map((item) => ({
            名称: 清理章节编号文本(item.名称 || ''),
            类型: 清理章节编号文本(item.类型 || ''),
            地盘: 清理章节编号文本(item.地盘 || ''),
            代表人物: 去重文本列表(item.代表人物 || [], 12),
            立场目标: 清理章节编号文本(item.立场目标 || ''),
            当前状态: 清理章节编号文本(item.当前状态 || ''),
            关系摘要: 去重文本列表(item.关系摘要 || [], 12),
            首次出现: 清理章节编号文本(item.首次出现 || '')
        })).filter((item) => item.名称)
        : [];
    const 地图地点档案 = Array.isArray(result.locationProfiles)
        ? result.locationProfiles.map((item) => ({
            名称: 清理章节编号文本(item.名称 || ''),
            层级: item.层级 === '具体地点'
                ? '区地点' as const
                : item.层级 === '寰宇' || item.层级 === '大地点' || item.层级 === '中地点' || item.层级 === '小地点' || item.层级 === '区地点' || item.层级 === '子地点'
                    ? item.层级
                    : '未知' as const,
            上级地点: 清理章节编号文本(item.上级地点 || ''),
            所属势力: 清理章节编号文本(item.所属势力 || ''),
            地貌功能: 清理章节编号文本(item.地貌功能 || ''),
            关键设施: 去重文本列表(item.关键设施 || [], 12),
            首次出现: 清理章节编号文本(item.首次出现 || '')
        })).filter((item) => item.名称)
        : [];
    const 物品档案 = Array.isArray(result.itemProfiles)
        ? result.itemProfiles.map((item) => ({
            名称: 清理章节编号文本(item.名称 || ''),
            类型: 清理章节编号文本(item.类型 || ''),
            用途: 清理章节编号文本(item.用途 || ''),
            所属人物: 清理章节编号文本(item.所属人物 || ''),
            所属势力: 清理章节编号文本(item.所属势力 || ''),
            首次出现: 清理章节编号文本(item.首次出现 || '')
        })).filter((item) => item.名称)
        : [];

    const AI登场角色 = 去重文本列表(result.appearingCharacters || [], 24);
    const 时间线 = 构建分段时间线({
        标题: options.标题,
        关键事件,
        referenceStart: options.referenceStart
    });
    const 登场角色 = AI登场角色;

    const 规范化章节范围 = (() => {
        const normalized = 清理章节范围文本(result.chapterRange || '');
        if (!normalized || /^[-~～—]/u.test(normalized)) {
            return 清理章节范围文本(options.chapterRange || '');
        }
        return normalized;
    })();

    return {
        组号: Math.max(1, Number(result.groupNumber) || 1),
        章节范围: 规范化章节范围,
        章节标题: 去重文本列表(Array.isArray(result.chapterTitles) ? result.chapterTitles : [], 24),
        是否开局组: result.isOpeningGroup === true,
        原文摘要,
        本组概括,
        开局已成立事实,
        前组延续事实,
        本组结束状态,
        给下一组参考,
        原著硬约束,
        可提前铺垫,
        关键事件,
        角色推进,
        登场角色,
        角色档案,
        势力档案,
        地图地点档案,
        物品档案,
        世界观规则: 去重文本列表(result.worldRules || [], 24),
        世界边界规则: 去重文本列表(result.worldBoundaryRules || [], 24),
        人物关系: 去重文本列表(result.characterRelations || [], 24),
        势力关系: 去重文本列表(result.factionRelations || [], 24),
        伏笔线索: 去重文本列表(result.foreshadowingThreads || [], 24),
        回收点: 去重文本列表(result.payoffPoints || [], 24),
        章节节奏: 去重文本列表(result.chapterRhythm || [], 24),
        时间线,
        时间线起点,
        时间线终点
    };
};

const 校验分段AI输出完整性 = (
    segment: Pick<
        小说拆分分段结构,
        | '组号'
        | '标题'
        | '原著硬约束'
        | '可提前铺垫'
        | '关键事件'
        | '时间线起点'
        | '时间线终点'
    >,
    expectedGroupNumber: number
) => {
    const segmentTitle = segment.标题 || `分段 ${expectedGroupNumber}`;
    if ((segment.组号 || 0) !== expectedGroupNumber) {
        throw new Error(`分段“${segmentTitle}”返回组号 ${segment.组号 || '空'}，与任务组号 ${expectedGroupNumber} 不一致。`);
    }

    const timelineStart = (segment.时间线起点 || '').trim();
    const timelineEnd = (segment.时间线终点 || '').trim();
    if (!timelineStart || !timelineEnd) {
        throw new Error(`分段“${segmentTitle}”缺少本组整体时间线起止，必须显式输出“时间线起点 / 时间线终点”。`);
    }

    const 校验可见信息条目 = (
        items: 小说拆分分段结构['原著硬约束'],
        label: '原著硬约束' | '可提前铺垫'
    ) => {
        items.forEach((entry, index) => {
            if (!(entry?.内容 || '').trim()) {
                throw new Error(`分段“${segmentTitle}”的${label} #${index + 1} 缺少内容。`);
            }
            if (
                (entry.信息可见性?.谁知道?.length || 0) <= 0
                && (entry.信息可见性?.谁不知道?.length || 0) <= 0
                && entry.信息可见性?.是否仅读者视角可见 !== true
            ) {
                throw new Error(`分段“${segmentTitle}”的${label} #${index + 1}（${entry.内容 || '未命名条目'}）缺少信息可见性标注。`);
            }
        });
    };

    校验可见信息条目(segment.原著硬约束, '原著硬约束');
    校验可见信息条目(segment.可提前铺垫, '可提前铺垫');

    segment.关键事件.forEach((event, index) => {
        if (!event.开始时间 || !event.最早开始时间 || !event.最迟开始时间 || !event.结束时间) {
            throw new Error(`分段“${segmentTitle}”的关键事件 #${index + 1}（${event.事件名 || '未命名事件'}）缺少完整时间字段。`);
        }
        if (
            !时间锚点格式正则.test(event.开始时间)
            || !时间锚点格式正则.test(event.最早开始时间)
            || !时间锚点格式正则.test(event.最迟开始时间)
            || !时间锚点格式正则.test(event.结束时间)
        ) {
            throw new Error(`分段“${segmentTitle}”的关键事件 #${index + 1}（${event.事件名 || '未命名事件'}）时间格式无效。`);
        }
        if (小说时间晚于(event.最早开始时间, event.开始时间) || 小说时间晚于(event.开始时间, event.最迟开始时间)) {
            throw new Error(`分段“${segmentTitle}”的关键事件 #${index + 1}（${event.事件名 || '未命名事件'}）开始时间不在允许窗口内。`);
        }
        if (小说时间早于(event.结束时间, event.开始时间)) {
            throw new Error(`分段“${segmentTitle}”的关键事件 #${index + 1}（${event.事件名 || '未命名事件'}）结束时间早于开始时间。`);
        }
        if (
            (event.信息可见性?.谁知道?.length || 0) <= 0
            && (event.信息可见性?.谁不知道?.length || 0) <= 0
            && event.信息可见性?.是否仅读者视角可见 !== true
        ) {
            throw new Error(`分段“${segmentTitle}”的关键事件 #${index + 1}（${event.事件名 || '未命名事件'}）缺少信息可见性标注。`);
        }
    });

};

const 校验分段时间连续性 = (
    segment: Pick<小说拆分分段结构, '标题' | '时间线起点' | '时间线' | '时间线终点'>,
    previousTimelineEnd?: string
) => {
    const segmentTitle = segment.标题 || '未命名分段';
    const currentStart = (segment.时间线起点 || '').trim();
    if (!currentStart) {
        throw new Error(`分段“${segmentTitle}”缺少起始时间。`);
    }
    if (!时间锚点格式正则.test(currentStart)) {
        throw new Error(`分段“${segmentTitle}”起始时间格式无效：${currentStart}`);
    }

    const currentEnd = (segment.时间线终点 || '').trim();
    if (!currentEnd) {
        throw new Error(`分段“${segmentTitle}”缺少结束时间。`);
    }
    if (!时间锚点格式正则.test(currentEnd)) {
        throw new Error(`分段“${segmentTitle}”结束时间格式无效：${currentEnd}`);
    }
    if (小说时间早于(currentEnd, currentStart)) {
        throw new Error(`分段“${segmentTitle}”结束时间 ${currentEnd} 早于起始时间 ${currentStart}。`);
    }

    const normalizedPreviousEnd = typeof previousTimelineEnd === 'string' ? previousTimelineEnd.trim() : '';
    if (!normalizedPreviousEnd) return;

    if (!时间锚点格式正则.test(normalizedPreviousEnd)) {
        throw new Error(`上一章节结束时间格式无效：${normalizedPreviousEnd}`);
    }
    if (小说时间早于(currentStart, normalizedPreviousEnd)) {
        throw new Error(`分段“${segmentTitle}”起始时间 ${currentStart} 早于上一章节结束时间 ${normalizedPreviousEnd}，时间线未衔接。`);
    }

    const firstEventTime = (segment.时间线 || [])
        .map((event) => (event?.时间锚点 || '').trim())
        .find(Boolean);
    if (firstEventTime) {
        if (!时间锚点格式正则.test(firstEventTime)) {
            throw new Error(`分段“${segmentTitle}”首条时间线事件格式无效：${firstEventTime}`);
        }
        if (小说时间早于(firstEventTime, normalizedPreviousEnd)) {
            throw new Error(`分段“${segmentTitle}”首条时间线事件 ${firstEventTime} 早于上一章节结束时间 ${normalizedPreviousEnd}，时间线未衔接。`);
        }
    }
};

export const 解析小说拆分分段 = async (params: {
    dataset: 小说拆分数据集结构;
    segment: 小说拆分分段结构;
    segmentIndex: number;
    previousTimelineEnd?: string;
    previousGroupReference?: string;
    nextChapterTitles?: string[];
    leadingSystemPrompt?: string;
    extraPrompt?: string;
    retryCorrection?: string;
    apiConfig?: 当前可用接口结构 | null;
    gptMode?: boolean;
    signal?: AbortSignal;
    onStreamDelta?: (delta: string, accumulated: string) => void;
}): Promise<小说拆分分段结构> => {
    if (!params.apiConfig) {
        throw new Error('小说拆分接口未配置或不可用');
    }

    const retryCorrection = 去空白(params.retryCorrection || '');
    const correctionPrompt = retryCorrection
        ? [
            '【补漏定向结构纠错】',
            `上一次失败原因：${retryCorrection}`,
            '请完整重输本分段的全部结构，不要只返回修补字段。',
            '信息可见性必须作为独立对象输出，明确包含“谁知道”“谁不知道”“是否仅读者视角可见”，不能拼进“内容”字符串。',
            '若失败涉及时间线，请按事件真实先后重新排列，并保证开始时间、最早开始时间、最迟开始时间、结束时间完整且单调。'
        ].join('\n')
        : '';
    const mergedExtraPrompt = [params.extraPrompt, correctionPrompt].filter(Boolean).join('\n\n');

    const result = await textAIService.generateNovelDecomposition({
        text: params.segment.原文内容,
        groupIndex: params.segment.组号 || params.segmentIndex + 1,
        chapterRange: params.segment.章节范围,
        chapterTitles: params.segment.章节标题,
        previousGroupReference: params.previousGroupReference,
        previousTimelineEnd: params.previousTimelineEnd,
        nextChapterTitles: params.nextChapterTitles,
        leadingSystemPrompt: params.leadingSystemPrompt,
        extraPrompt: mergedExtraPrompt || undefined,
        gptMode: params.gptMode === true
    }, params.apiConfig, params.signal, params.onStreamDelta
        ? {
            stream: true,
            onDelta: params.onStreamDelta
        }
        : undefined);

    const referenceStart = 规范化小说时间锚点(
        params.previousTimelineEnd,
        params.dataset?.默认时间线起点 || 默认小说时间线起点
    );
    const normalizedSegment = {
        ...params.segment,
        ...规范化AI结果到分段(result, {
            标题: params.segment.标题,
            chapterRange: params.segment.章节范围,
            referenceStart
        })
    };

    const finalizedSegment = normalizedSegment;

    校验分段AI输出完整性(finalizedSegment, params.segment.组号 || params.segmentIndex + 1);
    校验分段时间连续性(finalizedSegment, params.previousTimelineEnd);

    return {
        ...finalizedSegment,
        处理状态: '已完成',
        最近错误: '',
        updatedAt: Date.now()
    };
};

const 格式化事件摘要 = (title: string, details: string[]): string => {
    const body = 去重文本列表(details).join('、');
    return body ? `${title}：${body}` : title;
};

const 构建主剧情分段内容 = (segment: 小说拆分分段结构): string => [
    segment.本组概括 ? `本组概括：${segment.本组概括}` : '',
    segment.原著硬约束.length > 0 ? `原著硬约束：${segment.原著硬约束.map(格式化可见信息条目摘要).join('；')}` : ''
].filter(Boolean).join('\n');

const 构建规划分段内容 = (segment: 小说拆分分段结构): string => [
    segment.本组概括 ? `本组概括：${segment.本组概括}` : '',
    segment.开局已成立事实.length > 0 ? `开局已成立事实：${segment.开局已成立事实.join('；')}` : '',
    segment.前组延续事实.length > 0 ? `前组延续事实：${segment.前组延续事实.join('；')}` : '',
    segment.本组结束状态.length > 0 ? `本组结束状态：${segment.本组结束状态.join('；')}` : '',
    segment.原著硬约束.length > 0 ? `原著硬约束：${segment.原著硬约束.map(格式化可见信息条目摘要).join('；')}` : '',
    segment.可提前铺垫.length > 0 ? `可提前铺垫：${segment.可提前铺垫.map(格式化可见信息条目摘要).join('；')}` : '',
    segment.关键事件.length > 0 ? `关键事件：${segment.关键事件.map((event) => 格式化事件摘要(event.事件名, [event.开始时间, ...event.触发条件, 格式化信息可见性摘要(event.信息可见性)])).join('；')}` : '',
    segment.角色推进.length > 0 ? `角色推进：${segment.角色推进.map((item) => 格式化事件摘要(item.角色名, [...item.本组变化, ...item.本组后状态])).join('；')}` : '',
    segment.角色档案.length > 0 ? `角色档案：${segment.角色档案.map((item) => 格式化事件摘要(item.名称, [item.身份, item.所属势力, item.初始立场, ...item.状态摘要])).join('；')}` : '',
    segment.势力档案.length > 0 ? `势力档案：${segment.势力档案.map((item) => 格式化事件摘要(item.名称, [item.类型, item.地盘, item.当前状态, item.立场目标])).join('；')}` : '',
    segment.地图地点档案.length > 0 ? `地图地点：${segment.地图地点档案.map((item) => 格式化事件摘要(item.名称, [item.层级, item.上级地点, item.所属势力, item.地貌功能])).join('；')}` : '',
    segment.时间线起点 ? `区间时间：${segment.时间线起点} -> ${segment.时间线终点}` : ''
].filter(Boolean).join('\n');

const 构建世界演变分段内容 = (segment: 小说拆分分段结构): string => [
    segment.关键事件.length > 0 ? `关键事件：${segment.关键事件.map((event) => 格式化事件摘要(event.事件名, [event.开始时间, event.结束时间, ...event.事件结果, 格式化信息可见性摘要(event.信息可见性)])).join('；')}` : '',
    segment.本组结束状态.length > 0 ? `本组结束状态：${segment.本组结束状态.join('；')}` : '',
    segment.原著硬约束.length > 0 ? `原著硬约束：${segment.原著硬约束.map(格式化可见信息条目摘要).join('；')}` : '',
    segment.可提前铺垫.length > 0 ? `可提前铺垫：${segment.可提前铺垫.map(格式化可见信息条目摘要).join('；')}` : '',
    segment.角色推进.length > 0 ? `角色推进：${segment.角色推进.map((item) => 格式化事件摘要(item.角色名, [...item.本组后状态, ...item.对下一组影响])).join('；')}` : '',
    segment.登场角色.length > 0 ? `关联角色：${segment.登场角色.join('、')}` : '',
    segment.角色档案.length > 0 ? `角色档案：${segment.角色档案.map((item) => 格式化事件摘要(item.名称, [item.身份, item.所属势力, item.初始立场, ...item.状态摘要])).join('；')}` : '',
    segment.势力档案.length > 0 ? `势力档案：${segment.势力档案.map((item) => 格式化事件摘要(item.名称, [item.类型, item.地盘, item.当前状态, item.立场目标])).join('；')}` : '',
    segment.地图地点档案.length > 0 ? `地图地点：${segment.地图地点档案.map((item) => 格式化事件摘要(item.名称, [item.层级, item.上级地点, item.所属势力, item.地貌功能])).join('；')}` : '',
    segment.时间线起点 ? `区间时间：${segment.时间线起点} -> ${segment.时间线终点}` : ''
].filter(Boolean).join('\n');

const 构建规划时间线内容 = (
    segment: 小说拆分分段结构,
    event: 小说拆分分段结构['关键事件'][number]
): string => {
    return [
        `分解组：${segment.组号}`,
        `时间：${event.开始时间 || event.最早开始时间 || event.最迟开始时间 || segment.时间线起点 || 默认小说时间线起点}`,
        `事件：${event.事件名 || '未命名事件'}`,
        event.事件说明 ? `说明：${event.事件说明}` : '',
        event.结束时间 ? `结束时间：${event.结束时间}` : '',
        event.前置条件.length > 0 ? `前置条件：${event.前置条件.join('；')}` : '',
        event.触发条件.length > 0 ? `触发条件：${event.触发条件.join('；')}` : '',
        event.阻断条件.length > 0 ? `阻断条件：${event.阻断条件.join('；')}` : '',
        event.事件结果.length > 0 ? `事件结果：${event.事件结果.join('；')}` : '',
        event.对下一组影响.length > 0 ? `对下一组影响：${event.对下一组影响.join('；')}` : '',
        ...构建信息可见性行(event.信息可见性)
    ].filter(Boolean).join('\n');
};

const 构建世界演变时间线内容 = (
    segment: 小说拆分分段结构,
    event: 小说拆分分段结构['关键事件'][number]
): string => {
    return [
        `分解组：${segment.组号}`,
        `时间：${event.开始时间 || event.最早开始时间 || event.最迟开始时间 || segment.时间线起点 || 默认小说时间线起点}`,
        `事件：${event.事件名 || '未命名事件'}`,
        event.事件说明 ? `事件说明：${event.事件说明}` : '',
        event.结束时间 ? `结束时间：${event.结束时间}` : '',
        event.事件结果.length > 0 ? `事件结果：${event.事件结果.join('；')}` : '',
        event.对下一组影响.length > 0 ? `后续影响：${event.对下一组影响.join('；')}` : '',
        ...构建信息可见性行(event.信息可见性)
    ].filter(Boolean).join('\n');
};

export const 基于分段构建注入树 = (dataset: 小说拆分数据集结构): 小说拆分树节点结构[] => {
    const completedSegments = dataset.分段列表.filter((item) => item.处理状态 === '已完成' && item.启用注入 !== false);
    const 跨世界时间线规则 = 构建小说拆分跨世界时间线规则(dataset);
    const stageNode = 构建树节点({
        datasetId: dataset.id,
        title: '当前阶段概括',
        content: dataset.当前阶段概括,
        type: 'stage_summary',
        order: 10,
        targets: ['planning']
    });
    const characterArchiveNode = 构建树节点({
        datasetId: dataset.id,
        title: '原著角色档案',
        content: (dataset.角色档案 || []).map((item) => 格式化事件摘要(item.名称, [item.身份, item.所属势力, item.初始立场, ...item.状态摘要])).join('；'),
        type: 'summary',
        order: 20,
        targets: ['planning', 'world_evolution']
    });
    const factionArchiveNode = 构建树节点({
        datasetId: dataset.id,
        title: '原著势力档案',
        content: (dataset.势力档案 || []).map((item) => 格式化事件摘要(item.名称, [item.类型, item.地盘, item.当前状态, item.立场目标])).join('；'),
        type: 'summary',
        order: 30,
        targets: ['planning', 'world_evolution']
    });
    const locationArchiveNode = 构建树节点({
        datasetId: dataset.id,
        title: '原著地图地点档案',
        content: (dataset.地图地点档案 || []).map((item) => 格式化事件摘要(item.名称, [item.层级, item.上级地点, item.所属势力, item.地貌功能])).join('；'),
        type: 'summary',
        order: 40,
        targets: ['planning', 'world_evolution']
    });
    const crossWorldTimelineNode = 构建树节点({
        datasetId: dataset.id,
        title: '跨世界时间线硬约束',
        content: 跨世界时间线规则.join('\n'),
        type: 'summary',
        order: 45,
        targets: ['planning', 'world_evolution', 'main_story']
    });
    const mainStorySegmentChildren = completedSegments.map((segment, index) => 构建树节点({
        datasetId: dataset.id,
        title: 清理章节编号文本(segment.标题 || '') || `分段 ${index + 1}`,
        content: 构建主剧情分段内容(segment),
        type: 'segment',
        order: 100 + index,
        targets: ['main_story'],
        relatedSegmentIds: [segment.id]
    }));
    const planningSegmentChildren = completedSegments.map((segment, index) => 构建树节点({
        datasetId: dataset.id,
        title: 清理章节编号文本(segment.标题 || '') || `分段 ${index + 1}`,
        content: 构建规划分段内容(segment),
        type: 'segment',
        order: 200 + index,
        targets: ['planning'],
        relatedSegmentIds: [segment.id]
    }));
    const worldSegmentChildren = completedSegments.map((segment, index) => 构建树节点({
        datasetId: dataset.id,
        title: 清理章节编号文本(segment.标题 || '') || `分段 ${index + 1}`,
        content: 构建世界演变分段内容(segment),
        type: 'segment',
        order: 300 + index,
        targets: ['world_evolution'],
        relatedSegmentIds: [segment.id]
    }));
    const planningTimelineChildren = completedSegments.flatMap((segment, segmentIndex) => ([
        ...segment.关键事件.map((event, eventIndex) => 构建树节点({
            datasetId: dataset.id,
            title: 清理章节编号文本(event.事件名 || segment.标题) || `关键事件 ${eventIndex + 1}`,
            content: 构建规划时间线内容(segment, event),
            type: 'timeline_event',
            order: 400 + segmentIndex * 100 + eventIndex,
            targets: ['planning'],
            relatedSegmentIds: [segment.id]
        }))
    ]));
    const worldTimelineChildren = completedSegments.flatMap((segment, segmentIndex) => ([
        ...segment.关键事件.map((event, eventIndex) => 构建树节点({
            datasetId: dataset.id,
            title: 清理章节编号文本(event.事件名 || segment.标题) || `关键事件 ${eventIndex + 1}`,
            content: 构建世界演变时间线内容(segment, event),
            type: 'timeline_event',
            order: 500 + segmentIndex * 100 + eventIndex,
            targets: ['world_evolution'],
            relatedSegmentIds: [segment.id]
        }))
    ]));
    const segmentGroup = 构建树节点({
        datasetId: dataset.id,
        title: '原著区间概括',
        type: 'segment_group',
        order: 20,
        targets: ['main_story'],
        children: mainStorySegmentChildren
    });
    mainStorySegmentChildren.forEach((child) => {
        child.父节点ID = segmentGroup.id;
    });
    const planningSegmentGroup = 构建树节点({
        datasetId: dataset.id,
        title: '规划分析分段',
        type: 'segment_group',
        order: 30,
        targets: ['planning'],
        children: planningSegmentChildren
    });
    planningSegmentChildren.forEach((child) => {
        child.父节点ID = planningSegmentGroup.id;
    });
    const worldSegmentGroup = 构建树节点({
        datasetId: dataset.id,
        title: '世界演变后台锚点',
        type: 'segment_group',
        order: 40,
        targets: ['world_evolution'],
        children: worldSegmentChildren
    });
    worldSegmentChildren.forEach((child) => {
        child.父节点ID = worldSegmentGroup.id;
    });
    const planningTimelineGroup = 构建树节点({
        datasetId: dataset.id,
        title: '规划分析时间线',
        type: 'timeline_group',
        order: 50,
        targets: ['planning'],
        children: planningTimelineChildren
    });
    planningTimelineChildren.forEach((child) => {
        child.父节点ID = planningTimelineGroup.id;
    });
    const worldTimelineGroup = 构建树节点({
        datasetId: dataset.id,
        title: '世界演变时间线',
        type: 'timeline_group',
        order: 60,
        targets: ['world_evolution'],
        children: worldTimelineChildren
    });
    worldTimelineChildren.forEach((child) => {
        child.父节点ID = worldTimelineGroup.id;
    });
    return [
        stageNode,
        characterArchiveNode,
        factionArchiveNode,
        locationArchiveNode,
        crossWorldTimelineNode,
        segmentGroup,
        planningSegmentGroup,
        worldSegmentGroup,
        planningTimelineGroup,
        worldTimelineGroup
    ].filter((item) => {
        if (item.类型 === 'segment_group' || item.类型 === 'timeline_group') {
            return Array.isArray(item.子节点) && item.子节点.length > 0;
        }
        return Boolean((item.内容 || '').trim());
    });
};

export const 聚合小说拆分数据集 = (dataset: 小说拆分数据集结构): 小说拆分数据集结构 => {
    const completedSegments = dataset.分段列表.filter((item) => item.处理状态 === '已完成' && item.启用注入 !== false);
    const stageSummary = completedSegments.length > 0
        ? 合成阶段概括(completedSegments, 'stage')
        : '';
    const coreRoleStats = 统计核心角色(completedSegments);
    const 角色档案 = 聚合角色档案(completedSegments);
    const 势力档案 = 聚合势力档案(completedSegments);
    const 地图地点档案 = 聚合地图地点档案(completedSegments);
    const 物品档案 = 聚合物品档案(completedSegments);
    const 世界观规则 = 聚合文本列表字段(completedSegments, (segment) => segment.世界观规则 || []);
    const 世界边界规则 = 聚合文本列表字段(completedSegments, (segment) => segment.世界边界规则 || []);
    const 人物关系 = 聚合文本列表字段(completedSegments, (segment) => segment.人物关系 || []);
    const 势力关系 = 聚合文本列表字段(completedSegments, (segment) => segment.势力关系 || []);
    const 伏笔线索 = 聚合文本列表字段(completedSegments, (segment) => segment.伏笔线索 || []);
    const 回收点 = 聚合文本列表字段(completedSegments, (segment) => segment.回收点 || []);
    const 章节节奏 = 聚合文本列表字段(completedSegments, (segment) => segment.章节节奏 || []);

    return {
        ...dataset,
        原始文本长度: (dataset.原始文本 || '').length,
        原始文本摘要: dataset.原始文本摘要 || '',
        总章节数: dataset.章节列表.length,
        当前阶段概括: stageSummary,
        核心角色摘要: coreRoleStats.map(([role, count]) => `${role}：关联 ${count} 个分段`),
        核心角色: coreRoleStats.map(([role]) => role),
        角色档案,
        势力档案,
        地图地点档案,
        物品档案,
        世界观规则,
        世界边界规则,
        人物关系,
        势力关系,
        伏笔线索,
        回收点,
        章节节奏,
        注入树: 基于分段构建注入树({
            ...dataset,
            当前阶段概括: stageSummary,
            角色档案,
            势力档案,
            地图地点档案,
            物品档案,
            世界观规则,
            世界边界规则,
            人物关系,
            势力关系,
            伏笔线索,
            回收点,
            章节节奏
        }),
        updatedAt: Date.now()
    };
};
