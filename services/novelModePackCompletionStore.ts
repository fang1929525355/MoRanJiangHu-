import type {
    小说模式包完善记录,
    小说模式包完善状态,
    小说模式包完善阶段,
    小说模式包分段输入记录
} from '../models/novelModePackCompletion';
import type { 小说拆分数据集结构 } from '../models/novelDecomposition';
import type { 题材模式类型 } from '../models/system';
import { 读取设置, 保存设置 } from './dbService';
import { 设置键 } from '../utils/settingsSchema';

const 读取状态 = (value: unknown): 小说模式包完善状态 => (
    value === 'idle' || value === 'running' || value === 'paused' || value === 'finalizing' || value === 'completed'
        ? value
        : 'paused'
);

const 读取阶段 = (value: unknown): 小说模式包完善阶段 => (
    value === 'skeleton' || value === 'segment' || value === 'finalize' ? value : 'skeleton'
);

const 读取字符串列表 = (value: unknown): string[] => (
    Array.isArray(value)
        ? value.filter((item: unknown): item is string => typeof item === 'string')
        : []
);

const 读取分段输入记录 = (value: unknown): 小说模式包分段输入记录[] => (
    Array.isArray(value)
        ? value.filter((item): item is 小说模式包分段输入记录 => Boolean(
            item
            && typeof item === 'object'
            && typeof item.分段ID === 'string'
            && Number.isFinite(item.原文总字符数)
            && Number.isFinite(item.实际输入字符数)
            && typeof item.是否完整输入 === 'boolean'
        ))
        : []
);

export const 标准化小说模式包完善记录 = (raw: any): 小说模式包完善记录 => {
    const 总分段数 = Math.max(0, Math.floor(Number(raw?.总分段数) || 0));
    const 已完成分段数 = Math.min(总分段数, Math.max(0, Math.floor(Number(raw?.已完成分段数) || 0)));
    const rawCursor = Number.isFinite(Number(raw?.下一个分段索引))
        ? Math.floor(Number(raw.下一个分段索引))
        : 已完成分段数;
    const 下一个分段索引 = Math.min(总分段数, Math.max(0, Math.min(rawCursor, 已完成分段数)));
    const now = Date.now();
    return {
        id: String(raw?.id || ''),
        数据集ID: String(raw?.数据集ID || ''),
        题材: raw?.题材,
        数据集指纹: String(raw?.数据集指纹 || ''),
        状态: 读取状态(raw?.状态),
        当前阶段: 读取阶段(raw?.当前阶段),
        总分段数,
        已完成分段数,
        下一个分段索引,
        最近失败分段索引: Number.isInteger(raw?.最近失败分段索引) ? raw.最近失败分段索引 : undefined,
        最近错误: typeof raw?.最近错误 === 'string' ? raw.最近错误 : undefined,
        当前分段标题: typeof raw?.当前分段标题 === 'string' ? raw.当前分段标题 : undefined,
        分段输入记录: 读取分段输入记录(raw?.分段输入记录),
        待整理冲突提示: 读取字符串列表(raw?.待整理冲突提示),
        当前草稿: raw?.当前草稿 && typeof raw.当前草稿 === 'object' ? raw.当前草稿 : {},
        用户确认字段路径: 读取字符串列表(raw?.用户确认字段路径),
        最近原始输出: typeof raw?.最近原始输出 === 'string' ? raw.最近原始输出 : undefined,
        createdAt: Number(raw?.createdAt) || now,
        updatedAt: Number(raw?.updatedAt) || now
    };
};

export const 构建小说模式包数据集指纹 = async (dataset: 小说拆分数据集结构): Promise<string> => {
    const source = JSON.stringify({
        id: dataset.id,
        segments: (dataset.分段列表 || []).map((segment) => ({
            id: segment.id,
            title: segment.标题,
            text: segment.原文内容,
            updatedAt: segment.updatedAt
        }))
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};

const 读取全部记录 = async (): Promise<小说模式包完善记录[]> => {
    const raw = await 读取设置(设置键.小说模式包完善进度);
    return Array.isArray(raw) ? raw.map(标准化小说模式包完善记录) : [];
};

export const 读取小说模式包完善记录 = async (
    datasetId: string,
    topic: 题材模式类型
): Promise<小说模式包完善记录 | null> => {
    const records = await 读取全部记录();
    return records.find((record) => record.数据集ID === datasetId && record.题材 === topic) || null;
};

export const 保存小说模式包完善记录 = async (record: 小说模式包完善记录): Promise<void> => {
    const normalized = 标准化小说模式包完善记录(record);
    const records = await 读取全部记录();
    const next = records.filter((item) => item.数据集ID !== normalized.数据集ID || item.题材 !== normalized.题材);
    next.push(normalized);
    await 保存设置(设置键.小说模式包完善进度, next);
};

export const 删除小说模式包完善记录 = async (
    datasetId: string,
    topic: 题材模式类型
): Promise<void> => {
    const records = await 读取全部记录();
    await 保存设置(
        设置键.小说模式包完善进度,
        records.filter((record) => record.数据集ID !== datasetId || record.题材 !== topic)
    );
};
