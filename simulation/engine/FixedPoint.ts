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
export const FP_HALF_PI: FixedPoint = FP_PI / 2n;
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

// ── Arithmetic ─────────────────────────────────────────────────────────────

/** Q32.32 addition. */
export function add(a: FixedPoint, b: FixedPoint): FixedPoint {
    return a + b;
}

/** Q32.32 subtraction. */
export function sub(a: FixedPoint, b: FixedPoint): FixedPoint {
    return a - b;
}

/** Q32.32 multiplication: `(a * b) >> 32`. */
export function mul(a: FixedPoint, b: FixedPoint): FixedPoint {
    return (a * b) >> SHIFT;
}

/**
 * Q32.32 division: `(a << 32) / b`.
 * @throws {RangeError} when `b` is zero.
 */
export function div(a: FixedPoint, b: FixedPoint): FixedPoint {
    if (b === 0n) throw new RangeError('FixedPoint: division by zero');
    return (a << SHIFT) / b;
}

/** Negation. */
export function neg(a: FixedPoint): FixedPoint {
    return -a;
}

/** Absolute value. */
export function abs(a: FixedPoint): FixedPoint {
    return a < 0n ? -a : a;
}

// ── Comparisons ────────────────────────────────────────────────────────────

/** Less-than comparison. */
export function lt(a: FixedPoint, b: FixedPoint): boolean {
    return a < b;
}

/** Greater-than comparison. */
export function gt(a: FixedPoint, b: FixedPoint): boolean {
    return a > b;
}

/** Equality comparison. */
export function eq(a: FixedPoint, b: FixedPoint): boolean {
    return a === b;
}

// ── Transcendental functions ───────────────────────────────────────────────

// CORDIC angles: atan(2^-i) in Q32.32 — hard-coded for determinism.
// Computed offline (ECMAScript Math.atan/Math.pow/Math.sqrt do not guarantee
// bit-identical results across platforms). This is the standard approach for
// production CORDIC libraries targeting deterministic platforms.
const CORDIC_ANGLES = [
    3373259426n,
    1991351318n,
    1052175346n,
    534100635n,
    268086748n,
    134174063n,
    67103403n,
    33553749n,
    16777131n,
    8388597n,
    4194303n,
    2097152n,
    1048576n,
    524288n,
    262144n,
    131072n,
    65536n,
    32768n,
    16384n,
    8192n,
    4096n,
    2048n,
    1024n,
    512n,
    256n,
    128n,
    64n,
    32n,
    16n,
    8n,
    4n,
    2n,
] as const;

// Pre-computed shift amounts (0..31) to avoid per-iteration BigInt allocation.
// Each iteration of CORDIC loops would otherwise call BigInt(i), creating
// 2 heap allocations × 32 iterations = 64 allocations per trig call.
// With this cache, shifts are reused without allocation.
const CORDIC_SHIFTS = [
    0n,
    1n,
    2n,
    3n,
    4n,
    5n,
    6n,
    7n,
    8n,
    9n,
    10n,
    11n,
    12n,
    13n,
    14n,
    15n,
    16n,
    17n,
    18n,
    19n,
    20n,
    21n,
    22n,
    23n,
    24n,
    25n,
    26n,
    27n,
    28n,
    29n,
    30n,
    31n,
] as const;

// CORDIC K-factor (product of 1/sqrt(1+2^-2i)) in Q32.32
// Hard-coded for determinism across all platforms and runtime environments.
// Computed offline: product converges to ~0.6072... in Q32.32 fixed-point.
const CORDIC_K = 2608131496n;

/**
 * Q32.32 square root using binary-search Newton-Raphson on bigint.
 * @throws {RangeError} when input is negative.
 */
export function sqrt(a: FixedPoint): FixedPoint {
    if (a < 0n) throw new RangeError('FixedPoint: sqrt of negative number');
    if (a === 0n) return 0n;
    // Work in Q64 space: shift a left by 32 more bits so that sqrt brings it
    // back to Q32.
    const aQ64 = a << 32n;
    // Initial estimate: integer sqrt of aQ64
    let x = aQ64;
    let y = (x + 1n) >> 1n;
    while (y < x) {
        x = y;
        y = (x + aQ64 / x) >> 1n;
    }
    return x;
}

/**
 * Core CORDIC rotation kernel.
 * Rotates the vector (CORDIC_K, 0) by `angle` radians (in Q32.32).
 * `angle` **must** be in the range [-π/2, π/2]; no quadrant adjustment is done here.
 *
 * Returns `[cx, cy]` where `cx ≈ cos(angle)` and `cy ≈ sin(angle)`.
 *
 * @remarks Each call allocates O(32) intermediate `bigint` heap objects
 * (≈5 per iteration × 32 iterations). Acceptable for current usage volumes;
 * avoid calling on tight, high-frequency simulation paths without batching.
 */
function cordicRotateKernel(angle: bigint): [cx: bigint, cy: bigint] {
    let cx = CORDIC_K;
    let cy = 0n;
    let theta = angle;

    for (let i = 0; i < 32; i++) {
        const tx = cx;
        if (theta >= 0n) {
            cx = cx - (cy >> CORDIC_SHIFTS[i]!);
            cy = cy + (tx >> CORDIC_SHIFTS[i]!);
            theta -= CORDIC_ANGLES[i]!;
        } else {
            cx = cx + (cy >> CORDIC_SHIFTS[i]!);
            cy = cy - (tx >> CORDIC_SHIFTS[i]!);
            theta += CORDIC_ANGLES[i]!;
        }
    }

    return [cx, cy];
}

/**
 * CORDIC vectoring mode: compute angle of vector (x, y) = atan2(y, x).
 * Returns angle in Q32.32 radians, range (-π, π].
 *
 * @remarks Each call allocates O(32) intermediate `bigint` heap objects.
 * Acceptable for current usage volumes; avoid on tight high-frequency paths
 * without batching.
 */
export function atan2(y: FixedPoint, x: FixedPoint): FixedPoint {
    // Handle special cases
    if (y === 0n && x > 0n) return 0n;
    if (y === 0n && x < 0n) return FP_PI;
    if (x === 0n && y > 0n) return FP_HALF_PI;
    if (x === 0n && y < 0n) return -FP_HALF_PI;
    if (x === 0n && y === 0n) return 0n;

    let cx = x;
    let cy = y;
    let angle = 0n;

    // Quadrant adjustment: rotate to right half-plane
    if (cx < 0n) {
        if (cy >= 0n) {
            // Q2 → flip to Q4, add π after
            cx = -cx;
            cy = -cy;
            angle = FP_PI;
        } else {
            // Q3 → flip to Q1, subtract π after
            cx = -cx;
            cy = -cy;
            angle = -FP_PI;
        }
    }

    // CORDIC rotation
    for (let i = 0; i < 32; i++) {
        const tx = cx;
        if (cy < 0n) {
            // rotate counter-clockwise
            cx = cx - (cy >> CORDIC_SHIFTS[i]!);
            cy = cy + (tx >> CORDIC_SHIFTS[i]!);
            angle -= CORDIC_ANGLES[i]!;
        } else {
            // rotate clockwise
            cx = cx + (cy >> CORDIC_SHIFTS[i]!);
            cy = cy - (tx >> CORDIC_SHIFTS[i]!);
            angle += CORDIC_ANGLES[i]!;
        }
    }

    return angle;
}

/**
 * Q32.32 sine using CORDIC rotation mode.
 * Input in radians (Q32.32).
 *
 * @remarks Each call allocates O(32) intermediate `bigint` heap objects via
 * {@link cordicRotateKernel}. Acceptable for current usage volumes; avoid on
 * tight high-frequency simulation paths without batching.
 */
export function sin(a: FixedPoint): FixedPoint {
    if (a === 0n) return 0n;

    // Reduce angle to (-π, π] using TAU
    let angle = a;
    const tau = FP_TAU;
    if (angle > FP_PI || angle <= -FP_PI) {
        const q = angle / tau;
        angle = angle - q * tau;
        if (angle > FP_PI) angle -= tau;
        else if (angle <= -FP_PI) angle += tau;
    }

    // Further reduce to [-π/2, π/2] using sin symmetry
    // Identity: sin(π - angle) = sin(angle)       for angle ∈ (π/2, π]
    // Identity: sin(-π - angle) = sin(angle)      for angle ∈ (-π, -π/2)
    //   proof: sin(-π - a) = -sin(π + a) = -(-sin(a)) = sin(a) — no negation needed.
    if (angle > FP_HALF_PI) {
        angle = FP_PI - angle;
    } else if (angle < -FP_HALF_PI) {
        angle = -FP_PI - angle;
    }

    const [, cy] = cordicRotateKernel(angle);
    return cy;
}

/**
 * Q32.32 cosine using CORDIC rotation mode.
 * Input in radians (Q32.32).
 *
 * @remarks Each call allocates O(32) intermediate `bigint` heap objects via
 * {@link cordicRotateKernel}. Acceptable for current usage volumes; avoid on
 * tight high-frequency simulation paths without batching.
 */
export function cos(a: FixedPoint): FixedPoint {
    if (a === 0n) return FP_ONE;

    // Reduce angle to (-π, π]
    let angle = a;
    const tau = FP_TAU;
    if (angle > FP_PI || angle <= -FP_PI) {
        const q = angle / tau;
        angle = angle - q * tau;
        if (angle > FP_PI) angle -= tau;
        else if (angle <= -FP_PI) angle += tau;
    }

    // Reduce to [-π/2, π/2] using cos symmetry
    let negate = false;
    if (angle > FP_HALF_PI) {
        angle = FP_PI - angle;
        negate = true;
    } else if (angle < -FP_HALF_PI) {
        angle = -FP_PI - angle;
        negate = true;
    }

    const [cx] = cordicRotateKernel(angle);
    return negate ? -cx : cx;
}
