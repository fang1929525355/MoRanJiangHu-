import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NovelDecompositionApiSettings from '../components/features/Settings/NovelDecompositionApiSettings';
import { 测试小说拆分接口连接 } from '../services/novelDecompositionApiDiagnostics';
import { 规范化接口设置 } from '../utils/apiConfig';

const apiConfig = {
    id: 'novel',
    名称: '自建 Gemini2API',
    供应商: 'openai_compatible' as const,
    baseUrl: 'https://example.test/v1',
    apiKey: 'secret-key',
    model: 'gemini-2.5-flash',
    maxTokens: 32768
};

describe('小说分解接口设置', () => {
    it('显示独立的测试连接按钮与可读结果容器', () => {
        const settings = 规范化接口设置({
            configs: [apiConfig],
            activeConfigId: apiConfig.id,
            功能模型占位: {
                小说拆分功能启用: true,
                小说拆分独立模型开关: true,
                小说拆分渠道ID: apiConfig.id,
                小说拆分API地址: apiConfig.baseUrl,
                小说拆分API密钥: apiConfig.apiKey,
                小说拆分使用模型: 'models/gemini-2.5-flash'
            }
        } as any);

        const html = renderToStaticMarkup(
            <NovelDecompositionApiSettings settings={settings} onSave={() => undefined} />
        );

        expect(html).toContain('测试连接');
        expect(html).toContain('novel-api-connection-result');
    });

    it('连接成功时返回渠道、规范化模型、耗时与回复且不泄露密钥', async () => {
        const result = await 测试小说拆分接口连接(apiConfig, async () => 'OK');

        expect(result.ok).toBe(true);
        expect(result.identity).toBe('渠道：自建 Gemini2API｜模型：gemini-2.5-flash');
        expect(result.detail).toContain('回复：OK');
        expect(result.detail).not.toContain('secret-key');
    });

    it('连接失败时保留渠道、模型和完整上游错误且不泄露密钥', async () => {
        const result = await 测试小说拆分接口连接(apiConfig, async () => {
            throw new Error('404 Requested entity was not found');
        });

        expect(result.ok).toBe(false);
        expect(result.identity).toBe('渠道：自建 Gemini2API｜模型：gemini-2.5-flash');
        expect(result.detail).toContain('404 Requested entity was not found');
        expect(result.detail).not.toContain('secret-key');
    });
});
