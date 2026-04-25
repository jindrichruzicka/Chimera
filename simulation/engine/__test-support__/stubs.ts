/**
 * simulation/engine/__test-support__/stubs.ts
 *
 * Test-only stubs for simulation engine types.
 * NEVER import this file from production code.
 */
import type { DeterministicRng } from '../DeterministicRng.js';

/**
 * Creates a minimal `DeterministicRng` stub for use in unit tests.
 * All methods use the provided `floatValue` (default 0.5) for `float()`,
 * which means `int(min, max)` returns `min + Math.floor(0.5 * (max - min + 1))`.
 *
 * Use `createRng` from `DeterministicRng.ts` in tests that need real sequences.
 */
export function makeStubRng(floatValue = 0.5): DeterministicRng {
    return {
        float: () => floatValue,
        // Math.floor is the approved stdlib function — only Math.random is forbidden.
        int: (min, max) => Math.floor(floatValue * (max - min + 1)) + min,
        shuffle: <T>(items: readonly T[]) => [...items],
        pick: <T>(items: readonly T[]) => items[Math.floor(floatValue * items.length)] as T,
    };
}
