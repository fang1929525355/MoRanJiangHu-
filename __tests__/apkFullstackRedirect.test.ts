import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildFullstackApkRedirect } from '../functions/api/apk/_shared';
import { onRequestGet as onLatestApkRequestGet } from '../functions/api/apk/latest.apk';

describe('Fullstack cloud APK redirect', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('redirects the latest APK through the signed Fullstack cloud mount', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 200,
            data: { content: [{ name: 'latest.apk', is_dir: false, sign: 'fullstack sign' }] }
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await buildFullstackApkRedirect(
            { MORAN_OPENLIST_AUTH_TOKEN: 'token', MORAN_OPENLIST_BASE_URL: 'https://openlist.example' },
            'latest.apk',
            'MoRanJiangHu-v1.0.633.apk'
        );

        expect(fetchMock).toHaveBeenCalledWith(
            'https://openlist.example/api/fs/list',
            expect.objectContaining({
                body: JSON.stringify({
                    path: '/全栈云盘/MoRanJiangHu/releases',
                    password: '',
                    page: 1,
                    per_page: 100,
                    refresh: false
                })
            })
        );
        expect(response?.status).toBe(302);
        expect(response?.headers.get('Location')).toBe(
            'https://openlist.example/d/%E5%85%A8%E6%A0%88%E4%BA%91%E7%9B%98/MoRanJiangHu/apk/latest.apk?sign=fullstack%20sign'
        );
        expect(response?.headers.get('X-Moran-Apk-Source')).toBe('fullstack');
    });

    it('uses Fullstack cloud for an explicitly requested latest APK provider', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 200,
            data: { content: [{ name: 'latest.apk', is_dir: false, sign: 'latest-sign' }] }
        }), { status: 200 })));

        const response = await onLatestApkRequestGet({
            request: new Request('https://msjh.bacon159.pp.ua/api/apk/latest.apk?provider=fullstack'),
            env: {
                MORAN_OPENLIST_AUTH_TOKEN: 'token',
                RELEASE_MANIFEST: {
                    get: async () => ({ latest: { versionName: '1.0.633', versionCode: 633 } })
                }
            }
        } as any);

        expect(response.status).toBe(302);
        expect(response.headers.get('X-Moran-Apk-Source')).toBe('fullstack');
    });
});
