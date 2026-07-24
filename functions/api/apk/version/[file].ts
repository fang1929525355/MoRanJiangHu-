import {
    APK_CORS_HEADERS,
    buildVersionedApkFileName,
    buildTextResponse,
    readManifestPayload,
    readManifestPreferredApkProvider,
    readManifestVersionName,
} from '../_shared';
import { resolveApkDownload } from '../_providerRouter';
import { scheduleApkDownloadCount } from '../_downloadStats';

export function onRequestOptions(): Response {
    return new Response(null, { status: 204, headers: APK_CORS_HEADERS });
}

const pickVersionedFileName = (request: Request, params: any): string => {
    const raw = typeof params?.file === 'string'
        ? params.file
        : new URL(request.url).pathname.split('/').pop() || '';
    const decoded = decodeURIComponent(raw);
    if (!/^MoRanJiangHu-v[0-9A-Za-z._-]+\.apk$/.test(decoded)) {
        throw new Error('APK version file name is invalid');
    }
    return decoded;
};

const handleVersionedApkRequest = async (context: any, _method: 'GET' | 'HEAD'): Promise<Response> => {
    const { request, env, params } = context;
    try {
        const fileName = pickVersionedFileName(request, params);
        const manifest = await readManifestPayload(env);
        const versionName = readManifestVersionName(manifest?.payload);
        const expectedFileName = buildVersionedApkFileName(versionName);
        if (expectedFileName && fileName !== expectedFileName) {
            return buildTextResponse('APK version is no longer current', 404);
        }

        const requestedProvider = new URL(request.url).searchParams.get('provider');
        if (requestedProvider === 'b2') {
            return buildTextResponse('B2 APK provider is decommissioned', 410);
        }
        const resolved = await resolveApkDownload({
            env,
            requestedProvider,
            preferredProvider: readManifestPreferredApkProvider(manifest?.payload),
            versionName,
            storageFileName: fileName,
            downloadFileName: fileName
        });
        if (resolved) {
            scheduleApkDownloadCount({
                env,
                waitUntil: context.waitUntil,
                method: _method,
                versionName,
                provider: resolved.provider
            });
            return resolved.response;
        }
        return buildTextResponse('APK download providers are unavailable', 503);
    } catch (error: any) {
        return buildTextResponse(error?.message || 'Versioned APK download failed', 502);
    }
};

export const onRequestGet = (context: any): Promise<Response> => handleVersionedApkRequest(context, 'GET');

export const onRequestHead = (context: any): Promise<Response> => handleVersionedApkRequest(context, 'HEAD');
