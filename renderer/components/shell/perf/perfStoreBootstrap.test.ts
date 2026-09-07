// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameStore } from '../../../state/gameStore.js';
import {
    playerId,
    gamePhase,
    type HostPerfMetrics,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { createPerfStore } from './perfStore.js';
import { bootstrapPerfStore } from './perfStoreBootstrap.js';

function makeSnapshot(tick: number): PlayerSnapshot {
    return {
        tick,
        viewerId: playerId('p1'),
        players: {},
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

describe('bootstrapPerfStore()', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('syncs initial sim tick from gameStore', () => {
        const gameStore = createGameStore();
        gameStore.setState((state) => ({ ...state, currentTick: 42 }));
        const perfStore = createPerfStore();

        const stop = bootstrapPerfStore(gameStore, perfStore, () => 1000);

        expect(perfStore.getState().sample.simTick).toBe(42);
        stop();
    });

    it('syncs ping from gameStore latencyMs', () => {
        const gameStore = createGameStore();
        gameStore.setState((state) => ({ ...state, latencyMs: 37 }));
        const perfStore = createPerfStore();

        const stop = bootstrapPerfStore(gameStore, perfStore, () => 1000);

        expect(perfStore.getState().sample.pingMs).toBe(37);
        stop();
    });

    it('updates sim tick when gameStore tick changes', () => {
        const gameStore = createGameStore();
        const perfStore = createPerfStore();

        const stop = bootstrapPerfStore(gameStore, perfStore, () => 1000);
        gameStore.setState((state) => ({ ...state, currentTick: 77 }));

        expect(perfStore.getState().sample.simTick).toBe(77);
        stop();
    });

    it('records snapshot arrivals to update actionsPerSec', () => {
        const gameStore = createGameStore();
        const perfStore = createPerfStore();

        const stop = bootstrapPerfStore(gameStore, perfStore, () => 1500);
        gameStore.setState((state) => ({ ...state, snapshot: makeSnapshot(5) }));

        expect(perfStore.getState().sample.actionsPerSec).toBe(1);
        stop();
    });

    it('decays actionsPerSec to 0 between sporadic snapshots (turn-based games)', () => {
        let nowMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
        const gameStore = createGameStore();
        const perfStore = createPerfStore();

        const stop = bootstrapPerfStore(gameStore, perfStore, () => nowMs);
        gameStore.setState((state) => ({ ...state, snapshot: makeSnapshot(5) }));
        expect(perfStore.getState().sample.actionsPerSec).toBe(1);

        // Move wall-clock past the 1 s window, then let the interval fire.
        nowMs = 1500;
        vi.advanceTimersByTime(1000);

        expect(perfStore.getState().sample.actionsPerSec).toBe(0);
        stop();
        vi.restoreAllMocks();
    });

    it('prunes perf windows every second and stops after cleanup', () => {
        const gameStore = createGameStore();
        const perfStore = createPerfStore();
        const pruneSpy = vi.spyOn(perfStore.getState(), 'prunePerfWindows');

        const stop = bootstrapPerfStore(gameStore, perfStore, () => 1000);

        vi.advanceTimersByTime(2000);
        expect(pruneSpy).toHaveBeenCalledTimes(2);

        stop();
        vi.advanceTimersByTime(2000);
        expect(pruneSpy).toHaveBeenCalledTimes(2);
    });

    it('samples heap every second and stops after cleanup', () => {
        const gameStore = createGameStore();
        const perfStore = createPerfStore();
        const sampleHeapSpy = vi.spyOn(perfStore.getState(), 'sampleHeap');

        const stop = bootstrapPerfStore(gameStore, perfStore, () => 1000);

        vi.advanceTimersByTime(2000);
        expect(sampleHeapSpy).toHaveBeenCalledTimes(2);

        stop();
        vi.advanceTimersByTime(2000);
        expect(sampleHeapSpy).toHaveBeenCalledTimes(2);
    });
});

// ── host metrics push ─────────────────────────────────────────────────────────

describe('bootstrapPerfStore() — host metrics', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('writes each pushed sample into the store', () => {
        const gameStore = createGameStore();
        const perfStore = createPerfStore();
        const listeners: ((metrics: HostPerfMetrics) => void)[] = [];
        const dispose = bootstrapPerfStore(
            gameStore,
            perfStore,
            () => 0,
            (cb) => {
                listeners.push(cb);
                return () => undefined;
            },
        );

        for (const emit of listeners) emit({ hostHeapMb: 55.25, recordedActionCount: 4_200 });
        expect(listeners).toHaveLength(1);

        expect(perfStore.getState().sample.hostHeapMb).toBe(55.25);
        expect(perfStore.getState().sample.recordedActionCount).toBe(4_200);
        dispose();
    });

    it('does not drive the host fields off its own 1 s interval', () => {
        // The cadence belongs to the HOST — the push arrives on main's timer.
        // A renderer-side interval that also wrote these would either duplicate
        // the rate or, worse, resample a value it cannot read.
        const gameStore = createGameStore();
        const perfStore = createPerfStore();
        const dispose = bootstrapPerfStore(gameStore, perfStore, () => 0, undefined);

        vi.advanceTimersByTime(10_000);

        expect(perfStore.getState().sample.hostHeapMb).toBeNull();
        expect(perfStore.getState().sample.recordedActionCount).toBeNull();
        dispose();
    });

    it('does not write the host fields per snapshot either', () => {
        // The other rate this must not be: a realtime host broadcasts every
        // beat, and a metric written there would be paid at the beat rate.
        const gameStore = createGameStore();
        const perfStore = createPerfStore();
        const dispose = bootstrapPerfStore(
            gameStore,
            perfStore,
            () => 0,
            () => () => undefined,
        );

        for (let tick = 1; tick <= 20; tick += 1) {
            gameStore.setState((state) => ({
                ...state,
                currentTick: tick,
                snapshot: makeSnapshot(tick),
            }));
        }

        expect(perfStore.getState().sample.simTick).toBe(20);
        expect(perfStore.getState().sample.hostHeapMb).toBeNull();
        dispose();
    });

    it('unsubscribes the host-metrics listener on dispose', () => {
        const gameStore = createGameStore();
        const perfStore = createPerfStore();
        const unsubscribe = vi.fn();
        const dispose = bootstrapPerfStore(
            gameStore,
            perfStore,
            () => 0,
            () => unsubscribe,
        );

        dispose();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('runs without a bridge, leaving both host fields unavailable', () => {
        const gameStore = createGameStore();
        const perfStore = createPerfStore();

        const dispose = bootstrapPerfStore(gameStore, perfStore, () => 0, undefined);

        expect(perfStore.getState().sample.hostHeapMb).toBeNull();
        expect(() => dispose()).not.toThrow();
    });
});

// ── the production bridge path ────────────────────────────────────────────────

describe('bootstrapPerfStore() — default host-metrics port', () => {
    // The app calls `bootstrapPerfStore(gameStore, perfStore)` with two
    // arguments, so the DEFAULT port is the shipped path. Every case above
    // injects one explicitly, which leaves that resolution unmeasured: a
    // resolver that always answered `undefined` would leave both host rows at
    // "—" forever in the real app with the suite green.

    afterEach(() => {
        delete (globalThis as { __chimera?: unknown }).__chimera;
    });

    it('subscribes through window.__chimera.game.onHostMetrics when the bridge is present', () => {
        const listeners: ((metrics: HostPerfMetrics) => void)[] = [];
        const game = {
            onHostMetrics(cb: (metrics: HostPerfMetrics) => void) {
                listeners.push(cb);
                return () => undefined;
            },
        };
        (globalThis as { __chimera?: unknown }).__chimera = { game };
        const perfStore = createPerfStore();

        const dispose = bootstrapPerfStore(createGameStore(), perfStore);
        for (const emit of listeners) emit({ hostHeapMb: 33.5, recordedActionCount: 7 });

        expect(listeners).toHaveLength(1);
        expect(perfStore.getState().sample.hostHeapMb).toBe(33.5);
        expect(perfStore.getState().sample.recordedActionCount).toBe(7);
        dispose();
    });

    it('calls the bridge method on its own namespace, not detached', () => {
        // `onHostMetrics` is read off `game` and must stay bound to it: a
        // detached reference would lose `this` on a namespace whose method
        // reads its own state — which the real preload namespace is free to do.
        let seenMarker: string | null = null;
        const game = {
            marker: 'the-game-namespace',
            onHostMetrics(this: { marker?: string } | undefined) {
                seenMarker = this?.marker ?? null;
                return () => undefined;
            },
        };
        (globalThis as { __chimera?: unknown }).__chimera = { game };

        const dispose = bootstrapPerfStore(createGameStore(), createPerfStore());

        expect(seenMarker).toBe('the-game-namespace');
        dispose();
    });

    it('leaves both host fields unavailable when the bridge has no such method', () => {
        (globalThis as { __chimera?: unknown }).__chimera = { game: {} };
        const perfStore = createPerfStore();

        const dispose = bootstrapPerfStore(createGameStore(), perfStore);

        expect(perfStore.getState().sample.hostHeapMb).toBeNull();
        expect(() => dispose()).not.toThrow();
    });

    it('runs with no bridge at all', () => {
        const perfStore = createPerfStore();

        const dispose = bootstrapPerfStore(createGameStore(), perfStore);

        expect(perfStore.getState().sample.recordedActionCount).toBeNull();
        expect(() => dispose()).not.toThrow();
    });
});
