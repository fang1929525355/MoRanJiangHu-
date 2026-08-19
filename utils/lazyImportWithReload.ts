const DYNAMIC_IMPORT_FAILURE_PATTERNS = [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'error loading dynamically imported module',
    'is not a valid JavaScript MIME type',
    'text/html',
    'ChunkLoadError',
    'Loading chunk'
];

export const isDynamicImportFetchError = (error: unknown): boolean => {
    const message = error instanceof Error
        ? `${error.name} ${error.message}`
        : String(error || '');

    return message.includes('DynamicImportDeferredReloadError')
        || DYNAMIC_IMPORT_FAILURE_PATTERNS.some((pattern) => message.includes(pattern));
};

export const lazyImportWithReload = async <T>(
    importKey: string,
    loader: () => Promise<T>
): Promise<T> => {
    try {
        const result = await loader();
        try {
            window.sessionStorage.removeItem(`moranjianghu:lazy-import-reload:${importKey}`);
        } catch {
            // Storage cleanup is best-effort.
        }
        return result;
    } catch (error) {
        if (typeof window === 'undefined' || !isDynamicImportFetchError(error)) {
            throw error;
        }

        const reloadKey = `moranjianghu:lazy-import-reload:${importKey}`;
        try {
            if (window.sessionStorage.getItem(reloadKey) !== '1') {
                window.sessionStorage.setItem(reloadKey, '1');
                window.location.reload();
            }
        } catch {
            // Storage/reload is best-effort; preserve the actionable error below.
        }

        const reloadSafeError = new Error(
            `功能模块 ${importKey} 暂时无法加载。系统已尝试刷新页面；请先手动保存进度，稍后重新进入新版本。`
        );
        reloadSafeError.name = 'DynamicImportDeferredReloadError';
        (reloadSafeError as Error & { cause?: unknown }).cause = error;
        throw reloadSafeError;
    }
};
