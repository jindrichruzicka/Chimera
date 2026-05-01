/**
 * simulation/engine/GameTimer.test.ts
 *
 * Unit tests for GameTimer, TimerRegistry, and TimerManager.
 * Architecture reference: §4.20 — Game Timers
 * Issue: #404
 *
 * TDD: tests written first — red confirmed before implementation.
 *
 * Invariants upheld:
 *   #54 — GameTimer lives in GameSnapshot.timers; remainingTicks is tick-based.
 *   #55 — TimerManager.advance() is pure; only engine:tick may call it.
 */

import { describe, expect, it } from 'vitest';
import { TimerManager, type GameTimer, type TimerId, type TimerRegistry } from './GameTimer.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTimer(overrides: Partial<GameTimer> = {}): GameTimer {
    return {
        id: 'timer-1' as TimerId,
        remainingTicks: 3,
        intervalTicks: 0,
        actionType: 'game:test_action',
        payload: {},
        active: true,
        ...overrides,
    };
}

function makeRegistry(timers: GameTimer[]): TimerRegistry {
    return Object.fromEntries(timers.map((t) => [t.id, t]));
}

// ─── TimerManager.create ─────────────────────────────────────────────────────

describe('TimerManager.create', () => {
    it('adds a new timer as active to an empty registry', () => {
        const registry: TimerRegistry = {};
        const next = TimerManager.create(registry, {
            id: 'timer-1' as TimerId,
            remainingTicks: 5,
            intervalTicks: 0,
            actionType: 'game:my_action',
            payload: { x: 1 },
        });

        expect(next['timer-1' as TimerId]).toBeDefined();
        expect(next['timer-1' as TimerId]?.active).toBe(true);
        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(5);
    });

    it('replaces an existing timer with the same id', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3 })]);
        const next = TimerManager.create(registry, {
            id: 'timer-1' as TimerId,
            remainingTicks: 10,
            intervalTicks: 5,
            actionType: 'game:other_action',
            payload: {},
        });

        expect(Object.keys(next)).toHaveLength(1);
        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(10);
        expect(next['timer-1' as TimerId]?.intervalTicks).toBe(5);
    });

    it('does not mutate the input registry', () => {
        const registry: TimerRegistry = {};
        const frozen = Object.freeze({ ...registry });
        // Should not throw even though frozen (new object returned)
        const next = TimerManager.create(frozen, {
            id: 'timer-1' as TimerId,
            remainingTicks: 3,
            intervalTicks: 0,
            actionType: 'game:a',
            payload: {},
        });

        expect(frozen).toEqual({});
        expect(next).not.toBe(frozen);
    });

    it('preserves other timers when adding a new one', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-a' as TimerId })]);
        const next = TimerManager.create(registry, {
            id: 'timer-b' as TimerId,
            remainingTicks: 2,
            intervalTicks: 0,
            actionType: 'game:b',
            payload: {},
        });

        expect(Object.keys(next)).toHaveLength(2);
        expect(next['timer-a' as TimerId]).toEqual(registry['timer-a' as TimerId]);
    });
});

// ─── TimerManager.cancel ─────────────────────────────────────────────────────

describe('TimerManager.cancel', () => {
    it('marks an existing active timer as inactive', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, active: true })]);
        const next = TimerManager.cancel(registry, 'timer-1' as TimerId);

        expect(next['timer-1' as TimerId]?.active).toBe(false);
    });

    it('does not mutate the input registry', () => {
        const timer = makeTimer({ id: 'timer-1' as TimerId, active: true });
        const registry = makeRegistry([timer]);
        const next = TimerManager.cancel(registry, 'timer-1' as TimerId);

        expect(registry['timer-1' as TimerId]?.active).toBe(true);
        expect(next).not.toBe(registry);
    });

    it('is a no-op if the timer id does not exist', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId })]);
        const next = TimerManager.cancel(registry, 'nonexistent' as TimerId);

        expect(next).toEqual(registry);
    });

    it('leaves other timers unchanged', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, active: true }),
            makeTimer({ id: 'timer-2' as TimerId, active: true }),
        ]);
        const next = TimerManager.cancel(registry, 'timer-1' as TimerId);

        expect(next['timer-2' as TimerId]?.active).toBe(true);
    });
});

// ─── TimerManager.advance ────────────────────────────────────────────────────

describe('TimerManager.advance', () => {
    it('returns empty fired list when no timers are in registry', () => {
        const { next, fired } = TimerManager.advance({});

        expect(fired).toHaveLength(0);
        expect(next).toEqual({});
    });

    it('decrements remainingTicks of active timers by 1', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3 })]);
        const { next } = TimerManager.advance(registry);

        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(2);
    });

    it('does not decrement inactive timers', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3, active: false }),
        ]);
        const { next } = TimerManager.advance(registry);

        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(3);
    });

    it('fires a one-shot timer when remainingTicks reaches 0', () => {
        const registry = makeRegistry([
            makeTimer({
                id: 'timer-1' as TimerId,
                remainingTicks: 1,
                intervalTicks: 0,
                actionType: 'game:heal',
                payload: { amount: 5 },
            }),
        ]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(1);
        expect(fired[0]).toEqual({ actionType: 'game:heal', payload: { amount: 5 } });
    });

    it('marks a one-shot timer inactive after firing', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 1, intervalTicks: 0 }),
        ]);
        const { next } = TimerManager.advance(registry);

        expect(next['timer-1' as TimerId]?.active).toBe(false);
    });

    it('resets remainingTicks to intervalTicks for an interval timer after firing', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 1, intervalTicks: 3 }),
        ]);
        const { next } = TimerManager.advance(registry);

        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(3);
        expect(next['timer-1' as TimerId]?.active).toBe(true);
    });

    it('fires an interval timer and keeps it active', () => {
        const registry = makeRegistry([
            makeTimer({
                id: 'timer-1' as TimerId,
                remainingTicks: 1,
                intervalTicks: 5,
                actionType: 'game:dot',
                payload: { dmg: 10 },
            }),
        ]);
        const { fired, next } = TimerManager.advance(registry);

        expect(fired).toHaveLength(1);
        expect(fired[0]).toEqual({ actionType: 'game:dot', payload: { dmg: 10 } });
        expect(next['timer-1' as TimerId]?.active).toBe(true);
    });

    it('does not fire a timer that still has remainingTicks > 0 after decrement', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 2 })]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(0);
    });

    it('does not mutate the input registry', () => {
        const timer = makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3 });
        const registry = makeRegistry([timer]);
        TimerManager.advance(registry);

        expect(registry['timer-1' as TimerId]?.remainingTicks).toBe(3);
    });

    it('returns a new registry object (no mutation)', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3 })]);
        const { next } = TimerManager.advance(registry);

        expect(next).not.toBe(registry);
    });

    it('fires multiple timers in the same advance step', () => {
        const registry = makeRegistry([
            makeTimer({
                id: 'timer-a' as TimerId,
                remainingTicks: 1,
                actionType: 'game:a',
                payload: {},
            }),
            makeTimer({
                id: 'timer-b' as TimerId,
                remainingTicks: 1,
                actionType: 'game:b',
                payload: {},
            }),
            makeTimer({
                id: 'timer-c' as TimerId,
                remainingTicks: 2,
                actionType: 'game:c',
                payload: {},
            }),
        ]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(2);
        const types = fired.map((f) => f.actionType).sort();
        expect(types).toEqual(['game:a', 'game:b']);
    });

    it('does not fire an inactive timer even when remainingTicks would reach 0', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 1, active: false }),
        ]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(0);
    });
});
