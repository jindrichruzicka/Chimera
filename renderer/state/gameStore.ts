/**
 * renderer/state/gameStore.ts
 *
 * Zustand store for in-match game state.
 * Implements both `SnapshotStore` (authoritative IPC mirror) and
 * `PredictionStore` (optimistic client-side prediction queue).
 *
 * Architecture reference: §4.4 — Renderer State Stores
 * Task: issue #368 — Wire client prediction into renderer ipcClient
 *
 * Rules:
 *  - Components subscribe through narrow typed selectors only.
 *  - `applySnapshot`, `addPrediction`, and `confirmPrediction` are
 *    `// ipcClient only` — do NOT call from components.
 *  - `GameSnapshot` never enters this store; only `PlayerSnapshot` does
 *    (Invariant #1, #3).
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { EngineAction, PlayerSnapshot } from '../../electron/preload/api-types.js';

// ── Store interfaces (§4.4 split) ─────────────────────────────────────────────

/**
 * Authoritative snapshot mirror — receives `PlayerSnapshot` from IPC.
 * Only `ipcClient` may call `applySnapshot`.
 */
export interface SnapshotStore {
    /** Projected per-viewer snapshot; null before the first IPC push. */
    readonly snapshot: PlayerSnapshot | null;

    /**
     * Apply incoming `PlayerSnapshot` from IPC.
     * ipcClient only — do NOT call from components.
     */
    applySnapshot(snapshot: PlayerSnapshot): void;
}

/**
 * Optimistic prediction queue — tracks locally dispatched actions that have
 * not yet been confirmed by an authoritative snapshot.
 *
 * `canUndo` and `canRedo` mirror `snapshot.undoMeta` so that undo/redo
 * button state stays reactive without a separate selector chain.
 */
export interface PredictionStore {
    /** Actions dispatched but not yet confirmed by host. */
    readonly predictedActions: readonly EngineAction[];
    /** Estimated round-trip latency in milliseconds (0 until measured). */
    readonly latencyMs: number;
    /** Mirrors `snapshot.undoMeta.canUndo`; false before first snapshot. */
    readonly canUndo: boolean;
    /** Mirrors `snapshot.undoMeta.canRedo`; false before first snapshot. */
    readonly canRedo: boolean;

    /**
     * Append `action` to the prediction queue.
     * ipcClient only — do NOT call from components.
     */
    addPrediction(action: EngineAction): void;

    /**
     * Evict all predictions whose `tick` is ≤ `tick`.
     * Called by `ipcClient` when an authoritative snapshot arrives at `tick`.
     * ipcClient only — do NOT call from components.
     */
    confirmPrediction(tick: number): void;
}

/** Convenience composition exposed to components (§4.4). */
export type GameStore = SnapshotStore & PredictionStore;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an isolated store instance.
 * Preferred for tests; production code uses the singleton `useGameStore`.
 */
export function createGameStore(): StoreApi<GameStore> {
    return createStore<GameStore>()((set) => ({
        snapshot: null,
        predictedActions: [],
        latencyMs: 0,
        canUndo: false,
        canRedo: false,

        applySnapshot(snapshot: PlayerSnapshot): void {
            set(() => ({
                snapshot,
                canUndo: snapshot.undoMeta.canUndo,
                canRedo: snapshot.undoMeta.canRedo,
            }));
        },

        addPrediction(action: EngineAction): void {
            set((state) => ({
                predictedActions: [...state.predictedActions, action],
            }));
        },

        confirmPrediction(tick: number): void {
            set((state) => ({
                predictedActions: state.predictedActions.filter((a) => a.tick > tick),
            }));
        },
    }));
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const gameStoreInstance = createGameStore();

/**
 * Zustand hook for the game store.
 *
 * Always subscribe via a narrow selector:
 *
 * ```typescript
 * // ✅ Narrow selector
 * const snapshot = useGameStore((s) => s.snapshot);
 *
 * // ❌ Wrong — subscribes to entire store
 * const store = useGameStore();
 * ```
 */
export function useGameStore<TSelected>(selector: (state: GameStore) => TSelected): TSelected {
    return useStore(gameStoreInstance, selector);
}

// Expose static accessors for ipcClient wiring and tests.
useGameStore.getState = gameStoreInstance.getState.bind(gameStoreInstance);
useGameStore.subscribe = gameStoreInstance.subscribe.bind(gameStoreInstance);
