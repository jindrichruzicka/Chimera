---
title: 'Fixed-Point Math (Q32.32)'
description: 'FixedPoint = bigint Q32.32, range/resolution, FP_* constants, fromInt/fromRatio/fromFloat/toFloat/toInt, arithmetic suite, transcendentals (sqrt/sin/cos/atan2), ESLint no-fromfloat-in-simulation rule, determinism golden-vector tests.'
tags: [determinism, fixed-point, bigint, math, simulation, eslint]
---

# Fixed-Point Math (Q32.32)

> §4.31 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Architecture Invariants](../executive-architecture/architecture-invariants-appendix.md) · [Curves & Tweening](curves-tweening-interaction.md)

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

| Context                                        | Allowed                                          |
| ---------------------------------------------- | ------------------------------------------------ |
| Simulation state / `GameSnapshot` fields       | ✅ `FixedPoint` (`bigint`) for fractional values |
| `validate()` / `reduce()` arithmetic           | ✅ `FixedPoint` only                             |
| Content load (`simulation/content/loaders/**`) | ✅ `fromFloat()` once at load time               |
| Renderer display (Three.js / CSS / React)      | ✅ `toFloat()` at boundary                       |
| `number` for fractional game quantities        | ❌ violates invariant #44                        |
| `Math.random()` inside simulation              | ❌ violates invariant #43                        |

---

## ESLint Enforcement

Custom rule **`chimera/no-fromfloat-in-simulation`** (in `tools/eslint-plugin-chimera/`):

- **Scope**: `simulation/**/*.ts` EXCEPT `simulation/content/loaders/**`
- **Check**: any call to `fromFloat` imported from `simulation/engine/FixedPoint` is an error
- **Local bypass**: `// eslint-disable-next-line chimera/no-fromfloat-in-simulation` requires a companion `@chimera-review: <reason>` comment — grep-checked by CI

---

## Determinism Tests

The determinism test suite (§10.0) includes a golden-vector test:

- Runs the same `(operation, inputs)` table on macOS, Windows, and Linux
- Asserts bit-identical `bigint` output across all platforms
- Covers `add`, `sub`, `mul`, `div`, `sqrt`, `sin`, `cos`, `atan2`

---

## Invariants

| #   | Rule                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #75 | `FixedPoint` is the **only** allowed fractional representation in `GameSnapshot` and `EngineAction.payload`. A game that stores `number` for a fractional gameplay quantity violates invariant #44 even if it rounds consistently.    |
| #76 | `fromFloat()` is permitted only at content-load time for hard-coded constants. It must not be called inside `validate()`, `reduce()`, or any hot simulation path. Enforced by `chimera/no-fromfloat-in-simulation` ESLint rule in CI. |

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `FixedPoint` used in `GameSnapshot` fields
- [Architecture Invariants](../executive-architecture/architecture-invariants-appendix.md) — invariants #42, #43, #44, #75, #76
- [Curves & Tweening](curves-tweening-interaction.md) — renderer uses `toFloat()` at the R3F boundary
