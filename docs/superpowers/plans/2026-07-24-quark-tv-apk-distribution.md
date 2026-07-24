# Quark TV APK Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quark TV the default APK download channel, preserve automatic fallbacks, upload release APKs through the writable Quark mount, and record privacy-preserving daily download counts in D1.

**Architecture:** The Worker resolves a provider into a 302 response and never proxies APK bytes. Quark uploads go to `/夸克/MoRanJiangHu/releases`, while downloads resolve through `/夸克TV/MoRanJiangHu/releases`; a focused D1 helper asynchronously aggregates successful GET redirects by China date, version, and provider.

**Tech Stack:** Cloudflare Workers/Pages Functions, TypeScript, D1, OpenList API, Node.js release scripts, Vitest, PowerShell/curl verification.

---

## File Map

- Create `functions/api/apk/_providerRouter.ts`: resolve explicit providers and the default fallback chain.
- Create `functions/api/apk/_downloadStats.ts`: create/update the D1 daily aggregate without blocking downloads.
- Create `__tests__/apkQuarkTvRedirect.test.ts`: Quark TV signing, redirect, and fallback behavior.
- Create `__tests__/apkDownloadStats.test.ts`: GET/HEAD and D1 failure behavior.
- Create `migrations/2026-07-24-apk-download-daily.sql`: explicit D1 schema migration.
- Create `scripts/report-apk-downloads.mjs`: internal read-only download summary command.
- Create `scripts/upload-apk-quark.mjs`: upload the current APK to Quark and verify it through Quark TV without writing KV.
- Create `tests/upload-apk-quark.test.ts`: Quark upload and Quark TV verification tests.
- Modify `functions/api/apk/_shared.ts`: add `quark-tv`, generic OpenList file lookup, and Quark TV redirect construction.
- Modify `functions/api/apk/latest.apk.ts`: use provider router and schedule GET statistics.
- Modify `functions/api/apk/version/[file].ts`: use provider router and schedule GET statistics.
- Modify `functions/api/apk/latest.json.ts`: expose Quark URL and order Quark first.
- Modify `services/appUpdate.ts`: label `provider=quark-tv` as Quark TV.
- Modify `scripts/upload-apk-onedrive.mjs`: accept a configurable OpenList target root while preserving the OneDrive default.
- Modify `scripts/apk-provider-selection.mjs`: support `quark-tv` as the guarded default provider.
- Modify `scripts/publish-release-b2.mjs`: upload/verify Quark before writing a Quark-first manifest.
- Modify `package.json`: add D1 migration, Quark upload, and download-report commands.
- Modify existing APK route and release tests to reflect the new default while retaining explicit OneDrive/GitHub behavior.

The worktree already contains uncommitted APK provider experiments. Do not reset them. Adapt them in place and stage only the files named by the current task at each commit.

### Task 1: Add Quark TV As A Supported Provider

**Files:**
- Modify: `functions/api/apk/_shared.ts`
- Modify: `scripts/apk-provider-selection.mjs`
- Modify: `__tests__/apkProviderSelection.test.ts`

- [ ] **Step 1: Write the failing provider-selection tests**

Add assertions that the release helper defaults to Quark TV and accepts it without GitHub Raw verification:

```ts
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
```

Update the GitHub Raw failure expectation from `onedrive` to `quark-tv`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm run test:run -- __tests__/apkProviderSelection.test.ts
```

Expected: FAIL because `DEFAULT_APK_PROVIDER` is still `onedrive` and `quark-tv` is unsupported.

- [ ] **Step 3: Implement the minimal provider type changes**

In `scripts/apk-provider-selection.mjs`:

```js
export const DEFAULT_APK_PROVIDER = 'quark-tv';

const SUPPORTED_APK_PROVIDERS = new Set([
  'quark-tv',
  'github-raw',
  'onedrive',
  'onedrive-direct',
  'github'
]);
```

In `functions/api/apk/_shared.ts`, extend `ApkProvider` and manifest parsing:

```ts
export type ApkProvider =
    | 'quark-tv'
    | 'github'
    | 'github-raw'
    | 'onedrive'
    | 'onedrive-direct'
    | 'onedrive-origin'
    | 'r2'
    | 'hi168'
    | 'b2';

export const readManifestPreferredApkProvider = (payload: any): ApkProvider => {
    const provider = payload?.latest?.preferredApkProvider || payload?.preferredApkProvider;
    return provider === 'quark-tv'
        || provider === 'github'
        || provider === 'github-raw'
        || provider === 'onedrive'
        || provider === 'onedrive-direct'
        || provider === 'onedrive-origin'
        ? provider
        : 'quark-tv';
};
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same Vitest command. Expected: all provider-selection tests PASS.

- [ ] **Step 5: Commit the provider vocabulary**

```powershell
git add -- functions/api/apk/_shared.ts scripts/apk-provider-selection.mjs __tests__/apkProviderSelection.test.ts
git commit -m "feat: add quark tv apk provider"
```

### Task 2: Build The Quark TV OpenList Redirect

**Files:**
- Create: `__tests__/apkQuarkTvRedirect.test.ts`
- Modify: `functions/api/apk/_shared.ts`

- [ ] **Step 1: Write failing redirect tests**

Cover latest and versioned files, encoded Chinese mount paths, missing signs, and API-base fallback:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildQuarkTvApkRedirect } from '../functions/api/apk/_shared';

describe('Quark TV APK redirect', () => {
    it('redirects a signed latest APK through the Quark TV mount', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 200,
            data: { content: [{ name: 'latest.apk', is_dir: false, sign: 'quark sign' }] }
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await buildQuarkTvApkRedirect(
            { MORAN_OPENLIST_AUTH_TOKEN: 'token', MORAN_OPENLIST_BASE_URL: 'https://openlist.example' },
            'latest.apk',
            'MoRanJiangHu-v1.0.627.apk'
        );

        expect(response?.status).toBe(302);
        expect(response?.headers.get('Location')).toBe(
            'https://openlist.example/d/%E5%A4%B8%E5%85%8BTV/MoRanJiangHu/releases/latest.apk?sign=quark%20sign'
        );
        expect(response?.headers.get('X-Moran-Apk-Source')).toBe('quark-tv');
    });

    it('returns null when the Quark TV file has no sign', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 200,
            data: { content: [] }
        }), { status: 200 })));
        await expect(buildQuarkTvApkRedirect(
            { MORAN_OPENLIST_AUTH_TOKEN: 'token' },
            'latest.apk',
            'MoRanJiangHu-v1.0.627.apk'
        )).resolves.toBeNull();
    });
});
```

Restore globals in `afterEach(() => vi.unstubAllGlobals())`.

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm run test:run -- __tests__/apkQuarkTvRedirect.test.ts
```

Expected: FAIL because `buildQuarkTvApkRedirect` does not exist.

- [ ] **Step 3: Generalize OpenList lookup and add Quark redirect**

Replace the OneDrive-only sign lookup with a private generic helper:

```ts
const fetchOpenListFileSign = async (
    env: any,
    directory: string,
    storageFileName: string
): Promise<string | null> => {
    const authToken = env?.MORAN_OPENLIST_AUTH_TOKEN;
    if (!authToken) return null;
    for (const baseUrl of readOpenListApiBaseUrlCandidates(env)) {
        try {
            const response = await fetch(`${baseUrl}/api/fs/list`, {
                method: 'POST',
                headers: { Authorization: authToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: directory, password: '', page: 1, per_page: 100, refresh: false })
            });
            if (!response.ok) continue;
            const json = await response.json() as any;
            const item = Array.isArray(json?.data?.content)
                ? json.data.content.find((entry: any) => (
                    entry?.name === storageFileName && !entry?.is_dir && entry?.sign
                ))
                : null;
            if (item?.sign) return item.sign;
        } catch {
            // Try the next configured API base.
        }
    }
    return null;
};
```

Add:

```ts
const QUARK_TV_APK_DIR = '/夸克TV/MoRanJiangHu/releases';

export const buildQuarkTvApkRedirect = async (
    env: any,
    storageFileName: string,
    downloadFileName: string,
    cacheControl = APK_LATEST_CACHE_CONTROL
): Promise<Response | null> => {
    const sign = await fetchOpenListFileSign(env, QUARK_TV_APK_DIR, storageFileName);
    if (!sign) return null;
    const encodedPath = QUARK_TV_APK_DIR.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const baseUrl = readOpenListPublicBaseUrl(env);
    return new Response(null, {
        status: 302,
        headers: {
            Location: `${baseUrl}/d/${encodedPath}/${encodeURIComponent(storageFileName)}?sign=${encodeURIComponent(sign)}`,
            'Content-Type': 'application/vnd.android.package-archive',
            'Cache-Control': cacheControl,
            'Content-Disposition': `attachment; filename="${downloadFileName}"`,
            'X-Moran-Apk-Source': 'quark-tv',
            ...APK_CORS_HEADERS
        }
    });
};
```

Refactor `fetchOneDriveApkSign` to call `fetchOpenListFileSign` without changing OneDrive behavior.

- [ ] **Step 4: Run Quark and OneDrive redirect tests**

```powershell
npm run test:run -- __tests__/apkQuarkTvRedirect.test.ts __tests__/apkOneDriveRedirect.test.ts
```

Expected: both test files PASS.

- [ ] **Step 5: Commit the redirect helper**

```powershell
git add -- functions/api/apk/_shared.ts __tests__/apkQuarkTvRedirect.test.ts __tests__/apkOneDriveRedirect.test.ts
git commit -m "feat: redirect apk downloads through quark tv"
```

### Task 3: Add Default Fallback Routing

**Files:**
- Create: `functions/api/apk/_providerRouter.ts`
- Modify: `functions/api/apk/latest.apk.ts`
- Modify: `functions/api/apk/version/[file].ts`
- Modify: `__tests__/apkB2Provider.test.ts`
- Modify: `__tests__/apkQuarkTvRedirect.test.ts`

- [ ] **Step 1: Write failing route tests**

Add tests for default Quark success, Quark-to-OneDrive fallback, complete default failure, and explicit provider isolation:

```ts
it('uses Quark TV by default', async () => {
    const response = await onLatestApkRequestGet(buildContext({
        manifestProvider: 'quark-tv',
        quarkSign: 'signed'
    }));
    expect(response.status).toBe(302);
    expect(response.headers.get('X-Moran-Apk-Source')).toBe('quark-tv');
});

it('falls back to OneDrive when Quark TV is unavailable', async () => {
    const response = await onLatestApkRequestGet(buildContext({
        manifestProvider: 'quark-tv',
        quarkSign: null,
        oneDriveSign: 'onedrive-sign'
    }));
    expect(response.headers.get('X-Moran-Apk-Source')).toBe('onedrive-proxy');
});
```

Explicit `?provider=onedrive` must not query Quark, and `?provider=b2` must remain `410`.

- [ ] **Step 2: Run route tests and verify RED**

```powershell
npm run test:run -- __tests__/apkQuarkTvRedirect.test.ts __tests__/apkB2Provider.test.ts
```

Expected: FAIL because current handlers do not know `quark-tv` and do not fall back.

- [ ] **Step 3: Implement a focused provider router**

Create `functions/api/apk/_providerRouter.ts` with this public contract:

```ts
export type ResolvedApkProvider = 'quark-tv' | 'onedrive' | 'onedrive-direct' | 'github' | 'github-raw';

export type ResolveApkDownloadInput = {
    env: any;
    requestedProvider?: string | null;
    preferredProvider?: string | null;
    versionName: string;
    storageFileName: string;
    downloadFileName: string;
    cacheControl?: string;
};

export type ResolvedApkDownload = {
    provider: ResolvedApkProvider;
    response: Response;
};

export const resolveApkDownload = async (input: ResolveApkDownloadInput): Promise<ResolvedApkDownload | null> => {
    const explicit = input.requestedProvider?.trim();
    const defaultOrder = ['quark-tv', 'onedrive', 'github', 'github-raw'];
    const preferred = defaultOrder.includes(String(input.preferredProvider))
        ? String(input.preferredProvider)
        : 'quark-tv';
    const chain = explicit
        ? [explicit]
        : [preferred, ...defaultOrder.filter(provider => provider !== preferred)];
    for (const provider of chain) {
        const response = await buildProviderResponse(provider, input);
        if (response) return { provider: provider as ResolvedApkProvider, response };
    }
    return null;
};
```

`buildProviderResponse` delegates to existing builders. Quark uses `storageFileName`; OneDrive keeps `latest.apk`; GitHub builders use `versionName` and `downloadFileName`. Retired providers are handled in the route before calling the resolver.

Update both route files to:

```ts
const resolved = await resolveApkDownload({
    env,
    requestedProvider,
    preferredProvider: readManifestPreferredApkProvider(manifest?.payload),
    versionName,
    storageFileName: isVersioned ? fileName : 'latest.apk',
    downloadFileName: fileName,
    cacheControl
});
if (resolved) return resolved.response;
return buildTextResponse('APK download providers are unavailable', 503);
```

- [ ] **Step 4: Run all APK route tests**

```powershell
npm run test:run -- __tests__/apkB2Provider.test.ts __tests__/apkOneDriveRedirect.test.ts __tests__/apkQuarkTvRedirect.test.ts
```

Expected: PASS with default Quark, explicit fallback providers, and retired B2 behavior intact.

- [ ] **Step 5: Commit routing**

```powershell
git add -- functions/api/apk/_providerRouter.ts functions/api/apk/latest.apk.ts 'functions/api/apk/version/[file].ts' __tests__/apkB2Provider.test.ts __tests__/apkQuarkTvRedirect.test.ts
git commit -m "feat: add apk provider fallback routing"
```

### Task 4: Record Daily Download Counts In D1

**Files:**
- Create: `functions/api/apk/_downloadStats.ts`
- Create: `__tests__/apkDownloadStats.test.ts`
- Create: `migrations/2026-07-24-apk-download-daily.sql`
- Create: `scripts/report-apk-downloads.mjs`
- Modify: `functions/api/apk/latest.apk.ts`
- Modify: `functions/api/apk/version/[file].ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing statistics tests**

Use a small fake D1 binding that records SQL, binds, and `run()` calls:

```ts
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
    expect(db.boundValues).toContainEqual(['2026-07-25', '1.0.627', 'quark-tv']);
});

it('does not count HEAD requests', () => {
    const waitUntil = vi.fn();
    scheduleApkDownloadCount({ env: { DB: buildFakeD1() }, waitUntil, method: 'HEAD', versionName: '1.0.627', provider: 'quark-tv' });
    expect(waitUntil).not.toHaveBeenCalled();
});
```

Add a test where D1 rejects and the already-built 302 response remains unchanged.

- [ ] **Step 2: Run the statistics test and verify RED**

```powershell
npm run test:run -- __tests__/apkDownloadStats.test.ts
```

Expected: FAIL because `_downloadStats.ts` does not exist.

- [ ] **Step 3: Implement the D1 helper and migration**

Create `functions/api/apk/_downloadStats.ts`:

```ts
const TABLE_SQL = `CREATE TABLE IF NOT EXISTS apk_download_daily (
  day TEXT NOT NULL,
  version_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, version_name, provider)
)`;

const chinaDateKey = (date: Date): string => (
    new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
);

export const incrementApkDownloadCount = async (env: any, versionName: string, provider: string, now = new Date()): Promise<void> => {
    const db = env?.DB;
    if (!db?.prepare) return;
    await db.prepare(TABLE_SQL).run();
    const updatedAt = now.toISOString();
    await db.prepare(`INSERT INTO apk_download_daily (day, version_name, provider, request_count, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(day, version_name, provider) DO UPDATE SET
        request_count = request_count + 1,
        updated_at = excluded.updated_at`)
      .bind(chinaDateKey(now), versionName, provider, updatedAt)
      .run();
};

export const scheduleApkDownloadCount = (input: {
    env: any;
    waitUntil?: (promise: Promise<unknown>) => void;
    method: string;
    versionName: string;
    provider: string;
    now?: Date;
}): void => {
    if (input.method.toUpperCase() !== 'GET') return;
    const promise = incrementApkDownloadCount(input.env, input.versionName, input.provider, input.now).catch(() => undefined);
    input.waitUntil?.(promise);
};
```

Put the same `CREATE TABLE` statement in `migrations/2026-07-24-apk-download-daily.sql`.

- [ ] **Step 4: Wire statistics after provider resolution**

In both APK route handlers, schedule only after `resolveApkDownload` returns a provider:

```ts
scheduleApkDownloadCount({
    env,
    waitUntil: context.waitUntil,
    method,
    versionName,
    provider: resolved.provider
});
return resolved.response;
```

Pass `GET` and `HEAD` explicitly from the exported handlers.

- [ ] **Step 5: Add the read-only reporting script and package commands**

Create `scripts/report-apk-downloads.mjs` using `spawnSync` with the local Wrangler binary:

```js
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = process.platform === 'win32'
  ? path.join(rootDir, 'node_modules', '.bin', 'wrangler.cmd')
  : path.join(rootDir, 'node_modules', '.bin', 'wrangler');
const sql = `SELECT day, version_name, provider, request_count, updated_at
FROM apk_download_daily
ORDER BY day DESC, request_count DESC
LIMIT 100`;

const result = spawnSync(wrangler, [
  'd1', 'execute', 'moranjianghu-db', '--remote', '--command', sql, '--json'
], { cwd: rootDir, encoding: 'utf8', timeout: 60_000 });

if (result.status !== 0) {
  throw new Error((result.stderr || result.stdout || 'Wrangler query failed').trim());
}
process.stdout.write(result.stdout);
```

Add package scripts:

```json
"db:migrate:apk-downloads": "wrangler d1 execute moranjianghu-db --remote --file migrations/2026-07-24-apk-download-daily.sql",
"apk:downloads": "node scripts/report-apk-downloads.mjs"
```

- [ ] **Step 6: Run statistics and route tests**

```powershell
npm run test:run -- __tests__/apkDownloadStats.test.ts __tests__/apkQuarkTvRedirect.test.ts __tests__/apkB2Provider.test.ts
```

Expected: PASS. Do not run the remote migration yet.

- [ ] **Step 7: Commit statistics**

```powershell
git add -- functions/api/apk/_downloadStats.ts functions/api/apk/latest.apk.ts 'functions/api/apk/version/[file].ts' __tests__/apkDownloadStats.test.ts migrations/2026-07-24-apk-download-daily.sql scripts/report-apk-downloads.mjs package.json
git commit -m "feat: record apk download totals"
```

### Task 5: Publish A Quark-First Manifest

**Files:**
- Modify: `functions/api/apk/latest.json.ts`
- Modify: `__tests__/apkLatestManifest.test.ts`
- Modify: `services/appUpdate.ts`
- Modify: `__tests__/appUpdate.test.ts`

- [ ] **Step 1: Write failing manifest and label tests**

Add expectations:

```ts
expect(payload.latest.quarkTvApkUrl).toBe(
    'https://msjh.bacon159.pp.ua/api/apk/latest.apk?provider=quark-tv'
);
expect(payload.latest.preferredApkProvider).toBe('quark-tv');
expect(payload.latest.apkUrls[1]).toBe(payload.latest.quarkTvApkUrl);
```

In `appUpdate.test.ts`, assert that `provider=quark-tv` is displayed as `夸克TV`.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm run test:run -- __tests__/apkLatestManifest.test.ts __tests__/appUpdate.test.ts
```

Expected: FAIL because the manifest has no Quark URL and the UI has no label.

- [ ] **Step 3: Add the Quark URL and ordering**

In `latest.json.ts`:

```ts
const quarkTvApkUrl = `${baseUrl}/api/apk/latest.apk?provider=quark-tv`;
const quarkGroup = [quarkTvApkUrl];

if (preferredApkProvider === 'quark-tv') {
    providerOrderedUrls = [...quarkGroup, ...oneDriveGroup, ...githubGroup, ...githubRawGroup];
}
```

Expose `quarkTvApkUrl` under `latest` and retain the stable `/api/apk/latest.apk` as the first `apkUrls` entry.

In `services/appUpdate.ts`, add before the generic `/api/apk/` case:

```ts
if (lower.includes('provider=quark-tv') || lower.includes('/d/%e5%a4%b8%e5%85%8btv/')) return '夸克TV';
```

- [ ] **Step 4: Run manifest and app tests**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit manifest output**

```powershell
git add -- functions/api/apk/latest.json.ts __tests__/apkLatestManifest.test.ts services/appUpdate.ts __tests__/appUpdate.test.ts
git commit -m "feat: publish quark first apk manifest"
```

### Task 6: Upload Through Quark And Verify Through Quark TV

**Files:**
- Modify: `scripts/upload-apk-onedrive.mjs`
- Create: `scripts/upload-apk-quark.mjs`
- Create: `tests/upload-apk-quark.test.ts`
- Modify: `scripts/publish-release-b2.mjs`
- Modify: `__tests__/publishReleaseB2ManifestScript.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing configurable-target tests**

In `tests/upload-apk-quark.test.ts`:

```ts
it('uploads latest and versioned APKs to the writable Quark mount', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
        calls.push(String(new Headers(init?.headers).get('File-Path')));
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
```

Add a verification test:

```ts
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
    })).resolves.toEqual(expect.objectContaining({ ok: true }));
});

it('rejects a Quark TV size mismatch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 200,
        data: { content: [{ name: 'latest.apk', is_dir: false, size: 11, sign: 'sign' }] }
    }), { status: 200 }));

    await expect(verifyOpenListApkFiles({
        versionName: '1.0.627',
        expectedSize: 12,
        baseUrl: 'https://openlist.example',
        authToken: 'token',
        fetchImpl
    })).rejects.toThrow('size mismatch');
});
```

- [ ] **Step 2: Run upload tests and verify RED**

```powershell
npm run test:run -- tests/upload-apk-onedrive.test.ts tests/upload-apk-quark.test.ts
```

Expected: FAIL because `targetRoot` and Quark TV verification do not exist.

- [ ] **Step 3: Generalize the upload helper**

Change the target builder to:

```js
export const buildOpenListApkTargets = (versionName, targetRoot = '/Onedrive/MoRanJiangHu/releases') => {
  const normalizedRoot = `/${String(targetRoot).replace(/^\/+|\/+$/g, '')}`;
  return [
    { filePath: `${normalizedRoot}/latest.apk`, cacheControl: 'public, max-age=3600, stale-while-revalidate=86400' },
    { filePath: `${normalizedRoot}/MoRanJiangHu-v${versionName}.apk`, cacheControl: 'public, max-age=86400, stale-while-revalidate=604800' }
  ];
};
```

Accept `targetRoot` in `uploadApkToOpenList` and preserve the existing default.

Export a focused verifier:

```js
export const verifyOpenListApkFiles = async ({
  versionName,
  expectedSize,
  downloadRoot = '/夸克TV/MoRanJiangHu/releases',
  baseUrl,
  authToken,
  fetchImpl = fetch
}) => {
  if (!authToken) throw new Error('Missing MORAN_OPENLIST_AUTH_TOKEN.');
  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, '');
  const normalizedRoot = `/${String(downloadRoot).replace(/^\/+|\/+$/g, '')}`;
  const response = await fetchImpl(`${normalizedBaseUrl}/api/fs/list`, {
    method: 'POST',
    headers: { Authorization: authToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: normalizedRoot, page: 1, per_page: 100, refresh: true }),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json();
  if (!response.ok || payload?.code !== 200 || !Array.isArray(payload?.data?.content)) {
    throw new Error(`OpenList verification failed for ${normalizedRoot}`);
  }
  const requiredNames = ['latest.apk', `MoRanJiangHu-v${versionName}.apk`];
  const files = requiredNames.map((name) => {
    const item = payload.data.content.find((entry) => entry?.name === name && !entry?.is_dir);
    if (!item) throw new Error(`OpenList verification missing ${name}`);
    if (Number(item.size) !== expectedSize) {
      throw new Error(`OpenList verification size mismatch for ${name}: ${item.size}`);
    }
    if (!item.sign) throw new Error(`OpenList verification missing sign for ${name}`);
    return { name, size: Number(item.size), sign: String(item.sign) };
  });
  return { ok: true, root: normalizedRoot, files };
};
```

- [ ] **Step 4: Integrate Quark upload before manifest construction**

In `publish-release-b2.mjs`, import the helper and run:

```js
await uploadApkToOpenList({
  apkBytes: currentApkBuffer,
  versionName: currentVersionName,
  targetRoot: '/夸克/MoRanJiangHu/releases',
  baseUrl: readEnv('MORAN_OPENLIST_BASE_URL', 'https://openlist.bacon.de5.net'),
  authToken: readEnv('MORAN_OPENLIST_AUTH_TOKEN'),
  timeoutMs
});

await verifyOpenListApkFiles({
  versionName: currentVersionName,
  expectedSize: apkSize,
  downloadRoot: '/夸克TV/MoRanJiangHu/releases',
  baseUrl: readEnv('MORAN_OPENLIST_BASE_URL', 'https://openlist.bacon.de5.net'),
  authToken: readEnv('MORAN_OPENLIST_AUTH_TOKEN')
});
```

Default `MORAN_RELEASE_PREFERRED_APK_PROVIDER` to `quark-tv`, add `providerApkUrls.quarkTv`, and order it before OneDrive. Missing token, upload failure, missing Quark TV file, or size mismatch must throw before the KV manifest write.

- [ ] **Step 5: Add the upload-only CLI**

Create `scripts/upload-apk-quark.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadApkToOpenList, verifyOpenListApkFiles } from './upload-apk-onedrive.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apkPath = path.resolve(process.argv[2] || path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'));
const releaseInfo = JSON.parse(fs.readFileSync(path.join(rootDir, 'release.config.json'), 'utf8'));
const apkBytes = fs.readFileSync(apkPath);
const baseUrl = String(process.env.MORAN_OPENLIST_BASE_URL || 'https://openlist.bacon.de5.net').replace(/\/+$/, '');
const authToken = String(process.env.MORAN_OPENLIST_AUTH_TOKEN || '').trim();
const timeoutMs = Math.max(1000, Number(process.env.MORAN_OPENLIST_UPLOAD_TIMEOUT_MS || 600000));

const uploaded = await uploadApkToOpenList({
  apkBytes,
  versionName: releaseInfo.versionName,
  targetRoot: '/夸克/MoRanJiangHu/releases',
  baseUrl,
  authToken,
  timeoutMs
});
const verified = await verifyOpenListApkFiles({
  versionName: releaseInfo.versionName,
  expectedSize: apkBytes.byteLength,
  downloadRoot: '/夸克TV/MoRanJiangHu/releases',
  baseUrl,
  authToken
});
console.log(JSON.stringify({ uploaded, verified }, null, 2));
```

Add:

```json
"release:quark": "node scripts/upload-apk-quark.mjs"
```

- [ ] **Step 6: Update static script assertions**

Require the release script source to contain:

```ts
expect(script).toContain("targetRoot: '/夸克/MoRanJiangHu/releases'");
expect(script).toContain("downloadRoot: '/夸克TV/MoRanJiangHu/releases'");
expect(script).toContain("readEnv('MORAN_RELEASE_PREFERRED_APK_PROVIDER', 'quark-tv')");
```

- [ ] **Step 7: Run upload and release-script tests**

```powershell
npm run test:run -- tests/upload-apk-onedrive.test.ts tests/upload-apk-quark.test.ts __tests__/publishReleaseB2ManifestScript.test.ts __tests__/apkProviderSelection.test.ts
```

Expected: PASS without making network requests.

- [ ] **Step 8: Commit release integration**

```powershell
git add -- scripts/upload-apk-onedrive.mjs scripts/upload-apk-quark.mjs tests/upload-apk-onedrive.test.ts tests/upload-apk-quark.test.ts scripts/publish-release-b2.mjs __tests__/publishReleaseB2ManifestScript.test.ts scripts/apk-provider-selection.mjs package.json
git commit -m "feat: publish apk releases to quark"
```

### Task 7: Run Full Local Verification

**Files:**
- Verify all files changed in Tasks 1-6.

- [ ] **Step 1: Run focused APK tests**

```powershell
npm run test:run -- __tests__/apkProviderSelection.test.ts __tests__/apkQuarkTvRedirect.test.ts __tests__/apkDownloadStats.test.ts __tests__/apkB2Provider.test.ts __tests__/apkOneDriveRedirect.test.ts __tests__/apkLatestManifest.test.ts __tests__/publishReleaseB2ManifestScript.test.ts __tests__/appUpdate.test.ts tests/upload-apk-onedrive.test.ts tests/upload-apk-quark.test.ts
```

Expected: all focused tests PASS with zero failures.

- [ ] **Step 2: Run the complete test suite**

```powershell
npm run test:run
```

Expected: exit code 0 and zero failed tests.

- [ ] **Step 3: Build production assets**

```powershell
npm run build
```

Expected: exit code 0 and a completed Vite production build.

- [ ] **Step 4: Build the Worker functions bundle**

```powershell
npm run worker:functions
```

Expected: exit code 0. Confirm `.tmp-worker-build/index.js` is newer than the edited function files and contains both `quark-tv` and `apk_download_daily`:

```powershell
Select-String -LiteralPath '.tmp-worker-build/index.js' -Pattern 'quark-tv','apk_download_daily'
```

- [ ] **Step 5: Review the final diff and working tree**

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; `.reasonix/` remains untouched; every remaining modification is understood.

### Task 8: Prepare The Current APK In Quark Without Deploying

**Files:**
- Read: `release.config.json`
- Read: `android/app/build/outputs/apk/release/app-release.apk`
- External write: `/夸克/MoRanJiangHu/releases/`
- External read: `/夸克TV/MoRanJiangHu/releases/`

- [ ] **Step 1: Confirm the local APK matches the current release metadata**

```powershell
node scripts/inspect-apk-signature.mjs android/app/build/outputs/apk/release/app-release.apk
```

Expected: valid release signature and certificate SHA-256 `0c638692591300750ccc17cb828b5223bb9a5ef333095714377a6cd5adcbe48c`.

- [ ] **Step 2: Upload the current APK to the writable Quark mount**

Run the upload-only helper with explicit timeouts. It does not write the KV manifest and does not deploy the Worker:

```powershell
$env:MORAN_OPENLIST_UPLOAD_TIMEOUT_MS='600000'
npm run release:quark -- android/app/build/outputs/apk/release/app-release.apk
```

The command must upload only:

```text
/夸克/MoRanJiangHu/releases/latest.apk
/夸克/MoRanJiangHu/releases/MoRanJiangHu-v1.0.627.apk
```

- [ ] **Step 3: Verify through Quark TV**

Use OpenList `api/fs/list` to confirm both `/夸克TV/MoRanJiangHu/releases/` files have size `49,959,268` bytes and non-empty signs. Download bytes `0-1048575` through the signed `/d/夸克TV/...` URL with a 30-second timeout.

Expected:

```text
HTTP 206 Partial Content
Content-Range: bytes 0-1048575/49959268
Accept-Ranges: bytes
```

Confirm the first bytes are a ZIP/APK header (`PK`).

- [ ] **Step 4: Stop before deployment**

Do not run `wrangler deploy`, do not update the live KV manifest, and do not increment `versionName`, `versionCode`, or `releasePublishedAt`. Report that Quark is prepared but not live.

## Completion Criteria

- Quark TV is the code-level default provider.
- Default requests fall back to OneDrive, GitHub Release, then GitHub Raw.
- Explicit providers remain independently testable.
- Worker returns redirects and never proxies APK bytes.
- GET redirects increment D1 daily counts without storing user identifiers.
- Release tooling uploads through `/夸克` and verifies through `/夸克TV` before creating a Quark-first manifest.
- The current APK is present and range-downloadable through Quark TV.
- Full tests, production build, and Worker bundle build pass.
- No website deployment or new release occurs without a new explicit user instruction.
