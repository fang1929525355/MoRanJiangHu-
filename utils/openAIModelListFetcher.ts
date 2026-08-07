import { CapacitorHttp } from '@capacitor/core';
import { 构建OpenAI兼容模型列表候选地址 } from './apiConfig';
import { 是否原生Capacitor环境 } from './nativeRuntime';

export interface 模型列表获取配置 {
    baseUrl: string;
    apiKey: string;
    供应商?: string;
}

export const 获取OpenAI兼容模型列表 = async (config: 模型列表获取配置): Promise<string[]> => {
    const baseUrl = (config.baseUrl || '').trim();
    const apiKey = (config.apiKey || '').trim();
    if (!baseUrl || !apiKey) {
        throw new Error('请先填写当前配置的 API Key 和 Base URL');
    }

    const candidateUrls = 构建OpenAI兼容模型列表候选地址(baseUrl);
    const isMimo = config.供应商 === 'mimo_api'
        || config.供应商 === 'mimo_token_plan'
        || baseUrl.toLowerCase().includes('xiaomimimo.com');
    const headers = isMimo
        ? { 'api-key': apiKey }
        : { Authorization: `Bearer ${apiKey}` };

    let lastError: Error | null = null;
    for (const url of candidateUrls) {
        try {
            let data: any;
            if (是否原生Capacitor环境()) {
                const nativeRes = await CapacitorHttp.request({
                    url,
                    method: 'GET',
                    headers,
                    responseType: 'json'
                });
                if (nativeRes.status < 200 || nativeRes.status >= 300) continue;
                data = nativeRes.data;
            } else {
                const res = await fetch(url, { headers });
                if (!res.ok) continue;
                data = await res.json();
            }
            if (data && Array.isArray(data.data)) {
                // 只保留有效的字符串 id：部分兼容实现会返回数字 id 或嵌套对象，
                // 调用方（设置页）会对每项调用 .trim()，非字符串会直接抛 TypeError。
                const modelIds = data.data
                    .map((model: { id?: unknown }) => model?.id)
                    .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
                    .map((id: string) => id.trim());
                if (modelIds.length > 0) return modelIds;
            }
        } catch (e: any) {
            lastError = e;
        }
    }

    throw lastError || new Error('获取失败：返回格式错误。');
};
