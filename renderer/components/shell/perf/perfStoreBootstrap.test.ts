// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameStore } from '../../../state/gameStore.js';
import {
    playerId,
    gamePhase,
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
