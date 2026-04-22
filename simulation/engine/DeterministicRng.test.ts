/**
 * simulation/engine/DeterministicRng.test.ts
 *
 * Unit tests for `DeterministicRng` and `createRng`.
 *
 * Architecture reference: §4.2.1 — Rule 2 (Seeded RNG Only)
 * Task: F04 / T1 (issue #41) and T4 (issue #44)
 *
 * Invariants upheld:
 *   #43 — No Math.random() or Date.now() inside simulation/; tests confirm
 *          the module is the sole approved RNG source.
 *   Rule 2 — same (seed, tick) always produces the same draw sequence.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from './DeterministicRng.js';

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('DeterministicRng determinism', () => {
    it('produces identical float() sequences for the same (seed, tick)', () => {
        const rng1 = createRng(42, 0);
        const rng2 = createRng(42, 0);
        for (let i = 0; i < 10_000; i++) {
            expect(rng1.float()).toBe(rng2.float());
        }
    });

    it('produces different sequences for different seeds', () => {
        const rng1 = createRng(1, 0);
        const rng2 = createRng(2, 0);
        const draws1 = Array.from({ length: 20 }, () => rng1.float());
        const draws2 = Array.from({ length: 20 }, () => rng2.float());
        expect(draws1).not.toEqual(draws2);
    });

    it('tick participates in seeding: createRng(seed, 0) diverges from createRng(seed, 1)', () => {
        const rng0 = createRng(99, 0);
        const rng1 = createRng(99, 1);
        const draws0 = Array.from({ length: 5 }, () => rng0.float());
        const draws1 = Array.from({ length: 5 }, () => rng1.float());
        expect(draws0).not.toEqual(draws1);
    });
});

// ─── float() ─────────────────────────────────────────────────────────────────

describe('DeterministicRng float()', () => {
    it('always returns a value in [0, 1) across 10 000 calls', () => {
        const rng = createRng(7, 3);
        for (let i = 0; i < 10_000; i++) {
            const v = rng.float();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('never returns exactly 1.0', () => {
        const rng = createRng(0, 0);
        for (let i = 0; i < 10_000; i++) {
            expect(rng.float()).not.toBe(1.0);
        }
    });
});

// ─── int(min, max) ────────────────────────────────────────────────────────────

describe('DeterministicRng int(min, max)', () => {
    it('always returns a value in [min, max] inclusive across 10 000 calls', () => {
        const rng = createRng(13, 5);
        for (let i = 0; i < 10_000; i++) {
            const v = rng.int(3, 17);
            expect(v).toBeGreaterThanOrEqual(3);
            expect(v).toBeLessThanOrEqual(17);
        }
    });

    it('single-element range always returns that element', () => {
        const rng = createRng(0, 0);
        for (let i = 0; i < 100; i++) {
            expect(rng.int(5, 5)).toBe(5);
        }
    });

    it('works for negative ranges', () => {
        const rng = createRng(4, 1);
        for (let i = 0; i < 10_000; i++) {
            const v = rng.int(-10, -1);
            expect(v).toBeGreaterThanOrEqual(-10);
            expect(v).toBeLessThanOrEqual(-1);
        }
    });
});

// ─── Fisher-Yates shuffle ─────────────────────────────────────────────────────

describe('DeterministicRng shuffle()', () => {
    it('returns a new array (not the same reference)', () => {
        const rng = createRng(0, 0);
        const input = [1, 2, 3];
        const result = rng.shuffle(input);
        expect(result).not.toBe(input);
    });

    it('does not mutate the input array', () => {
        const rng = createRng(0, 0);
        const input = [1, 2, 3, 4, 5];
        const copy = [...input];
        rng.shuffle(input);
        expect(input).toEqual(copy);
    });

    it('returns an array with the same elements', () => {
        const rng = createRng(0, 0);
        const input = [10, 20, 30, 40];
        const result = rng.shuffle(input);
        expect(result.slice().sort()).toEqual(input.slice().sort());
    });

    it('handles an empty array without error', () => {
        const rng = createRng(0, 0);
        expect(rng.shuffle([])).toEqual([]);
    });

    it('handles a single-element array', () => {
        const rng = createRng(0, 0);
        expect(rng.shuffle([42])).toEqual([42]);
    });

    it('all 6 permutations of a 3-element array appear across 10 000 shuffles', () => {
        const rng = createRng(0, 0);
        const seen = new Set<string>();
        for (let i = 0; i < 10_000; i++) {
            seen.add(rng.shuffle([1, 2, 3]).join(','));
        }
        expect(seen.size).toBe(6);
    });
});

// ─── pick ─────────────────────────────────────────────────────────────────────

describe('DeterministicRng pick()', () => {
    it('always returns an element that exists in the input array', () => {
        const rng = createRng(0, 0);
        const items = ['a', 'b', 'c', 'd'] as const;
        for (let i = 0; i < 10_000; i++) {
            expect(items).toContain(rng.pick(items));
        }
    });

    it('uniformity: each of 4 elements is within ±0.5% of 25% frequency over 1 000 000 draws', () => {
        const rng = createRng(0, 0);
        const items = [0, 1, 2, 3] as const;
        const counts = [0, 0, 0, 0];
        const N = 1_000_000;
        for (let i = 0; i < N; i++) {
            counts[rng.pick(items)]!++;
        }
        for (const count of counts) {
            const freq = count / N;
            expect(freq).toBeGreaterThanOrEqual(0.245);
            expect(freq).toBeLessThanOrEqual(0.255);
        }
    });
});
