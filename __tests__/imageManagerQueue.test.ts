import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => (
    readFileSync(resolve(process.cwd(), path), 'utf8')
);

describe('image manager queue tab composition', () => {
    it('图片管理器打开时不递归预取整份存档图片数据', () => {
        const desktop = readSource('components/features/Social/ImageManagerModal.tsx');
        const mobile = readSource('components/features/Social/mobile/MobileImageManagerModal.tsx');
        const unsafeCall = 'use图片资源回源预取(socialList, playerCharacter, sceneArchive, currentPersistentWallpaper, apiConfig);';

        expect(desktop).not.toContain(unsafeCall);
        expect(mobile).not.toContain(unsafeCall);
    });

    it('桌面与移动物品图库使用分页读取而不是 getAll 全量读取', () => {
        const desktop = readSource('components/features/Social/ImageManagerModal.tsx');
        const mobile = readSource('components/features/Social/mobile/MobileImageManagerModal.tsx');

        expect(desktop).toContain('分页读取用户图库');
        expect(mobile).toContain('分页读取用户图库');
        expect(desktop).not.toContain('获取用户图库全部条目');
        expect(mobile).not.toContain('获取用户图库全部条目');
    });

    it('图库分页使用排他主键游标且不在返回前打乱游标顺序', () => {
        const source = readSource('services/dbService.ts');
        const start = source.indexOf('export const 分页读取用户图库');
        const end = source.indexOf('export const 获取用户图库全部条目', start);
        const paginationSource = source.slice(start, end);

        expect(paginationSource).toContain('IDBKeyRange.upperBound(beforeId, true)');
        expect(paginationSource).not.toContain('entries.sort');
    });

    it('桌面图库保留裸 assetId 与远程 URL，只清理两者都为空的空记录', () => {
        const desktop = readSource('components/features/Social/ImageManagerModal.tsx');
        expect(desktop).toContain("const hasAssetId = Boolean(entry.assetId && entry.assetId.trim());");
        expect(desktop).toContain("const hasImageUrl = Boolean(entry.imageUrl && entry.imageUrl.trim());");
        expect(desktop).toContain('if (hasAssetId || hasImageUrl)');
        expect(desktop).not.toContain("entry.assetId.startsWith('data:')");
    });

    it('URL-only 图库记录直接预览远程图片，本地资源缺失或解码失败时回退到 imageUrl', () => {
        const desktop = readSource('components/features/Social/ImageManagerModal.tsx');
        expect(desktop).toContain('if (!assetId && imageUrl)');
        expect(desktop).toContain('setGalleryPreviewOriginal(imageUrl)');
        expect(desktop).toContain('} else if (imageUrl) {');
        expect(desktop).toContain('onError={() => {');
        expect(desktop).toContain('galleryPreviewOriginal !== imageUrl');
        expect(desktop).toContain('图片加载失败，且无可用的远程兜底地址。');
    });
    it('图库列表错误独立显示并提供重试，加载按钮禁用态保持日间可读', () => {
        const desktop = readSource('components/features/Social/ImageManagerModal.tsx');
        expect(desktop).toContain("const [galleryError, setGalleryError] = React.useState('');");
        expect(desktop).toContain("setGalleryError('读取图库失败，请重试。')");
        expect(desktop).toContain("setGalleryError('继续读取图库失败，请重试。')");
        expect(desktop).toContain('onClick={() => void refreshGallery()}');
        expect(desktop).toContain('disabled:text-gray-100');
        expect(desktop).not.toContain('disabled:opacity-50');
    });

    it('does not stack the desktop queue tab with a separate history tab', () => {
        const source = readSource('components/features/Social/ImageManagerModal.tsx');

        expect(source).not.toContain("activeTab === 'queue' && <>{renderQueueTab()}<div className=\"mt-6\">{renderHistoryTab()}</div></>");
        expect(source).toContain("activeTab === 'queue' && renderHistoryTab(true)");
        expect(source).toContain('实时队列状态');
    });

    it('does not stack the mobile queue tab with a separate history tab', () => {
        const source = readSource('components/features/Social/mobile/MobileImageManagerModal.tsx');

        expect(source).not.toContain('return <><QueueTabContent {...propsForTabs} /><div className="mt-4"><HistoryTabContent {...propsForTabs} /></div></>;');
        expect(source).toContain('return <HistoryTabContent {...propsForTabs} queueMode />;');
        expect(source).toContain('下方继续沿用生成历史框架展示完整记录。');
    });
});
