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

import type { GameAPI, PlayerSnapshot, Unsubscribe } from '../../electron/preload/api-types.js';
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
    let latestSnapshot = currentSnapshotFrom(resolvedStore);
    const trackedStore: IpcPredictionStore = {
        addPrediction: (action) => resolvedStore.addPrediction(action),
        confirmPrediction: (tick) => resolvedStore.confirmPrediction(tick),
        applySnapshot: (snapshot) => {
            latestSnapshot = snapshot;
            resolvedStore.applySnapshot(snapshot);
        },
        applyTick: (tick) => resolvedStore.applyTick(tick),
    };
    let predictableTypes = new Set<string>();
    const predictableTypesPromise = api.getPredictableActionTypes();
    const client = clientFactory(api, trackedStore, (type: string) => predictableTypes.has(type));
    const unsubscribe = client.bootstrap();
    predictableTypes = new Set(await predictableTypesPromise);

    // Replay: if a snapshot was sent before this listener was registered
    // (direct-game E2E start, renderer reload mid-session), apply it now so
    // the match page does not redirect back to /lobby on mount.
    const currentSnapshot = await api.getCurrentSnapshot();
    if (currentSnapshot !== null && isNewerThanLatest(currentSnapshot, latestSnapshot)) {
        latestSnapshot = currentSnapshot;
        resolvedStore.applySnapshot(currentSnapshot);
    }

    return unsubscribe;
}

type SnapshotReadableStore = IpcPredictionStore & {
    readonly snapshot?: PlayerSnapshot | null;
};

function currentSnapshotFrom(store: IpcPredictionStore): PlayerSnapshot | null {
    return (store as SnapshotReadableStore).snapshot ?? null;
}

function isNewerThanLatest(
    snapshot: PlayerSnapshot,
    latestSnapshot: PlayerSnapshot | null,
): boolean {
    return latestSnapshot === null || snapshot.tick > latestSnapshot.tick;
}
