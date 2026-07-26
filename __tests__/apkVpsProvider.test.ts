import { describe, expect, it } from 'vitest';

import { resolveApkDownload } from '../functions/api/apk/_providerRouter';

describe('VPS APK provider', () => {
    it('redirects the preferred download to the versioned VPS APK', async () => {
        const resolved = await resolveApkDownload({
            env: { MORAN_VPS_APK_BASE_URL: 'https://moranjianghu.bacon159.pp.ua' },
            preferredProvider: 'vps',
            versionName: '1.0.629',
            storageFileName: 'MoRanJiangHu-v1.0.629.apk',
            downloadFileName: 'MoRanJiangHu-v1.0.629.apk'
        });

        expect(resolved?.provider).toBe('vps');
        expect(resolved?.response.status).toBe(302);
        expect(resolved?.response.headers.get('Location')).toBe(
            'https://moranjianghu.bacon159.pp.ua/MoRanJiangHu-v1.0.629.apk'
        );
        expect(resolved?.response.headers.get('X-Moran-Apk-Source')).toBe('vps');
    });
});
