import { recordDiagnosticLog } from './diagnosticLog';

const IMAGE_HOST_UPLOAD_PROXY_PATH = '/api/image-host/upload';
const DEFAULT_IMAGE_HOST_BASE = 'https://image1.bacon159.pp.ua';
const DEFAULT_SYNC_API_BASE = 'https://msjh.bacon159.pp.ua';
const MAX_DIRECT_UPLOAD_BYTES = 1.5 * 1024 * 1024;
const MAX_MOBILE_UPLOAD_BYTES = 900 * 1024;
const MAX_OPTIMIZED_IMAGE_EDGE = 1440;
const MAX_MOBILE_IMAGE_EDGE = 1080;
const OPTIMIZED_IMAGE_QUALITY = 0.78;
const MOBILE_OPTIMIZED_IMAGE_QUALITY = 0.68;

export interface 图床上传结果 {
    url: string;
    id?: string;
    size?: number;
    storage?: string;
}

export type 图床上传阶段 = 'prepare' | 'attempt' | 'retry' | 'success' | 'failed';

export interface 图床上传进度 {
    stage: 图床上传阶段;
    attempt: number;
    maxAttempts: number;
    fileName: string;
    uploadBytes: number;
    elapsedMs?: number;
    message: string;
}

export interface 图床上传选项 {
    fileName?: string;
    maxAttempts?: number;
    onProgress?: (progress: 图床上传进度) => void;
}

const readEnvText = (value: unknown): string => (
    typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
);

export const buildImageHostProxyUrl = (path: string): string => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const configuredBase = readEnvText(import.meta.env.VITE_SYNC_API_BASE_URL);
    if (configuredBase) return `${configuredBase}${normalizedPath}`;
    if (typeof window === 'undefined') return normalizedPath;
    if (/^https?:$/i.test(window.location.protocol)) return normalizedPath;
    return `${DEFAULT_SYNC_API_BASE}${normalizedPath}`;
};

const 读取文本 = (value: unknown): string => (
    typeof value === 'string' ? value.trim() : ''
);

const 是否DataUrl = (value: string): boolean => /^data:[^;,]+;base64,/i.test(value);

const 是否原生或移动端 = (): boolean => {
    if (typeof window === 'undefined') return false;
    const protocol = window.location?.protocol || '';
    const userAgent = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
    return !/^https?:$/i.test(protocol) || /Android|iPhone|iPad|Mobile/i.test(userAgent);
};

const 截断诊断文本 = (value: string, limit = 500): string => (
    value.length > limit ? `${value.slice(0, limit)}...(${value.length} chars)` : value
);

const 推断扩展名 = (mimeType: string): string => {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('bmp')) return 'bmp';
    return 'png';
};

const dataUrl转Blob = (dataUrl: string): { blob: Blob; mimeType: string } => {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/i);
    if (!match) throw new Error('图片 data URL 格式无效');
    const mimeType = match[1] || 'image/png';
    const base64 = (match[2] || '').replace(/\s+/g, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return { blob: new Blob([bytes], { type: 'application/octet-stream' }), mimeType };
};

const 估算DataUrl字节数 = (dataUrl: string): number => {
    const commaIndex = dataUrl.indexOf(',');
    const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1).replace(/\s+/g, '') : dataUrl;
    return Math.floor((base64.length * 3) / 4);
};

const blob转DataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('读取压缩图片失败'));
    reader.readAsDataURL(blob);
});

const 加载DataUrl图片 = (dataUrl: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('解析待上传图片失败'));
    image.src = dataUrl;
});

const 压缩DataUrl图片 = async (
    dataUrl: string,
    maxEdge: number,
    quality: number
): Promise<string> => {
    if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
        return dataUrl;
    }

    const image = await 加载DataUrl图片(dataUrl);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) return dataUrl;

    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const optimizedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/webp', quality);
    });
    if (!optimizedBlob || optimizedBlob.size <= 0 || optimizedBlob.size >= 估算DataUrl字节数(dataUrl)) {
        return dataUrl;
    }
    return blob转DataUrl(optimizedBlob);
};

const 优化待上传DataUrl = async (dataUrl: string): Promise<{ dataUrl: string; originalBytes: number; optimizedBytes: number; mobileMode: boolean; optimized: boolean }> => {
    const originalBytes = 估算DataUrl字节数(dataUrl);
    const mobileMode = 是否原生或移动端();
    const directLimit = mobileMode ? MAX_MOBILE_UPLOAD_BYTES : MAX_DIRECT_UPLOAD_BYTES;
    if (originalBytes <= directLimit) {
        return { dataUrl, originalBytes, optimizedBytes: originalBytes, mobileMode, optimized: false };
    }

    let optimized = await 压缩DataUrl图片(
        dataUrl,
        mobileMode ? MAX_MOBILE_IMAGE_EDGE : MAX_OPTIMIZED_IMAGE_EDGE,
        mobileMode ? MOBILE_OPTIMIZED_IMAGE_QUALITY : OPTIMIZED_IMAGE_QUALITY
    );
    let optimizedBytes = 估算DataUrl字节数(optimized);

    if (mobileMode && optimizedBytes > directLimit) {
        optimized = await 压缩DataUrl图片(optimized, 900, 0.6);
        optimizedBytes = 估算DataUrl字节数(optimized);
    }

    return {
        dataUrl: optimized,
        originalBytes,
        optimizedBytes,
        mobileMode,
        optimized: optimized !== dataUrl
    };
};

const 读取下载链接 = (payload: any): string => {
    const candidates = [
        payload?.links?.download,
        payload?.data?.links?.download,
        payload?.download,
        payload?.download_url,
        payload?.downloadUrl,
        payload?.data?.download,
        payload?.data?.download_url,
        payload?.data?.downloadUrl,
        payload?.data?.url,
        payload?.data?.file?.url,
        payload?.file?.links?.download,
        payload?.file?.download,
        payload?.file?.download_url,
        payload?.file?.downloadUrl,
        payload?.file?.url,
        payload?.url
    ];
    return candidates.map(读取文本).find(Boolean) || '';
};

const 读取文件ID = (payload: any): string => (
    读取文本(payload?.file?.id)
    || 读取文本(payload?.id)
    || 读取文本(payload?.data?.file?.id)
    || 读取文本(payload?.data?.id)
);

const 构建稳定下载链接 = (payload: any): string => {
    const downloadUrl = 读取下载链接(payload);
    const fileId = 读取文件ID(payload);
    if (downloadUrl) return downloadUrl;
    if (!fileId) return '';
    return `${DEFAULT_IMAGE_HOST_BASE}/api/v1/file/${encodeURIComponent(fileId)}`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

const 读取重试次数 = (value: unknown): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 3;
    return Math.max(1, Math.min(5, Math.trunc(parsed)));
};

const 是否可重试上传失败 = (status: number, message: string): boolean => {
    if (status === 0 || status === 408 || status === 429) return true;
    if (status >= 500) return true;
    return /network|timeout|fetch|aborted|temporar/i.test(message);
};

const 构建图床失败诊断后缀 = (response: Response | null, uploadBytes: number, attempts: number, elapsedMs: number): string => {
    const proxyRequestId = response?.headers.get('X-Moran-Image-Proxy-Request-Id') || '';
    const upstreamStatus = response?.headers.get('X-Moran-Image-Upstream-Status') || '';
    const parts = [
        `HTTP ${response?.status || 0}`,
        upstreamStatus ? `上游 ${upstreamStatus}` : '',
        proxyRequestId ? `请求ID ${proxyRequestId}` : '',
        `上传 ${Math.round(uploadBytes / 1024)}KB`,
        `尝试 ${attempts} 次`,
        `耗时 ${elapsedMs}ms`
    ].filter(Boolean);
    return parts.join('，');
};

const 读取上传错误详情 = (payload: any, text: string, response: Response | null): string => {
    const rawMessage = 读取文本(payload?.error?.message)
        || 读取文本(payload?.error)
        || 读取文本(payload?.detail)
        || text.slice(0, 160)
        || `HTTP ${response?.status || 0}`;
    const upstreamStatus = Number(payload?.upstreamStatus || response?.headers.get('X-Moran-Image-Upstream-Status') || 0);
    const upstreamStatusText = 读取文本(payload?.upstreamStatusText);
    const requestId = 读取文本(payload?.requestId) || response?.headers.get('X-Moran-Image-Proxy-Request-Id') || '';
    const isTelegramTemporaryFailure = upstreamStatus >= 500
        || response?.status === 503
        || /error code:\s*1102/i.test(rawMessage)
        || /Service Unavailable/i.test(`${rawMessage} ${upstreamStatusText}`);
    if (isTelegramTemporaryFailure) {
        return [
            `TG图床上游暂时不可用：HTTP ${upstreamStatus || response?.status || 0}`,
            rawMessage && !/^HTTP\s+\d+$/i.test(rawMessage) ? rawMessage : '',
            requestId ? `请求ID ${requestId}` : '',
            '系统已重试，稍后会继续尝试；急用时可切换对象存储同步。'
        ].filter(Boolean).join('，');
    }
    return rawMessage;
};

export const 上传DataUrl到图床 = async (dataUrl: string, options?: 图床上传选项): Promise<图床上传结果> => {
    const normalized = 读取文本(dataUrl);
    if (!normalized || !是否DataUrl(normalized)) {
        throw new Error('只支持上传 data URL 图片');
    }

    const uploadPlan = await 优化待上传DataUrl(normalized).catch((error) => {
        recordDiagnosticLog('warn', '图床上传图片压缩失败，改用原图上传', {
            error: error?.message || String(error),
            originalBytes: 估算DataUrl字节数(normalized)
        });
        const originalBytes = 估算DataUrl字节数(normalized);
        return { dataUrl: normalized, originalBytes, optimizedBytes: originalBytes, mobileMode: 是否原生或移动端(), optimized: false };
    });
    const { blob, mimeType } = dataUrl转Blob(uploadPlan.dataUrl);
    const extension = 推断扩展名(mimeType);
    const fileName = 读取文本(options?.fileName) || `moranjianghu-image-${Date.now()}.${extension}`;
    const uploadUrl = `${buildImageHostProxyUrl(IMAGE_HOST_UPLOAD_PROXY_PATH)}?kind=image`;
    const maxAttempts = 读取重试次数(options?.maxAttempts);
    const uploadStartedAt = Date.now();
    options?.onProgress?.({
        stage: 'prepare',
        attempt: 0,
        maxAttempts,
        fileName,
        uploadBytes: blob.size,
        message: `准备上传图片 ${Math.round(blob.size / 1024)}KB`
    });

    recordDiagnosticLog('info', '图床上传开始', {
        fileName,
        mimeType,
        originalBytes: uploadPlan.originalBytes,
        uploadBytes: blob.size,
        optimizedBytes: uploadPlan.optimizedBytes,
        optimized: uploadPlan.optimized,
        mobileMode: uploadPlan.mobileMode,
        proxyUrl: uploadUrl
    });

    let payload: any = null;
    let text = '';
    let response: Response | null = null;
    let elapsedMs = 0;
    let lastMessage = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptStartedAt = Date.now();
        options?.onProgress?.({
            stage: 'attempt',
            attempt,
            maxAttempts,
            fileName,
            uploadBytes: blob.size,
            elapsedMs: Date.now() - uploadStartedAt,
            message: `正在上传图片 ${Math.round(blob.size / 1024)}KB（第 ${attempt}/${maxAttempts} 次）`
        });
        try {
            const form = new FormData();
            form.append('file', blob, fileName);
            response = await fetch(uploadUrl, {
                method: 'POST',
                body: form
            });
            text = await response.text();
            elapsedMs = Date.now() - uploadStartedAt;
            try {
                payload = text ? JSON.parse(text) : null;
            } catch {
                payload = null;
            }
            if (response.ok && payload?.success !== false) {
                lastMessage = '';
                break;
            }
            lastMessage = 读取上传错误详情(payload, text, response);
            if (attempt >= maxAttempts || !是否可重试上传失败(response.status, lastMessage)) break;
        } catch (error: any) {
            response = null;
            text = '';
            payload = null;
            elapsedMs = Date.now() - uploadStartedAt;
            lastMessage = error?.message || String(error);
            if (attempt >= maxAttempts || !是否可重试上传失败(0, lastMessage)) break;
        }
        const delayMs = Math.min(12000, 1200 * attempt * attempt);
        options?.onProgress?.({
            stage: 'retry',
            attempt,
            maxAttempts,
            fileName,
            uploadBytes: blob.size,
            elapsedMs,
            message: `图床上传暂时失败：${lastMessage}。${Math.round(delayMs / 1000)} 秒后自动重试`
        });
        await sleep(delayMs);
        elapsedMs = Date.now() - uploadStartedAt;
    }
    if (!response?.ok || payload?.success === false) {
        const message = lastMessage || 读取上传错误详情(payload, text, response);
        recordDiagnosticLog('error', '图床上传失败', {
            status: response?.status || 0,
            statusText: response?.statusText || '',
            elapsedMs,
            fileName,
            originalBytes: uploadPlan.originalBytes,
            uploadBytes: blob.size,
            optimized: uploadPlan.optimized,
            mobileMode: uploadPlan.mobileMode,
            attempts: maxAttempts,
            proxyRequestId: 读取文本(payload?.requestId) || response?.headers.get('X-Moran-Image-Proxy-Request-Id') || '',
            upstreamStatus: 读取文本(payload?.upstreamStatus) || response?.headers.get('X-Moran-Image-Upstream-Status') || '',
            upstreamStatusText: 读取文本(payload?.upstreamStatusText),
            upstreamContentLength: 读取文本(payload?.contentLength),
            responseSnippet: 截断诊断文本(text)
        });
        options?.onProgress?.({
            stage: 'failed',
            attempt: maxAttempts,
            maxAttempts,
            fileName,
            uploadBytes: blob.size,
            elapsedMs,
            message: `图床上传失败：${message}`
        });
        throw new Error(`图床上传失败：${message}（${构建图床失败诊断后缀(response, blob.size, maxAttempts, elapsedMs)}）`);
    }

    const url = 构建稳定下载链接(payload);
    if (!url) {
        recordDiagnosticLog('error', '图床上传响应缺少下载链接', {
            status: response.status,
            elapsedMs,
            fileName,
            responseSnippet: 截断诊断文本(text)
        });
        throw new Error('图床上传失败：响应中没有下载链接');
    }
    recordDiagnosticLog('info', '图床上传成功', {
        elapsedMs,
        fileName,
        originalBytes: uploadPlan.originalBytes,
        uploadBytes: blob.size,
        optimized: uploadPlan.optimized,
        id: 读取文件ID(payload) || '',
        storage: 读取文本(payload?.file?.storage) || ''
    });
    options?.onProgress?.({
        stage: 'success',
        attempt: maxAttempts,
        maxAttempts,
        fileName,
        uploadBytes: blob.size,
        elapsedMs,
        message: `图片上传成功，耗时 ${Math.round(elapsedMs / 1000)} 秒`
    });
    return {
        url,
        id: 读取文件ID(payload) || undefined,
        size: typeof payload?.file?.size === 'number' ? payload.file.size : undefined,
        storage: 读取文本(payload?.file?.storage) || undefined
    };
};

export const 上传Blob到图床 = async (blob: Blob, options?: 图床上传选项): Promise<图床上传结果> => {
    if (!(blob instanceof Blob) || blob.size <= 0) {
        throw new Error('上传文件失败：文件内容为空');
    }
    const fileName = 读取文本(options?.fileName) || `moranjianghu-file-${Date.now()}.bin`;
    const uploadUrl = `${buildImageHostProxyUrl(IMAGE_HOST_UPLOAD_PROXY_PATH)}?storage=telegram`;
    const maxAttempts = 读取重试次数(options?.maxAttempts);
    const uploadStartedAt = Date.now();
    options?.onProgress?.({
        stage: 'prepare',
        attempt: 0,
        maxAttempts,
        fileName,
        uploadBytes: blob.size,
        message: `准备上传文件 ${Math.round(blob.size / 1024)}KB`
    });

    recordDiagnosticLog('info', '图床上传文件开始', {
        fileName,
        uploadBytes: blob.size,
        mimeType: blob.type || 'application/octet-stream',
        proxyUrl: uploadUrl
    });

    let payload: any = null;
    let text = '';
    let response: Response | null = null;
    let elapsedMs = 0;
    let lastMessage = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        options?.onProgress?.({
            stage: 'attempt',
            attempt,
            maxAttempts,
            fileName,
            uploadBytes: blob.size,
            elapsedMs: Date.now() - uploadStartedAt,
            message: `正在上传文件 ${Math.round(blob.size / 1024)}KB（第 ${attempt}/${maxAttempts} 次）`
        });
        try {
            const form = new FormData();
            form.append('file', blob, fileName);
            response = await fetch(uploadUrl, {
                method: 'POST',
                body: form
            });
            text = await response.text();
            elapsedMs = Date.now() - uploadStartedAt;
            try {
                payload = text ? JSON.parse(text) : null;
            } catch {
                payload = null;
            }
            if (response.ok && payload?.success !== false) {
                lastMessage = '';
                break;
            }
            lastMessage = 读取上传错误详情(payload, text, response);
            if (attempt >= maxAttempts || !是否可重试上传失败(response.status, lastMessage)) break;
        } catch (error: any) {
            response = null;
            text = '';
            payload = null;
            elapsedMs = Date.now() - uploadStartedAt;
            lastMessage = error?.message || String(error);
            if (attempt >= maxAttempts || !是否可重试上传失败(0, lastMessage)) break;
        }
        const delayMs = Math.min(12000, 1200 * attempt * attempt);
        options?.onProgress?.({
            stage: 'retry',
            attempt,
            maxAttempts,
            fileName,
            uploadBytes: blob.size,
            elapsedMs,
            message: `图床上传暂时失败：${lastMessage}。${Math.round(delayMs / 1000)} 秒后自动重试`
        });
        await sleep(delayMs);
        elapsedMs = Date.now() - uploadStartedAt;
    }
    if (!response?.ok || payload?.success === false) {
        const message = lastMessage || 读取上传错误详情(payload, text, response);
        recordDiagnosticLog('error', '图床上传文件失败', {
            status: response?.status || 0,
            statusText: response?.statusText || '',
            elapsedMs,
            fileName,
            uploadBytes: blob.size,
            attempts: maxAttempts,
            proxyRequestId: 读取文本(payload?.requestId) || response?.headers.get('X-Moran-Image-Proxy-Request-Id') || '',
            upstreamStatus: 读取文本(payload?.upstreamStatus) || response?.headers.get('X-Moran-Image-Upstream-Status') || '',
            upstreamStatusText: 读取文本(payload?.upstreamStatusText),
            upstreamContentLength: 读取文本(payload?.contentLength),
            responseSnippet: 截断诊断文本(text)
        });
        options?.onProgress?.({
            stage: 'failed',
            attempt: maxAttempts,
            maxAttempts,
            fileName,
            uploadBytes: blob.size,
            elapsedMs,
            message: `图床上传文件失败：${message}`
        });
        throw new Error(`图床上传文件失败：${message}（${构建图床失败诊断后缀(response, blob.size, maxAttempts, elapsedMs)}）`);
    }

    const url = 构建稳定下载链接(payload);
    if (!url) {
        recordDiagnosticLog('error', '图床上传文件响应缺少下载链接', {
            status: response.status,
            elapsedMs,
            fileName,
            responseSnippet: 截断诊断文本(text)
        });
        throw new Error('图床上传文件失败：响应中没有下载链接');
    }
    recordDiagnosticLog('info', '图床上传文件成功', {
        elapsedMs,
        fileName,
        uploadBytes: blob.size,
        id: 读取文件ID(payload) || '',
        storage: 读取文本(payload?.file?.storage) || ''
    });
    options?.onProgress?.({
        stage: 'success',
        attempt: maxAttempts,
        maxAttempts,
        fileName,
        uploadBytes: blob.size,
        elapsedMs,
        message: `文件上传成功，耗时 ${Math.round(elapsedMs / 1000)} 秒`
    });
    return {
        url,
        id: 读取文件ID(payload) || undefined,
        size: typeof payload?.file?.size === 'number' ? payload.file.size : blob.size,
        storage: 读取文本(payload?.file?.storage) || undefined
    };
};
