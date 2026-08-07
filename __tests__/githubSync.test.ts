import { describe, expect, it, vi, beforeEach } from 'vitest';

let mockIsNative = false;
let mockSyncBaseUrl = '';

vi.mock('../utils/nativeRuntime', () => ({
    构建同步API地址: (path: string) => {
        const base = mockSyncBaseUrl.replace(/\/+$/, '');
        return base ? `${base}${path}` : path;
    },
    是否原生Capacitor环境: () => mockIsNative
}));

const { 构建GitHub代理地址, 构建GitHub代理地址列表 } = await import('../services/githubSync');

describe('GitHub 云同步代理地址', () => {
    beforeEach(() => {
        mockIsNative = false;
        mockSyncBaseUrl = '';
    });

    it('网页端且未配置同步基址时保留相对路径（fetch 会自动补全 origin）', () => {
        mockIsNative = false;
        mockSyncBaseUrl = '';
        expect(构建GitHub代理地址('/api/github/release-download')).toBe('/api/github/release-download');
    });

    it('原生端且未配置同步基址时兜底到主站绝对地址', () => {
        mockIsNative = true;
        mockSyncBaseUrl = '';
        expect(构建GitHub代理地址('/api/github/release-download')).toBe('https://msjh.bacon159.pp.ua/api/github/release-download');
        expect(构建GitHub代理地址('/api/github/release-upload')).toBe('https://msjh.bacon159.pp.ua/api/github/release-upload');
    });

    it('已配置同步基址时直接使用配置值', () => {
        mockIsNative = true;
        mockSyncBaseUrl = 'https://sync.example.com';
        expect(构建GitHub代理地址('/api/github/release-download')).toBe('https://sync.example.com/api/github/release-download');
    });

    it('已配置同步基址且带尾随斜杠时正确处理', () => {
        mockIsNative = false;
        mockSyncBaseUrl = 'https://sync.example.com/';
        expect(构建GitHub代理地址('/api/github/release-download')).toBe('https://sync.example.com/api/github/release-download');
    });

    it('地址列表去重并包含主备站兜底', () => {
        mockIsNative = true;
        mockSyncBaseUrl = '';
        const list = 构建GitHub代理地址列表('/api/github/release-download');
        expect(list).toEqual([
            'https://msjh.bacon159.pp.ua/api/github/release-download',
            'https://msjh.bacon.de5.net/api/github/release-download'
        ]);
    });
});
