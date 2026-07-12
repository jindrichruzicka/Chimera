/**
 * renderer/bridge/ipcClient.ts
 *
 * Typed bridge between renderer game state and the `window.__chimera.game`
 * IPC surface. Wraps `sendAction()` to enqueue optimistic predictions for
 * actions marked `predictable: true`, and wires the authoritative snapshot
 * stream into the `gameStore` via `applySnapshot` / `confirmPrediction`.
 *
 * Architecture reference: §4.4 — Renderer State Stores;
 *                         §6  — simulation/prediction · Client Prediction
 *
 * Module boundary rules (hard constraints):
 *  - Must NOT import `ClientPredictor` or `ReconcileBuffer` from simulation/.
 *  - Must NOT import from electron/main/, games/<name>/data, or any DOM API.
 *  - Renderer interacts with `PredictionStore` methods only; simulation types
 *    stay in simulation/.
 *
 * Invariants upheld:
 *  #1  — `GameSnapshot` never crosses the IPC boundary; only `PlayerSnapshot`.
 *  #3  — Renderer never writes simulation state directly; all writes go
 *          through `sendAction()` → IPC → `ActionPipeline`.
 *  #4  — `addPrediction` and `confirmPrediction` are `// ipcClient only`;
 *          components never call them.
 */

import type {
    EngineAction,
    PlayerSnapshot,
    Unsubscribe,
} from '@chimera-engine/simulation/bridge/api-types.js';

// ── Port interface ────────────────────────────────────────────────────────────

/**
 * Minimal surface of `window.__chimera.game` needed by `ipcClient`.
 * Typed as a narrow interface so tests can inject a double without
 * importing the full `GameAPI`.
 */
export interface IpcGamePort {
    /** Dispatch an action to the simulation host via IPC (fire-and-forget). */
    sendAction(action: EngineAction): void;
    /** Subscribe to projected `PlayerSnapshot` pushes. */
    onSnapshot(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe;
    /** Subscribe to tick-only clock updates. */
    onTick(cb: (tick: number) => void): Unsubscribe;
}

// ── Store interface ───────────────────────────────────────────────────────────

/**
 * Narrow `GameStore` prediction surface that `ipcClient` is allowed to write.
 * Components must never call these methods directly.
 */
export interface IpcPredictionStore {
    /** ipcClient only — appends action to prediction queue. */
    addPrediction(action: EngineAction): void;
    /** ipcClient only — evicts confirmed predictions at or before `tick`. */
    confirmPrediction(tick: number): void;
    /** ipcClient only — applies authoritative snapshot from host. */
    applySnapshot(snapshot: PlayerSnapshot): void;
    /** ipcClient only — applies authoritative tick-only updates from host. */
    applyTick(tick: number): void;
}

// ── IpcClient interface ───────────────────────────────────────────────────────

export interface IpcClient {
    /**
     * Dispatch `action` via IPC. When `isPredictable(action.type)` is `true`,
     * enqueues an optimistic prediction in the store before sending.
     */
    sendAction(action: EngineAction): void;
    /**
     * Register the `onSnapshot` push listener. Must be called once at
     * renderer bootstrap. Returns an `Unsubscribe` function.
     */
    bootstrap(): Unsubscribe;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a typed IPC client with prediction wiring.
 *
 * @param port          - Narrow `GameAPI` surface (`window.__chimera.game`).
 * @param store         - `GameStore` prediction write surface (ipcClient only).
 * @param isPredictable - Returns `true` when the action type is marked
 *                        `predictable: true` in its `ActionDefinition`.
 *                        Injected so the bridge does not import `ActionRegistry`
 *                        from `simulation/` (module boundary rule).
 */
export function createIpcClient(
    port: IpcGamePort,
    store: IpcPredictionStore,
    isPredictable: (type: string) => boolean,
): IpcClient {
    return {
        sendAction(action: EngineAction): void {
            if (isPredictable(action.type)) {
                store.addPrediction(action);
            }
            port.sendAction(action);
        },

        bootstrap(): Unsubscribe {
            const unsubscribeSnapshot = port.onSnapshot((snapshot: PlayerSnapshot) => {
                store.confirmPrediction(snapshot.tick);
                store.applySnapshot(snapshot);
            });
            const unsubscribeTick = port.onTick((tick: number) => {
                store.applyTick(tick);
            });

            return (): void => {
                unsubscribeSnapshot();
                unsubscribeTick();
            };
        },
    };
}
