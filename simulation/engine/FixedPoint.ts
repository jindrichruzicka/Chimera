/**
 * Fixed-point arithmetic (Q32.32) for deterministic simulation math.
 *
 * Low 32 bits represent the fractional part; high bits represent the integer part.
 * This is the authoritative single-import point for all fixed-point operations
 * in the simulation layer.
 *
 * @module
 */

/** Q32.32 fixed-point number represented as a `bigint`. */
export type FixedPoint = bigint;

const SHIFT = 32n;
const SCALE = 1n << SHIFT; // 2^32

// ── Constants ──────────────────────────────────────────────────────────────

export const FP_ZERO: FixedPoint = 0n;
export const FP_ONE: FixedPoint = SCALE;
export const FP_HALF: FixedPoint = SCALE / 2n;
export const FP_PI: FixedPoint = BigInt(Math.round(Math.PI * 2 ** 32));
export const FP_TAU: FixedPoint = FP_PI * 2n;

// ── Conversion helpers ─────────────────────────────────────────────────────

/** Exact conversion from an integer to `FixedPoint`. */
export function fromInt(n: number): FixedPoint {
    return BigInt(n) << SHIFT;
}

/** Convert a ratio (numerator / denominator) to `FixedPoint`. */
export function fromRatio(numerator: number, denominator: number): FixedPoint {
    return BigInt(Math.round((numerator / denominator) * 2 ** 32));
}

/**
 * Lossy conversion from a `number` float to `FixedPoint`.
 *
 * @remarks This is intended for content-load time only. Do **not** use at
 * runtime inside `validate()` or `reduce()` — prefer `fromInt` or `fromRatio`
 * for deterministic paths.
 */
export function fromFloat(x: number): FixedPoint {
    return BigInt(Math.round(x * 2 ** 32));
}

/** Lossy conversion from `FixedPoint` to a `number` float. Renderer boundary only. */
export function toFloat(x: FixedPoint): number {
    return Number(x) / 2 ** 32;
}

/** Truncating conversion from `FixedPoint` to an integer `number`. */
export function toInt(x: FixedPoint): number {
    return Number(x >> SHIFT);
}
