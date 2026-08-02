import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NovelDecompositionApiSettings from '../components/features/Settings/NovelDecompositionApiSettings';
import { 解析小说拆分连接测试草稿, 测试小说拆分接口连接 } from '../services/novelDecompositionApiDiagnostics';
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
        expect(result.detail).toMatch(/^耗时：\d+ms\n/);
        expect(result.detail).toContain('404 Requested entity was not found');
        expect(result.detail).not.toContain('secret-key');
    });

    it('独立草稿缺少密钥时不回退到已保存渠道密钥', () => {
        const settings = 规范化接口设置({
            configs: [apiConfig],
            activeConfigId: apiConfig.id,
            功能模型占位: {
                小说拆分功能启用: true,
                小说拆分独立模型开关: true,
                小说拆分渠道ID: apiConfig.id,
                小说拆分API地址: 'https://draft.example.test/v1',
                小说拆分API密钥: '',
                小说拆分使用模型: 'models/gemini-2.5-pro'
            }
        } as any);

        const draft = 解析小说拆分连接测试草稿(settings);

        expect(draft.apiConfig).toBeNull();
        expect(draft.failure?.identity).toBe('渠道：自建 Gemini2API｜模型：gemini-2.5-pro');
        expect(draft.failure?.detail).toContain('API Key');
    });

    it('测试中按钮使用暖色表面而不是近黑背景', () => {
        const source = fs.readFileSync(
            path.join(process.cwd(), 'components/features/Settings/NovelDecompositionApiSettings.tsx'),
            'utf8'
        );

        expect(source).toContain("testingConnection ? '!bg-amber-100/85");
    });
});
