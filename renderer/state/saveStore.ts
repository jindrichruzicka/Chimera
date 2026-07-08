/**
 * renderer/state/saveStore.ts
 *
 * Zustand store for the save slot list mirrored from IPC.
 *
 * Holds the current `SaveSlotMeta[]` list returned by
 * `window.__chimera.saves.list()` and updated via
 * `window.__chimera.saves.onSlotUpdate` push events.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #373
 *
 * Rules:
 *  - Components subscribe through narrow typed selectors only.
 *  - `applySaveSlots` is called by bootstrap/IPC wiring; do NOT call from components.
 *  - Holds only `SaveSlotMeta` (metadata). Never holds `GameSnapshot` or
 *    `SaveFile` content (Invariant #1).
 *  - Must NOT import from: electron/main/, simulation/, networking/.
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type {
    RestoreStatusEvent,
    SaveSlotMeta,
} from '@chimera-engine/simulation/bridge/api-types.js';

// ── Store shape ───────────────────────────────────────────────────────────────

export interface SaveStoreState {
    /** Current save slot list. Empty until bootstrap fetch resolves. */
    readonly slots: readonly SaveSlotMeta[];

    /**
     * True until the initial `list()` fetch resolves (or rejects).
     * Components should render a loading indicator while this is true.
     */
    readonly isLoading: boolean;

    /**
     * Latest session-restore transition pushed over
     * `chimera:saves:restore-status`, or `null` while idle (no restore seen
     * yet, or dismissed locally). Terminal events (`ready`/`cancelled`/
     * `failed`) are kept as-is; only `waiting` drives the overlay.
     */
    readonly restore: RestoreStatusEvent | null;

    /**
     * Remote-seat baseline latched when a restore enters `waiting` — the wire
     * event carries only the still-missing seats, so the "connected/expected"
     * roster count must be derived from the first waiting push. Held while
     * pendingSeats shrink; re-latched fresh when a different match enters
     * waiting.
     */
    readonly restoreExpectedSeats: number | null;

    /**
     * The matchId `restoreExpectedSeats` was latched for. Keyed so a waiting
     * push that resurrects the overlay after a dismissed-but-failed cancel
     * (same match, shrunken pendingSeats) restores the original baseline
     * instead of re-latching a too-small one.
     */
    readonly restoreLatchMatchId: string | null;

    /**
     * Apply incoming save slot list from IPC.
     * Called by `bootstrapSaveStore` after `list()` resolves and on every
     * `onSlotUpdate` push event.
     *
     * ipcClient / bootstrap only — do NOT call from components directly.
     */
    applySaveSlots(slots: readonly SaveSlotMeta[]): void;

    /**
     * Apply an incoming restore-status transition.
     * Called by `bootstrapSaveStore` on every `onRestoreStatus` push event.
     *
     * ipcClient / bootstrap only — do NOT call from components directly.
     */
    applyRestoreStatus(this: void, event: RestoreStatusEvent): void;

    /**
     * Optimistic local reset back to idle. Component-callable — the
     * RestoreWaitingOverlay's abort path dismisses immediately without
     * waiting for the main process to push its `cancelled` transition.
     * Deliberately keeps the latch pair: if the cancel fails main-side and
     * the same restore pushes `waiting` again, the baseline must survive.
     */
    dismissRestore(this: void): void;

    /**
     * True while a user-initiated restore abort (RestoreWaitingOverlay
     * Cancel / Escape) waits for the game route to carry the host off the
     * dead mid-restore /game hop and back to /saves (#842). Raised by the
     * overlay's abort handler; consumed by the game page's abort-exit
     * effect, which owns the navigation (mirrors the #741 leave flag).
     */
    readonly restoreAbortPending: boolean;

    /** Raise the abort-exit marker. Overlay abort path only. */
    markRestoreAborted(this: void): void;

    /** Consume the abort-exit marker after routing the exit. */
    clearRestoreAbort(this: void): void;
}

// ── Factory (for testing and production use) ──────────────────────────────────

/**
 * Create an isolated store instance. Preferred for tests so each test has
 * an independent store that does not share state with the singleton.
 */
export function createSaveStore(): StoreApi<SaveStoreState> {
    return createStore<SaveStoreState>()((set) => ({
        slots: [],
        isLoading: true,
        restore: null,
        restoreExpectedSeats: null,
        restoreLatchMatchId: null,
        restoreAbortPending: false,

        applySaveSlots(slots: readonly SaveSlotMeta[]): void {
            set(() => ({
                slots,
                isLoading: false,
            }));
        },

        applyRestoreStatus(event: RestoreStatusEvent): void {
            set((state) => {
                if (event.state !== 'waiting') {
                    return { restore: event };
                }
                // Same match: never shrink the baseline (covers waiting→waiting
                // shrinks AND a resurrect after a dismissed-but-failed cancel);
                // different match: latch fresh from this event.
                const sameMatch = state.restoreLatchMatchId === event.matchId;
                return {
                    restore: event,
                    restoreExpectedSeats: sameMatch
                        ? Math.max(state.restoreExpectedSeats ?? 0, event.pendingSeats.length)
                        : event.pendingSeats.length,
                    restoreLatchMatchId: event.matchId,
                };
            });
        },

        dismissRestore(): void {
            set(() => ({
                restore: null,
            }));
        },

        markRestoreAborted(): void {
            set(() => ({
                restoreAbortPending: true,
            }));
        },

        clearRestoreAbort(): void {
            set(() => ({
                restoreAbortPending: false,
            }));
        },
    }));
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const saveStoreInstance = createSaveStore();

/**
 * Zustand hook for the save store.
 *
 * Always subscribe via a narrow selector:
 *
 * ```typescript
 * // ✅ Narrow selector
 * const slots = useSaveStore((s) => s.slots);
 * const isLoading = useSaveStore((s) => s.isLoading);
 *
 * // ❌ Never subscribe to the whole store
 * const state = useSaveStore((s) => s);
 * ```
 */
export function useSaveStore<TSelected>(selector: (state: SaveStoreState) => TSelected): TSelected {
    return useStore(saveStoreInstance, selector);
}

// Expose static accessors for IPC wiring and tests
useSaveStore.getState = saveStoreInstance.getState.bind(saveStoreInstance);
useSaveStore.setState = saveStoreInstance.setState.bind(saveStoreInstance);
useSaveStore.subscribe = saveStoreInstance.subscribe.bind(saveStoreInstance);
