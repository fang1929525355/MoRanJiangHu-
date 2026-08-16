// 网页版跨域（CORS）自动中转：
// 浏览器直连第三方 AI 接口时，若对方未开放 CORS，请求会被浏览器在网络层拦截
// （TypeError: Failed to fetch，预检 OPTIONS 404 等）。本模块在直连出现
// 网络层失败时，自动改走同域中转端点 /api/ai-relay 再试一次。
// APK 原生环境不受浏览器 CORS 限制，不启用中转。

import { isNativeCapacitorEnvironment } from '../../utils/nativeRuntime';

export type 跨域中转模式 = 'auto' | 'off';

const RELAY_MODE_STORAGE_KEY = 'msjh_ai_cors_relay_mode';

export const 读取跨域中转模式 = (): 跨域中转模式 => {
    try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(RELAY_MODE_STORAGE_KEY);
        return raw === 'off' ? 'off' : 'auto';
    } catch {
        return 'auto';
    }
};

export const 写入跨域中转模式 = (mode: 跨域中转模式): void => {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(RELAY_MODE_STORAGE_KEY, mode);
    } catch { /* 忽略隐私模式等存储失败 */ }
};

export const 构建AI中转地址 = (endpoint: string): string => {
    const base = typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)
        ? window.location.origin.replace(/\/+$/, '')
        : 'https://msjh.bacon159.pp.ua';
    return `${base}/api/ai-relay?target=${encodeURIComponent(endpoint)}`;
};

/** 网络层错误（请求根本没有到达服务器或响应被浏览器拦截）：fetch 抛 TypeError 且无 HTTP 状态。 */
export const 疑似浏览器跨域失败 = (error: unknown): boolean => {
    if (!error) return false;
    if (typeof error !== 'object') return false;
    const anyError = error as any;
    if (anyError.status || anyError.statusCode) return false;
    if (anyError.name === 'AbortError' || anyError.name === 'TimeoutError') return false;
    const message = String(anyError.message || anyError).toLowerCase();
    if (!message) return false;
    return anyError instanceof TypeError
        || message.includes('failed to fetch')
        || message.includes('networkerror')
        || message.includes('network error')
        || message.includes('load failed');
};

export const 中转可用 = (): boolean => (
    !isNativeCapacitorEnvironment() && 读取跨域中转模式() !== 'off'
);

/**
 * 直连优先、跨域失败自动经同域中转重试一次的 fetch。
 * 返回 null 表示中转不可用或中转也失败（此时抛出原始错误由调用方处理）。
 */
export const fetchWithCorsRelay = async (
    endpoint: string,
    init: RequestInit,
    onRelayAttempt?: () => void
): Promise<{ response: Response; viaRelay: boolean }> => {
    try {
        return { response: await fetch(endpoint, init), viaRelay: false };
    } catch (directError) {
        if (!疑似浏览器跨域失败(directError) || !中转可用()) throw directError;
        onRelayAttempt?.();
        try {
            const response = await fetch(构建AI中转地址(endpoint), init);
            return { response, viaRelay: true };
        } catch {
            // 中转也失败：抛出最初的直连错误，避免把中转端点问题误报成接口问题。
            throw directError;
        }
    }
};
