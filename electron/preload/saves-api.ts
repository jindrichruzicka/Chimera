// electron/preload/saves-api.ts
//
// Implements the `window.__chimera.saves` namespace exposed to the renderer
// (§4.1). Only depends on a narrow `SavesApiIpcPort` so the factory is
// trivially testable without spinning up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and the
// main-process handler module imports these same constants to guarantee the
// channel strings match on both sides (invariant 5).
//
// The host-only constraint (§4.1) is enforced in the main-process handlers —
// the preload bridge simply forwards calls and has no opinion about who is
// allowed to issue them.

import type { SaveRequest, SaveSlotMeta, SavesAPI, Unsubscribe } from './api.js';

/** `ipcRenderer.invoke` target for {@link SavesAPI.list}. */
export const SAVES_LIST_CHANNEL = 'chimera:saves:list';

/** `ipcRenderer.invoke` target for {@link SavesAPI.save}. */
export const SAVES_SAVE_CHANNEL = 'chimera:saves:save';

/** `ipcRenderer.invoke` target for {@link SavesAPI.load}. */
export const SAVES_LOAD_CHANNEL = 'chimera:saves:load';

/** `ipcRenderer.invoke` target for {@link SavesAPI.delete}. */
export const SAVES_DELETE_CHANNEL = 'chimera:saves:delete';

/**
 * `ipcRenderer.on` target for {@link SavesAPI.onSlotUpdate}. Main pushes the
 * full slot list via `webContents.send` after every save / delete / autosave.
 */
export const SAVES_SLOT_UPDATE_CHANNEL = 'chimera:saves:slot-update';

/**
 * Shape of an `ipcRenderer` listener. Electron's real signature is
 * `(event: IpcRendererEvent, ...args: unknown[]) => void`; permissive here
 * so a test stub can invoke it with any payload.
 */
export type SavesApiListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Narrow port over `ipcRenderer`. The saves namespace never `send`s — every
 * write is a round-trip invoke so the renderer can surface failures.
 */
export interface SavesApiIpcPort {
    invoke(channel: string, arg?: unknown): Promise<unknown>;
    on(channel: string, listener: SavesApiListener): void;
    removeListener(channel: string, listener: SavesApiListener): void;
}

/**
 * Build the `window.__chimera.saves` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph.
 *
 * Note: `delete` is a reserved JavaScript keyword but is valid as an object
 * method name (§4.1 documents the method as `delete(slotId)`). The preload
 * mirrors the canonical surface verbatim.
 */
export function createSavesApi(ipc: SavesApiIpcPort): SavesAPI {
    return {
        list: (gameId: string): Promise<SaveSlotMeta[]> =>
            ipc.invoke(SAVES_LIST_CHANNEL, gameId) as Promise<SaveSlotMeta[]>,
        save: (request: SaveRequest): Promise<SaveSlotMeta> =>
            ipc.invoke(SAVES_SAVE_CHANNEL, request) as Promise<SaveSlotMeta>,
        load: async (slotId: string): Promise<void> => {
            await ipc.invoke(SAVES_LOAD_CHANNEL, slotId);
        },
        delete: async (slotId: string): Promise<void> => {
            await ipc.invoke(SAVES_DELETE_CHANNEL, slotId);
        },
        onSlotUpdate: (cb: (slots: SaveSlotMeta[]) => void): Unsubscribe => {
            const listener: SavesApiListener = (_event, ...args) => {
                // Main emits via `webContents.send(channel, slots)`; the
                // first positional argument (after the Electron event) is
                // the payload. Coerce via the declared type.
                cb(args[0] as SaveSlotMeta[]);
            };
            ipc.on(SAVES_SLOT_UPDATE_CHANNEL, listener);
            return () => {
                ipc.removeListener(SAVES_SLOT_UPDATE_CHANNEL, listener);
            };
        },
    };
}
