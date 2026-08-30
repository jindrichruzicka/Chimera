/**
 * renderer/assets/__tests__/sheet-reader-purity.test.ts
 *
 * The two sheet readers are pure: bundled alone, each is ONE input with ZERO
 * externals.
 *
 * **Why zero and not a denylist.** `animationSheet.ts` and `spriteAtlas.ts` are
 * the renderer's readers of an opaque, game-authored value, and the whole reason
 * they are separate modules is that anything reachable from them is reachable
 * from a caller that only wanted to read a sheet. A denylist would need a new row
 * for each runtime someone might drag in; an empty set needs none, and reports
 * the first one on the day it lands.
 *
 * The claim covers BOTH channels — the resolved inputs and the unresolved
 * specifiers — because a type-only import that esbuild's TypeScript loader
 * elides reaches no input while its specifier still survives as an external.
 * Reading only the inputs would call a module pure that names `three` on every
 * line. See `assetsGraph.ts`.
 *
 * The last case is the control: the same analyzer over `AssetManager.ts`, a
 * sibling that really does import `three` at runtime, so a green pair above is
 * a measurement rather than an analyzer that reports nothing about anything.
 */

import { describe, expect, it } from 'vitest';

import { analyzeModule, importsRuntime } from './assetsGraph.js';

const PURE_MODULES = ['animationSheet.ts', 'spriteAtlas.ts'] as const;

describe('the sheet readers bundle to themselves alone', () => {
    it.each(PURE_MODULES)('%s resolves exactly one input', async (moduleFile) => {
        const { inputs } = await analyzeModule(moduleFile);

        expect(inputs.map((input) => input.split('/').slice(-2).join('/'))).toEqual([
            `assets/${moduleFile}`,
        ]);
    });

    it.each(PURE_MODULES)('%s records no external specifier at all', async (moduleFile) => {
        const { externals } = await analyzeModule(moduleFile);

        // `Texture` and the sheet types are imported `import type`, so neither
        // reaches an input NOR leaves a specifier behind. A VALUE import of
        // `three` would leave one even unused — which is the shape the control
        // below measures, in the dynamic form `AssetManager.ts` uses.
        expect([...externals]).toEqual([]);
    });
});

describe('the purity claim is a measurement', () => {
    it('reports the runtime three import a sibling module really has', async () => {
        // The control. `AssetManager.ts` reaches `three` at runtime for its
        // default loader registry — through `await import` inside `loadTexture`,
        // which is a specifier the analyzer records all the same. If it could
        // not see that, the two empty sets above would mean nothing.
        const { inputs, externals } = await analyzeModule('AssetManager.ts');

        expect(importsRuntime(externals, 'three')).toBe(true);
        expect(inputs.length).toBeGreaterThan(1);
    });
});
