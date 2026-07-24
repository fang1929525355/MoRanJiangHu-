import { describe, expect, it, vi } from 'vitest';

import { scheduleApkDownloadCount } from '../functions/api/apk/_downloadStats';
import { onRequestGet as onLatestApkRequestGet } from '../functions/api/apk/latest.apk';

const buildFakeD1 = (runImpl: () => Promise<unknown> = async () => ({})) => {
    const state = {
        sql: [] as string[],
        boundValues: [] as unknown[][]
    };
    return {
        state,
        prepare(sql: string) {
            state.sql.push(sql);
            return {
                bind(...values: unknown[]) {
                    state.boundValues.push(values);
                    return { run: runImpl };
                },
                run: runImpl
            };
        }
    };
};

describe('APK download statistics', () => {
    it('schedules one China-day aggregate for a successful GET redirect', async () => {
        const waitUntil = vi.fn();
        const db = buildFakeD1();

        scheduleApkDownloadCount({
            env: { DB: db },
            waitUntil,
            method: 'GET',
            versionName: '1.0.627',
            provider: 'quark-tv',
            now: new Date('2026-07-24T16:30:00Z')
        });

        expect(waitUntil).toHaveBeenCalledTimes(1);
        await waitUntil.mock.calls[0][0];
        expect(db.state.boundValues).toContainEqual([
            '2026-07-25',
            '1.0.627',
            'quark-tv',
            '2026-07-24T16:30:00.000Z'
        ]);
    });

    it('does not count HEAD requests', () => {
        const waitUntil = vi.fn();

        scheduleApkDownloadCount({
            env: { DB: buildFakeD1() },
            waitUntil,
            method: 'HEAD',
            versionName: '1.0.627',
            provider: 'quark-tv'
        });

        expect(waitUntil).not.toHaveBeenCalled();
    });

    it('keeps the redirect response when D1 rejects', async () => {
        const waitUntil = vi.fn();
        const db = buildFakeD1(async () => {
            throw new Error('D1 unavailable');
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response(JSON.stringify({
            code: 200,
            data: { content: [{ name: 'latest.apk', is_dir: false, sign: 'signed' }] }
        }), { status: 200 })) as typeof fetch;

        try {
            const response = await onLatestApkRequestGet({
                request: new Request('https://msjh.bacon159.pp.ua/api/apk/latest.apk'),
                waitUntil,
                env: {
                    DB: db,
                    MORAN_OPENLIST_AUTH_TOKEN: 'token',
                    RELEASE_MANIFEST: {
                        get: async () => ({ latest: { versionName: '1.0.627', versionCode: 627 } })
                    }
                }
            } as any);

            expect(response.status).toBe(302);
            expect(response.headers.get('X-Moran-Apk-Source')).toBe('quark-tv');
            expect(waitUntil).toHaveBeenCalledTimes(1);
            await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
