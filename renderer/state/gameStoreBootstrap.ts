/**
 * renderer/state/gameStoreBootstrap.ts
 *
 * Side-effect-free bootstrap function that wires the IPC game snapshot stream
 * into the gameStore via `createIpcClient`, routing incoming PlayerSnapshot
 * pushes through `confirmPrediction` (evicts confirmed predictions) and
 * `applySnapshot` (applies authoritative state).
 *
 * Usage (from a 'use client' component's useEffect):
 *
 *   const stop = bootstrapGameStore(window.__chimera.game);
 *   return stop; // cleanup on unmount
 *
 * Architecture reference: §4.4 — Renderer State Stores;
 *                         §6  — simulation/prediction · Client Prediction (F17)
 *
 * Invariants upheld:
 *   #1  — GameSnapshot never crosses any IPC boundary; only PlayerSnapshot.
 *   #3  — Renderer never writes simulation state directly; writes go via ipcClient.
 *   #4  — addPrediction / confirmPrediction are ipcClient only — components
 *          must never call them directly.
 */

import type { GameAPI, Unsubscribe } from '../../electron/preload/api-types.js';
import { createIpcClient, type IpcPredictionStore } from '../bridge/ipcClient.js';
import { useGameStore } from './gameStore.js';

/** Shape of the `createIpcClient` factory; injectable for testing. */
type IpcClientFactory = typeof createIpcClient;

/**
 * Wire the IPC game bridge into the gameStore.
 *
 * Fetches the set of predictable action types from the main-process
 * `ActionRegistry` via `api.getPredictableActionTypes()` once at mount, then
 * creates an `IpcClient` with a real `isPredictable` predicate. Subsequent
 * `sendAction()` calls on that client will enqueue optimistic predictions for
 * any action type in the returned set.
 *
 * @param api           - The `window.__chimera.game` bridge surface.
 * @param store         - Optional store write surface. Defaults to the singleton
 *                        `useGameStore.getState()`. Pass an isolated instance for
 *                        testing.
 * @param clientFactory - Optional factory override for testing. Defaults to
 *                        `createIpcClient`. Inject a spy to capture the
 *                        `isPredictable` predicate that was constructed.
 *
 * @returns Promise resolving to an Unsubscribe function — call on unmount to
 *          clean up the IPC listener.
 */
export async function bootstrapGameStore(
    api: GameAPI,
    store?: IpcPredictionStore,
    clientFactory: IpcClientFactory = createIpcClient,
): Promise<Unsubscribe> {
    const resolvedStore: IpcPredictionStore = store ?? useGameStore.getState();
    const predictableTypes = new Set(await api.getPredictableActionTypes());
    const client = clientFactory(api, resolvedStore, (type: string) => predictableTypes.has(type));
    return client.bootstrap();
}
