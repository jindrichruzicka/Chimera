/**
 * simulation/engine/DeterministicRng.ts
 *
 * `DeterministicRng` — pure, seeded PRNG producing bit-identical sequences
 * across all platforms for a given (seed, tick) input pair.
 *
 * Algorithm: splitmix64 for state initialisation, xoshiro256** for generation.
 *
 * Architecture reference: §4.2.1 — Rule 2 (Seeded RNG Only)
 * Task: F04 / T1 (issue #41)
 *
 * Invariants upheld:
 *   #43 — This module is the ONLY approved source of randomness inside
 *          simulation/. Math.random() is blocked by no-restricted-globals.
 *   Rule 2 — same (seed, tick) always produces the same draw sequence.
 */

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Pure, seeded PRNG. All methods are side-effect-free with respect to external
 * state. Successive calls advance the internal state deterministically.
 */
export interface DeterministicRng {
    /** 53-bit float in [0, 1). Never returns exactly 1.0. */
    float(): number;
    /** Integer in [min, max] inclusive. No modulo bias. */
    int(min: number, max: number): number;
    /**
     * Fisher-Yates shuffle. Returns a NEW array; input is not mutated.
     * All N! orderings are reachable given a sufficiently varied seed.
     */
    shuffle<T>(items: readonly T[]): T[];
    /** Uniform pick from the array. Callers must ensure the array is non-empty. */
    pick<T>(items: readonly T[]): T;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MASK64 = 0xffff_ffff_ffff_ffffn;

// ─── splitmix64 ───────────────────────────────────────────────────────────────

/**
 * Advance a splitmix64 state by one step and return the mixed output.
 * Used exclusively during xoshiro256** state initialisation to convert the
 * 32-bit (seed, tick) pair into four 64-bit words.
 */
function splitmix64(s: bigint): [bigint, bigint] {
    s = (s + 0x9e37_79b9_7f4a_7c15n) & MASK64;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK64;
    z = z ^ (z >> 31n);
    return [s, z];
}

// ─── xoshiro256** helpers ─────────────────────────────────────────────────────

function rotl(x: bigint, k: bigint): bigint {
    return ((x << k) | (x >> (64n - k))) & MASK64;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Construct a `DeterministicRng` seeded from the canonical `(seed, tick)` pair.
 *
 * The 32-bit `seed` and `tick` values are combined into a single 64-bit splitmix64
 * seed by placing `seed` in the high 32 bits and `tick` in the low 32 bits.
 * Four successive splitmix64 steps produce the four 64-bit xoshiro256** state words.
 *
 * @param seed - Base RNG seed from `BaseGameSnapshot.seed` (32-bit integer).
 * @param tick - Logical simulation tick from `BaseGameSnapshot.tick` (32-bit integer).
 */
export function createRng(seed: number, tick: number): DeterministicRng {
    // Combine seed (high) and tick (low) into a 64-bit splitmix64 starting value.
    let smState = ((BigInt(seed >>> 0) << 32n) | BigInt(tick >>> 0)) & MASK64;

    // Initialise four 64-bit xoshiro256** state words via splitmix64.
    let s0: bigint, s1: bigint, s2: bigint, s3: bigint;
    let out: bigint;
    [smState, out] = splitmix64(smState);
    s0 = out;
    [smState, out] = splitmix64(smState);
    s1 = out;
    [smState, out] = splitmix64(smState);
    s2 = out;
    [, out] = splitmix64(smState);
    s3 = out;

    /** xoshiro256** next() — advances state and returns the raw 64-bit output. */
    function next(): bigint {
        const result = (rotl((s1 * 5n) & MASK64, 7n) * 9n) & MASK64;
        const t = (s1 << 17n) & MASK64;
        s2 ^= s0;
        s3 ^= s1;
        s1 ^= s2;
        s0 ^= s3;
        s2 ^= t;
        s3 = rotl(s3, 45n);
        return result;
    }

    function float(): number {
        // Extract the top 53 bits for a 53-bit IEEE 754 mantissa in [0, 1).
        return Number(next() >> 11n) / 0x20_0000_0000_0000;
    }

    function int(min: number, max: number): number {
        // Math.floor is the approved stdlib function — only Math.random is forbidden.
        // eslint-disable-next-line no-restricted-globals
        return Math.floor(float() * (max - min + 1)) + min;
    }

    function shuffle<T>(items: readonly T[]): T[] {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i--) {
            const j = int(0, i);
            // Swap result[i] and result[j].
            const tmp = result[i] as T;
            result[i] = result[j] as T;
            result[j] = tmp;
        }
        return result;
    }

    function pick<T>(items: readonly T[]): T {
        if (items.length === 0) {
            throw new RangeError('DeterministicRng.pick(): items array must be non-empty.');
        }
        return items[int(0, items.length - 1)] as T;
    }

    return { float, int, shuffle, pick };
}
