/**
 * Golden-vector determinism tests for FixedPoint (Q32.32).
 *
 * Each test records a fixed (operation, inputs) → expected bigint pair and
 * asserts bit-identical output. Expected values were computed once by running
 * the pure-bigint CORDIC implementation and are stored as hard-coded bigint
 * literals — no Math.sin / Math.cos / Math.sqrt / Math.atan2 at test time.
 *
 * These tests serve as the CI guard against accidental introduction of
 * floating-point intermediates (Invariants #44 and #75).
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import {
    FP_HALF,
    FP_HALF_PI,
    FP_ONE,
    FP_PI,
    FP_ZERO,
    add,
    atan2,
    cos,
    div,
    fromInt,
    fromRatio,
    mul,
    sin,
    sqrt,
    sub,
    toFloat,
    toInt,
} from './FixedPoint.js';

// ── add ────────────────────────────────────────────────────────────────────
describe('FixedPoint golden vectors — add', () => {
    it('add(FP_ZERO, FP_ZERO) = 0n', () => {
        expect(add(FP_ZERO, FP_ZERO)).toBe(0n);
    });

    it('add(FP_ONE, FP_ONE) = 8589934592n', () => {
        expect(add(FP_ONE, FP_ONE)).toBe(8589934592n);
    });

    it('add(FP_PI, FP_HALF_PI) = 20239556557n', () => {
        expect(add(FP_PI, FP_HALF_PI)).toBe(20239556557n);
    });

    it('add(fromInt(-5), fromInt(3)) = -8589934592n  [negative inputs]', () => {
        expect(add(fromInt(-5), fromInt(3))).toBe(-8589934592n);
    });

    it('add(FP_ONE, FP_PI) = 17788005001n', () => {
        expect(add(FP_ONE, FP_PI)).toBe(17788005001n);
    });

    it('add(FP_HALF, FP_HALF) = 4294967296n  [two halves = one]', () => {
        expect(add(FP_HALF, FP_HALF)).toBe(4294967296n);
    });
});

// ── sub ────────────────────────────────────────────────────────────────────
describe('FixedPoint golden vectors — sub', () => {
    it('sub(FP_ONE, FP_ONE) = 0n', () => {
        expect(sub(FP_ONE, FP_ONE)).toBe(0n);
    });

    it('sub(FP_PI, FP_HALF_PI) = 6746518853n  [≈ FP_HALF_PI + 1 due to integer division]', () => {
        expect(sub(FP_PI, FP_HALF_PI)).toBe(6746518853n);
    });

    it('sub(fromInt(7), fromInt(3)) = 17179869184n  [= fromInt(4)]', () => {
        expect(sub(fromInt(7), fromInt(3))).toBe(17179869184n);
    });

    it('sub(FP_ZERO, FP_ONE) = -4294967296n  [zero minus one]', () => {
        expect(sub(FP_ZERO, FP_ONE)).toBe(-4294967296n);
    });

    it('sub(fromInt(-2), fromInt(-5)) = 12884901888n  [= fromInt(3), negatives cancel]', () => {
        expect(sub(fromInt(-2), fromInt(-5))).toBe(12884901888n);
    });
});

// ── mul ────────────────────────────────────────────────────────────────────
describe('FixedPoint golden vectors — mul', () => {
    it('mul(FP_ONE, FP_ONE) = 4294967296n  [identity]', () => {
        expect(mul(FP_ONE, FP_ONE)).toBe(4294967296n);
    });

    it('mul(FP_HALF, fromInt(2)) = 4294967296n  [0.5 × 2 = 1]', () => {
        expect(mul(FP_HALF, fromInt(2))).toBe(4294967296n);
    });

    it('mul(fromInt(3), fromInt(4)) = 51539607552n  [= fromInt(12)]', () => {
        expect(mul(fromInt(3), fromInt(4))).toBe(51539607552n);
    });

    it('mul(FP_PI, FP_HALF) = 6746518852n  [π × 0.5 = π/2]', () => {
        expect(mul(FP_PI, FP_HALF)).toBe(6746518852n);
    });

    it('mul(fromInt(-3), fromInt(4)) = -51539607552n  [= fromInt(-12), negative × positive]', () => {
        expect(mul(fromInt(-3), fromInt(4))).toBe(-51539607552n);
    });

    it('mul(FP_ONE, FP_PI) = 13493037705n  [1 × π = π]', () => {
        expect(mul(FP_ONE, FP_PI)).toBe(13493037705n);
    });
});

// ── div ────────────────────────────────────────────────────────────────────
describe('FixedPoint golden vectors — div', () => {
    it('div(FP_ONE, FP_ONE) = 4294967296n  [identity]', () => {
        expect(div(FP_ONE, FP_ONE)).toBe(4294967296n);
    });

    it('div(fromInt(12), fromInt(3)) = 17179869184n  [= fromInt(4)]', () => {
        expect(div(fromInt(12), fromInt(3))).toBe(17179869184n);
    });

    it('div(FP_ONE, fromInt(2)) = 2147483648n  [= FP_HALF]', () => {
        expect(div(FP_ONE, fromInt(2))).toBe(2147483648n);
    });

    it('div(FP_PI, fromInt(2)) = 6746518852n  [= FP_HALF_PI]', () => {
        expect(div(FP_PI, fromInt(2))).toBe(6746518852n);
    });

    it('div(fromInt(-6), fromInt(3)) = -8589934592n  [= fromInt(-2), negative dividend]', () => {
        expect(div(fromInt(-6), fromInt(3))).toBe(-8589934592n);
    });

    it('div(FP_TAU, FP_PI) = 8589934592n  [2π / π = 2]', () => {
        // FP_TAU = FP_PI * 2n; golden value is fromInt(2)
        expect(div(FP_PI * 2n, FP_PI)).toBe(8589934592n);
    });
});

// ── sqrt ───────────────────────────────────────────────────────────────────
describe('FixedPoint golden vectors — sqrt', () => {
    it('sqrt(FP_ZERO) = 0n', () => {
        expect(sqrt(FP_ZERO)).toBe(0n);
    });

    it('sqrt(FP_ONE) = 4294967296n  [sqrt(1) = 1]', () => {
        expect(sqrt(FP_ONE)).toBe(4294967296n);
    });

    it('sqrt(fromInt(4)) = 8589934592n  [= fromInt(2), perfect square]', () => {
        expect(sqrt(fromInt(4))).toBe(8589934592n);
    });

    it('sqrt(fromInt(9)) = 12884901888n  [= fromInt(3), perfect square]', () => {
        expect(sqrt(fromInt(9))).toBe(12884901888n);
    });

    it('sqrt(fromInt(25)) = 21474836480n  [= fromInt(5), perfect square]', () => {
        expect(sqrt(fromInt(25))).toBe(21474836480n);
    });

    it('sqrt(FP_PI) = 7612631323n  [sqrt(π), non-integer golden value]', () => {
        expect(sqrt(FP_PI)).toBe(7612631323n);
    });

    it('sqrt(FP_HALF) = 3037000499n  [sqrt(0.5) ≈ 0.7071, golden value]', () => {
        expect(sqrt(FP_HALF)).toBe(3037000499n);
    });
});

// ── sin ────────────────────────────────────────────────────────────────────
describe('FixedPoint golden vectors — sin', () => {
    it('sin(FP_ZERO) = 0n  [boundary: zero]', () => {
        expect(sin(FP_ZERO)).toBe(0n);
    });

    it('sin(FP_HALF_PI) = 4294967303n  [≈ FP_ONE, CORDIC approximation of sin(π/2)=1]', () => {
        expect(sin(FP_HALF_PI)).toBe(4294967303n);
    });

    it('sin(FP_PI) = 1n  [near-zero CORDIC residual for sin(π)≈0]', () => {
        expect(sin(FP_PI)).toBe(1n);
    });

    it('sin(-FP_HALF_PI) = -4294967303n  [negative boundary, sin(-π/2)=-1]', () => {
        expect(sin(-FP_HALF_PI)).toBe(-4294967303n);
    });

    it('sin(FP_PI / 6n) = 2147483651n  [sin(π/6) ≈ 0.5]', () => {
        expect(sin(FP_PI / 6n)).toBe(2147483651n);
    });

    it('sin(FP_PI / 4n) = 3037000496n  [sin(π/4) ≈ √2/2, positive quadrant]', () => {
        expect(sin(FP_PI / 4n)).toBe(3037000496n);
    });

    it('sin(-FP_PI / 4n) = -3037000501n  [sin(-π/4), negative quadrant — CORDIC magnitude differs by ≤7 ULP from positive]', () => {
        expect(sin(-FP_PI / 4n)).toBe(-3037000501n);
    });
});

// ── cos ────────────────────────────────────────────────────────────────────
describe('FixedPoint golden vectors — cos', () => {
    it('cos(FP_ZERO) = 4294967296n  [= FP_ONE, cos(0)=1]', () => {
        expect(cos(FP_ZERO)).toBe(4294967296n);
    });

    it('cos(FP_HALF_PI) = 1n  [near-zero CORDIC residual for cos(π/2)≈0]', () => {
        expect(cos(FP_HALF_PI)).toBe(1n);
    });

    it('cos(FP_PI) = -4294967303n  [≈ -FP_ONE, CORDIC approximation of cos(π)=-1]', () => {
        expect(cos(FP_PI)).toBe(-4294967303n);
    });

    it('cos(-FP_HALF_PI) = -3n  [near-zero CORDIC residual for cos(-π/2)≈0]', () => {
        expect(cos(-FP_HALF_PI)).toBe(-3n);
    });

    it('cos(FP_PI / 3n) = 2147483651n  [cos(π/3) ≈ 0.5]', () => {
        expect(cos(FP_PI / 3n)).toBe(2147483651n);
    });

    it('cos(FP_PI / 4n) = 3037000501n  [cos(π/4) ≈ √2/2, positive angle]', () => {
        expect(cos(FP_PI / 4n)).toBe(3037000501n);
    });

    it('cos(-FP_PI / 4n) = 3037000503n  [cos(-π/4), CORDIC magnitude differs from positive by ≤2 ULP]', () => {
        expect(cos(-FP_PI / 4n)).toBe(3037000503n);
    });
});

// ── atan2 ──────────────────────────────────────────────────────────────────
describe('FixedPoint golden vectors — atan2', () => {
    it('atan2(0n, FP_ONE) = 0n  [positive x-axis, angle=0]', () => {
        expect(atan2(0n, FP_ONE)).toBe(0n);
    });

    it('atan2(FP_ONE, 0n) = 6746518852n  [= FP_HALF_PI, positive y-axis, angle=π/2]', () => {
        expect(atan2(FP_ONE, 0n)).toBe(6746518852n);
    });

    it('atan2(FP_ONE, FP_ONE) = 3373259427n  [≈ FP_PI/4, first quadrant diagonal]', () => {
        expect(atan2(FP_ONE, FP_ONE)).toBe(3373259427n);
    });

    it('atan2(-FP_ONE, 0n) = -6746518852n  [= -FP_HALF_PI, negative y-axis]', () => {
        expect(atan2(-FP_ONE, 0n)).toBe(-6746518852n);
    });

    it('atan2(0n, -FP_ONE) = 13493037705n  [= FP_PI, negative x-axis]', () => {
        expect(atan2(0n, -FP_ONE)).toBe(13493037705n);
    });

    it('atan2(-FP_ONE, -FP_ONE) = -10119778278n  [≈ -3π/4, third quadrant]', () => {
        expect(atan2(-FP_ONE, -FP_ONE)).toBe(-10119778278n);
    });

    it('atan2(FP_ONE, -FP_ONE) = 10119778280n  [≈ 3π/4, second quadrant]', () => {
        expect(atan2(FP_ONE, -FP_ONE)).toBe(10119778280n);
    });

    it('atan2(0n, 0n) = 0n  [degenerate boundary: both zero]', () => {
        expect(atan2(0n, 0n)).toBe(0n);
    });
});

// ── fromInt → toInt round-trip ─────────────────────────────────────────────
describe('FixedPoint golden vectors — fromInt intermediate and toInt round-trip', () => {
    it('fromInt(0) = 0n', () => {
        expect(fromInt(0)).toBe(0n);
    });

    it('fromInt(1) = 4294967296n  [= 1 << 32]', () => {
        expect(fromInt(1)).toBe(4294967296n);
    });

    it('fromInt(-1) = -4294967296n', () => {
        expect(fromInt(-1)).toBe(-4294967296n);
    });

    it('fromInt(42) = 180388626432n', () => {
        expect(fromInt(42)).toBe(180388626432n);
    });

    it('fromInt(100) = 429496729600n', () => {
        expect(fromInt(100)).toBe(429496729600n);
    });

    it('toInt(fromInt(0)) = 0  [round-trip zero]', () => {
        expect(toInt(fromInt(0))).toBe(0);
    });

    it('toInt(fromInt(42)) = 42  [round-trip positive]', () => {
        expect(toInt(fromInt(42))).toBe(42);
    });

    it('toInt(fromInt(-7)) = -7  [round-trip negative]', () => {
        expect(toInt(fromInt(-7))).toBe(-7);
    });
});

// ── fromRatio → toFloat round-trip ────────────────────────────────────────
describe('FixedPoint golden vectors — fromRatio intermediate and toFloat round-trip', () => {
    it('fromRatio(1, 4) = 1073741824n', () => {
        expect(fromRatio(1, 4)).toBe(1073741824n);
    });

    it('fromRatio(3, 4) = 3221225472n', () => {
        expect(fromRatio(3, 4)).toBe(3221225472n);
    });

    it('fromRatio(1, 3) = 1431655765n  [nearest Q32.32 to 1/3]', () => {
        expect(fromRatio(1, 3)).toBe(1431655765n);
    });

    it('fromRatio(2, 3) = 2863311531n  [nearest Q32.32 to 2/3]', () => {
        expect(fromRatio(2, 3)).toBe(2863311531n);
    });

    it('fromRatio(0, 5) = 0n', () => {
        expect(fromRatio(0, 5)).toBe(0n);
    });

    it('toFloat(fromRatio(1, 4)) = 0.25  [exact quarter]', () => {
        expect(toFloat(fromRatio(1, 4))).toBe(0.25);
    });

    it('toFloat(fromRatio(3, 4)) = 0.75  [exact three-quarters]', () => {
        expect(toFloat(fromRatio(3, 4))).toBe(0.75);
    });

    it('toFloat(fromRatio(0, 5)) = 0  [zero ratio]', () => {
        expect(toFloat(fromRatio(0, 5))).toBe(0);
    });
});
