import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const downloadAndInstallMock = vi.fn();
const addListenerMock = vi.fn(async () => ({ remove: vi.fn() }));
const getInstalledApkInfoMock = vi.fn(async () => ({ sha256: 'old-sha', fileSize: 1 }));

vi.mock('../data/releaseInfo', () => ({
    RELEASE_INFO: {
        versionCode: 290,
        versionName: '1.0.289',
        updateManifestUrl: 'https://msjh.bacon159.pp.ua/api/apk/latest.json',
        apkDownloadUrl: 'https://msjh.bacon159.pp.ua/api/apk/latest.apk',
        releaseNotes: []
    }
}));

const nativeRuntimeMock = vi.hoisted(() => ({
    native: true,
    appPluginAvailable: true
}));

vi.mock('../utils/nativeRuntime', () => ({
    isNativeCapacitorEnvironment: () => nativeRuntimeMock.native,
    isCapacitorPluginAvailable: (name: string) => name === 'App' ? nativeRuntimeMock.appPluginAvailable : false
}));

vi.mock('@capacitor/app', () => ({
    App: {
        getInfo: vi.fn(async () => ({ build: '289', version: '1.0.288' }))
    }
}));

vi.mock('../services/nativeApkUpdater', () => ({
    NativeApkUpdater: {
        addListener: addListenerMock,
        downloadAndInstall: downloadAndInstallMock,
        getInstalledApkInfo: getInstalledApkInfoMock
    }
}));

const createLocalStorageMock = () => {
    const store = new Map<string, string>();
    return {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            store.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
            store.delete(key);
        }),
        clear: vi.fn(() => {
            store.clear();
        })
    };
};

describe('appUpdate native APK download', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        nativeRuntimeMock.native = true;
        nativeRuntimeMock.appPluginAvailable = true;
        vi.stubGlobal('localStorage', createLocalStorageMock());
        vi.stubGlobal('window', {
            location: { href: 'capacitor://localhost' },
            confirm: vi.fn(() => true),
            alert: vi.fn(),
            setTimeout: vi.fn((callback: () => void) => {
                callback();
                return 1;
            })
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('falls back to latest.apk when the versioned APK candidate fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            latest: {
                versionCode: 290,
                versionName: '1.0.289',
                apkSha256: 'new-sha',
                apkSize: 123456,
                directApkUrl: 'https://msjh.bacon159.pp.ua/api/apk/version/MoRanJiangHu-v1.0.289.apk',
                latestApkUrl: 'https://msjh.bacon159.pp.ua/api/apk/latest.apk',
                changes: ['测试更新']
            }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
        downloadAndInstallMock
            .mockRejectedValueOnce(new Error('下载更新失败，HTTP 404'))
            .mockResolvedValueOnce({ filePath: '/tmp/latest.apk', versionName: '1.0.289' });

        const { checkForAppUpdate } = await import('../services/appUpdate');
        const result = await checkForAppUpdate();

        expect(result.opened).toBe(true);
        expect(downloadAndInstallMock).toHaveBeenCalledTimes(2);
        expect(downloadAndInstallMock.mock.calls[0][0].url).toBe('https://msjh.bacon159.pp.ua/api/apk/version/MoRanJiangHu-v1.0.289.apk');
        expect(downloadAndInstallMock.mock.calls[1][0].url).toBe('https://msjh.bacon159.pp.ua/api/apk/latest.apk');
    });

    it('chooses the fastest available APK source among GitHub accelerators, OneDrive and OneDrive direct', async () => {
        const githubAcceleratedUrl = 'https://gh.ddlc.top/https://github.com/ypq123456789/MoRanJiangHu/releases/download/v1.0.289/MoRanJiangHu-v1.0.289.apk';
        const oneDriveUrl = 'https://msjh.bacon159.pp.ua/api/apk/latest.apk?provider=onedrive';
        const oneDriveDirectUrl = 'https://msjh.bacon159.pp.ua/api/apk/latest.apk?provider=onedrive-direct';

        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (init?.method === 'HEAD') {
                if (url === githubAcceleratedUrl) {
                    await delay(160);
                    return new Response(null, { status: 200 });
                }
                if (url === oneDriveUrl) {
                    await delay(300);
                    return new Response(null, { status: 200 });
                }
                if (url === oneDriveDirectUrl) {
                    await delay(5);
                    return new Response(null, { status: 200 });
                }
                return new Response(null, { status: 404 });
            }
            return new Response(JSON.stringify({
                latest: {
                    versionCode: 290,
                    versionName: '1.0.289',
                    apkSha256: 'new-sha',
                    apkSize: 123456,
                    apkUrls: [githubAcceleratedUrl, oneDriveUrl, oneDriveDirectUrl],
                    changes: ['测试更新']
                }
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }));
        downloadAndInstallMock.mockResolvedValueOnce({ filePath: '/tmp/onedrive-direct.apk', versionName: '1.0.289' });

        const { checkForAppUpdate } = await import('../services/appUpdate');
        const result = await checkForAppUpdate();

        expect(result.opened).toBe(true);
        expect(downloadAndInstallMock).toHaveBeenCalledTimes(1);
        expect(downloadAndInstallMock.mock.calls[0][0].url).toBe(oneDriveDirectUrl);
    });

    it('falls back to bundled release info when the App plugin is unavailable in native webview mode', async () => {
        nativeRuntimeMock.appPluginAvailable = false;
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            latest: {
                versionCode: 290,
                versionName: '1.0.289',
                apkSha256: 'new-sha',
                apkSize: 123456,
                latestApkUrl: 'https://msjh.bacon159.pp.ua/api/apk/latest.apk',
                changes: ['测试更新']
            }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
        downloadAndInstallMock.mockResolvedValueOnce({ filePath: '/tmp/latest.apk', versionName: '1.0.289' });

        const { getCurrentAppRelease, checkForAppUpdate } = await import('../services/appUpdate');

        await expect(getCurrentAppRelease()).resolves.toEqual({
            versionCode: 290,
            versionName: '1.0.289'
        });

        const result = await checkForAppUpdate();
        expect(result.opened).toBe(true);
    });

    it('downloads the web APK through a Blob URL without navigating to a cross-origin redirect', async () => {
        nativeRuntimeMock.native = false;
        const click = vi.fn();
        const remove = vi.fn();
        const appendChild = vi.fn();
        const revokeObjectURL = vi.fn();
        const createObjectURL = vi.fn(() => 'blob:https://msjh.bacon159.pp.ua/apk');
        const link: Record<string, any> = { click, remove, style: {} };
        vi.stubGlobal('document', {
            body: { appendChild },
            createElement: vi.fn(() => link)
        });
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
        const apkBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
        const fetchMock = vi.fn(async () => new Response(apkBytes, {
            status: 200,
            headers: { 'Content-Type': 'application/vnd.android.package-archive' }
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { downloadLatestApkPackage } = await import('../services/appUpdate');
        await downloadLatestApkPackage();

        expect(fetchMock).toHaveBeenCalledWith(
            'https://msjh.bacon159.pp.ua/api/apk/latest.apk',
            expect.objectContaining({ method: 'GET' })
        );
        expect(link.href).toBe('blob:https://msjh.bacon159.pp.ua/apk');
        expect(link.download).toBe('MoRanJiangHu-v1.0.289.apk');
        expect(click).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:https://msjh.bacon159.pp.ua/apk');
    });
});
