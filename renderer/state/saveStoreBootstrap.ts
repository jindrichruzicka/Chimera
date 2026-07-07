/**
 * renderer/state/saveStoreBootstrap.ts
 *
 * Side-effect-free bootstrap function that:
 *  1. Calls `api.list(gameId)` to populate the saveStore with the initial
 *     save slot list.
 *  2. Registers `api.onSlotUpdate` so the renderer stays in sync whenever
 *     the main process mutates the save slot list (saves, deletes, autosaves).
 *  3. Registers `api.onRestoreStatus` so the restore slice tracks the
 *     session-restore lifecycle. The channel is push-only with no pull twin
 *     (F68 #826), so this bootstrap-time subscription — before any load can
 *     be issued — is the only way the renderer sees every transition.
 *
 * Usage (from a 'use client' component's useEffect):
 *
 *   const stop = bootstrapSaveStore(window.__chimera.saves, activeGameId);
 *   return stop; // cleanup on unmount
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #373; restore-status subscription: issue #828
 *
 * Invariant #1: SaveSlotMeta (not GameSnapshot) is what crosses IPC.
 */

import type { SavesAPI, Unsubscribe } from '@chimera-engine/simulation/bridge/api-types.js';
import { useSaveStore } from './saveStore.js';

/**
 * Wire the saves API push subscription into the saveStore singleton and
 * initiate the initial `list()` fetch.
 *
 * @param api  - Narrow slice of `SavesAPI` required for bootstrapping.
 * @param gameId - Game identifier passed to `api.list()`.
 * @returns Unsubscribe function; call on component unmount to stop receiving
 *          push events.
 */
export function bootstrapSaveStore(
    api: Pick<SavesAPI, 'list' | 'onSlotUpdate' | 'onRestoreStatus'>,
    gameId: string,
): Unsubscribe {
    const unsubscribeSlots = api.onSlotUpdate((slots) => {
        useSaveStore.getState().applySaveSlots(slots);
    });

    const unsubscribeRestore = api.onRestoreStatus((event) => {
        useSaveStore.getState().applyRestoreStatus(event);
    });

    void api
        .list(gameId)
        .then((slots) => {
            useSaveStore.getState().applySaveSlots(slots);
        })
        .catch(() => {
            useSaveStore.getState().applySaveSlots([]);
        });

    return () => {
        unsubscribeSlots();
        unsubscribeRestore();
    };
}
