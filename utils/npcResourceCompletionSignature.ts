import type { 当前可用接口结构 } from './apiConfig';

const 配置字段是否存在 = (value: unknown): boolean => (
    typeof value === 'string' && value.trim().length > 0
);

export const 构建主要角色资源补全配置签名 = (options: {
    NPC生图已启用: boolean;
    普通生图接口可用: boolean;
    NSFW生图接口可用: boolean;
    普通生图接口: 当前可用接口结构 | null;
    NSFW生图接口: 当前可用接口结构 | null;
}): string => [
    options.NPC生图已启用 ? 'npc:on' : 'npc:off',
    options.普通生图接口可用 ? 'image-api:ready' : 'image-api:unavailable',
    配置字段是否存在(options.普通生图接口?.apiKey) ? 'image-key:present' : 'image-key:missing',
    配置字段是否存在(options.普通生图接口?.ComfyUI工作流JSON) ? 'image-workflow:present' : 'image-workflow:missing',
    options.NSFW生图接口可用 ? 'nsfw-api:ready' : 'nsfw-api:unavailable',
    配置字段是否存在(options.NSFW生图接口?.apiKey) ? 'nsfw-key:present' : 'nsfw-key:missing',
    配置字段是否存在(options.NSFW生图接口?.ComfyUI工作流JSON) ? 'nsfw-workflow:present' : 'nsfw-workflow:missing'
].join('__');
