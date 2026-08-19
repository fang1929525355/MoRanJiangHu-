import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyImportWithReload } from '../utils/lazyImportWithReload';

describe('lazyImportWithReload', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('refreshes once when a deployed chunk is no longer available', async () => {
        const reload = vi.fn();
        vi.stubGlobal('window', {
            location: { reload },
            sessionStorage: {
                getItem: vi.fn().mockReturnValue(null),
                setItem: vi.fn(),
                removeItem: vi.fn()
            }
        });

        await expect(lazyImportWithReload('game-panel', async () => {
            throw new TypeError('Failed to fetch dynamically imported module');
        })).rejects.toMatchObject({
            name: 'DynamicImportDeferredReloadError'
        });

        expect(reload).toHaveBeenCalledOnce();
    });

    it('does not refresh repeatedly after the same chunk failure', async () => {
        const reload = vi.fn();
        vi.stubGlobal('window', {
            location: { reload },
            sessionStorage: {
                getItem: vi.fn().mockReturnValue('1'),
                setItem: vi.fn(),
                removeItem: vi.fn()
            }
        });

        await expect(lazyImportWithReload('game-panel', async () => {
            throw new TypeError('Failed to fetch dynamically imported module');
        })).rejects.toMatchObject({ name: 'DynamicImportDeferredReloadError' });
        expect(reload).not.toHaveBeenCalled();
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
