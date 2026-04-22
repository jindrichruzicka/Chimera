/**
 * simulation/engine/SimulationClock.test.ts
 *
 * Unit tests for `SimulationClock` and `RealtimeTicker`.
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 * Task: F04 / T2 (issue #42)
 *
 * Invariants upheld:
 *   Rule 1 — tick is a logical counter; wall-clock time never enters the state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeTicker, simulationClock } from './SimulationClock.js';
import type { ActionEnvelope, BaseGameSnapshot } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(tick: number): BaseGameSnapshot {
    return {
        tick,
        seed: 0,
        players: {},
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
    };
}

// ─── SimulationClock ─────────────────────────────────────────────────────────

describe('simulationClock.now()', () => {
    it('returns snapshot.tick', () => {
        expect(simulationClock.now(makeSnapshot(0))).toBe(0);
        expect(simulationClock.now(makeSnapshot(7))).toBe(7);
        expect(simulationClock.now(makeSnapshot(999))).toBe(999);
    });

    it('does not call Date.now or performance.now', () => {
        const dateSpy = vi.spyOn(Date, 'now');
        simulationClock.now(makeSnapshot(1));
        expect(dateSpy).not.toHaveBeenCalled();
        dateSpy.mockRestore();
    });
});

// ─── RealtimeTicker ───────────────────────────────────────────────────────────

describe('RealtimeTicker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('calls dispatch approximately hz times after one second', () => {
        const dispatched: ActionEnvelope[] = [];
        const dispatch = (_action: ActionEnvelope): void => {
            dispatched.push(_action);
        };
        const ticker = new RealtimeTicker({ hz: 10, dispatch });
        ticker.start();
        vi.advanceTimersByTime(1000);
        ticker.stop();
        expect(dispatched).toHaveLength(10);
    });

    it('dispatch is called with an ActionEnvelope of type engine:tick', () => {
        const dispatched: ActionEnvelope[] = [];
        const dispatch = (_action: ActionEnvelope): void => {
            dispatched.push(_action);
        };
        const ticker = new RealtimeTicker({ hz: 1, dispatch });
        ticker.start();
        vi.advanceTimersByTime(1000);
        ticker.stop();
        expect(dispatched[0]).toMatchObject({ type: 'engine:tick' });
    });

    it('double-start does not start two intervals', () => {
        const dispatched: ActionEnvelope[] = [];
        const dispatch = (_action: ActionEnvelope): void => {
            dispatched.push(_action);
        };
        const ticker = new RealtimeTicker({ hz: 10, dispatch });
        ticker.start();
        ticker.start(); // second call should be a no-op
        vi.advanceTimersByTime(1000);
        ticker.stop();
        expect(dispatched).toHaveLength(10);
    });

    it('stop() when not running does not throw', () => {
        const ticker = new RealtimeTicker({ hz: 10, dispatch: vi.fn() });
        expect(() => ticker.stop()).not.toThrow();
    });

    it('stop() prevents further dispatch calls', () => {
        const dispatched: ActionEnvelope[] = [];
        const dispatch = (_action: ActionEnvelope): void => {
            dispatched.push(_action);
        };
        const ticker = new RealtimeTicker({ hz: 10, dispatch });
        ticker.start();
        vi.advanceTimersByTime(500);
        ticker.stop();
        vi.advanceTimersByTime(1000);
        expect(dispatched).toHaveLength(5);
    });

    it('hz is available as a readonly property', () => {
        const ticker = new RealtimeTicker({ hz: 20, dispatch: vi.fn() });
        expect(ticker.hz).toBe(20);
    });
});
