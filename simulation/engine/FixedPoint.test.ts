import { describe, expect, it } from 'vitest';
import {
    type FixedPoint,
    FP_ZERO,
    FP_ONE,
    FP_HALF,
    FP_PI,
    FP_TAU,
    fromInt,
    fromRatio,
    fromFloat,
    toFloat,
    toInt,
} from './FixedPoint.js';

describe('FixedPoint', () => {
    describe('constants', () => {
        it('FP_ZERO equals 0n', () => {
            expect(FP_ZERO).toBe(0n);
        });

        it('FP_ONE equals 1 << 32', () => {
            expect(FP_ONE).toBe(1n << 32n);
        });

        it('FP_HALF equals FP_ONE / 2', () => {
            expect(FP_HALF).toBe(FP_ONE / 2n);
        });

        it('FP_PI approximates π', () => {
            const piFloat = toFloat(FP_PI);
            expect(piFloat).toBeCloseTo(Math.PI, 5);
        });

        it('FP_TAU approximates 2π', () => {
            const tauFloat = toFloat(FP_TAU);
            expect(tauFloat).toBeCloseTo(2 * Math.PI, 5);
        });

        it('FP_TAU equals 2 * FP_PI', () => {
            expect(FP_TAU).toBe(FP_PI * 2n);
        });
    });

    describe('fromInt / toInt round-trip', () => {
        it.each([0, 1, -1, 42, -42, 100, -100, 2147483647, -2147483648])(
            'toInt(fromInt(%i)) === %i',
            (n) => {
                expect(toInt(fromInt(n))).toBe(n);
            },
        );

        it('fromInt shifts left by 32 bits', () => {
            expect(fromInt(1)).toBe(1n << 32n);
            expect(fromInt(5)).toBe(5n << 32n);
        });
    });

    describe('fromRatio', () => {
        it('fromRatio(1, 2) equals FP_HALF', () => {
            expect(fromRatio(1, 2)).toBe(FP_HALF);
        });

        it('fromRatio(1, 1) equals FP_ONE', () => {
            expect(fromRatio(1, 1)).toBe(FP_ONE);
        });

        it('fromRatio(0, 5) equals FP_ZERO', () => {
            expect(fromRatio(0, 5)).toBe(FP_ZERO);
        });

        it('fromRatio(3, 4) is correct', () => {
            const threeQuarters = fromRatio(3, 4);
            expect(toFloat(threeQuarters)).toBeCloseTo(0.75, 5);
        });

        it('fromRatio(1, 3) approximates 1/3', () => {
            const third = fromRatio(1, 3);
            expect(toFloat(third)).toBeCloseTo(1 / 3, 5);
        });
    });

    describe('fromFloat', () => {
        it('fromFloat(0) equals FP_ZERO', () => {
            expect(fromFloat(0)).toBe(FP_ZERO);
        });

        it('fromFloat(1) equals FP_ONE', () => {
            expect(fromFloat(1)).toBe(FP_ONE);
        });

        it('fromFloat(0.5) equals FP_HALF', () => {
            expect(fromFloat(0.5)).toBe(FP_HALF);
        });

        it('fromFloat(-1) equals -FP_ONE', () => {
            expect(fromFloat(-1)).toBe(-FP_ONE);
        });

        it('fromFloat preserves value approximately via toFloat round-trip', () => {
            const values = [0.1, 0.25, 0.333, 1.5, -2.75, 100.125];
            for (const v of values) {
                expect(toFloat(fromFloat(v))).toBeCloseTo(v, 5);
            }
        });
    });

    describe('toFloat', () => {
        it('converts FP_ZERO to 0', () => {
            expect(toFloat(FP_ZERO)).toBe(0);
        });

        it('converts FP_ONE to 1', () => {
            expect(toFloat(FP_ONE)).toBe(1);
        });

        it('converts FP_HALF to 0.5', () => {
            expect(toFloat(FP_HALF)).toBe(0.5);
        });

        it('converts negative values correctly', () => {
            expect(toFloat(fromInt(-5))).toBe(-5);
        });
    });

    describe('toInt', () => {
        it('truncates fractional part (floor toward -∞ via >>)', () => {
            expect(toInt(FP_HALF)).toBe(0);
            expect(toInt(fromFloat(1.9))).toBe(1);
            // BigInt >> floors toward -∞, so -1.9 → -2
            expect(toInt(fromFloat(-1.9))).toBe(-2);
        });
    });

    describe('type safety', () => {
        it('FixedPoint values are bigints', () => {
            const fp: FixedPoint = fromInt(42);
            expect(typeof fp).toBe('bigint');
        });
    });
});
