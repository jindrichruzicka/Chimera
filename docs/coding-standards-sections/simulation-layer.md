---
title: 'Chimera Coding Standards — §7 Simulation Layer'
description: 'Simulation determinism rules, reducer purity, GameSnapshot invariants, and fixed-point arithmetic requirements.'
tags: [simulation, determinism, reducer, GameSnapshot, FixedPoint, rng, coding-standards]
---

# §7 Simulation Layer

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 7.1 Determinism — three inviolable rules

1. **Action-driven clock only.** Time advances via `snapshot.tick`, never `Date.now()` or `performance.now()`.
2. **Seeded RNG only.** All randomness flows through `ctx.rng` (xoshiro256\*\* seeded from `(snapshot.seed, snapshot.tick)`). No `Math.random()` anywhere in `simulation/` or `apps/*/simulation/`.
3. **Integer arithmetic only in `GameSnapshot`.** All snapshot fields that participate in equality or arithmetic must be plain `number` integers — a fractional quantity as a scaled integer in a declared unit (§7.4). No `float` fields in `GameSnapshot`, and no `bigint` either: every persistence boundary is `JSON.stringify`, which throws on one.

## 7.2 Reducer purity

- `validate()` and `reduce()` are **pure functions**. Same inputs → same output, always.
- They must not read environment variables, perform I/O, access the file system, or call any platform API.
- They must not mutate the input `snapshot`. Always return a new object.

## 7.3 `GameSnapshot` invariants

- `GameSnapshot` must never cross process or network boundaries. Only `PlayerSnapshot` (a projected, filtered view) is transmitted.
- No DOM imports, Three.js imports, or Node.js platform APIs inside `simulation/` or `ai/engine/`.

## 7.4 Fixed-point arithmetic

- A fractional gameplay quantity is STORED as a scaled integer `number` in a declared unit — milli-cells, basis points — never as a `FixedPoint` and never as a float (Invariants #44/#75). `FixedPoint` (Q32.32 `bigint`) is for the arithmetic that produces it — a ratio, a square root, a transcendental — and is converted with `toInt()`, or scaled and truncated, before the result reaches a `GameSnapshot` field or an `EngineAction.payload`. A `bigint` cannot cross any persistence boundary: every one is `JSON.stringify`, which throws on one.
- The `FixedPoint.fromFloat()` factory is forbidden inside `validate()`, `reduce()`, and all hot simulation paths. Use it only in content loaders for hard-coded constants.
- Prefer the named constants `FP_ZERO`, `FP_ONE`, `FP_HALF`, `FP_PI` over constructing equivalent values inline.

## 7.5 Snapshot retention

Every collection that lives on `GameSnapshot` sits in every save checkpoint the body checksum covers; the ones `StateProjector.project()` carries (`events` is one, `timers` is not) also ride into every projected `PlayerSnapshot` and every broadcast. A collection that only ever grows is therefore not a memory concern but a per-beat cost. These are the rules, not a description of what the code happens to do today.

- **`events` is a per-action outbox.** `ActionPipeline.process()` empties it before every outer action's reduce (Stage 0). A reducer appends to what it was handed and must never rely on an earlier action's events still being there; a consumer plays a batch whole, because there is no already-seen prefix to index past. The mechanism and its consequences are in [§4.2 — Event outbox retention](../core-components/simulation-core-action-pipeline.md#event-outbox-retention).
- **A fired one-shot timer leaves `timers` in the beat that fired it.** `TimerManager.advance()` does not carry the fired entry into the registry it returns; only a repeating timer, a timer still counting down, and an entry that was already inactive survive a beat. Nothing sweeps inactive entries, and `timers` is in `BASE_SNAPSHOT_KEYS`, so a `cancel()`ed timer stays in the registry until a `create()` under the same id replaces it — a game that cancels many distinct ids should `create()` under a stable, entity-derived id rather than mint a fresh one per cancel. See [§4.20](../core-components/game-timers.md).
- **A new snapshot-resident collection declares its retention where it is added.** The field's doc comment on `BaseGameSnapshot` states what removes an entry and when — per action, per beat, at the match boundary, or never — and the test that pins that statement lands in the same change. A collection whose answer is "never" needs a stated bound instead.
- **Retention produces a new snapshot; it never trims in place.** `validate()` and `reduce()` are pure and must not mutate their input (§7.2, Invariant #43), and the drain and the timer removal above are both new-object writes for the same reason. The drained `events` array is a shared frozen constant, so an in-place append throws at the offending line rather than contaminating every later action.

### Per-beat outbound cost baseline

What a realtime host pays per eventful beat is `O(entities × viewers)`: `StateProjector.project()` once per seated viewer, then serialisation and a `crc32` per outbound frame. `StateBroadcaster` decides whether that frame is a whole projection or a delta. [`apps/action/__tests__/OutboundPerBeatPerf.bench.test.ts`](../../apps/action/__tests__/OutboundPerBeatPerf.bench.test.ts) is the measurement — one wave = all viewers — over the action app's shipped (identity) visibility rules; `pnpm test:perf` re-runs it. What it does and does not cover is its own header's to state.

| Grid (entities × viewers) | Wave median | Wave p95  | Body per viewer |
| ------------------------- | ----------- | --------- | --------------- |
| 500 × 4                   | 1.515 ms    | 1.600 ms  | 56,183 B        |
| 2000 × 8                  | 12.508 ms   | 13.072 ms | 226,667 B       |

Measured on the development machine (Node v25.9.0; `CHIMERA_PERF_STRICT=1 vitest run` on that file; median and p95 of 200 waves after a 100-wave warm-up). The 500 × 4 grid is gated against `TICK_BUDGET_MS` (§13.1); the 2000 × 8 grid is logged only and compared against nothing.

The same file measures the DELTA arm beside it — project per viewer, diff against what that viewer was last sent, then serialise and `crc32` the delta instead of the projection — at both ends of the axis it lives on, how much of the arena moved:

| Grid     | Entities moved | Body per viewer    | Wave p95 |
| -------- | -------------- | ------------------ | -------- |
| 500 × 4  | 25             | 2,988 B (5.3%)     | 0.89 ms  |
| 500 × 4  | 496            | 58,849 B (104.7%)  | 2.33 ms  |
| 2000 × 8 | 100            | 11,753 B (5.2%)    | 7.07 ms  |
| 2000 × 8 | 1996           | 239,232 B (105.5%) | 18.93 ms |

The moved counts are what each run measured: `measureDeltaWave` counts the entities that differ. The byte percentages are of the whole-snapshot row at the same grid, and reproduce exactly. The p95 column is not given as a percentage — the bench measures its own baseline in the same run, and the ratio moves with the machine.

Read the two rows per grid as the two ends they are: at a realtime beat's motion the payload is about a twentieth, and when nearly everything moves the delta is LARGER than the snapshot it would replace — which is why `StateBroadcaster` measures each delta against the last keyframe and sends the snapshot when the delta does not beat it. Neither delta row is gated: they are the recorded measurement, and a ratio asserted here would gate the runner rather than the code.
