/**
 * electron/main/runtime/RealtimeTicker.test.ts
 *
 * Unit + integration tests for the host-side `RealtimeTicker`.
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 * Task: issue #89 — Relocate `RealtimeTicker` out of `simulation/` and
 *                   fix `engine:tick` envelope construction.
 *
 * RealtimeTicker is a host-side wall-clock wrapper; it lives in
 * `electron/main/runtime/` so `simulation/` stays host-I/O-free (invariant #2).
 * The ticker itself never builds the envelope — the caller supplies a
 * `getEnvelope` factory that has live access to the current snapshot.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ActionPipeline,
    ActionRegistry,
    registerEngineActions,
    type ActionDefinition,
    type ActionEnvelope,
    type BaseGameSnapshot,
} from '@chimera/simulation/engine/index.js';
import { RealtimeTicker } from './RealtimeTicker.js';
import { playerId as toPlayerId } from '@chimera/networking/provider/MultiplayerProvider.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HOST = toPlayerId('host');

function makeSnapshot(tick: number): BaseGameSnapshot {
    return {
        tick,
        seed: 42,
        players: { [HOST]: { id: HOST } },
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        matchResult: null,
    };
}

/**
 * Test-only action definition that advances `tick` by 1 on each reduce.
 * Used to drive monotonic tick progression through a real `ActionPipeline`
 * without relying on game-specific reducers.
 */
const advanceTickDef: ActionDefinition<Record<string, never>> = {
    type: 'test:advance-tick',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => ({ ...state, tick: state.tick + 1 }),
};

// ─── Constructor guards ───────────────────────────────────────────────────────

describe('RealtimeTicker constructor guards', () => {
    const noopDispatch = (_envelope: ActionEnvelope): void => {
        // intentionally empty
    };
    const noopEnvelope = (): ActionEnvelope => ({
        type: 'test:advance-tick',
        playerId: HOST,
        tick: 0,
        payload: {},
    });

    it('throws RangeError when hz is zero', () => {
        expect(
            () =>
                new RealtimeTicker({
                    hz: 0,
                    getEnvelope: noopEnvelope,
                    dispatch: noopDispatch,
                }),
        ).toThrow(RangeError);
    });

    it('throws RangeError when hz is negative', () => {
        expect(
            () =>
                new RealtimeTicker({
                    hz: -10,
                    getEnvelope: noopEnvelope,
                    dispatch: noopDispatch,
                }),
        ).toThrow(RangeError);
    });

    it('throws RangeError when hz is NaN', () => {
        expect(
            () =>
                new RealtimeTicker({
                    hz: Number.NaN,
                    getEnvelope: noopEnvelope,
                    dispatch: noopDispatch,
                }),
        ).toThrow(RangeError);
    });

    it('throws RangeError when hz is Infinity', () => {
        expect(
            () =>
                new RealtimeTicker({
                    hz: Number.POSITIVE_INFINITY,
                    getEnvelope: noopEnvelope,
                    dispatch: noopDispatch,
                }),
        ).toThrow(RangeError);
    });

    it('accepts a positive finite hz', () => {
        expect(
            () =>
                new RealtimeTicker({
                    hz: 20,
                    getEnvelope: noopEnvelope,
                    dispatch: noopDispatch,
                }),
        ).not.toThrow();
    });
});

// ─── Cadence / lifecycle (fake timers) ────────────────────────────────────────

describe('RealtimeTicker lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('calls dispatch approximately hz times per second', () => {
        const dispatched: ActionEnvelope[] = [];
        const ticker = new RealtimeTicker({
            hz: 10,
            getEnvelope: (): ActionEnvelope => ({
                type: 'test:advance-tick',
                playerId: HOST,
                tick: 0,
                payload: {},
            }),
            dispatch: (env) => dispatched.push(env),
        });
        ticker.start();
        vi.advanceTimersByTime(1000);
        ticker.stop();
        expect(dispatched).toHaveLength(10);
    });

    it('double-start does not start two intervals', () => {
        const dispatched: ActionEnvelope[] = [];
        const ticker = new RealtimeTicker({
            hz: 10,
            getEnvelope: (): ActionEnvelope => ({
                type: 'test:advance-tick',
                playerId: HOST,
                tick: 0,
                payload: {},
            }),
            dispatch: (env) => dispatched.push(env),
        });
        ticker.start();
        ticker.start();
        vi.advanceTimersByTime(1000);
        ticker.stop();
        expect(dispatched).toHaveLength(10);
    });

    it('stop() when not running does not throw', () => {
        const ticker = new RealtimeTicker({
            hz: 10,
            getEnvelope: (): ActionEnvelope => ({
                type: 'test:advance-tick',
                playerId: HOST,
                tick: 0,
                payload: {},
            }),
            dispatch: () => {
                // intentionally empty
            },
        });
        expect(() => ticker.stop()).not.toThrow();
    });

    it('stop() prevents further dispatch calls', () => {
        const dispatched: ActionEnvelope[] = [];
        const ticker = new RealtimeTicker({
            hz: 10,
            getEnvelope: (): ActionEnvelope => ({
                type: 'test:advance-tick',
                playerId: HOST,
                tick: 0,
                payload: {},
            }),
            dispatch: (env) => dispatched.push(env),
        });
        ticker.start();
        vi.advanceTimersByTime(500);
        ticker.stop();
        vi.advanceTimersByTime(1000);
        expect(dispatched).toHaveLength(5);
    });

    it('hz is available as a readonly property', () => {
        const ticker = new RealtimeTicker({
            hz: 20,
            getEnvelope: (): ActionEnvelope => ({
                type: 'test:advance-tick',
                playerId: HOST,
                tick: 0,
                payload: {},
            }),
            dispatch: () => {
                // intentionally empty
            },
        });
        expect(ticker.hz).toBe(20);
    });
});

// ─── Integration: end-to-end through a real ActionPipeline ────────────────────

describe('RealtimeTicker integration with ActionPipeline', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('advances snapshot.tick monotonically and never throws pipeline errors', () => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        registry.register(advanceTickDef);
        const pipeline = new ActionPipeline(registry);

        let snapshot: BaseGameSnapshot = makeSnapshot(0);
        const observedTicks: number[] = [];
        const errors: unknown[] = [];

        const ticker = new RealtimeTicker({
            hz: 10,
            getEnvelope: (): ActionEnvelope => ({
                type: 'test:advance-tick',
                playerId: HOST,
                tick: snapshot.tick,
                payload: {},
            }),
            dispatch: (envelope) => {
                try {
                    snapshot = pipeline.process(snapshot, envelope);
                    observedTicks.push(snapshot.tick);
                } catch (err) {
                    errors.push(err);
                }
            },
        });

        ticker.start();
        vi.advanceTimersByTime(1000); // 10 dispatches at 10 Hz
        ticker.stop();

        expect(errors).toEqual([]);
        expect(observedTicks).toHaveLength(10);
        // Monotonic increasing by 1 each step, starting at 1.
        expect(observedTicks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(snapshot.tick).toBe(10);
    });
});
