/**
 * simulation/engine/SimulationClock.test.ts
 *
 * Unit tests for `simulationClock` (the pure snapshot.tick reader).
 *
 * Host-side real-time tick tests live in
 * `electron/main/runtime/RealtimeTicker.test.ts`.
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 * Task: F04 / T2 (issue #42); relocation: issue #89
 *
 * Invariants upheld:
 *   Rule 1 — tick is a logical counter; wall-clock time never enters the state.
 */
import { describe, expect, it, vi } from 'vitest';
import { simulationClock } from './SimulationClock.js';
import type { BaseGameSnapshot } from './types.js';

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

// ─── simulationClock ─────────────────────────────────────────────────────────

describe('simulationClock.now()', () => {
    it('returns snapshot.tick', () => {
        expect(simulationClock.now(makeSnapshot(0))).toBe(0);
        expect(simulationClock.now(makeSnapshot(7))).toBe(7);
        expect(simulationClock.now(makeSnapshot(999))).toBe(999);
    });

    it('does not read from the wall clock', () => {
        const dateSpy = vi.spyOn(Date, 'now');
        simulationClock.now(makeSnapshot(1));
        expect(dateSpy).not.toHaveBeenCalled();
        dateSpy.mockRestore();
    });
});
