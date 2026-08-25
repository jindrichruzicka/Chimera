/**
 * electron/main/runtime/RealtimeTicker.ts
 *
 * Host-side real-time dispatch loop for games that need a wall-clock-driven
 * tick (e.g. real-time strategy). Lives in `electron/main/` — NOT in
 * `simulation/` — because a wall-clock timer is host I/O and invariant #2
 * forbids host I/O inside the deterministic core.
 *
 * The ticker never builds an envelope on its own: the caller supplies a
 * `getEnvelope` factory that has live access to the current snapshot so it
 * can stamp the correct `tick`, `seed`, and `playerId` every time.
 *
 * WHEN the host arms one is not this module's decision but it constrains this
 * module's contract: `engine:tick` is admitted by the reducer in every phase, so
 * a ticker started while the session is still in the lobby advances the clock
 * ahead of `engine:start_game` and writes pre-start beats into the deterministic
 * recording. The gate that forbids that is `tryStartGame` in
 * `electron/main/index.ts`, which arms a ticker only once the session snapshot
 * has left the lobby phase.
 *
 * Two scheduling paths, chosen once per `start()` by whether the caller wired
 * `getRateScalePermille`:
 *
 *  - ABSENT — a fixed `setInterval` at `1000 / hz`. Unchanged.
 *  - PRESENT — a self-scheduling `setTimeout` chain re-armed against an
 *    ABSOLUTE next-fire target, so a beat's own dispatch cost is not added to
 *    the next delay. The period comes from `dilatedBeatPeriodMs`; its
 *    reciprocity with the renderer's `timeScaleMultiplier` is measured in
 *    `renderer/animation/__tests__/dilation-coherence.test.ts`.
 *
 * Dilation re-paces the beat sequence in wall-clock time; no wall-clock
 * quantity produced here reaches a reducer (invariants #42/#43).
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 * Feature reference: F82 — Animation System,
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 */

import type { ActionEnvelope } from '@chimera-engine/simulation/engine/index.js';
import {
    NORMAL_TIME_SCALE_PERMILLE,
    clampTimeScalePermille,
    dilatedBeatPeriodMs,
} from '@chimera-engine/simulation/foundation/time-scale.js';
import type { Logger } from '../logging/logger.js';

export interface RealtimeTickerOptions {
    /**
     * BASE dispatch frequency in Hz — the undilated rate. Must be finite and
     * > 0. Time dilation is applied on top of it (see `effectiveHz`), never
     * into it, so this stays the game's declared rate for the ticker's whole
     * life.
     */
    readonly hz: number;
    /**
     * Factory called immediately before each dispatch. Must return an
     * `ActionEnvelope` stamped with the current `snapshot.tick`,
     * `snapshot.seed`-derived payload, and the correct host player id.
     */
    readonly getEnvelope: () => ActionEnvelope;
    /**
     * Callback that delivers the envelope to the caller's `ActionPipeline`.
     * Any error thrown is the caller's responsibility.
     */
    readonly dispatch: (envelope: ActionEnvelope) => void;
    /**
     * Optional host pacing scale in permille, read fresh before EVERY re-arm so
     * a scale change mid-match re-paces from the next beat on. Out-of-range and
     * non-integer values are normalised by `clampTimeScalePermille`; a throw is
     * caught, reported once, and treated as real time.
     *
     * ABSENT ⇒ the ticker keeps its fixed `setInterval` cadence and never calls
     * `setTimeout`.
     */
    readonly getRateScalePermille?: () => number;
    /**
     * Optional logger for the one-shot report that `getRateScalePermille`
     * threw. Absent ⇒ the failure is still absorbed, just not reported;
     * `console.*` is never used (invariant #67).
     */
    readonly logger?: Logger;
    /**
     * Wall clock injection, defaulting to `Date.now`. Declared so drift and
     * stall tests can model a dispatch that costs real time while the timer
     * queue is driven by fake timers.
     */
    readonly now?: () => number;
}

export class RealtimeTicker {
    readonly hz: number;
    readonly #getEnvelope: () => ActionEnvelope;
    readonly #dispatch: (envelope: ActionEnvelope) => void;
    readonly #getRateScalePermille: (() => number) | undefined;
    readonly #logger: Logger | undefined;
    readonly #now: () => number;
    #intervalId: ReturnType<typeof setInterval> | null = null;
    #timeoutId: ReturnType<typeof setTimeout> | null = null;
    #running = false;
    /** Absolute wall-clock target of the next chain beat. */
    #nextAt = 0;
    /** Latch so a permanently throwing scale getter reports once, not per beat. */
    #rateScaleFailureReported = false;

    constructor(options: RealtimeTickerOptions) {
        if (!Number.isFinite(options.hz) || options.hz <= 0) {
            throw new RangeError(
                `RealtimeTicker: hz must be a finite positive number; got ${String(options.hz)}.`,
            );
        }
        this.hz = options.hz;
        this.#getEnvelope = options.getEnvelope;
        this.#dispatch = options.dispatch;
        this.#getRateScalePermille = options.getRateScalePermille;
        this.#logger = options.logger;
        this.#now = options.now ?? ((): number => Date.now());
    }

    /**
     * The dilated dispatch rate: `hz` scaled by the current permille. Equal to
     * `hz` whenever no scale getter is wired.
     */
    get effectiveHz(): number {
        return (this.hz * this.#readRateScalePermille()) / NORMAL_TIME_SCALE_PERMILLE;
    }

    start(): void {
        if (this.#running) {
            return;
        }
        this.#running = true;
        if (this.#getRateScalePermille === undefined) {
            // Undilated: the fixed-interval path, pinned by `schedules with
            // setInterval and never setTimeout when no scale getter is wired`.
            this.#intervalId = setInterval(() => {
                this.#dispatch(this.#getEnvelope());
            }, 1000 / this.hz);
            return;
        }
        this.#nextAt = this.#now();
        this.#scheduleNextBeat();
    }

    stop(): void {
        if (!this.#running) {
            return;
        }
        this.#running = false;
        if (this.#intervalId !== null) {
            clearInterval(this.#intervalId);
            this.#intervalId = null;
        }
        if (this.#timeoutId !== null) {
            clearTimeout(this.#timeoutId);
            this.#timeoutId = null;
        }
    }

    /**
     * Arm one chain beat against an ABSOLUTE target.
     *
     * `Math.max(target + period, now)` does two things at once: the running
     * target keeps a beat's own dispatch cost out of the next delay (no drift
     * accrual), and the clamp resynchronises after a long stall instead of
     * firing the whole backlog — no catch-up or missed-beat recovery exists.
     */
    #scheduleNextBeat(): void {
        const periodMs = dilatedBeatPeriodMs(1000 / this.hz, this.#readRateScalePermille());
        this.#nextAt = Math.max(this.#nextAt + periodMs, this.#now());
        this.#timeoutId = setTimeout(() => {
            this.#timeoutId = null;
            try {
                this.#dispatch(this.#getEnvelope());
            } finally {
                // Re-armed in `finally`, NOT after the dispatch: `dispatch`
                // hands the envelope to an `ActionPipeline` whose rejections
                // propagate straight out, and the fixed-interval path fires the
                // next beat regardless of them. Pinned by `keeps the chain
                // alive when dispatch throws on the first beat`. `stop()`
                // called from inside the dispatch still wins, leaving no
                // pending callback. `#timeoutId` was nulled above, so a
                // non-null one here means the dispatch armed its own chain
                // (`stop()` then `start()`); re-arming over it would orphan
                // that handle and leave a beat `stop()` can no longer clear.
                if (this.#running && this.#timeoutId === null) {
                    this.#scheduleNextBeat();
                }
            }
        }, this.#nextAt - this.#now());
    }

    /**
     * Read and normalise the caller's pacing scale. A getter that throws is
     * absorbed — a broken scale source must not stop the match — reported once
     * through the injected logger, and treated as real time.
     */
    #readRateScalePermille(): number {
        const getRateScalePermille = this.#getRateScalePermille;
        if (getRateScalePermille === undefined) {
            return NORMAL_TIME_SCALE_PERMILLE;
        }
        try {
            return clampTimeScalePermille(getRateScalePermille());
        } catch (err) {
            if (!this.#rateScaleFailureReported) {
                this.#rateScaleFailureReported = true;
                this.#logger?.error(
                    'realtime ticker time-scale getter threw; pacing at real time',
                    err instanceof Error ? err : new Error(String(err)),
                );
            }
            return NORMAL_TIME_SCALE_PERMILLE;
        }
    }
}
