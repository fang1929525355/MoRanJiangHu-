import { describe, expect, it } from 'vitest';
import {
    规范化Gemini模型资源ID,
    格式化小说拆分接口身份
} from '../utils/apiConfig';

describe('小说分解接口诊断', () => {
    it('仅移除 Gemini 模型资源前缀', () => {
        expect(规范化Gemini模型资源ID('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');
        expect(规范化Gemini模型资源ID('MODELS/gemini-2.5-pro')).toBe('gemini-2.5-pro');
        expect(规范化Gemini模型资源ID('vendor/gemini-2.5-flash')).toBe('vendor/gemini-2.5-flash');
    });

    it('接口身份包含渠道与模型且不泄露密钥', () => {
        const text = 格式化小说拆分接口身份({
            id: 'novel',
            名称: '自建 Gemini2API',
            供应商: 'openai_compatible',
            baseUrl: 'https://example.test/v1',
            apiKey: 'secret-key',
            model: 'gemini-2.5-flash',
            maxTokens: 32768
        });

        expect(text).toBe('渠道：自建 Gemini2API｜模型：gemini-2.5-flash');
        expect(text).not.toContain('secret-key');
    });

    it('接口缺失时仍返回可读身份', () => {
        expect(格式化小说拆分接口身份(null)).toBe('渠道：小说分解独立接口｜模型：未配置');
    });
});
