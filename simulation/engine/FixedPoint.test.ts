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
    add,
    sub,
    mul,
    div,
    neg,
    abs,
    lt,
    gt,
    eq,
    sqrt,
    sin,
    cos,
    atan2,
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

    describe('add', () => {
        it('add(FP_ZERO, FP_ZERO) === FP_ZERO', () => {
            expect(add(FP_ZERO, FP_ZERO)).toBe(FP_ZERO);
        });

        it('add(FP_ONE, FP_ONE) === fromInt(2)', () => {
            expect(add(FP_ONE, FP_ONE)).toBe(fromInt(2));
        });

        it('add(FP_ONE, FP_ZERO) === FP_ONE', () => {
            expect(add(FP_ONE, FP_ZERO)).toBe(FP_ONE);
        });

        it('add(positive, negative) cancels out', () => {
            expect(add(fromInt(5), fromInt(-5))).toBe(FP_ZERO);
        });

        it('add(negative, negative) produces negative sum', () => {
            expect(add(fromInt(-3), fromInt(-4))).toBe(fromInt(-7));
        });

        it('add(FP_HALF, FP_HALF) === FP_ONE', () => {
            expect(add(FP_HALF, FP_HALF)).toBe(FP_ONE);
        });
    });

    describe('sub', () => {
        it('sub(FP_ZERO, FP_ZERO) === FP_ZERO', () => {
            expect(sub(FP_ZERO, FP_ZERO)).toBe(FP_ZERO);
        });

        it('sub(FP_ONE, FP_ONE) === FP_ZERO', () => {
            expect(sub(FP_ONE, FP_ONE)).toBe(FP_ZERO);
        });

        it('sub(fromInt(5), fromInt(3)) === fromInt(2)', () => {
            expect(sub(fromInt(5), fromInt(3))).toBe(fromInt(2));
        });

        it('sub(FP_ZERO, FP_ONE) === fromInt(-1)', () => {
            expect(sub(FP_ZERO, FP_ONE)).toBe(fromInt(-1));
        });

        it('sub(negative, negative)', () => {
            expect(sub(fromInt(-3), fromInt(-7))).toBe(fromInt(4));
        });
    });

    describe('mul', () => {
        it('mul(FP_ONE, x) === x for positive x', () => {
            const x = fromInt(7);
            expect(mul(FP_ONE, x)).toBe(x);
        });

        it('mul(FP_ONE, x) === x for negative x', () => {
            const x = fromInt(-7);
            expect(mul(FP_ONE, x)).toBe(x);
        });

        it('mul(FP_ONE, FP_ZERO) === FP_ZERO', () => {
            expect(mul(FP_ONE, FP_ZERO)).toBe(FP_ZERO);
        });

        it('mul(FP_HALF, FP_ONE) === FP_HALF', () => {
            expect(mul(FP_HALF, FP_ONE)).toBe(FP_HALF);
        });

        it('mul(FP_HALF, fromInt(2)) === FP_ONE', () => {
            expect(mul(FP_HALF, fromInt(2))).toBe(FP_ONE);
        });

        it('mul(fromInt(3), fromInt(4)) === fromInt(12)', () => {
            expect(mul(fromInt(3), fromInt(4))).toBe(fromInt(12));
        });

        it('mul(negative, positive) produces negative', () => {
            expect(mul(fromInt(-3), fromInt(4))).toBe(fromInt(-12));
        });

        it('mul(negative, negative) produces positive', () => {
            expect(mul(fromInt(-3), fromInt(-4))).toBe(fromInt(12));
        });
    });

    describe('div', () => {
        it('div(x, FP_ONE) === x for positive x', () => {
            const x = fromInt(7);
            expect(div(x, FP_ONE)).toBe(x);
        });

        it('div(x, FP_ONE) === x for negative x', () => {
            const x = fromInt(-7);
            expect(div(x, FP_ONE)).toBe(x);
        });

        it('div(FP_ZERO, FP_ONE) === FP_ZERO', () => {
            expect(div(FP_ZERO, FP_ONE)).toBe(FP_ZERO);
        });

        it('div(fromInt(12), fromInt(3)) === fromInt(4)', () => {
            expect(div(fromInt(12), fromInt(3))).toBe(fromInt(4));
        });

        it('div(FP_ONE, fromInt(2)) === FP_HALF', () => {
            expect(div(FP_ONE, fromInt(2))).toBe(FP_HALF);
        });

        it('div by zero throws RangeError', () => {
            expect(() => div(FP_ONE, FP_ZERO)).toThrowError(
                new RangeError('FixedPoint: division by zero'),
            );
        });

        it('div(negative, positive) produces negative', () => {
            expect(div(fromInt(-12), fromInt(3))).toBe(fromInt(-4));
        });
    });

    describe('neg', () => {
        it('neg(FP_ZERO) === FP_ZERO', () => {
            expect(neg(FP_ZERO)).toBe(FP_ZERO);
        });

        it('neg(FP_ONE) === fromInt(-1)', () => {
            expect(neg(FP_ONE)).toBe(fromInt(-1));
        });

        it('neg(fromInt(-5)) === fromInt(5)', () => {
            expect(neg(fromInt(-5))).toBe(fromInt(5));
        });

        it('neg(neg(x)) === x', () => {
            const x = fromInt(42);
            expect(neg(neg(x))).toBe(x);
        });
    });

    describe('abs', () => {
        it('abs(FP_ZERO) === FP_ZERO', () => {
            expect(abs(FP_ZERO)).toBe(FP_ZERO);
        });

        it('abs(FP_ONE) === FP_ONE', () => {
            expect(abs(FP_ONE)).toBe(FP_ONE);
        });

        it('abs(fromInt(-5)) === fromInt(5)', () => {
            expect(abs(fromInt(-5))).toBe(fromInt(5));
        });

        it('abs(fromInt(5)) === fromInt(5)', () => {
            expect(abs(fromInt(5))).toBe(fromInt(5));
        });
    });

    describe('lt', () => {
        it('lt(FP_ZERO, FP_ONE) is true', () => {
            expect(lt(FP_ZERO, FP_ONE)).toBe(true);
        });

        it('lt(FP_ONE, FP_ZERO) is false', () => {
            expect(lt(FP_ONE, FP_ZERO)).toBe(false);
        });

        it('lt(FP_ONE, FP_ONE) is false', () => {
            expect(lt(FP_ONE, FP_ONE)).toBe(false);
        });

        it('lt(fromInt(-1), FP_ZERO) is true', () => {
            expect(lt(fromInt(-1), FP_ZERO)).toBe(true);
        });
    });

    describe('gt', () => {
        it('gt(FP_ONE, FP_ZERO) is true', () => {
            expect(gt(FP_ONE, FP_ZERO)).toBe(true);
        });

        it('gt(FP_ZERO, FP_ONE) is false', () => {
            expect(gt(FP_ZERO, FP_ONE)).toBe(false);
        });

        it('gt(FP_ONE, FP_ONE) is false', () => {
            expect(gt(FP_ONE, FP_ONE)).toBe(false);
        });

        it('gt(FP_ZERO, fromInt(-1)) is true', () => {
            expect(gt(FP_ZERO, fromInt(-1))).toBe(true);
        });
    });

    describe('eq', () => {
        it('eq(FP_ZERO, FP_ZERO) is true', () => {
            expect(eq(FP_ZERO, FP_ZERO)).toBe(true);
        });

        it('eq(FP_ONE, FP_ONE) is true', () => {
            expect(eq(FP_ONE, FP_ONE)).toBe(true);
        });

        it('eq(FP_ZERO, FP_ONE) is false', () => {
            expect(eq(FP_ZERO, FP_ONE)).toBe(false);
        });

        it('eq(fromInt(-5), fromInt(-5)) is true', () => {
            expect(eq(fromInt(-5), fromInt(-5))).toBe(true);
        });

        it('eq(fromInt(-5), fromInt(5)) is false', () => {
            expect(eq(fromInt(-5), fromInt(5))).toBe(false);
        });
    });

    describe('sqrt', () => {
        it('sqrt(FP_ONE) === FP_ONE', () => {
            expect(sqrt(FP_ONE)).toBe(FP_ONE);
        });

        it('sqrt(FP_ZERO) === FP_ZERO', () => {
            expect(sqrt(FP_ZERO)).toBe(FP_ZERO);
        });

        it('sqrt(fromInt(4)) === fromInt(2)', () => {
            const result = sqrt(fromInt(4));
            expect(toFloat(result)).toBeCloseTo(2, 4);
        });

        it('sqrt(fromInt(9)) === fromInt(3)', () => {
            const result = sqrt(fromInt(9));
            expect(toFloat(result)).toBeCloseTo(3, 4);
        });

        it('sqrt(fromInt(2)) approximates √2', () => {
            const result = sqrt(fromInt(2));
            expect(toFloat(result)).toBeCloseTo(Math.sqrt(2), 4);
        });

        it('sqrt(FP_HALF) approximates √0.5', () => {
            const result = sqrt(FP_HALF);
            expect(toFloat(result)).toBeCloseTo(Math.sqrt(0.5), 4);
        });

        it('sqrt throws RangeError for negative input', () => {
            expect(() => sqrt(fromInt(-1))).toThrowError(RangeError);
        });

        it('sqrt throws RangeError for -FP_ONE', () => {
            expect(() => sqrt(-FP_ONE)).toThrowError('FixedPoint: sqrt of negative number');
        });
    });

    describe('sin', () => {
        it('sin(FP_ZERO) === FP_ZERO', () => {
            expect(sin(FP_ZERO)).toBe(FP_ZERO);
        });

        it('sin(FP_PI) approximates 0', () => {
            const result = sin(FP_PI);
            expect(toFloat(result)).toBeCloseTo(0, 3);
        });

        it('sin(FP_PI / 2) approximates 1', () => {
            const halfPi = FP_PI / 2n;
            const result = sin(halfPi);
            expect(toFloat(result)).toBeCloseTo(1, 3);
        });

        it('sin(FP_PI / 6) approximates 0.5', () => {
            const sixthPi = FP_PI / 6n;
            const result = sin(sixthPi);
            expect(toFloat(result)).toBeCloseTo(0.5, 3);
        });

        it('sin(-FP_PI / 2) approximates -1', () => {
            const negHalfPi = -(FP_PI / 2n);
            const result = sin(negHalfPi);
            expect(toFloat(result)).toBeCloseTo(-1, 3);
        });

        it('sin(-3*FP_PI/4) approximates -√2/2 (regression: lower-half symmetry)', () => {
            const negThreeQuarterPi = -(FP_PI * 3n) / 4n;
            const result = sin(negThreeQuarterPi);
            expect(toFloat(result)).toBeCloseTo(-Math.sqrt(2) / 2, 3);
        });

        it('sin(-2*FP_PI/3) approximates -√3/2', () => {
            const neg2ThirdsPi = -(FP_PI * 2n) / 3n;
            const result = sin(neg2ThirdsPi);
            expect(toFloat(result)).toBeCloseTo(-Math.sqrt(3) / 2, 3);
        });
    });

    describe('cos', () => {
        it('cos(FP_ZERO) === FP_ONE', () => {
            expect(cos(FP_ZERO)).toBe(FP_ONE);
        });

        it('cos(FP_PI) approximates -1', () => {
            const result = cos(FP_PI);
            expect(toFloat(result)).toBeCloseTo(-1, 3);
        });

        it('cos(FP_PI / 2) approximates 0', () => {
            const halfPi = FP_PI / 2n;
            const result = cos(halfPi);
            expect(toFloat(result)).toBeCloseTo(0, 3);
        });

        it('cos(FP_PI / 3) approximates 0.5', () => {
            const thirdPi = FP_PI / 3n;
            const result = cos(thirdPi);
            expect(toFloat(result)).toBeCloseTo(0.5, 3);
        });

        it('sin^2 + cos^2 === 1 for various angles', () => {
            const angles = [FP_ZERO, FP_PI / 6n, FP_PI / 4n, FP_PI / 3n, FP_PI / 2n, FP_PI];
            for (const a of angles) {
                const s = toFloat(sin(a));
                const c = toFloat(cos(a));
                expect(s * s + c * c).toBeCloseTo(1, 3);
            }
        });
    });

    describe('atan2', () => {
        it('atan2(FP_ZERO, FP_ZERO) === FP_ZERO', () => {
            expect(atan2(FP_ZERO, FP_ZERO)).toBe(FP_ZERO);
        });

        it('atan2(FP_ZERO, FP_ONE) === FP_ZERO', () => {
            expect(atan2(FP_ZERO, FP_ONE)).toBe(FP_ZERO);
        });

        it('atan2(FP_ONE, FP_ONE) approximates π/4', () => {
            const result = atan2(FP_ONE, FP_ONE);
            expect(toFloat(result)).toBeCloseTo(Math.PI / 4, 3);
        });

        it('atan2(FP_ONE, FP_ZERO) approximates π/2', () => {
            const result = atan2(FP_ONE, FP_ZERO);
            expect(toFloat(result)).toBeCloseTo(Math.PI / 2, 3);
        });

        it('atan2(FP_ZERO, -FP_ONE) approximates π', () => {
            const result = atan2(FP_ZERO, -FP_ONE);
            expect(toFloat(result)).toBeCloseTo(Math.PI, 3);
        });

        it('atan2(-FP_ONE, FP_ZERO) approximates -π/2', () => {
            const result = atan2(-FP_ONE, FP_ZERO);
            expect(toFloat(result)).toBeCloseTo(-Math.PI / 2, 3);
        });

        it('atan2(-FP_ONE, -FP_ONE) approximates -3π/4', () => {
            const result = atan2(-FP_ONE, -FP_ONE);
            expect(toFloat(result)).toBeCloseTo((-3 * Math.PI) / 4, 3);
        });
    });
});
