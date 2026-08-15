import { useEffect, useMemo, useState } from 'react';
import { 读取图片资源 } from '../services/dbService';
import {
    创建图片资源引用,
    读取图片资源缓存,
    读取远程图片兜底资源ID,
    是否图片资源引用,
    是否远程图片地址
} from '../utils/imageAssets';
import { isNativeCapacitorEnvironment } from '../utils/nativeRuntime';

const 取可扫描文本 = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    // 图片引用和 HTTP(S) 地址本身都很短。超长字符串通常是剧情正文或 data URL，
    // 对它们执行 trim() 会在移动端额外复制整段大字符串并抬高内存峰值。
    if (value.length > 16 * 1024) return '';
    return value.trim();
};

const 收集图片资源引用 = (
    value: unknown,
    refs: Set<string>,
    seen: WeakSet<object> = new WeakSet()
): void => {
    const text = 取可扫描文本(value);
    if (text) {
        if (是否图片资源引用(text)) {
            refs.add(text);
            return;
        }
        if (是否远程图片地址(text)) {
            const fallbackId = 读取远程图片兜底资源ID(text);
            const fallbackRef = fallbackId ? 创建图片资源引用(fallbackId) : '';
            if (fallbackRef) refs.add(fallbackRef);
        }
        return;
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    if (Array.isArray(value)) {
        value.forEach((item) => 收集图片资源引用(item, refs, seen));
        return;
    }

    Object.values(value as Record<string, unknown>).forEach((child) => {
        收集图片资源引用(child, refs, seen);
    });
};

export const 提取图片资源引用列表 = (...sources: unknown[]): string[] => {
    const refs = new Set<string>();
    sources.forEach((source) => 收集图片资源引用(source, refs));
    return Array.from(refs.values());
};

export const use图片资源回源预取 = (...sources: unknown[]): void => {
    const [, forceRefresh] = useState(0);
    const refList = useMemo(() => 提取图片资源引用列表(...sources), [...sources]);
    const refKey = refList.join('|');

    useEffect(() => {
        let cancelled = false;
        const native = isNativeCapacitorEnvironment();
        const maxRefs = native ? 8 : 48;
        const poolSize = native ? 1 : 2;
        const unresolvedRefs = refList.filter((ref) => !读取图片资源缓存(ref)).slice(0, maxRefs);
        if (unresolvedRefs.length === 0) return;

        const run = async () => {
            const results: PromiseSettledResult<string>[] = [];
            let cursor = 0;
            const worker = async () => {
                while (!cancelled && cursor < unresolvedRefs.length) {
                    const ref = unresolvedRefs[cursor++];
                    results.push(await 读取图片资源(ref).then(
                        (value) => ({ status: 'fulfilled', value }) as PromiseFulfilledResult<string>,
                        (reason) => ({ status: 'rejected', reason }) as PromiseRejectedResult
                    ));
                    await new Promise((resolve) => window.setTimeout(resolve, native ? 80 : 20));
                }
            };
            await Promise.all(Array.from({ length: poolSize }, () => worker()));
            return results;
        };

        void run().then((results) => {
            if (cancelled) return;
            const hasLoaded = (results || []).some((item) => (
                item.status === 'fulfilled'
                && typeof item.value === 'string'
                && item.value.length > 0
            ));
            if (hasLoaded) {
                forceRefresh((value) => value + 1);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [refKey, refList]);
};
