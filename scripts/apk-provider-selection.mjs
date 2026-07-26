import crypto from 'node:crypto';

export const DEFAULT_APK_PROVIDER = 'quark-tv';

const SUPPORTED_APK_PROVIDERS = new Set([
  'vps',
  'quark-tv',
  'github-raw',
  'onedrive',
  'onedrive-direct',
  'github'
]);

const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export const verifyRemoteApk = async ({
  url,
  expectedSize,
  expectedSha256,
  fetchImpl = fetch,
  timeoutMs = 120_000
}) => {
  if (!url) return { ok: false, reason: 'APK verification URL is empty' };
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
    return { ok: false, reason: `APK expected size is invalid: ${expectedSize}` };
  }
  if (!/^[0-9a-f]{64}$/i.test(String(expectedSha256 || ''))) {
    return { ok: false, reason: 'APK expected SHA-256 is invalid' };
  }

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs))
    });
    if (!response.ok) {
      return { ok: false, reason: `GET ${url} returned HTTP ${response.status}` };
    }

    const declaredSize = Number(response.headers.get('Content-Length') || 0);
    if (declaredSize > 0 && declaredSize !== expectedSize) {
      return {
        ok: false,
        reason: `APK Content-Length mismatch: expected ${expectedSize}, received ${declaredSize}`
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== expectedSize) {
      return {
        ok: false,
        reason: `APK size mismatch: expected ${expectedSize}, received ${bytes.byteLength}`
      };
    }

    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== String(expectedSha256).toLowerCase()) {
      return {
        ok: false,
        reason: `APK SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`
      };
    }

    return { ok: true, size: bytes.byteLength, sha256: actualSha256 };
  } catch (error) {
    return { ok: false, reason: `GET ${url} failed: ${error?.message || error}` };
  }
};

export const resolvePreferredApkProvider = async ({
  requestedProvider,
  vpsUrl,
  githubRawUrl,
  apkSize,
  apkSha256,
  fetchImpl = fetch,
  timeoutMs = 120_000,
  logger = console
} = {}) => {
  const normalizedProvider = SUPPORTED_APK_PROVIDERS.has(requestedProvider)
    ? requestedProvider
    : DEFAULT_APK_PROVIDER;
  if (normalizedProvider !== 'github-raw' && normalizedProvider !== 'vps') return normalizedProvider;

  const verification = await verifyRemoteApk({
    url: normalizedProvider === 'vps' ? vpsUrl : githubRawUrl,
    expectedSize: apkSize,
    expectedSha256: apkSha256,
    fetchImpl,
    timeoutMs
  });
  if (verification.ok) return normalizedProvider;

  const label = normalizedProvider === 'vps' ? 'VPS' : 'GitHub Raw';
  logger?.warn?.(`[APK provider] ${label} validation failed; falling back to Quark TV: ${verification.reason}`);
  return DEFAULT_APK_PROVIDER;
};
