import { describe, expect, it } from 'vitest';
import { 提取图片资源引用列表 } from '../hooks/useImageAssetPrefetch';
import {
    创建图片资源引用,
    获取图片资源文本地址,
    获取图片安全预览地址,
    清空图片资源缓存,
    注册图片资源缓存,
    注册远程图片兜底引用,
    图片资源记录含可恢复地址
} from '../utils/imageAssets';

describe('imageAssets', () => {
    it('treats successful local or remote image records as recoverable without requiring a warm cache', () => {
        expect(图片资源记录含可恢复地址({ 本地路径: 'wuxia-asset://npc-avatar-1' })).toBe(true);
        expect(图片资源记录含可恢复地址({ 图片URL: 'https://image.bacon159.pp.ua/api/v1/file/abc' })).toBe(true);
        expect(图片资源记录含可恢复地址({ 本地路径: '' })).toBe(false);
    });

    it('extracts local fallback refs for remote image-host URLs', () => {
        const remoteUrl = 'https://image.bacon159.pp.ua/api/v1/file/npc-avatar-remote.png';
        const fallbackRef = 创建图片资源引用('npc-avatar-fallback');
        注册远程图片兜底引用(remoteUrl, fallbackRef);

        expect(提取图片资源引用列表({ 图片URL: remoteUrl })).toContain(fallbackRef);
    });

    it('扫描图片引用时跳过超长剧情和 base64 文本，不为无关大字符串创建 trim 副本', () => {
        const originalTrim = String.prototype.trim;
        let longStringTrimCalls = 0;
        String.prototype.trim = function trimWithCounter() {
            if (this.length > 16 * 1024) longStringTrimCalls += 1;
            return originalTrim.call(this);
        };

        try {
            expect(提取图片资源引用列表({
                剧情正文: `  ${'长剧情'.repeat(20000)}  `,
                原始图片: `data:image/png;base64,${'A'.repeat(100000)}`,
                图片URL: 'wuxia-asset://npc-avatar-small'
            })).toContain('wuxia-asset://npc-avatar-small');
            expect(longStringTrimCalls).toBe(0);
        } finally {
            String.prototype.trim = originalTrim;
        }
    });

    it('uses the local cached copy before a registered remote fallback URL', () => {
        const remoteUrl = 'https://image.bacon159.pp.ua/api/v1/file/player-avatar.png';
        const fallbackRef = 创建图片资源引用('player-avatar-local');
        const dataUrl = 'data:image/png;base64,LOCAL_AVATAR';
        注册远程图片兜底引用(remoteUrl, fallbackRef);
        注册图片资源缓存('player-avatar-local', dataUrl);

        expect(获取图片资源文本地址(remoteUrl)).toBe(dataUrl);
    });

    it('falls back to the registered remote URL when a local asset ref has no warm cache', () => {
        const remoteUrl = 'https://image.bacon159.pp.ua/api/v1/file/player-avatar-cloud.png';
        const fallbackRef = 创建图片资源引用('player-avatar-cloud-local');
        清空图片资源缓存();
        注册远程图片兜底引用(remoteUrl, fallbackRef);

        expect(获取图片资源文本地址(fallbackRef)).toBe(remoteUrl);
    });

    it('uses the registered image-host URL when a local asset ref has no warm cache', () => {
        const remoteUrl = 'https://image.bacon159.pp.ua/api/v1/file/nsfw-secret-part.png';
        const fallbackRef = 创建图片资源引用('npc-secret-part-local');
        清空图片资源缓存();
        注册远程图片兜底引用(remoteUrl, fallbackRef);

        expect(获取图片资源文本地址(fallbackRef)).toBe(remoteUrl);
        expect(图片资源记录含可恢复地址({ 本地路径: fallbackRef })).toBe(true);
    });

    it('safe preview keeps local asset refs so DataUrlSafeImage can load the real image from IndexedDB', () => {
        const remoteUrl = 'https://image.bacon159.pp.ua/api/v1/file/gallery-preview.png';
        const fallbackRef = 创建图片资源引用('gallery-preview-local');
        清空图片资源缓存();
        注册远程图片兜底引用(remoteUrl, fallbackRef);

        expect(获取图片资源文本地址(fallbackRef)).toBe(remoteUrl);
        expect(获取图片安全预览地址({ 本地路径: fallbackRef, 图片URL: remoteUrl })).toBe(fallbackRef);
    });
});
