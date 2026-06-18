// @vitest-environment jsdom

/**
 * renderer/state/gameStore.test.ts
 *
 * Unit tests for the gameStore Zustand store.
 * Covers SnapshotStore and PredictionStore behaviours as required by §4.4 and
 * acceptance criteria for issue #368.
 *
 * Architecture: §4.4 — Renderer State Stores
 * Task: issue #368
 *
 * Rules:
 *  - No real Electron IPC — all tests use the `createGameStore()` factory.
 *  - `applySnapshot`, `addPrediction`, `confirmPrediction` are marked
 *    `// ipcClient only` and must not be called from components.
 */

import { describe, it, expect } from 'vitest';
import { createGameStore, useGameStore } from './gameStore.js';
import type {
    CommitmentId,
    CommitmentReveal,
    EngineAction,
    PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';
import { playerId, gamePhase } from '@chimera/electron/preload/api-types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSnapshot(tick: number, canUndo = false, canRedo = false): PlayerSnapshot {
    return {
        tick,
        viewerId: playerId('p1'),
        players: {},
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo, canRedo },
        isMyTurn: true,
    };
}

function makeAction(tick: number, type = 'test:move'): EngineAction {
    return {
        type,
        playerId: playerId('p1'),
        tick,
        payload: {},
    };
}

// ── gameStore — initial state ─────────────────────────────────────────────────

describe('gameStore — initial state', () => {
    it('initialises with null snapshot', () => {
        const store = createGameStore();
        expect(store.getState().snapshot).toBeNull();
    });

    it('initialises with empty predictedActions', () => {
        const store = createGameStore();
        expect(store.getState().predictedActions).toEqual([]);
    });

    it('initialises with latencyMs = 0', () => {
        const store = createGameStore();
        expect(store.getState().latencyMs).toBe(0);
    });

    it('initialises with canUndo = false', () => {
        const store = createGameStore();
        expect(store.getState().canUndo).toBe(false);
    });

    it('initialises with canRedo = false', () => {
        const store = createGameStore();
        expect(store.getState().canRedo).toBe(false);
    });
});

// ── gameStore.applySnapshot() ─────────────────────────────────────────────────

describe('gameStore.applySnapshot()', () => {
    it('sets snapshot to the provided PlayerSnapshot', () => {
        const store = createGameStore();
        const snap = makeSnapshot(5);

        store.getState().applySnapshot(snap);

        expect(store.getState().snapshot).toBe(snap);
    });

    it('mirrors canUndo = true from snapshot.undoMeta', () => {
        const store = createGameStore();

        store.getState().applySnapshot(makeSnapshot(1, true, false));

        expect(store.getState().canUndo).toBe(true);
    });

    it('mirrors canRedo = true from snapshot.undoMeta', () => {
        const store = createGameStore();

        store.getState().applySnapshot(makeSnapshot(1, false, true));

        expect(store.getState().canRedo).toBe(true);
    });

    it('mirrors both canUndo and canRedo when both are true', () => {
        const store = createGameStore();

        store.getState().applySnapshot(makeSnapshot(1, true, true));

        expect(store.getState().canUndo).toBe(true);
        expect(store.getState().canRedo).toBe(true);
    });

    it('updates canUndo / canRedo when a subsequent snapshot arrives', () => {
        const store = createGameStore();
        store.getState().applySnapshot(makeSnapshot(1, true, true));

        store.getState().applySnapshot(makeSnapshot(2, false, false));

        expect(store.getState().canUndo).toBe(false);
        expect(store.getState().canRedo).toBe(false);
    });

    it('replaces the previous snapshot with the latest', () => {
        const store = createGameStore();
        const first = makeSnapshot(3);
        const second = makeSnapshot(7);

        store.getState().applySnapshot(first);
        store.getState().applySnapshot(second);

        expect(store.getState().snapshot?.tick).toBe(7);
    });

    it('mirrors currentTick from the incoming snapshot', () => {
        const store = createGameStore();

        store.getState().applySnapshot(makeSnapshot(11));

        expect(store.getState().currentTick).toBe(11);
    });
});

// ── gameStore.applyTick() ─────────────────────────────────────────────────────

describe('gameStore.applyTick()', () => {
    it('updates currentTick without replacing the current snapshot', () => {
        const store = createGameStore();
        const snap = makeSnapshot(5);
        store.getState().applySnapshot(snap);

        store.getState().applyTick(6);

        expect(store.getState().currentTick).toBe(6);
        expect(store.getState().snapshot).toBe(snap);
    });
});

// ── gameStore.addPrediction() ─────────────────────────────────────────────────

describe('gameStore.addPrediction()', () => {
    it('appends the action to predictedActions', () => {
        const store = createGameStore();
        const action = makeAction(5);

        store.getState().addPrediction(action);

        expect(store.getState().predictedActions).toHaveLength(1);
        expect(store.getState().predictedActions[0]).toBe(action);
    });

    it('accumulates multiple predictions in order', () => {
        const store = createGameStore();
        const a1 = makeAction(3);
        const a2 = makeAction(4);
        const a3 = makeAction(5);

        store.getState().addPrediction(a1);
        store.getState().addPrediction(a2);
        store.getState().addPrediction(a3);

        expect(store.getState().predictedActions).toHaveLength(3);
        expect(store.getState().predictedActions[0]).toBe(a1);
        expect(store.getState().predictedActions[2]).toBe(a3);
    });

    it('does not mutate the previous predictedActions array', () => {
        const store = createGameStore();
        const a1 = makeAction(1);
        store.getState().addPrediction(a1);
        const before = store.getState().predictedActions;

        const a2 = makeAction(2);
        store.getState().addPrediction(a2);

        // The array reference should change (immutable update)
        expect(store.getState().predictedActions).not.toBe(before);
    });
});

// ── gameStore.confirmPrediction() ─────────────────────────────────────────────

describe('gameStore.confirmPrediction()', () => {
    it('evicts all predictions with tick exactly equal to N', () => {
        const store = createGameStore();
        store.getState().addPrediction(makeAction(5));

        store.getState().confirmPrediction(5);

        expect(store.getState().predictedActions).toHaveLength(0);
    });

    it('evicts all predictions with tick strictly less than N', () => {
        const store = createGameStore();
        store.getState().addPrediction(makeAction(3));
        store.getState().addPrediction(makeAction(4));

        store.getState().confirmPrediction(5);

        expect(store.getState().predictedActions).toHaveLength(0);
    });

    it('retains predictions with tick strictly greater than N', () => {
        const store = createGameStore();
        store.getState().addPrediction(makeAction(6));
        store.getState().addPrediction(makeAction(7));

        store.getState().confirmPrediction(5);

        expect(store.getState().predictedActions).toHaveLength(2);
    });

    it('evicts only tick <= N and retains tick > N', () => {
        const store = createGameStore();
        store.getState().addPrediction(makeAction(3));
        store.getState().addPrediction(makeAction(5));
        store.getState().addPrediction(makeAction(6));
        store.getState().addPrediction(makeAction(10));

        store.getState().confirmPrediction(5);

        const remaining = store.getState().predictedActions.map((a) => a.tick);
        expect(remaining).toEqual([6, 10]);
    });

    it('handles empty predictedActions without error', () => {
        const store = createGameStore();

        expect(() => store.getState().confirmPrediction(5)).not.toThrow();
        expect(store.getState().predictedActions).toHaveLength(0);
    });
});

// ── RevealStore.applyReveal() (F54 / T9) ──────────────────────────────────────

describe('gameStore.applyReveal()', () => {
    const reveal = (id: string): CommitmentReveal => ({
        id: id as CommitmentId,
        value: { playerId: 'p1' },
        nonce: 'nonce',
    });

    it('starts with no reveal', () => {
        expect(createGameStore().getState().lastReveal).toBeNull();
    });

    it('records the most recent reveal', () => {
        const store = createGameStore();
        store.getState().applyReveal(reveal('env-1'));
        expect(store.getState().lastReveal?.id).toBe('env-1');
        store.getState().applyReveal(reveal('env-2'));
        expect(store.getState().lastReveal?.id).toBe('env-2');
    });

    it('does not disturb snapshot or prediction state', () => {
        const store = createGameStore();
        store.getState().applySnapshot(makeSnapshot(7));
        store.getState().applyReveal(reveal('env-1'));
        expect(store.getState().snapshot?.tick).toBe(7);
        expect(store.getState().predictedActions).toHaveLength(0);
    });
});

// ── gameStore.reset() (issue #741) ────────────────────────────────────────────

describe('gameStore.reset()', () => {
    const reveal = (id: string): CommitmentReveal => ({
        id: id as CommitmentId,
        value: { playerId: 'p1' },
        nonce: 'nonce',
    });

    it('clears the stale snapshot back to null', () => {
        const store = createGameStore();
        store.getState().applySnapshot(makeSnapshot(7));

        store.getState().reset();

        expect(store.getState().snapshot).toBeNull();
    });

    it('returns currentTick to 0', () => {
        const store = createGameStore();
        store.getState().applySnapshot(makeSnapshot(11));

        store.getState().reset();

        expect(store.getState().currentTick).toBe(0);
    });

    it('clears predictions and undo/redo and reveal back to initial', () => {
        const store = createGameStore();
        store.getState().applySnapshot(makeSnapshot(3, true, true));
        store.getState().addPrediction(makeAction(4));
        store.getState().applyReveal(reveal('env-1'));

        store.getState().reset();

        expect(store.getState().predictedActions).toEqual([]);
        expect(store.getState().canUndo).toBe(false);
        expect(store.getState().canRedo).toBe(false);
        expect(store.getState().lastReveal).toBeNull();
    });

    it('is idempotent on an already-empty store', () => {
        const store = createGameStore();

        expect(() => store.getState().reset()).not.toThrow();
        expect(store.getState().snapshot).toBeNull();
    });
});

// ── singleton useGameStore ────────────────────────────────────────────────────

describe('useGameStore singleton', () => {
    it('exposes getState on the hook', () => {
        expect(typeof useGameStore.getState).toBe('function');
    });

    it('exposes subscribe on the hook', () => {
        expect(typeof useGameStore.subscribe).toBe('function');
    });
});
