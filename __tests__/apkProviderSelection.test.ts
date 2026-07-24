import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    resolvePreferredApkProvider,
    verifyRemoteApk
} from '../scripts/apk-provider-selection.mjs';

describe('APK provider selection helper', () => {
    it('exists as a separately testable release guard', () => {
        expect(existsSync(path.join(process.cwd(), 'scripts', 'apk-provider-selection.mjs'))).toBe(true);
    });

    it('exports remote verification and guarded provider selection', async () => {
        const selection = await import('../scripts/apk-provider-selection.mjs');

        expect(typeof selection.verifyRemoteApk).toBe('function');
        expect(typeof selection.resolvePreferredApkProvider).toBe('function');
    });

    it('defaults to Quark TV for release manifests', async () => {
        await expect(resolvePreferredApkProvider({})).resolves.toBe('quark-tv');
    });

    it('keeps an explicitly selected Quark TV provider', async () => {
        const fetchImpl = vi.fn();

        await expect(resolvePreferredApkProvider({
            requestedProvider: 'quark-tv',
            fetchImpl
        })).resolves.toBe('quark-tv');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('accepts a remote APK only when status, size, and SHA-256 all match', async () => {
        const bytes = Buffer.from('verified-apk-bytes');
        const apkSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        const fetchImpl = vi.fn().mockResolvedValue(new Response(bytes, {
            status: 200,
            headers: { 'Content-Length': String(bytes.byteLength) }
        }));

        await expect(verifyRemoteApk({
            url: 'https://download.example/release.apk',
            expectedSize: bytes.byteLength,
            expectedSha256: apkSha256,
            fetchImpl,
            timeoutMs: 1000
        })).resolves.toEqual(expect.objectContaining({ ok: true }));
    });

    it('rejects a GitHub Raw response whose body hash does not match', async () => {
        const expectedBytes = Buffer.from('expected-apk');
        const actualBytes = Buffer.from('tampered-apk');
        const apkSha256 = crypto.createHash('sha256').update(expectedBytes).digest('hex');

        await expect(verifyRemoteApk({
            url: 'https://download.example/release.apk',
            expectedSize: actualBytes.byteLength,
            expectedSha256: apkSha256,
            fetchImpl: vi.fn().mockResolvedValue(new Response(actualBytes, { status: 200 })),
            timeoutMs: 1000
        })).resolves.toEqual(expect.objectContaining({
            ok: false,
            reason: expect.stringContaining('SHA-256')
        }));
    });

    it('falls back to Quark TV when an explicitly requested GitHub Raw APK returns 404', async () => {
        const warn = vi.fn();
        const provider = await resolvePreferredApkProvider({
            requestedProvider: 'github-raw',
            githubRawUrl: 'https://download.example/missing.apk',
            apkSize: 123,
            apkSha256: 'a'.repeat(64),
            fetchImpl: vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })),
            timeoutMs: 1000,
            logger: { warn }
        });

        expect(provider).toBe('quark-tv');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('404'));
    });

    it('keeps GitHub Raw only after the remote APK passes validation', async () => {
        const bytes = Buffer.from('published-apk');
        const apkSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        const provider = await resolvePreferredApkProvider({
            requestedProvider: 'github-raw',
            githubRawUrl: 'https://download.example/release.apk',
            apkSize: bytes.byteLength,
            apkSha256,
            fetchImpl: vi.fn().mockResolvedValue(new Response(bytes, { status: 200 })),
            timeoutMs: 1000,
            logger: { warn: vi.fn() }
        });

        expect(provider).toBe('github-raw');
    });
});
