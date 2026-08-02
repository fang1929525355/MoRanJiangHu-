import type { 当前可用接口结构 } from '../utils/apiConfig';
import { 格式化小说拆分接口身份, 规范化Gemini模型资源ID } from '../utils/apiConfig';
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

const 隐藏接口密钥 = (text: string, apiKey: string): string => {
    const secret = (apiKey || '').trim();
    return secret ? text.split(secret).join('[已隐藏]') : text;
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
        const raw = error?.detail ?? error?.message ?? error ?? '未知错误';
        const detail = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
        return {
            ok: false,
            identity,
            detail: 隐藏接口密钥(detail, normalizedApiConfig.apiKey)
        };
    }
};
