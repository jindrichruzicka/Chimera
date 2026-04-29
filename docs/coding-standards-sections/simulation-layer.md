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
2. **Seeded RNG only.** All randomness flows through `ctx.rng` (xoshiro256\*\* seeded from `(snapshot.seed, snapshot.tick)`). No `Math.random()` anywhere in `simulation/` or `games/*/actions/`.
3. **Integer arithmetic only in `GameSnapshot`.** All snapshot fields that participate in equality or arithmetic must be `bigint` (Q32.32 fixed-point via `FixedPoint`) or plain `number` integers. No `float` fields in `GameSnapshot`.

## 7.2 Reducer purity

- `validate()` and `reduce()` are **pure functions**. Same inputs → same output, always.
- They must not read environment variables, perform I/O, access the file system, or call any platform API.
- They must not mutate the input `snapshot`. Always return a new object.

## 7.3 `GameSnapshot` invariants

- `GameSnapshot` must never cross process or network boundaries. Only `PlayerSnapshot` (a projected, filtered view) is transmitted.
- No DOM imports, Three.js imports, or Node.js platform APIs inside `simulation/` or `ai/engine/`.

## 7.4 Fixed-point arithmetic

- Use `FixedPoint` (Q32.32 `bigint`) for all fractional simulation values. The `FixedPoint.fromFloat()` factory is forbidden inside `validate()`, `reduce()`, and all hot simulation paths. Use it only in content loaders for hard-coded constants.
- Prefer the named constants `FP_ZERO`, `FP_ONE`, `FP_HALF`, `FP_PI` over constructing equivalent values inline.
