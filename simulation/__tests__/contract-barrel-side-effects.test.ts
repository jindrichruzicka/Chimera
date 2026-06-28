/**
 * simulation/__tests__/contract-barrel-side-effects.test.ts
 *
 * Asserts the public contract barrels are SIDE-EFFECT-FREE (issue #759, AC #2):
 * importing `@chimera-engine/simulation` (the root `.` entry) or
 * `@chimera-engine/simulation/contracts` must evaluate NO simulation runtime module.
 *
 * Both barrels re-export contract *types* only (`export type *`), so after
 * TypeScript type-stripping and tree-shaking they compile to an empty module.
 * If a runtime export ever crept into the barrel — or into a foundation module
 * it re-exports through a value binding — the bundle would be non-empty and this
 * test would fail, catching the regression that would otherwise let a contract
 * import pull the engine runtime graph (violating Invariant #1 from the consumer
 * side).
 *
 * Uses esbuild (already a devDependency) to bundle each barrel with tree-shaking
 * and asserts the emitted code, stripped of comments and whitespace, is empty.
 */

import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const simulationDir = resolve(__dirname, '..');

/**
 * Bundle a barrel entry with esbuild (bundle + tree-shake) and return its
 * emitted JavaScript with comments and whitespace removed. A side-effect-free,
 * type-only barrel erases to the empty string.
 */
async function bundleAndStrip(entryRelativeToSimulation: string): Promise<string> {
    const result = await build({
        entryPoints: [resolve(simulationDir, entryRelativeToSimulation)],
        bundle: true,
        treeShaking: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        logLevel: 'silent',
    });
    const code = result.outputFiles[0]?.text ?? '';
    return code
        .replace(/\/\/[^\n]*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, '');
}

describe('contract barrels are side-effect-free (Invariant #1, issue #759)', () => {
    it('@chimera-engine/simulation/contracts evaluates no runtime module', async () => {
        expect(await bundleAndStrip('contracts/index.ts')).toBe('');
    });

    it('@chimera-engine/simulation root barrel (.) evaluates no runtime module', async () => {
        expect(await bundleAndStrip('index.ts')).toBe('');
    });
});
