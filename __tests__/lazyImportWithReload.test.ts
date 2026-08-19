import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyImportWithReload } from '../utils/lazyImportWithReload';

describe('lazyImportWithReload', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('refreshes only once for repeated failures in the same session', async () => {
        const reload = vi.fn();
        const values = new Map<string, string>();
        const sessionStorage = {
            getItem: vi.fn((key: string) => values.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => values.set(key, value)),
            removeItem: vi.fn((key: string) => values.delete(key))
        };
        vi.stubGlobal('window', {
            location: { reload },
            sessionStorage
        });

        const loader = async () => {
            throw new TypeError('Failed to fetch dynamically imported module');
        };
        await expect(lazyImportWithReload('game-panel', loader)).rejects.toMatchObject({
            name: 'DynamicImportDeferredReloadError'
        });
        await expect(lazyImportWithReload('game-panel', loader)).rejects.toMatchObject({
            name: 'DynamicImportDeferredReloadError'
        });

        expect(sessionStorage.setItem).toHaveBeenCalledOnce();
        expect(sessionStorage.setItem).toHaveBeenCalledWith('moranjianghu:lazy-import-reload:game-panel', '1');
        expect(reload).toHaveBeenCalledOnce();
    });

    it('clears the reload marker after the module loads successfully', async () => {
        const values = new Map([['moranjianghu:lazy-import-reload:game-panel', '1']]);
        const sessionStorage = {
            getItem: vi.fn((key: string) => values.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => values.set(key, value)),
            removeItem: vi.fn((key: string) => values.delete(key))
        };
        vi.stubGlobal('window', {
            location: { reload: vi.fn() },
            sessionStorage
        });

        await expect(lazyImportWithReload('game-panel', async () => ({ default: 'loaded' })))
            .resolves.toEqual({ default: 'loaded' });
        expect(sessionStorage.removeItem).toHaveBeenCalledWith('moranjianghu:lazy-import-reload:game-panel');
        expect(values.has('moranjianghu:lazy-import-reload:game-panel')).toBe(false);
    });

    it('treats Safari text/html module MIME errors as deployed chunk failures', async () => {
        vi.stubGlobal('window', { location: { reload: vi.fn() } });

        await expect(lazyImportWithReload('settings-panel', async () => {
            throw new TypeError("'text/html' is not a valid JavaScript MIME type.");
        })).rejects.toMatchObject({
            name: 'DynamicImportDeferredReloadError'
        });
    });
});
