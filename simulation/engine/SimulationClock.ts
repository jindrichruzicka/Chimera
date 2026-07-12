/**
 * simulation/engine/SimulationClock.ts
 *
 * `SimulationClock` — reads logical simulation time from a snapshot.
 *
 * This module is the deterministic core's only clock reader: it returns
 * `snapshot.tick` and nothing else. Wall-clock sources (`Date.now`,
 * `performance.now`) are forbidden here by Invariant #43.
 *
 * Host-side real-time tick dispatch lives outside `simulation/` — see
 * `electron/main/runtime/RealtimeTicker.ts`.
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 *
 * Invariants upheld:
 *   Rule 1 — SimulationClock.now() reads snapshot.tick only; never calls
 *             Date.now(), performance.now(), or any wall-clock source.
 *   #2     — No host I/O (setInterval/setTimeout) in simulation/.
 *   #43    — No Math.random() or Date.now() inside simulation/.
 */

import type { BaseGameSnapshot } from './types.js';

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
