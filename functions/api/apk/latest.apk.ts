import {
    APK_CORS_HEADERS,
    APK_LATEST_CACHE_CONTROL,
    buildVersionedApkFileName,
    buildTextResponse,
    readManifestPayload,
    readManifestPreferredApkProvider,
    readManifestVersionName,
} from './_shared';
import { resolveApkDownload } from './_providerRouter';

const handleLatestApkRequest = async ({ request, env }: any): Promise<Response> => {
    try {
        const manifest = await readManifestPayload(env);
        const versionName = readManifestVersionName(manifest?.payload);
        const versionedFileName = buildVersionedApkFileName(versionName);
        const fileName = versionedFileName || 'MoRanJiangHu-latest.apk';
        const requestedProvider = new URL(request.url).searchParams.get('provider');
        if (requestedProvider === 'b2') {
            return buildTextResponse('B2 APK provider is decommissioned', 410);
        }
        const resolved = await resolveApkDownload({
            env,
            requestedProvider,
            preferredProvider: readManifestPreferredApkProvider(manifest?.payload),
            versionName,
            storageFileName: 'latest.apk',
            downloadFileName: fileName,
            cacheControl: APK_LATEST_CACHE_CONTROL
        });
        if (resolved) return resolved.response;
        return buildTextResponse('APK download providers are unavailable', 503);
    } catch (error: any) {
        return buildTextResponse(error?.message || 'APK redirect failed', 502);
    }
};

export function onRequestOptions(): Response {
    return new Response(null, { status: 204, headers: APK_CORS_HEADERS });
}

export const onRequestGet = handleLatestApkRequest;
export const onRequestHead = handleLatestApkRequest;
