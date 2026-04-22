/**
 * electron/main/RealtimeTicker.ts
 *
 * Host-side real-time dispatch loop for games that need a wall-clock-driven
 * tick (e.g. real-time strategy). Lives in `electron/main/` — NOT in
 * `simulation/` — because `setInterval` is host I/O and invariant #2 forbids
 * host I/O inside the deterministic core.
 *
 * The ticker never builds an envelope on its own: the caller supplies a
 * `getEnvelope` factory that has live access to the current snapshot so it
 * can stamp the correct `tick`, `seed`, and `playerId` every time.
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 * Issue: #89
 */

import type { ActionEnvelope } from '@chimera/simulation/engine/index.js';

export interface RealtimeTickerOptions {
    /** Dispatch frequency in Hz. Must be finite and > 0. */
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
}

export class RealtimeTicker {
    readonly hz: number;
    readonly #getEnvelope: () => ActionEnvelope;
    readonly #dispatch: (envelope: ActionEnvelope) => void;
    #intervalId: ReturnType<typeof setInterval> | null = null;

    constructor(options: RealtimeTickerOptions) {
        if (!Number.isFinite(options.hz) || options.hz <= 0) {
            throw new RangeError(
                `RealtimeTicker: hz must be a finite positive number; got ${String(options.hz)}.`,
            );
        }
        this.hz = options.hz;
        this.#getEnvelope = options.getEnvelope;
        this.#dispatch = options.dispatch;
    }

    start(): void {
        if (this.#intervalId !== null) {
            return;
        }
        this.#intervalId = setInterval(() => {
            this.#dispatch(this.#getEnvelope());
        }, 1000 / this.hz);
    }

    stop(): void {
        if (this.#intervalId === null) {
            return;
        }
        clearInterval(this.#intervalId);
        this.#intervalId = null;
    }
}
