---
title: 'Game Timers'
description: 'GameTimer interface, TimerRegistry on GameSnapshot, TimerManager (create/cancel/advance), ctx.dispatch() semantics with bounded recursion (MAX_NESTED_DISPATCH=16), DoT example, and determinism rules.'
tags: [timers, simulation, game-loop, determinism, engine-action]
---

# Game Timers

> §4.20 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Fixed-Point Math](fixed-point-math.md)

---

## Overview

Tick-based, deterministic timers that live entirely inside `GameSnapshot` and travel through the normal action pipeline. Used for periodic gameplay effects: Damage-over-Time (DoT), power-up durations, timed abilities, countdown objectives.

---

## Core Types

```typescript
// simulation/engine/GameTimer.ts

export type TimerId = string & { readonly __brand: 'TimerId' };

export interface GameTimer {
    readonly id: TimerId;
    /** Ticks remaining until next fire. Decremented by TimerManager.advance(). */
    readonly remainingTicks: number;
    /**
     * 0 = one-shot: fires once when remainingTicks reaches 0, then marks inactive.
     * N = interval: resets remainingTicks to N after each fire.
     */
    readonly intervalTicks: number;
    readonly actionType: string;
    readonly payload: Record<string, unknown>;
    readonly active: boolean;
}

export type TimerRegistry = Record<TimerId, GameTimer>;

export interface FiredTimerAction {
    readonly actionType: string;
    readonly payload: Record<string, unknown>;
}
```

`TimerRegistry` is stored as `snapshot.timers: TimerRegistry`. Serialises naturally in saves and replays deterministically (all counters are integer ticks).

---

## TimerManager

```typescript
export const TimerManager = {
    /** Add or replace a timer. Pure — returns new registry. */
    create(registry: TimerRegistry, timer: Omit<GameTimer, 'active'>): TimerRegistry,

    /** Mark a timer inactive. Pure — returns new registry. */
    cancel(registry: TimerRegistry, id: TimerId): TimerRegistry,

    /**
     * Advance all active timers by 1 tick.
     * Returns updated registry + list of actions that fired.
     * Pure. Called by engine:tick reducer ONLY.
     */
    advance(registry: TimerRegistry): {
        next: TimerRegistry;
        fired: readonly FiredTimerAction[];
    },
};
```

---

## engine:tick Reducer

```typescript
// The engine:tick reducer calls advance() before game-defined logic
const { next, fired } = TimerManager.advance(state.timers);
let nextState: GameSnapshot = { ...state, timers: next };
for (const { actionType, payload } of fired) {
    nextState = ctx.dispatch(actionType, payload, state.activePlayerId, nextState);
}
return nextState;
```

---

## ctx.dispatch() Semantics

Timer-driven actions re-enter the pipeline from inside `engine:tick.reduce()`. Four rules govern this:

1. **Partial pipeline only.** `ctx.dispatch()` runs Stage 4 (validate) and Stage 5 (reduce). Does NOT invoke Stage 6 (history append), Stage 7 (broadcast), or the debug observer. `ActionHistory` records only the outer `engine:tick` frame. Replays re-derive timer fires from `TimerRegistry` state.

2. **Bounded recursion.** Nested-dispatch depth is tracked on `ReduceContext`. Exceeding `MAX_NESTED_DISPATCH = 16` throws `RecursiveDispatchError`.

3. **Fire-within-fire.** A child action may create or cancel timers on `nextState.timers`. New/cancelled timers do not fire until the **next** `engine:tick`. `TimerManager.advance()` is invoked exactly once per outer tick.

4. **Non-fatal validation rejection.** If a timer-fired action fails `validate()`, the failure is logged at `warn` with `{ timerId, actionType, reason }` and the outer tick continues. Game code must not rely on a timer's action always succeeding.

---

## DoT Example

```typescript
// Inside game:apply_poison reducer — set up a 5-tick DoT, 10 damage per tick:
const newTimers = TimerManager.create(state.timers, {
    id: `dot-${payload.targetId}`,
    remainingTicks: 5,
    intervalTicks: 1, // fires every tick, 5 times
    actionType: 'game:apply_dot_damage',
    payload: { targetId: payload.targetId, damage: 10 },
});
return { ...state, timers: newTimers };
```

---

## Determinism Rules

- Timers are driven by integer `tick` — **never** by `Date.now()` or `performance.now()`.
- Turn-based games: `engine:tick` dispatched explicitly by host at defined moments (end of turn, resolution phase).
- Real-time games: `engine:tick` dispatched by `RealtimeTicker` (§4.2.1).
- Timer IDs must be deterministic (derived from entity IDs + action type, not random UUIDs) so replays produce identical timer maps.

---

## Invariants

| #   | Rule                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #54 | `GameTimer` lives in `GameSnapshot.timers`. Serialised, loaded, and replayed. `remainingTicks` must never be derived from wall-clock time.                                                                       |
| #55 | `TimerManager.advance()` is a pure function. The `engine:tick` reducer is the ONLY consumer of `advance()`. Game reducers may create or cancel timers via `create()` / `cancel()` but must NOT call `advance()`. |

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `ReduceContext`, `ReductionContext.dispatch()`, pipeline stages
- [Fixed-Point Math](fixed-point-math.md) — timer payloads may carry fixed-point values
