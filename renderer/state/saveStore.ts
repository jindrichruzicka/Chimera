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
import type { SaveSlotMeta } from '@chimera/simulation/bridge/api-types.js';

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
     * Apply incoming save slot list from IPC.
     * Called by `bootstrapSaveStore` after `list()` resolves and on every
     * `onSlotUpdate` push event.
     *
     * ipcClient / bootstrap only — do NOT call from components directly.
     */
    applySaveSlots(slots: readonly SaveSlotMeta[]): void;
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

        applySaveSlots(slots: readonly SaveSlotMeta[]): void {
            set(() => ({
                slots,
                isLoading: false,
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
