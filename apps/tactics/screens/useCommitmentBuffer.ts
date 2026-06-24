/**
 * apps/tactics/screens/useCommitmentBuffer.ts
 *
 * Renderer-side store for the tactics commitment-scheme local action buffer
 * (F54 / #730). In commitment mode a player's move/attack/reveal selections are
 * NOT dispatched to the host — they are appended to this per-instance buffer and
 * applied to an optimistic local view until the player commits. This module-
 * singleton Zustand store is the single shared source of buffer state between
 * the two sibling tactics screens — the board (which appends actions and renders
 * the optimistic view) and the HUD (Commit / Undo / optimistic stamina) — neither
 * of which can pass props to the other through the game-agnostic GameShell
 * (Invariants #48/#80). It mirrors the `renderer/state/chatStore.ts` idiom.
 *
 * All gameplay rules live in the pure kernel (`../commitment/buffer.js`); this
 * store only holds the buffer + an optimistic "committed" latch and resets at
 * turn / match boundaries (driven by the board). The buffer never reaches the
 * host's authoritative snapshot until commit/reveal (Invariants #3/#8).
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';

import type { PlayerId, PlayerSnapshot } from '@chimera/electron/preload/api-types.js';

import { appendToBuffer, bufferCanUndo, popBuffer } from '../commitment/buffer.js';
import type { BufferedTacticsAction, LocalActionBuffer } from '../commitment/contract.js';
import type { TacticsSnapshot } from '../stamina.js';

/** Outcome of an append attempt — mirrors the kernel's `appendToBuffer` result. */
export interface AppendResult {
    readonly ok: boolean;
    readonly reason?: string;
}

export interface CommitmentBufferState {
    /** The local player's ordered, un-committed turn (empty until they act). */
    readonly buffer: LocalActionBuffer;
    /**
     * Optimistic latch set when the local player presses Commit, before the
     * authoritative snapshot reflects it. Blocks further append/undo and lets the
     * HUD disable the Commit button immediately. Cleared by {@link reset}.
     */
    readonly committedLatch: boolean;
    /**
     * Validate `action` against the optimistic view (`base` + current buffer)
     * through its existing kernel definition and, if legal, extend the buffer.
     * No-op (returns `ok:false`) once committed.
     */
    append(
        this: void,
        base: Readonly<TacticsSnapshot>,
        action: BufferedTacticsAction,
        playerId: PlayerId,
    ): AppendResult;
    /** Pop the last buffered action (refunds its stamina implicitly via re-apply). */
    undo(this: void): void;
    /** Latch the local commit (board goes inert; Commit disabled). */
    markCommitted(this: void): void;
    /** Clear the buffer and the latch — called at turn and match boundaries. */
    reset(this: void): void;
}

export function createCommitmentBufferStore(): StoreApi<CommitmentBufferState> {
    return createStore<CommitmentBufferState>()((set, get) => ({
        buffer: [],
        committedLatch: false,

        append(base, action, playerId): AppendResult {
            if (get().committedLatch) {
                return { ok: false, reason: 'already_committed' };
            }
            const result = appendToBuffer(base, get().buffer, action, playerId);
            if (!result.ok) {
                return { ok: false, reason: result.reason };
            }
            set({ buffer: result.buffer });
            return { ok: true };
        },

        undo(): void {
            if (get().committedLatch) {
                return;
            }
            set((state) => ({ buffer: popBuffer(state.buffer) }));
        },

        markCommitted(): void {
            set({ committedLatch: true });
        },

        reset(): void {
            // Idempotent: skip the set (and the subscriber re-render it would
            // trigger) when the buffer is already clean — the board calls this on
            // every mount/turn-start to clear any stale buffer.
            const state = get();
            if (state.buffer.length === 0 && !state.committedLatch) {
                return;
            }
            set({ buffer: [], committedLatch: false });
        },
    }));
}

const commitmentBufferInstance = createCommitmentBufferStore();

export function useCommitmentBuffer<TSelected>(
    selector: (state: CommitmentBufferState) => TSelected,
): TSelected {
    return useStore(commitmentBufferInstance, selector);
}

useCommitmentBuffer.getState = commitmentBufferInstance.getState.bind(commitmentBufferInstance);
useCommitmentBuffer.setState = commitmentBufferInstance.setState.bind(commitmentBufferInstance);
useCommitmentBuffer.subscribe = commitmentBufferInstance.subscribe.bind(commitmentBufferInstance);

// ─── Narrow selectors (renderer/CLAUDE.md: components use narrow selectors) ────

export const selectBuffer = (state: CommitmentBufferState): LocalActionBuffer => state.buffer;
export const selectCommittedLatch = (state: CommitmentBufferState): boolean => state.committedLatch;
export const selectCanUndo = (state: CommitmentBufferState): boolean => bufferCanUndo(state.buffer);
export const selectBufferLength = (state: CommitmentBufferState): number => state.buffer.length;

/**
 * Normalise a projected {@link PlayerSnapshot} into a reducer-safe
 * {@link TacticsSnapshot} base for the optimistic view. The projection strips
 * host-internal fields (`seed`, `turnNumber`, `turnClock`, `timers`,
 * `playerStamina`); the three tactics reducers never read `ctx.rng`, so any seed
 * is fine (we derive it from `tick`), and starting the optimistic ledger at
 * `turnNumber: 0` makes stamina decrement from full each turn. Own units are
 * projected unmasked, so the view is faithful for the local player's actions.
 */
export function toOptimisticBase(snapshot: PlayerSnapshot): TacticsSnapshot {
    return {
        ...snapshot,
        seed: snapshot.tick,
        turnNumber: 0,
        timers: {},
    };
}
