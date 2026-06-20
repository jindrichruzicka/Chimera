/**
 * ai/__tests__/contract-barrel-side-effects.test.ts
 *
 * Asserts the `@chimera/ai` public root barrel is SIDE-EFFECT-FREE (issue #764,
 * AC: "Importing the barrel/`./engine` subpath is side-effect-free"): importing
 * `@chimera/ai` (the root `.` entry) must evaluate NO AI runtime module.
 *
 * The root barrel re-exports the agent-framework *contract types* only
 * (`export type { … }`), so after TypeScript type-stripping and tree-shaking it
 * compiles to an empty module. If a runtime export (a class such as `AIBrain`
 * or `AgentManager`) ever crept into the root barrel, the bundle would be
 * non-empty and this test would fail — catching the regression that would
 * otherwise let a contract import pull the AI runtime graph. Runtime APIs are
 * reached through the `@chimera/ai/engine` subpath, which is intentionally NOT
 * asserted side-effect-free.
 *
 * Mirrors `simulation/__tests__/contract-barrel-side-effects.test.ts` (F58,
 * issue #759). Uses esbuild (already a devDependency) to bundle the barrel with
 * tree-shaking and asserts the emitted code, stripped of comments and
 * whitespace, is empty.
 */

import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const aiDir = resolve(__dirname, '..');

/**
 * Bundle a barrel entry with esbuild (bundle + tree-shake) and return its
 * emitted JavaScript with comments and whitespace removed. A side-effect-free,
 * type-only barrel erases to the empty string.
 */
async function bundleAndStrip(entryRelativeToAi: string): Promise<string> {
    const result = await build({
        entryPoints: [resolve(aiDir, entryRelativeToAi)],
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

describe('@chimera/ai contract barrel is side-effect-free (issue #764)', () => {
    it('@chimera/ai root barrel (.) evaluates no AI runtime module', async () => {
        expect(await bundleAndStrip('index.ts')).toBe('');
    });
});
