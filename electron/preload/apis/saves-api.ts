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

import type {
    RestoreStatusEvent,
    SaveRequest,
    SaveSlotMeta,
    SavesAPI,
    Unsubscribe,
} from '../api-types.js';
import type { IpcListener, PushListenerPort } from '../shared/listener.js';
import { subscribeGuardedPush, subscribePush } from '../shared/listener.js';
import {
    RestoreStatusEventSchema,
    SaveSlotListSchema,
    SaveSlotMetaSchema,
    parseInvokeResponse,
} from '../shared/schemas.js';

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
 * `ipcRenderer.on` target for {@link SavesAPI.onRestoreStatus}. Main pushes a
 * slim `RestoreStatusEvent` via `webContents.send` on every session-restore
 * transition.
 */
export const SAVES_RESTORE_STATUS_CHANNEL = 'chimera:saves:restore-status';

/** `ipcRenderer.invoke` target for {@link SavesAPI.cancelRestore}. */
export const SAVES_CANCEL_RESTORE_CHANNEL = 'chimera:saves:cancel-restore';

/**
 * Back-compat alias for {@link IpcListener}. Retained so test files that
 * imported `SavesApiListener` continue to compile. New code should use
 * {@link IpcListener} directly.
 */
export type SavesApiListener = IpcListener;

/**
 * Narrow port over `ipcRenderer`. Extends {@link PushListenerPort} for the
 * on/removeListener slice and adds `invoke`. The saves namespace never
 * `send`s — every write is a round-trip invoke so the renderer can
 * surface failures.
 */
export interface SavesApiIpcPort extends PushListenerPort {
    invoke(channel: string, arg?: unknown): Promise<unknown>;
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
            ipc.invoke(SAVES_LIST_CHANNEL, gameId).then(
                (value) =>
                    parseInvokeResponse(
                        SaveSlotListSchema,
                        SAVES_LIST_CHANNEL,
                        value,
                        // The declared contract is `Promise<SaveSlotMeta[]>` (mutable
                        // array) whereas the schema returns `readonly SaveSlotMeta[]`.
                        // Casting here is safe: the parsed array is a freshly-created
                        // copy that no other caller holds a reference to.
                    ) as SaveSlotMeta[],
            ),
        save: (request: SaveRequest): Promise<SaveSlotMeta> =>
            ipc
                .invoke(SAVES_SAVE_CHANNEL, request)
                .then((value) =>
                    parseInvokeResponse(SaveSlotMetaSchema, SAVES_SAVE_CHANNEL, value),
                ),
        load: async (slotId: string): Promise<void> => {
            await ipc.invoke(SAVES_LOAD_CHANNEL, slotId);
        },
        delete: async (slotId: string): Promise<void> => {
            await ipc.invoke(SAVES_DELETE_CHANNEL, slotId);
        },
        onSlotUpdate: (cb: (slots: SaveSlotMeta[]) => void): Unsubscribe =>
            subscribePush<SaveSlotMeta[]>(ipc, SAVES_SLOT_UPDATE_CHANNEL, cb),
        // Guarded (log-and-drop): a malformed status push must not take down
        // the renderer's long-lived restore overlay subscription.
        onRestoreStatus: (cb: (event: RestoreStatusEvent) => void): Unsubscribe =>
            subscribeGuardedPush<RestoreStatusEvent>(
                ipc,
                SAVES_RESTORE_STATUS_CHANNEL,
                RestoreStatusEventSchema,
                cb,
            ),
        cancelRestore: async (): Promise<void> => {
            await ipc.invoke(SAVES_CANCEL_RESTORE_CHANNEL);
        },
    };
}
