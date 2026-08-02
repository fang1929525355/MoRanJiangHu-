import type { 接口设置结构 } from '../types';
import type { 当前可用接口结构 } from '../utils/apiConfig';
import {
    格式化小说拆分接口身份,
    获取小说拆分接口配置,
    规范化Gemini模型资源ID,
    规范化接口设置
} from '../utils/apiConfig';
import { 请求模型文本, type 通用消息 } from './ai/chatCompletionClient';

export interface 小说拆分连接测试结果 {
    ok: boolean;
    identity: string;
    detail: string;
}

type 小说拆分连接测试请求器 = (
    apiConfig: 当前可用接口结构,
    messages: 通用消息[],
    options: Parameters<typeof 请求模型文本>[2]
) => Promise<string>;

export interface 小说拆分连接测试草稿解析结果 {
    apiConfig: 当前可用接口结构 | null;
    failure?: 小说拆分连接测试结果;
}

const 隐藏接口密钥 = (text: string, apiKey: string): string => {
    const secret = (apiKey || '').trim();
    return secret ? text.split(secret).join('[已隐藏]') : text;
};

export const 构建小说拆分接口日志文本 = (
    apiConfig: 当前可用接口结构 | null | undefined,
    message: string
): string => 隐藏接口密钥(
    `${(message || '').trim()}（${格式化小说拆分接口身份(apiConfig)}）`,
    apiConfig?.apiKey || ''
);

export const 解析小说拆分连接测试草稿 = (
    settings: 接口设置结构
): 小说拆分连接测试草稿解析结果 => {
    const normalized = 规范化接口设置(settings);
    const feature = normalized.功能模型占位;
    const independentEnabled = Boolean(feature.小说拆分独立模型开关);

    if (independentEnabled) {
        const baseUrl = (feature.小说拆分API地址 || '').trim();
        const apiKey = (feature.小说拆分API密钥 || '').trim();
        const model = 规范化Gemini模型资源ID(feature.小说拆分使用模型);
        const selected = normalized.configs.find((item) => item.id === feature.小说拆分渠道ID)
            || normalized.configs.find((item) => item.id === normalized.activeConfigId)
            || normalized.configs[0];
        const identity = `渠道：${selected?.名称 || '小说分解独立接口'}｜模型：${model || '未配置'}`;
        const missing = [
            !baseUrl ? 'Base URL' : '',
            !apiKey ? 'API Key' : '',
            !model ? '模型名称' : ''
        ].filter(Boolean);
        if (missing.length > 0) {
            return {
                apiConfig: null,
                failure: {
                    ok: false,
                    identity,
                    detail: `测试失败：请先填写${missing.join('、')}。`
                }
            };
        }
    }

    const apiConfig = 获取小说拆分接口配置(normalized);
    if (!apiConfig?.baseUrl || !apiConfig.apiKey || !apiConfig.model) {
        return {
            apiConfig: null,
            failure: {
                ok: false,
                identity: 格式化小说拆分接口身份(apiConfig),
                detail: '测试失败：请先填写可用的 Base URL、API Key 与模型名称。'
            }
        };
    }
    return { apiConfig };
};

export const 测试小说拆分接口连接 = async (
    apiConfig: 当前可用接口结构,
    requester: 小说拆分连接测试请求器 = 请求模型文本
): Promise<小说拆分连接测试结果> => {
    const normalizedApiConfig = {
        ...apiConfig,
        model: 规范化Gemini模型资源ID(apiConfig.model)
    };
    const identity = 格式化小说拆分接口身份(normalizedApiConfig);
    const startedAt = Date.now();

    try {
        const text = await requester(normalizedApiConfig, [
            { role: 'user', content: '你好，请只回复 OK。' }
        ], {
            temperature: 0,
            streamOptions: { stream: false },
            errorDetailLimit: Number.POSITIVE_INFINITY,
            disableThinking: true,
            stripReasoning: true
        });
        const elapsed = Date.now() - startedAt;
        const reply = (text || '').trim() || '无文本回复';
        return {
            ok: true,
            identity,
            detail: 隐藏接口密钥(`耗时：${elapsed}ms\n回复：${reply}`, normalizedApiConfig.apiKey)
        };
    } catch (error: any) {
        const elapsed = Date.now() - startedAt;
        const raw = error?.detail ?? error?.message ?? error ?? '未知错误';
        const detail = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
        return {
            ok: false,
            identity,
            detail: 隐藏接口密钥(`耗时：${elapsed}ms\n${detail}`, normalizedApiConfig.apiKey)
        };
    }
};
