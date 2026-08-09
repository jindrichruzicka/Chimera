/**
 * simulation/engine/TimeScale.test.ts
 *
 * Unit tests for the pure time-dilation state layer: `applyTimeScale`,
 * `clearTimeScale` and `advanceTimeScale`.
 *
 * There is ONE dilation field on the snapshot, so two overlapping requests are
 * last-write-wins and nothing stacks. These tests pin that single-field
 * behaviour, the restore countdown, and the fact that the module owns no copy
 * of the permille bounds.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Properties pinned:
 *   `applyTimeScale` normalises through `clampTimeScalePermille` — asserted row
 *     by row over a table drawn from `simulation/foundation/time-scale.test.ts`,
 *     plus three literal expectations so the comparison is not tautological.
 *   The module holds no inlined copy of the permille bounds — a source scan,
 *     with a positive control proving the scan fires on an inlined clamp.
 *   Two overlapping requests leave exactly ONE scale and ONE countdown, the
 *     later request's.
 *   The countdown restores real time on the beat AFTER the last dilated one,
 *     and one fewer call leaves the dilation active.
 *   Every verb is pure: a deep-frozen input throws nothing and still equals a
 *     pre-call clone.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NORMAL_TIME_SCALE_PERMILLE, clampTimeScalePermille } from '../foundation/time-scale.js';

import type { BaseGameSnapshot } from './types.js';
import { gamePhase } from './types.js';
import { applyTimeScale, clearTimeScale, advanceTimeScale } from './TimeScale.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 1,
        players: {},
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
        ...overrides,
    };
}

function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null) {
        for (const member of Object.values(value)) deepFreeze(member);
        Object.freeze(value);
    }
    return value;
}

const clone = <T>(value: T): T => structuredClone(value);

// ─── applyTimeScale normalises through the one clamp ──────────────────────────

describe('applyTimeScale — normalisation', () => {
    // The rows `simulation/foundation/time-scale.test.ts` drives
    // `clampTimeScalePermille` with, minus its `undefined` row —
    // `TimeScaleRequest.permille` is required, so that input has no state-verb
    // form.
    const table: readonly (readonly [string, number])[] = [
        ['NaN', Number.NaN],
        ['+Infinity', Number.POSITIVE_INFINITY],
        ['-Infinity', Number.NEGATIVE_INFINITY],
        ['a fractional permille', 2.5],
        ['zero', 0],
        ['negative', -1],
        ['just under the floor', 49],
        ['the floor itself', 50],
        ['real time', 1000],
        ['the ceiling itself', 4000],
        ['above the ceiling', 9999],
    ];

    it.each(table)('writes the clamped permille for %s', (_label, input) => {
        const next = applyTimeScale(makeState(), { permille: input });

        expect(next.timeScalePermille).toBe(clampTimeScalePermille(input));
    });

    // Not tautological: three rows pinned against literals, so a verb that
    // inlined its OWN (wrong) clamp cannot pass by agreeing with itself.
    it('refuses a fractional permille to real time rather than clamping it', () => {
        expect(applyTimeScale(makeState(), { permille: 2.5 }).timeScalePermille).toBe(1000);
    });

    it('clamps below the floor up to the slowest supported scale', () => {
        expect(applyTimeScale(makeState(), { permille: 0 }).timeScalePermille).toBe(50);
    });

    it('clamps above the ceiling down to the fastest supported scale', () => {
        expect(applyTimeScale(makeState(), { permille: 9999 }).timeScalePermille).toBe(4000);
    });
});

// ─── The bounds live in exactly one module ────────────────────────────────────

describe('TimeScale.ts holds no copy of the permille bounds', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(__dirname, 'TimeScale.ts'), 'utf8');

    // The floor, real time and the ceiling. Guarded on both ends against a
    // digit or a decimal point so `2500` and `1.50` are not read as a bound.
    const INLINED_BOUND = /(?<![\d.])(?:50|1000|4000)(?![\d.])/;

    it('the scan fires on an inlined clamp (control)', () => {
        expect(INLINED_BOUND.test('Math.min(4000, Math.max(50, value))')).toBe(true);
        expect(INLINED_BOUND.test('return NORMAL_TIME_SCALE_PERMILLE;')).toBe(false);
    });

    it('the source really was read (control)', () => {
        expect(source).toContain('clampTimeScalePermille');
        expect(source).toContain('applyTimeScale');
    });

    it('names no bound literal', () => {
        expect(INLINED_BOUND.test(source)).toBe(false);
    });
});

// ─── One field: overlapping requests are last-write-wins ──────────────────────

describe('applyTimeScale — one field, last-write-wins', () => {
    it('leaves exactly one scale and one countdown after two overlapping requests', () => {
        const first = applyTimeScale(makeState(), { permille: 250, durationBeats: 5 });
        const second = applyTimeScale(first, { permille: 500, durationBeats: 2 });

        expect(second.timeScalePermille).toBe(500);
        expect(second.timeScaleRestoreBeats).toBe(2);

        // Nothing stacked: the first request's 250/5 left no residue anywhere
        // on the snapshot.
        const dilationKeys = Object.keys(second).filter((key) => key.startsWith('timeScale'));
        expect(dilationKeys.sort()).toEqual(['timeScalePermille', 'timeScaleRestoreBeats']);
    });

    it('a later open-ended request drops the earlier countdown', () => {
        const first = applyTimeScale(makeState(), { permille: 250, durationBeats: 5 });
        const second = applyTimeScale(first, { permille: 500 });

        expect(second.timeScalePermille).toBe(500);
        // The later request named no countdown, so the earlier one must not
        // survive to restore a scale nobody asked to end.
        expect(Object.hasOwn(second, 'timeScaleRestoreBeats')).toBe(false);
    });

    it('omits the countdown entirely for an open-ended request', () => {
        const next = applyTimeScale(makeState(), { permille: 250 });

        expect(next.timeScalePermille).toBe(250);
        expect(Object.hasOwn(next, 'timeScaleRestoreBeats')).toBe(false);
    });

    it('throws RangeError on a non-integer or non-positive durationBeats', () => {
        expect(() => applyTimeScale(makeState(), { permille: 250, durationBeats: 0 })).toThrow(
            RangeError,
        );
        expect(() => applyTimeScale(makeState(), { permille: 250, durationBeats: -1 })).toThrow(
            RangeError,
        );
        expect(() => applyTimeScale(makeState(), { permille: 250, durationBeats: 1.5 })).toThrow(
            RangeError,
        );
    });

    it('accepts a countdown of one beat (boundary, positive control)', () => {
        expect(
            applyTimeScale(makeState(), { permille: 250, durationBeats: 1 }).timeScaleRestoreBeats,
        ).toBe(1);
    });
});

// ─── The restore countdown ────────────────────────────────────────────────────

describe('advanceTimeScale — the restore countdown', () => {
    it('restores real time on the beat after the last dilated one', () => {
        const dilated = applyTimeScale(makeState(), { permille: 250, durationBeats: 2 });

        const afterOne = advanceTimeScale(dilated);
        const afterTwo = advanceTimeScale(afterOne);
        const afterThree = advanceTimeScale(afterTwo);

        // One fewer call leaves the dilation ACTIVE — this is what makes the
        // restore below an off-by-one failure rather than an unconditional pass.
        expect(afterTwo.timeScalePermille).toBe(250);
        expect(afterTwo.timeScaleRestoreBeats).toBe(0);

        expect(afterThree.timeScalePermille).toBe(NORMAL_TIME_SCALE_PERMILLE);
        expect(Object.hasOwn(afterThree, 'timeScaleRestoreBeats')).toBe(false);
    });

    it('decrements the countdown by exactly one beat and leaves the scale alone', () => {
        const dilated = applyTimeScale(makeState(), { permille: 250, durationBeats: 3 });

        const next = advanceTimeScale(dilated);

        expect(next.timeScaleRestoreBeats).toBe(2);
        expect(next.timeScalePermille).toBe(250);
    });

    it('leaves an open-ended dilation running forever', () => {
        const dilated = applyTimeScale(makeState(), { permille: 250 });

        const next = advanceTimeScale(dilated);

        // No countdown was requested, so there is nothing to advance and the
        // input reference comes straight back.
        expect(next).toBe(dilated);
        expect(next.timeScalePermille).toBe(250);
    });

    it('returns the input reference on an undilated state', () => {
        const state = makeState();

        expect(advanceTimeScale(state)).toBe(state);
    });

    it('clears the countdown on the restoring beat of an already-real-time scale', () => {
        // The same reachable state as the `clearTimeScale` case: real time with
        // a live countdown. Without it, an `isRealTime` that ignored the
        // countdown would leave `timeScaleRestoreBeats: 0` on the snapshot for
        // the rest of the match.
        const odd = applyTimeScale(makeState(), { permille: 2.5, durationBeats: 1 });

        const afterOne = advanceTimeScale(odd);
        const afterTwo = advanceTimeScale(afterOne);

        expect(afterOne.timeScaleRestoreBeats).toBe(0);
        expect(Object.hasOwn(afterTwo, 'timeScaleRestoreBeats')).toBe(false);
        expect(afterTwo.timeScalePermille).toBe(NORMAL_TIME_SCALE_PERMILLE);
    });
});

// ─── clearTimeScale ───────────────────────────────────────────────────────────

describe('clearTimeScale', () => {
    it('returns the input reference on an undilated state', () => {
        const state = makeState();

        expect(clearTimeScale(state)).toBe(state);
    });

    it('returns the input reference when the scale is already real time', () => {
        const state = makeState({ timeScalePermille: NORMAL_TIME_SCALE_PERMILLE });

        expect(clearTimeScale(state)).toBe(state);
    });

    it('drops a countdown pending beside an already-real-time scale', () => {
        // Reachable through the public API: a fractional permille falls back to
        // real time (pinned by the table above) while the countdown is still
        // written, so "real time" alone must not be read as "nothing pending".
        const odd = applyTimeScale(makeState(), { permille: 2.5, durationBeats: 2 });
        expect(odd.timeScalePermille).toBe(NORMAL_TIME_SCALE_PERMILLE);
        expect(odd.timeScaleRestoreBeats).toBe(2);

        const cleared = clearTimeScale(odd);

        expect(cleared).not.toBe(odd);
        expect(Object.hasOwn(cleared, 'timeScaleRestoreBeats')).toBe(false);
    });

    it('restores real time and drops a pending countdown', () => {
        const dilated = applyTimeScale(makeState(), { permille: 250, durationBeats: 4 });

        const cleared = clearTimeScale(dilated);

        expect(cleared).not.toBe(dilated);
        expect(cleared.timeScalePermille).toBe(NORMAL_TIME_SCALE_PERMILLE);
        expect(Object.hasOwn(cleared, 'timeScaleRestoreBeats')).toBe(false);
    });
});

// ─── Purity ───────────────────────────────────────────────────────────────────

describe('the time-scale verbs are pure', () => {
    it('applyTimeScale does not touch a deep-frozen input', () => {
        const state = deepFreeze(makeState({ timeScalePermille: 250, timeScaleRestoreBeats: 3 }));
        const before = clone(state);

        expect(() => applyTimeScale(state, { permille: 500, durationBeats: 1 })).not.toThrow();
        expect(state).toEqual(before);
    });

    it('advanceTimeScale does not touch a deep-frozen input', () => {
        const state = deepFreeze(makeState({ timeScalePermille: 250, timeScaleRestoreBeats: 3 }));
        const before = clone(state);

        expect(() => advanceTimeScale(state)).not.toThrow();
        expect(state).toEqual(before);
    });

    it('advanceTimeScale does not touch a deep-frozen input on the restoring beat', () => {
        const state = deepFreeze(makeState({ timeScalePermille: 250, timeScaleRestoreBeats: 0 }));
        const before = clone(state);

        expect(() => advanceTimeScale(state)).not.toThrow();
        expect(state).toEqual(before);
    });

    it('clearTimeScale does not touch a deep-frozen input', () => {
        const state = deepFreeze(makeState({ timeScalePermille: 250, timeScaleRestoreBeats: 3 }));
        const before = clone(state);

        expect(() => clearTimeScale(state)).not.toThrow();
        expect(state).toEqual(before);
    });

    it('carries every unrelated snapshot field through untouched', () => {
        const state = makeState({ tick: 9, turnNumber: 4, seed: 77 });

        const next = advanceTimeScale(applyTimeScale(state, { permille: 250, durationBeats: 1 }));

        expect(next.tick).toBe(9);
        expect(next.turnNumber).toBe(4);
        expect(next.seed).toBe(77);
    });
});
