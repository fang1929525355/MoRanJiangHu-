import { describe, expect, it, vi } from 'vitest';
import { __githubOAuthTestUtils } from '../hooks/useGitHubOAuth';

describe('GitHub OAuth APK 回调兜底', () => {
    it('网页桥接回调会把 pending state 带进 deep link', () => {
        const callbackUrl = 'https://msjh.bacon159.pp.ua/oauth/github/callback?code=abc&state=native%3Astate-123';
        const deepLink = __githubOAuthTestUtils.buildNativeBridgeDeepLink(callbackUrl);
        const url = new URL(deepLink || '');

        expect(url.protocol).toBe('com.moranjianghu.game:');
        expect(url.searchParams.get('code')).toBe('abc');
        expect(url.searchParams.get('state')).toBe('native:state-123');
        expect(url.searchParams.get('oauth_pending')).toBeTruthy();
    });

    it('pending state 丢失时可从 native 回调恢复交换所需状态', () => {
        const callbackUrl = 'com.moranjianghu.game://oauth/github/callback?code=abc&state=native%3Astate-123';
        const pending = __githubOAuthTestUtils.createFallbackPendingStateFromCallback(callbackUrl);

        expect(pending?.state).toBe('native:state-123');
        expect(pending?.clientType).toBe('web');
        expect(pending?.redirectUri).toBe('https://msjh.bacon159.pp.ua/oauth/github/callback');
        expect(pending?.expectedCallbackUris).toContain('com.moranjianghu.game://oauth/github/callback');
    });

    it('APK 环境优先用 Capacitor Browser 打开 GitHub 授权页', async () => {
        const browserOpen = vi.fn(async () => undefined);
        const windowOpen = vi.fn();

        await __githubOAuthTestUtils.openGitHubAuthPageForTest(
            'https://github.com/login/oauth/authorize?client_id=test',
            true,
            {
                loadBrowser: async () => ({ Browser: { open: browserOpen } }),
                windowOpen
            }
        );

        expect(browserOpen).toHaveBeenCalledWith({
            url: 'https://github.com/login/oauth/authorize?client_id=test',
            presentationStyle: 'fullscreen'
        });
        expect(windowOpen).not.toHaveBeenCalled();
    });

    it('备用域名网页端使用备用 GitHub OAuth App 和备用域名回调地址', () => {
        const result = __githubOAuthTestUtils.resolveWebOAuthClientForTest({
            currentOrigin: 'https://msjh.bacon.de5.net',
            primaryClientId: 'primary-client',
            backupClientId: 'backup-client'
        });

        expect(result.clientId).toBe('backup-client');
        expect(result.clientType).toBe('web_backup');
        expect(result.redirectUri).toBe('https://msjh.bacon.de5.net/oauth/github/callback');
        expect(result.expectedCallbackUris).toEqual(['https://msjh.bacon.de5.net/oauth/github/callback']);
    });

    it('主域名网页端继续使用主 GitHub OAuth App 和主域名回调地址', () => {
        const result = __githubOAuthTestUtils.resolveWebOAuthClientForTest({
            currentOrigin: 'https://msjh.bacon159.pp.ua',
            primaryClientId: 'primary-client',
            backupClientId: 'backup-client'
        });

        expect(result.clientId).toBe('primary-client');
        expect(result.clientType).toBe('web');
        expect(result.redirectUri).toBe('https://msjh.bacon159.pp.ua/oauth/github/callback');
        expect(result.expectedCallbackUris).toEqual(['https://msjh.bacon159.pp.ua/oauth/github/callback']);
    });

    it('本地预览域名仍使用已登记的主域名 redirect_uri，避免 GitHub redirect_uri 不匹配', () => {
        const result = __githubOAuthTestUtils.resolveWebOAuthClientForTest({
            currentOrigin: 'http://127.0.0.1:4173',
            primaryClientId: 'primary-client',
            backupClientId: 'backup-client'
        });

        expect(result.clientId).toBe('primary-client');
        expect(result.clientType).toBe('web');
        expect(result.redirectUri).toBe('https://msjh.bacon159.pp.ua/oauth/github/callback');
        expect(result.expectedCallbackUris).toEqual([
            'https://msjh.bacon159.pp.ua/oauth/github/callback',
            'http://127.0.0.1:4173/oauth/github/callback'
        ]);
    });

    it('构建时 Client ID 缺失时使用 Worker 运行时公开配置兜底', () => {
        const result = __githubOAuthTestUtils.resolveGitHubOAuthClientIdsForTest({
            buildWebClientId: '',
            buildBackupClientId: '',
            runtimeWebClientId: 'runtime-primary-client',
            runtimeBackupClientId: 'runtime-backup-client'
        });

        expect(result.webGitHubClientId).toBe('runtime-primary-client');
        expect(result.backupGitHubClientId).toBe('runtime-backup-client');
    });

    it('构建时 Client ID 已注入时优先使用构建配置', () => {
        const result = __githubOAuthTestUtils.resolveGitHubOAuthClientIdsForTest({
            buildWebClientId: 'build-primary-client',
            buildBackupClientId: 'build-backup-client',
            runtimeWebClientId: 'runtime-primary-client',
            runtimeBackupClientId: 'runtime-backup-client'
        });

        expect(result.webGitHubClientId).toBe('build-primary-client');
        expect(result.backupGitHubClientId).toBe('build-backup-client');
    });
});
