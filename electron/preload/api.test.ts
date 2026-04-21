import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Vitest module mock for `electron`. `contextBridge.exposeInMainWorld` is the
 * only side effect `preload/api.ts` is expected to cause at import time;
 * `ipcRenderer` is captured so we can inspect whether the composed namespaces
 * actually talk to it.
 */
const exposeInMainWorld = vi.fn<(key: string, api: Record<string, unknown>) => void>();
const ipcRendererInvoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(() =>
    Promise.resolve(undefined),
);
const ipcRendererSend = vi.fn<(channel: string, ...args: unknown[]) => void>();
const ipcRendererOn = vi.fn<(channel: string, listener: (...args: unknown[]) => void) => void>();
const ipcRendererRemoveListener =
    vi.fn<(channel: string, listener: (...args: unknown[]) => void) => void>();

vi.mock('electron', () => ({
    contextBridge: {
        exposeInMainWorld,
    },
    ipcRenderer: {
        invoke: ipcRendererInvoke,
        send: ipcRendererSend,
        on: ipcRendererOn,
        removeListener: ipcRendererRemoveListener,
    },
}));

/**
 * Reload `preload/api.ts` for every test so its import-time side effect
 * (the single `contextBridge.exposeInMainWorld` call) is observed fresh.
 */
async function importPreloadApi(): Promise<void> {
    vi.resetModules();
    await import('./api.js');
}

describe('preload/api.ts', () => {
    beforeEach(() => {
        exposeInMainWorld.mockClear();
        ipcRendererInvoke.mockClear();
        ipcRendererSend.mockClear();
        ipcRendererOn.mockClear();
        ipcRendererRemoveListener.mockClear();
    });

    it('calls contextBridge.exposeInMainWorld exactly once', async () => {
        await importPreloadApi();
        expect(exposeInMainWorld).toHaveBeenCalledOnce();
    });

    it("exposes the composed ChimeraAPI under the key '__chimera'", async () => {
        await importPreloadApi();
        const [key] = exposeInMainWorld.mock.calls[0] ?? [];
        expect(key).toBe('__chimera');
    });

    it('composes all five required namespaces: game, lobby, saves, settings, system', async () => {
        await importPreloadApi();
        const [, api] = exposeInMainWorld.mock.calls[0] ?? [];
        expect(api).toBeDefined();
        // Each namespace must be an object with the canonical method set so the
        // renderer's typed `ChimeraAPI` contract is honoured. We assert the
        // namespace presence + at least one characteristic method per namespace.
        expect(typeof api?.['game']).toBe('object');
        expect(typeof (api?.['game'] as Record<string, unknown>)?.['sendAction']).toBe('function');
        expect(typeof api?.['lobby']).toBe('object');
        expect(typeof (api?.['lobby'] as Record<string, unknown>)?.['host']).toBe('function');
        expect(typeof api?.['saves']).toBe('object');
        expect(typeof (api?.['saves'] as Record<string, unknown>)?.['list']).toBe('function');
        expect(typeof api?.['settings']).toBe('object');
        expect(typeof (api?.['settings'] as Record<string, unknown>)?.['get']).toBe('function');
        expect(typeof api?.['system']).toBe('object');
        expect(typeof (api?.['system'] as Record<string, unknown>)?.['platform']).toBe('function');
    });

    it('does NOT expose a __chimeraDebug namespace (invariant 28)', async () => {
        await importPreloadApi();
        // Invariant 28: the debug surface is a separate preload for the
        // Inspector window; the game renderer preload must never expose it.
        const keys = exposeInMainWorld.mock.calls.map(([k]) => k);
        expect(keys).not.toContain('__chimeraDebug');
    });

    it('wires the namespaces against the real ipcRenderer port (smoke: game.sendAction → ipcRenderer.send)', async () => {
        await importPreloadApi();
        const [, api] = exposeInMainWorld.mock.calls[0] ?? [];
        const game = api?.['game'] as { sendAction: (a: unknown) => void };
        game.sendAction({ type: 'noop', playerId: 'p1', tick: 0, payload: {} });
        expect(ipcRendererSend).toHaveBeenCalledOnce();
        const [channel] = ipcRendererSend.mock.calls[0] ?? [];
        expect(channel).toBe('chimera:game:send-action');
    });
});
