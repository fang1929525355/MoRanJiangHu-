import { Capacitor, SystemBars, SystemBarType } from '@capacitor/core';

const readEnvString = (value: unknown): string => (
    typeof value === 'string' ? value.trim() : ''
);

export const getSyncApiBaseUrl = (): string => {
    // Vite only statically replaces direct `import.meta.env.VITE_*` access.
    // Dynamic `(import.meta as any).env?.VITE_*` collapses to an empty object in production bundles.
    const raw = readEnvString(import.meta.env.VITE_SYNC_API_BASE_URL);
    return raw.replace(/\/+$/, '');
};

export const buildSyncApiUrl = (path: string): string => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const baseUrl = getSyncApiBaseUrl();
    return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
};

export const isNativeCapacitorEnvironment = (): boolean => {
    try {
        if (typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform()) {
            return true;
        }
        if (typeof Capacitor?.getPlatform === 'function') {
            const platform = Capacitor.getPlatform();
            if (platform && platform !== 'web') return true;
        }
    } catch {
        // Fall through to the window-based runtime probe below.
    }

    if (typeof window === 'undefined') return false;
    const maybeCapacitor = (window as any).Capacitor;

    try {
        if (typeof maybeCapacitor?.isNativePlatform === 'function' && maybeCapacitor.isNativePlatform()) {
            return true;
        }
        if (typeof maybeCapacitor?.getPlatform === 'function') {
            const platform = maybeCapacitor.getPlatform();
            if (platform && platform !== 'web') return true;
        }
    } catch {
        return false;
    }

    const protocol = readEnvString(window.location?.protocol).toLowerCase();
    if (protocol === 'capacitor:') return true;

    return false;
};

export const isCapacitorPluginAvailable = (pluginName: string): boolean => {
    const normalizedName = readEnvString(pluginName);
    if (!normalizedName) return false;

    try {
        if (typeof Capacitor?.isPluginAvailable === 'function') {
            return Capacitor.isPluginAvailable(normalizedName);
        }
    } catch {
        // Fall through to the window-based runtime probe below.
    }

    if (typeof window === 'undefined') return false;
    const maybeCapacitor = (window as any).Capacitor;

    try {
        if (typeof maybeCapacitor?.isPluginAvailable === 'function') {
            return maybeCapacitor.isPluginAvailable(normalizedName);
        }
    } catch {
        return false;
    }

    return false;
};

export const requiresRemoteSyncApi = (): boolean => {
    if (!isNativeCapacitorEnvironment()) return false;
    if (typeof window === 'undefined') return false;

    const hostname = readEnvString(window.location.hostname).toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1';
};

export const isMissingNativeSyncApiBaseUrl = (): boolean => (
    requiresRemoteSyncApi() && !getSyncApiBaseUrl()
);

export const setNativeSystemBarsHidden = async (hidden: boolean): Promise<void> => {
    if (!isNativeCapacitorEnvironment()) return;

    try {
        if (hidden) {
            await SystemBars.hide({ bar: SystemBarType.StatusBar });
            await SystemBars.hide({ bar: SystemBarType.NavigationBar });
        } else {
            await SystemBars.show({ bar: SystemBarType.StatusBar });
            await SystemBars.show({ bar: SystemBarType.NavigationBar });
        }
    } catch (error) {
        console.warn('Failed to update native system bars visibility:', error);
    }
};

export const 构建同步API地址 = buildSyncApiUrl;
export const 是否原生Capacitor环境 = isNativeCapacitorEnvironment;
export const 当前环境需要远程同步API = requiresRemoteSyncApi;
export const 设置原生系统栏隐藏 = setNativeSystemBarsHidden;
export const Capacitor插件可用 = isCapacitorPluginAvailable;
