/**
 * simulation/engine/SimulationClock.ts
 *
 * `SimulationClock` — reads logical simulation time from a snapshot.
 * `RealtimeTicker`  — optional real-time dispatch loop for real-time games.
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 * Task: F04 / T2 (issue #42)
 *
 * Invariants upheld:
 *   Rule 1 — SimulationClock.now() reads snapshot.tick only; never calls
 *             Date.now(), performance.now(), or any wall-clock source.
 *   #43    — No Math.random() or Date.now() inside simulation/.
 */

import type { ActionEnvelope, BaseGameSnapshot } from './types.js';

// ─── SimulationClock ─────────────────────────────────────────────────────────

/**
 * Thin utility that reads logical simulation time from a snapshot.
 * Never reads wall-clock time — only `snapshot.tick`.
 */
export interface SimulationClock {
    /** Returns snapshot.tick. Never reads wall-clock time. */
    now(snapshot: Readonly<BaseGameSnapshot>): number;
}

/**
 * Singleton implementation of `SimulationClock`.
 * Import and use directly — no constructor needed.
 */
export const simulationClock: SimulationClock = {
    now(snapshot: Readonly<BaseGameSnapshot>): number {
        return snapshot.tick;
    },
};

// ─── RealtimeTicker ───────────────────────────────────────────────────────────

/**
 * Optional real-time tick loop for games that want a wall-clock-driven tick.
 * Dispatches `engine:tick` at a configurable Hz using `setInterval`.
 *
 * This ticker is NOT used by the core engine — it is an opt-in harness for
 * real-time games. The `dispatch` callback is provided by the game host; the
 * ticker itself never builds the seed.
 */
export interface RealtimeTickerInterface {
    start(): void;
    stop(): void;
    readonly hz: number;
}

export class RealtimeTicker implements RealtimeTickerInterface {
    readonly hz: number;
    readonly #dispatch: (action: ActionEnvelope) => void;
    #intervalId: ReturnType<typeof setInterval> | null = null;

    constructor(options: { hz: number; dispatch: (action: ActionEnvelope) => void }) {
        this.hz = options.hz;
        this.#dispatch = options.dispatch;
    }

    start(): void {
        // Guard against double-start — no-op if already running.
        if (this.#intervalId !== null) {
            return;
        }
        this.#intervalId = setInterval(() => {
            this.#dispatch({
                type: 'engine:tick',
                playerId: '' as ActionEnvelope['playerId'],
                tick: 0,
                payload: {},
            });
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
