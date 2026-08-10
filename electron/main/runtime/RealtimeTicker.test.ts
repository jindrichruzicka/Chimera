/**
 * electron/main/runtime/RealtimeTicker.test.ts
 *
 * Unit + integration tests for the host-side `RealtimeTicker`.
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 * Task: Relocate `RealtimeTicker` out of `simulation/` and
 *                   fix `engine:tick` envelope construction.
 *
 * RealtimeTicker is a host-side wall-clock wrapper; it lives in
 * `electron/main/runtime/` so `simulation/` stays host-I/O-free (invariant #2).
 * The ticker itself never builds the envelope — the caller supplies a
 * `getEnvelope` factory that has live access to the current snapshot.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ActionPipeline,
    ActionRegistry,
    registerEngineActions,
    type ActionDefinition,
    type ActionEnvelope,
    type BaseGameSnapshot,
} from '@chimera-engine/simulation/engine/index.js';
import {
    MAX_TIME_SCALE_PERMILLE,
    MIN_TIME_SCALE_PERMILLE,
    NORMAL_TIME_SCALE_PERMILLE,
    clampTimeScalePermille,
    dilatedBeatPeriodMs,
    timeScaleMultiplier,
} from '@chimera-engine/simulation/foundation/time-scale.js';
import { RealtimeTicker } from './RealtimeTicker.js';
import { createLogger, createMemorySink } from '../logging/logger.js';
import { playerId as toPlayerId } from '@chimera-engine/networking';

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
        gameResult: null,
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

// ─── Time dilation (F82 requirement 6, host half) ─────────────────────────────
//
// A wired `getRateScalePermille` swaps the fixed `setInterval` cadence for a
// self-scheduling `setTimeout` chain whose period is
// `dilatedBeatPeriodMs(1000 / hz, permille)`. Its reciprocity with the
// renderer's `timeScaleMultiplier` is measured in
// `renderer/animation/__tests__/dilation-coherence.test.ts`.

const DILATION_HZ = 20;
const DILATION_BASE_PERIOD_MS = 1000 / DILATION_HZ;

function dilationEnvelope(): ActionEnvelope {
    return { type: 'test:advance-tick', playerId: HOST, tick: 0, payload: {} };
}

function noopDispatch(): void {
    // intentionally empty
}

describe('RealtimeTicker scheduling path selection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('schedules with setInterval and never setTimeout when no scale getter is wired', () => {
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: noopDispatch,
        });

        ticker.start();

        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(DILATION_BASE_PERIOD_MS);
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        ticker.stop();
    });

    it('schedules with setTimeout and never setInterval when a scale getter is wired', () => {
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: noopDispatch,
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
        });

        ticker.start();

        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setIntervalSpy).not.toHaveBeenCalled();
        ticker.stop();
    });
});

describe('RealtimeTicker dilated pacing', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it.each([250, 2000])(
        'paces one beat per dilatedBeatPeriodMs at %i permille',
        (permille: number) => {
            const period = dilatedBeatPeriodMs(DILATION_BASE_PERIOD_MS, permille);
            const t0 = Date.now();
            const stamps: number[] = [];
            const ticker = new RealtimeTicker({
                hz: DILATION_HZ,
                getEnvelope: dilationEnvelope,
                dispatch: () => stamps.push(Date.now() - t0),
                getRateScalePermille: () => permille,
            });

            ticker.start();
            vi.advanceTimersByTime(period * 5);
            ticker.stop();

            expect(stamps).toHaveLength(5);
            stamps.forEach((at, index) => {
                expect(at).toBeCloseTo(period * (index + 1), 6);
            });
        },
    );

    it('re-reads the scale after every dispatch so a mid-match change re-paces the next beat', () => {
        const halfSpeed = NORMAL_TIME_SCALE_PERMILLE / 2;
        const t0 = Date.now();
        const stamps: number[] = [];
        let permille = NORMAL_TIME_SCALE_PERMILLE;
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => {
                stamps.push(Date.now() - t0);
                // Changed DURING the beat, so only a re-read at re-arm time can
                // see it; a scale captured once at start() would not.
                permille = halfSpeed;
            },
            getRateScalePermille: () => permille,
        });

        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS);
        expect(stamps).toEqual([DILATION_BASE_PERIOD_MS]);

        // Half speed ⇒ double period: the second beat is NOT due one base period
        // after the first.
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS);
        expect(stamps).toEqual([DILATION_BASE_PERIOD_MS]);

        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS);
        expect(stamps).toEqual([DILATION_BASE_PERIOD_MS, DILATION_BASE_PERIOD_MS * 3]);
        ticker.stop();
    });

    it('keeps the chain alive when dispatch throws on the first beat', () => {
        let beats = 0;
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => {
                beats += 1;
                if (beats === 1) {
                    throw new Error('reducer exploded');
                }
            },
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
        });

        ticker.start();
        // The throw escapes the timer callback exactly as it does under
        // setInterval; the re-arm already happened in the `finally`.
        expect(() => vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS)).toThrow('reducer exploded');
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 4);
        ticker.stop();

        expect(beats).toBe(5);
    });

    it('keeps the chain alive when getEnvelope throws on the first beat', () => {
        let built = 0;
        let dispatched = 0;
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: () => {
                built += 1;
                if (built === 1) {
                    throw new Error('no snapshot');
                }
                return dilationEnvelope();
            },
            dispatch: () => {
                dispatched += 1;
            },
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
        });

        ticker.start();
        expect(() => vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS)).toThrow('no snapshot');
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 4);
        ticker.stop();

        expect(built).toBe(5);
        expect(dispatched).toBe(4);
    });

    it('catches a throwing scale getter, logs it exactly once, and keeps pacing at real time', () => {
        const sink = createMemorySink();
        const logger = createLogger({
            source: { process: 'main', module: 'realtime-ticker' },
            sink,
        });
        const t0 = Date.now();
        const stamps: number[] = [];
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => stamps.push(Date.now() - t0),
            getRateScalePermille: () => {
                throw new Error('snapshot unavailable');
            },
            logger,
        });

        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 11);
        ticker.stop();

        expect(stamps).toHaveLength(11);
        stamps.forEach((at, index) => {
            expect(at).toBe(DILATION_BASE_PERIOD_MS * (index + 1));
        });
        const errors = sink.entries.filter((entry) => entry.level === 'error');
        expect(errors).toHaveLength(1);
        expect(errors[0]?.error?.message).toBe('snapshot unavailable');
    });

    it('absorbs a throwing scale getter with no logger wired', () => {
        const t0 = Date.now();
        const stamps: number[] = [];
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => stamps.push(Date.now() - t0),
            getRateScalePermille: () => {
                throw new Error('snapshot unavailable');
            },
        });

        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 11);
        ticker.stop();

        // Reporting is optional; absorbing is not.
        expect(stamps).toHaveLength(11);
        stamps.forEach((at, index) => {
            expect(at).toBe(DILATION_BASE_PERIOD_MS * (index + 1));
        });
    });

    it('holds cumulative drift under one period across twenty beats with a 5 ms dispatch cost', () => {
        const dispatchCostMs = 5;
        const beats = 20;
        const t0 = Date.now();
        let cost = 0;
        const now = (): number => Date.now() + cost;
        const stamps: number[] = [];
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => {
                stamps.push(now() - t0);
                cost += dispatchCostMs;
            },
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
            now,
        });

        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * beats);
        ticker.stop();

        expect(stamps.length).toBeGreaterThanOrEqual(beats);
        for (let index = 0; index < beats; index += 1) {
            const drift = Math.abs((stamps[index] ?? 0) - DILATION_BASE_PERIOD_MS * (index + 1));
            expect(drift).toBeLessThan(DILATION_BASE_PERIOD_MS);
        }
        expect(stamps[beats - 1]).toBeCloseTo(DILATION_BASE_PERIOD_MS * beats, 6);
    });

    it('fires exactly one beat after a ten-period stall, never a ten-beat burst', () => {
        const stallPeriods = 10;
        const t0 = Date.now();
        let extra = 0;
        const now = (): number => Date.now() + extra;
        const stamps: number[] = [];
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => {
                stamps.push(now() - t0);
                if (stamps.length === 1) {
                    // The first beat's own dispatch "stalls" the host for ten
                    // periods of wall-clock time.
                    extra += DILATION_BASE_PERIOD_MS * stallPeriods;
                }
            },
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
            now,
        });

        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 6);
        ticker.stop();

        // Resync point: the beat after the catch-up lands one period past the
        // stall's end.
        const resyncAt = DILATION_BASE_PERIOD_MS * (stallPeriods + 2);
        const beforeResync = stamps.filter((at) => at < resyncAt);
        const afterResync = stamps.filter((at) => at >= resyncAt);

        // The pre-stall beat plus EXACTLY ONE catch-up — no missed-tick recovery.
        expect(beforeResync).toHaveLength(2);
        expect(beforeResync[0]).toBe(DILATION_BASE_PERIOD_MS);
        expect(beforeResync[1]).toBeGreaterThanOrEqual(
            DILATION_BASE_PERIOD_MS * (stallPeriods + 1),
        );
        expect(afterResync.length).toBeGreaterThan(0);
        afterResync.forEach((at, index) => {
            expect(at).toBe(DILATION_BASE_PERIOD_MS * (stallPeriods + 2 + index));
        });
    });

    it('leaves no pending callback after stop() on the dilated path', () => {
        let beats = 0;
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => {
                beats += 1;
            },
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
        });

        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 2);
        ticker.stop();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 10);

        expect(beats).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('honours stop() called from inside a dispatch', () => {
        let beats = 0;
        let ticker: RealtimeTicker | null = null;
        ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => {
                beats += 1;
                ticker?.stop();
            },
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
        });

        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 10);

        expect(beats).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves exactly one chain when a dispatch stops and restarts the ticker', () => {
        const beats: number[] = [];
        let ticker: RealtimeTicker | null = null;
        ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => {
                beats.push(beats.length);
                if (beats.length === 1) {
                    // The dispatch arms a fresh chain; the `finally` that runs
                    // after it must not arm a SECOND one and orphan this handle.
                    ticker?.stop();
                    ticker?.start();
                }
            },
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
        });

        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 3);
        expect(vi.getTimerCount()).toBe(1);
        const beatsAtStop = beats.length;

        ticker.stop();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 10);

        expect(vi.getTimerCount()).toBe(0);
        expect(beats).toHaveLength(beatsAtStop);
    });

    it('restarts cleanly after stop() on the dilated path', () => {
        let beats = 0;
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => {
                beats += 1;
            },
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
        });

        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 2);
        ticker.stop();
        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 2);
        ticker.stop();

        expect(beats).toBe(4);
    });

    it('double-start does not start two chains', () => {
        let beats = 0;
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: () => {
                beats += 1;
            },
            getRateScalePermille: () => NORMAL_TIME_SCALE_PERMILLE,
        });

        ticker.start();
        ticker.start();
        vi.advanceTimersByTime(DILATION_BASE_PERIOD_MS * 4);
        ticker.stop();

        expect(beats).toBe(4);
    });
});

describe('RealtimeTicker effectiveHz', () => {
    it('reports the base hz when no scale getter is wired', () => {
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: noopDispatch,
        });

        expect(ticker.effectiveHz).toBe(DILATION_HZ);
    });

    it.each([250, 2000])('reports hz scaled by the permille (%i)', (permille: number) => {
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: noopDispatch,
            getRateScalePermille: () => permille,
        });

        expect(ticker.effectiveHz).toBe(DILATION_HZ * timeScaleMultiplier(permille));
    });

    it('declares hz readonly so dilation never rewrites the base rate', () => {
        const ticker = new RealtimeTicker({
            hz: DILATION_HZ,
            getEnvelope: dilationEnvelope,
            dispatch: noopDispatch,
            getRateScalePermille: () => 250,
        });

        // The pin IS this line: `tsc` fails the gate if `hz` ever becomes
        // writable (no `setHz`, no rename, no alias — the base rate is fixed at
        // construction and dilation is applied on top of it, never into it).
        // @ts-expect-error — `hz` is readonly.
        ticker.hz = DILATION_HZ * 2;
        // Runtime is deliberately unguarded, so the assignment really lands.
        expect(ticker.hz).toBe(DILATION_HZ * 2);
    });
});

describe('RealtimeTicker scale clamping', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it.each([Number.NaN, 0, -5, 1e9, 2.5])(
        'clamps a getter value of %s through clampTimeScalePermille',
        (raw: number) => {
            const clamped = clampTimeScalePermille(raw);
            const period = dilatedBeatPeriodMs(DILATION_BASE_PERIOD_MS, clamped);
            const t0 = Date.now();
            const stamps: number[] = [];
            const ticker = new RealtimeTicker({
                hz: DILATION_HZ,
                getEnvelope: dilationEnvelope,
                dispatch: () => stamps.push(Date.now() - t0),
                getRateScalePermille: () => raw,
            });

            expect(ticker.effectiveHz).toBe((DILATION_HZ * clamped) / NORMAL_TIME_SCALE_PERMILLE);

            ticker.start();
            vi.advanceTimersByTime(Math.ceil(period * 3));
            ticker.stop();

            expect(stamps).toHaveLength(3);
            stamps.forEach((at, index) => {
                // The 4× ceiling gives a fractional 12.5 ms period, and a
                // platform timer only resolves whole milliseconds. The absolute
                // target keeps the error bounded below one millisecond instead
                // of letting the truncation accumulate.
                expect(Math.abs(at - period * (index + 1))).toBeLessThan(1);
            });
        },
    );

    it('reads both clamp bounds from time-scale.ts rather than hand-writing them', () => {
        const source = readFileSync(
            fileURLToPath(new URL('./RealtimeTicker.ts', import.meta.url)),
            'utf-8',
        )
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');

        for (const bound of [MIN_TIME_SCALE_PERMILLE, MAX_TIME_SCALE_PERMILLE]) {
            const literal = new RegExp(String.raw`(?<![\w.])${bound}(?![\w.])`);
            // Positive control: the pattern really does match a bare literal.
            expect(`const bound = ${bound};`).toMatch(literal);
            expect(source).not.toMatch(literal);
        }
    });
});
