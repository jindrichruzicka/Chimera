---
title: 'Fixed-Point Math (Q32.32)'
description: 'FixedPoint = bigint Q32.32, range/resolution, FP_* constants, fromInt/fromRatio/fromFloat/toFloat/toInt, arithmetic suite, transcendentals (sqrt/sin/cos/atan2), why a FixedPoint is never stored in a snapshot (Invariant #75), ESLint no-fromfloat-in-simulation rule, determinism golden-vector tests.'
tags: [determinism, fixed-point, bigint, math, simulation, eslint]
---

# Fixed-Point Math (Q32.32)

> §4.31 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Architecture Invariants](../executive-architecture/architecture-invariants.md) · [Curves & Tweening](curves-tweening-interaction.md)

---

## Motivation

`number` (IEEE-754 double) is non-deterministic across platforms: the x87 FPU on x86, ARM NEON, and V8's JIT all produce distinct bit patterns for the same computation. Any simulation that uses `number` arithmetic on gameplay-meaningful values is non-deterministic and will diverge between players.

Chimera's solution: **`FixedPoint = bigint Q32.32`**. `bigint` arithmetic is spec-identical across all ECMAScript engines on all platforms. Determinism is guaranteed.

---

## Value Representation

`FixedPoint` is a plain `bigint`. The low 32 bits hold the fractional component; the high 32 bits hold the integer component.

- **Range**: approximately ±2.1 × 10⁹
- **Resolution**: ≈ 2.3 × 10⁻¹⁰

---

## Constants

```typescript
// simulation/engine/FixedPoint.ts

export type FixedPoint = bigint; // Branded Q32.32

export const FP_ZERO: FixedPoint;
export const FP_ONE: FixedPoint;
export const FP_HALF: FixedPoint;
export const FP_PI: FixedPoint;
export const FP_HALF_PI: FixedPoint;
export const FP_TAU: FixedPoint;
```

---

## Constructors

```typescript
/** Integer → FixedPoint. Exact. */
export function fromInt(n: number): FixedPoint;

/** Ratio → FixedPoint. Exact when denominator divides 2^32. */
export function fromRatio(numerator: number, denominator: number): FixedPoint;

/**
 * Float → FixedPoint. Lossy.
 * Use ONLY for hard-coded content constants loaded at content-load time.
 * NEVER call inside validate(), reduce(), or any hot simulation path.
 */
export function fromFloat(x: number): FixedPoint;

/** FixedPoint → float. Lossy. Use ONLY at the renderer boundary for display. */
export function toFloat(x: FixedPoint): number;

/** FixedPoint → integer (truncation). */
export function toInt(x: FixedPoint): number;
```

---

## Arithmetic Suite

```typescript
// Arithmetic
export function add(a: FixedPoint, b: FixedPoint): FixedPoint;
export function sub(a: FixedPoint, b: FixedPoint): FixedPoint;
export function mul(a: FixedPoint, b: FixedPoint): FixedPoint;
export function div(a: FixedPoint, b: FixedPoint): FixedPoint;
export function neg(a: FixedPoint): FixedPoint;
export function abs(a: FixedPoint): FixedPoint;

// Transcendentals — table-driven or CORDIC polynomial, deterministic bigint intermediates
export function sqrt(a: FixedPoint): FixedPoint;
export function sin(a: FixedPoint): FixedPoint; // Input in radians
export function cos(a: FixedPoint): FixedPoint;
export function atan2(y: FixedPoint, x: FixedPoint): FixedPoint;

// Comparison
export function lt(a: FixedPoint, b: FixedPoint): boolean;
export function gt(a: FixedPoint, b: FixedPoint): boolean;
export function eq(a: FixedPoint, b: FixedPoint): boolean;
```

`sin`/`cos`/`sqrt` use integer-only implementations (CORDIC or polynomial approximation with `bigint` intermediates) to guarantee cross-platform bit-identity.

---

## Rules of Use

| Context                                         | Allowed                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Simulation state / `GameSnapshot` fields        | ✅ integer `number` — a fractional quantity as a scaled integer         |
| `validate()` / `reduce()` arithmetic            | ✅ `FixedPoint` for a fractional intermediate; `toInt()` before storing |
| Content load (`simulation/content/loaders/**`)  | ✅ `fromFloat()` once at load time                                      |
| Renderer display (Three.js / CSS / React)       | ✅ `toFloat()` at boundary                                              |
| `FixedPoint` in a snapshot or an action payload | ❌ violates invariant #75 — a `bigint` cannot be saved                  |
| float `number` for fractional game quantities   | ❌ violates invariant #44                                               |
| `Math.random()` inside simulation               | ❌ violates invariant #43                                               |

---

## Persistence

`FixedPoint` is arithmetic, not storage. Every persistence boundary in the engine is bare `JSON.stringify`, which throws on a `bigint` rather than degrading; no reviver on the way back produces one. A `FixedPoint` placed in a `GameSnapshot` field or an `EngineAction.payload` therefore makes the match unsavable at the first autosave, which is why Invariant #75 stores a fractional quantity as a scaled integer `number` and keeps `FixedPoint` to the arithmetic that produces it. The pins are [`SaveFile.test.ts`](../../simulation/persistence/SaveFile.test.ts) › `REFUSES a bigint in the checkpoint`, [`SaveChecksum.test.ts`](../../simulation/persistence/SaveChecksum.test.ts) › `rejects a bigint in the checkpoint`, [`crc32.test.ts`](../../simulation/foundation/crc32.test.ts) › `throws TypeError when passed a bigint`, and [`AnimationWindow.test.ts`](../../simulation/engine/AnimationWindow.test.ts) › `throws RangeError on a payload carrying a FixedPoint` — refused at the write.

The decision was between teaching every boundary a paired `bigint` replacer/reviver — with a save `schemaVersion` bump, a migrator step and a checksum that still verifies a save written before it — and relaxing the invariant to the representation Invariant #44 already blesses. The scaled integer is JSON-native and allocation-free on a realtime beat path; the replacer/reviver preserves `FixedPoint` as storage at the cost of a per-operation `bigint` allocation on every hot path that reads it. The engine takes the first.

---

## ESLint Enforcement

Custom rule **`chimera/no-fromfloat-in-simulation`** (in `electron/dev-tools/eslint/`):

- **Scope**: `simulation/**`, `apps/*/simulation/**` and `apps/*/ai/**`, EXCEPT `simulation/content/loaders/**` and test files, where the rule is turned off
- **Check**: any call to `fromFloat` imported from `simulation/engine/FixedPoint` is an error
- **Local bypass**: `// eslint-disable-next-line chimera/no-fromfloat-in-simulation` requires a companion `// @chimera-review: <reason>` comment on the same or previous line. The rule enforces this itself, on `Program:exit` — a bare disable is reported as a second error at the disable comment's own line, which the directive does not suppress. There is no separate CI grep, so the check travels with the rule into standalone games (§4.32).

---

## Determinism Tests

The determinism test suite (§10.0) includes a golden-vector test:

- Runs the same `(operation, inputs)` table on macOS, Windows, and Linux
- Asserts bit-identical `bigint` output across all platforms
- Covers `add`, `sub`, `mul`, `div`, `sqrt`, `sin`, `cos`, `atan2`

---

## Invariants

| #   | Rule                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #75 | A fractional gameplay quantity in `GameSnapshot` or `EngineAction.payload` is a **scaled integer `number`** in a declared unit; `FixedPoint` is the arithmetic that produces it and is never stored, because every persistence boundary is `JSON.stringify`, which throws on a `bigint`. A float there violates invariant #44 even if it rounds consistently. |
| #76 | `fromFloat()` is permitted only at content-load time for hard-coded constants. It must not be called inside `validate()`, `reduce()`, or any hot simulation path. Enforced by `chimera/no-fromfloat-in-simulation` ESLint rule in CI.                                                                                                                         |

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — the integer / scaled-integer state rules a `FixedPoint` result is stored under
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #42, #43, #44, #75, #76
- [Curves & Tweening](curves-tweening-interaction.md) — renderer uses `toFloat()` at the R3F boundary
