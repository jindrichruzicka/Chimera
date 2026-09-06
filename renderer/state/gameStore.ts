/**
 * renderer/state/gameStore.ts
 *
 * Zustand store for in-match game state.
 * Implements `SnapshotStore` (the authoritative IPC mirror), `MatchStatusStore`
 * and `RevealStore`.
 *
 * Architecture reference: §4.4 — Renderer State Stores
 *
 * Rules:
 *  - Components subscribe through narrow typed selectors only.
 *  - `applySnapshot` and `applyTick` are `// ipcClient only` — do NOT call
 *    from components.
 *  - `GameSnapshot` never enters this store; only `PlayerSnapshot` does
 *    (Invariant #1, #3).
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type {
    CommitmentReveal,
    PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';

// ── Store interfaces (§4.4 split) ─────────────────────────────────────────────

/**
 * Authoritative snapshot mirror — receives `PlayerSnapshot` from IPC.
 * Only `ipcClient` may call `applySnapshot`.
 */
export interface SnapshotStore {
    /** Projected per-viewer snapshot; null before the first IPC push. */
    readonly snapshot: PlayerSnapshot | null;
    /**
     * The authoritative logical tick, written by both `applySnapshot` and
     * `applyTick`. What it is NOT is monotonic: a restore rewinds the match to
     * an earlier checkpoint, and its snapshot carries that checkpoint's tick.
     */
    readonly currentTick: number;

    /**
     * Apply incoming `PlayerSnapshot` from IPC.
     * ipcClient only — do NOT call from components.
     */
    applySnapshot(snapshot: PlayerSnapshot): void;
    /** Apply an authoritative tick-only update without replacing snapshot. */
    applyTick(tick: number): void;

    /**
     * Drop the current match snapshot and all derived in-match state back to
     * initial. Routing/lifecycle only — called by navigation effects on a
     * match → lobby or match → main-menu transition, NOT from render. Distinct
     * from the `// ipcClient only` mutators above.
     */
    reset(): void;
}

/**
 * What the match is, beside the snapshot itself.
 *
 * `canUndo` and `canRedo` mirror `snapshot.undoMeta` so that undo/redo
 * button state stays reactive without a separate selector chain.
 */
export interface MatchStatusStore {
    /** Estimated round-trip latency in milliseconds (0 until measured). */
    readonly latencyMs: number;
    /** Mirrors `snapshot.undoMeta.canUndo`; false before first snapshot. */
    readonly canUndo: boolean;
    /** Mirrors `snapshot.undoMeta.canRedo`; false before first snapshot. */
    readonly canRedo: boolean;
}

/**
 * Verified reveal stream for commitment battle mode. The main process
 * already gated each reveal through `CommitmentScheme.verify()` (Invariant #9)
 * before pushing it here; the store holds the most recent reveal so the active
 * game's playfield can play back each revealed turn as it lands (reveals arrive
 * one-per-player in the host's deterministic order). Game-agnostic — only the
 * authoring game interprets the opaque `reveal.value`.
 */
export interface RevealStore {
    /** The most recently received verified reveal, or null before any arrives. */
    readonly lastReveal: CommitmentReveal | null;
    /**
     * Record a verified reveal. ipcClient/bootstrap only — do NOT call from
     * components.
     */
    applyReveal(reveal: CommitmentReveal): void;
}

/** Convenience composition exposed to components (§4.4). */
export type GameStore = SnapshotStore & MatchStatusStore & RevealStore;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an isolated store instance.
 * Preferred for tests; production code uses the singleton `useGameStore`.
 */
export function createGameStore(): StoreApi<GameStore> {
    return createStore<GameStore>()((set) => ({
        snapshot: null,
        currentTick: 0,
        latencyMs: 0,
        canUndo: false,
        canRedo: false,
        lastReveal: null,

        applySnapshot(snapshot: PlayerSnapshot): void {
            set(() => ({
                snapshot,
                currentTick: snapshot.tick,
                canUndo: snapshot.undoMeta.canUndo,
                canRedo: snapshot.undoMeta.canRedo,
            }));
        },

        applyReveal(reveal: CommitmentReveal): void {
            set(() => ({ lastReveal: reveal }));
        },

        applyTick(tick: number): void {
            set(() => ({ currentTick: tick }));
        },

        reset(): void {
            set(() => ({
                snapshot: null,
                currentTick: 0,
                latencyMs: 0,
                canUndo: false,
                canRedo: false,
                lastReveal: null,
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
