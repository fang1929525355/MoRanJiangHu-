import { describe, expect, it } from 'vitest';
import type { 当前可用接口结构 } from '../utils/apiConfig';
import { 构建主要角色资源补全配置签名 } from '../utils/npcResourceCompletionSignature';

const 构建接口 = (overrides: Partial<当前可用接口结构> = {}): 当前可用接口结构 => ({
    id: 'image',
    名称: '文生图',
    供应商: 'openai_compatible',
    协议覆盖: 'auto',
    baseUrl: 'https://example.com/v1',
    apiKey: '',
    model: 'image-model',
    maxTokens: 0,
    temperature: 0,
    ...overrides
});

describe('构建主要角色资源补全配置签名', () => {
    it('配置从不可用变为可用时会改变签名', () => {
        const unavailable = 构建主要角色资源补全配置签名({
            NPC生图已启用: true,
            普通生图接口可用: false,
            NSFW生图接口可用: false,
            普通生图接口: 构建接口(),
            NSFW生图接口: 构建接口({ 图片后端类型: 'comfyui' })
        });
        const available = 构建主要角色资源补全配置签名({
            NPC生图已启用: true,
            普通生图接口可用: true,
            NSFW生图接口可用: true,
            普通生图接口: 构建接口({ apiKey: 'configured-key' }),
            NSFW生图接口: 构建接口({ 图片后端类型: 'comfyui', ComfyUI工作流JSON: '{"1":{}}' })
        });

        expect(available).not.toBe(unavailable);
        expect(available).toContain('image-key:present');
        expect(available).toContain('nsfw-workflow:present');
    });

    it('只记录敏感配置是否存在，不写入实际内容', () => {
        const first = 构建主要角色资源补全配置签名({
            NPC生图已启用: true,
            普通生图接口可用: true,
            NSFW生图接口可用: true,
            普通生图接口: 构建接口({ apiKey: 'first-secret' }),
            NSFW生图接口: 构建接口({ apiKey: 'second-secret', ComfyUI工作流JSON: '{"secret":"first"}' })
        });
        const second = 构建主要角色资源补全配置签名({
            NPC生图已启用: true,
            普通生图接口可用: true,
            NSFW生图接口可用: true,
            普通生图接口: 构建接口({ apiKey: 'replacement-secret' }),
            NSFW生图接口: 构建接口({ apiKey: 'replacement-nsfw-secret', ComfyUI工作流JSON: '{"secret":"second"}' })
        });

        expect(second).toBe(first);
        expect(first).not.toContain('first-secret');
        expect(first).not.toContain('second-secret');
        expect(first).not.toContain('"secret"');
    });

    it('NPC 生图开关变化时会改变签名', () => {
        const base = {
            普通生图接口可用: true,
            NSFW生图接口可用: true,
            普通生图接口: 构建接口({ apiKey: 'configured' }),
            NSFW生图接口: 构建接口({ apiKey: 'configured' })
        };

        expect(构建主要角色资源补全配置签名({ ...base, NPC生图已启用: true }))
            .not.toBe(构建主要角色资源补全配置签名({ ...base, NPC生图已启用: false }));
    });
});
