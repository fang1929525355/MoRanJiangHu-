import { describe, expect, it, vi } from 'vitest';

import {
    uploadApkFileToOpenListWithCurl,
    uploadApkToOpenList,
    verifyOpenListApkFiles
} from '../scripts/upload-apk-onedrive.mjs';

describe('Quark APK upload', () => {
    it('uploads a local APK file to encoded Quark paths with curl', () => {
        const calls: string[][] = [];
        const spawnImpl = vi.fn((_command, args: string[]) => {
            calls.push(args);
            return { status: 0, stdout: JSON.stringify({ code: 200 }), stderr: '' };
        });

        uploadApkFileToOpenListWithCurl({
            apkPath: 'android/app/build/outputs/apk/release/app-release.apk',
            versionName: '1.0.627',
            targetRoot: '/夸克/MoRanJiangHu/releases',
            baseUrl: 'https://openlist.example',
            authToken: 'token',
            timeoutMs: 1000,
            spawnImpl
        });

        expect(calls).toHaveLength(2);
        const filePathHeaders = calls.map((args) => String(args.find((arg) => arg.startsWith('File-Path: '))));
        expect(filePathHeaders.map((header) => decodeURI(header.replace('File-Path: ', '')))).toEqual([
            '/夸克/MoRanJiangHu/releases/latest.apk',
            '/夸克/MoRanJiangHu/releases/MoRanJiangHu-v1.0.627.apk'
        ]);
    });

    it('uploads latest and versioned APKs to the writable Quark mount', async () => {
        const calls: string[] = [];
        const fetchImpl = vi.fn(async (_url, init) => {
            calls.push(decodeURI(String(new Headers(init?.headers).get('File-Path'))));
            return new Response(JSON.stringify({ code: 200 }), { status: 200 });
        });

        await uploadApkToOpenList({
            apkBytes: Buffer.from('apk'),
            versionName: '1.0.627',
            targetRoot: '/夸克/MoRanJiangHu/releases',
            baseUrl: 'https://openlist.example',
            authToken: 'token',
            fetchImpl
        });

        expect(calls).toEqual([
            '/夸克/MoRanJiangHu/releases/latest.apk',
            '/夸克/MoRanJiangHu/releases/MoRanJiangHu-v1.0.627.apk'
        ]);
    });

    it('requires matching sizes and signs from the Quark TV mount', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 200,
            data: {
                content: [
                    { name: 'latest.apk', is_dir: false, size: 12, sign: 'latest-sign' },
                    { name: 'MoRanJiangHu-v1.0.627.apk', is_dir: false, size: 12, sign: 'version-sign' }
                ]
            }
        }), { status: 200 }));

        await expect(verifyOpenListApkFiles({
            versionName: '1.0.627',
            expectedSize: 12,
            downloadRoot: '/夸克TV/MoRanJiangHu/releases',
            baseUrl: 'https://openlist.example',
            authToken: 'token',
            fetchImpl
        })).resolves.toEqual(expect.objectContaining({
            ok: true,
            root: '/夸克TV/MoRanJiangHu/releases'
        }));
    });

    it('rejects a Quark TV size mismatch', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 200,
            data: {
                content: [
                    { name: 'latest.apk', is_dir: false, size: 11, sign: 'latest-sign' },
                    { name: 'MoRanJiangHu-v1.0.627.apk', is_dir: false, size: 12, sign: 'version-sign' }
                ]
            }
        }), { status: 200 }));

        await expect(verifyOpenListApkFiles({
            versionName: '1.0.627',
            expectedSize: 12,
            baseUrl: 'https://openlist.example',
            authToken: 'token',
            fetchImpl
        })).rejects.toThrow('size mismatch');
    });
});
