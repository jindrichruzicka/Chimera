/**
 * renderer/input/__tests__/input-barrel-side-effects.test.ts
 *
 * Holds the claims `renderer/input/index.ts` makes about itself.
 *
 * **What it drags in.** The barrel's header says importing it mounts nothing,
 * starts no listener, and constructs no store. What this test measures is the
 * import GRAPH, not what evaluating it does: a side effect added inside a
 * module already in the set would change no edge and pass here. One edge the
 * graph claim is load-bearing for: `KeyBindingRepository.ts` imports
 * `state/settingsStore`, whose module-level singleton is eager, so exporting the
 * repository would make importing this barrel construct that store — which is
 * what makes `audio`'s weaker claim weaker. The repository is not exported.
 *
 * **The exported surface.** `package-exports-contract.test.ts` pins the
 * package's `exports` MAP, never what the barrel behind it exports. So the
 * runtime names are pinned as a closed set below, and the whole re-export list —
 * types included, which leave no runtime trace — by reading the barrel source
 * through `parseBarrelExports`. `BarrelTypeSurface` holds the types a second
 * way, against removal, by making `tsc` name them.
 *
 * **The client boundary.** Every module shipping React surface (the hook, the
 * context hook, the provider) must carry `'use client'` on line 1 so a Next
 * consumer can import the barrel from a client tree.
 *
 * Mechanism mirrors `renderer/assets/__tests__/assets-barrel-side-effects.test.ts`:
 * esbuild bundles the barrel with tree-shaking, and the test asserts over the
 * resolved inputs and external specifiers.
 */

import { describe, it, expect } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as inputBarrel from '../index';
import type {
    InputAction,
    InputActionId,
    InputEvent,
    InputManager,
    InputManagerProviderProps,
} from '../index';

/**
 * The barrel's TYPE surface, held by naming every member of it. Types leave no
 * runtime trace, so the symbol-set assertion below cannot see them; naming each
 * here makes `pnpm typecheck` the gate that catches a removal.
 */
interface BarrelTypeSurface {
    readonly action: InputAction;
    readonly actionId: InputActionId;
    readonly event: InputEvent;
    readonly manager: InputManager;
    readonly providerProps: InputManagerProviderProps;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Marks every bare specifier external so the bundle holds only in-repo source. */
const externalizeBareImports: Plugin = {
    name: 'externalize-bare-imports',
    setup(b) {
        // esbuild filters are Go RE2 regexes — the JS `u` flag is rejected.
        b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
        b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, external: true }));
    },
};

async function analyzeBarrel(
    entryAbsPath: string,
): Promise<{ readonly inputs: readonly string[]; readonly externals: ReadonlySet<string> }> {
    const result = await build({
        entryPoints: [entryAbsPath],
        bundle: true,
        treeShaking: true,
        write: false,
        metafile: true,
        format: 'esm',
        platform: 'browser',
        jsx: 'automatic',
        logLevel: 'silent',
        plugins: [externalizeBareImports],
    });
    const metafile = result.metafile;
    const externals = new Set<string>();
    for (const input of Object.values(metafile.inputs)) {
        for (const imported of input.imports) {
            if (imported.external) {
                externals.add(imported.path);
            }
        }
    }
    return { inputs: Object.keys(metafile.inputs), externals };
}

/** A forbidden external is the named runtime or any of its subpaths. */
function importsRuntime(externals: ReadonlySet<string>, name: string): boolean {
    return [...externals].some((spec) => spec === name || spec.startsWith(`${name}/`));
}

/** `source` with block and line comments removed, so prose cannot be parsed as code. */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/**
 * Every name `source` re-exports, value and TYPE alike, with the `type` keyword
 * and any `as` alias resolved to the published name — or `null` when `source`
 * contains an export this reader cannot enumerate.
 *
 * Types leave no runtime trace, so `Object.keys(barrel)` cannot see them and
 * `BarrelTypeSurface` only catches a removal. Reading the source is what makes an
 * ADDED type export — which is published API of `@chimera-engine/renderer` the
 * moment it lands — visible to an assertion.
 *
 * The `null` arm is what makes the result a CLOSED set rather than a sample.
 * `export * from './x.js'` and `export type * from './x.js'` publish names this
 * function cannot name, and a local `export const`/`export type` publishes one
 * that is not a re-export at all; each would otherwise slip past silently, so
 * every `export` in the file has to be brace-form or the answer is `null`.
 */
export function parseBarrelExports(source: string): readonly string[] | null {
    const code = stripComments(source);
    const braceForm = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'[^']+'/gu;

    const blocks = [...code.matchAll(braceForm)];
    const exportKeywords = code.match(/\bexport\b/gu) ?? [];
    if (blocks.length !== exportKeywords.length) {
        return null;
    }

    const names: string[] = [];
    for (const block of blocks) {
        for (const clause of (block[1] ?? '').split(',')) {
            const name = clause
                .trim()
                .replace(/^type\s+/u, '')
                .split(/\s+as\s+/u)
                .at(-1);
            if (name !== undefined && name !== '') {
                names.push(name);
            }
        }
    }
    return names.sort();
}

describe('@chimera-engine/renderer/input barrel', () => {
    it('exports exactly the documented public surface', () => {
        // Referencing the type roll-call keeps it from reading as unused; the
        // assertion that matters for it is made by tsc, not here.
        const typeSurface: BarrelTypeSurface | undefined = undefined;
        expect(typeSurface).toBeUndefined();

        // Sorted and exhaustive on purpose: an ADDITION is as reportable as a
        // removal, since every name here becomes public API of a published
        // package the moment it lands. In particular `createInputManager`,
        // `createInputActionRegistry` and `createKeyBindingRepository` are
        // withheld; §4.26 records why.
        expect(Object.keys(inputBarrel).sort()).toEqual([
            'InputManagerProvider',
            'useInputAction',
            'useInputManager',
        ]);
    });

    describe('parseBarrelExports', () => {
        // Pinned against synthetic inputs rather than against the barrel it is
        // pointed at, so the tree's current contents are not what defines
        // "correct". Both export forms, the `type` inline keyword, an alias, and
        // multi-line prettier output are separate cases because each is a way a
        // real edit could slip a name past the reader.
        it('reads a name out of every export form the barrel may use', () => {
            expect(
                parseBarrelExports(
                    [
                        `export { useThing } from './a.js';`,
                        `export { Provider, type ProviderProps } from './b.js';`,
                        `export type { Alpha, Beta } from './c.js';`,
                        `export {`,
                        `    Multi,`,
                        `    type Line,`,
                        `} from './d.js';`,
                        `export { internal as Renamed } from './e.js';`,
                    ].join('\n'),
                ),
            ).toEqual([
                'Alpha',
                'Beta',
                'Line',
                'Multi',
                'Provider',
                'ProviderProps',
                'Renamed',
                'useThing',
            ]);
        });

        it('ignores a bare side-effect import and prose that contains the word export', () => {
            expect(
                parseBarrelExports(
                    [
                        `/** Re-export only; nothing here is code. */`,
                        `// export { NotReal } from './nope.js';`,
                        `import './side-effect.js';`,
                        `export { Real } from './a.js';`,
                    ].join('\n'),
                ),
            ).toEqual(['Real']);
        });

        // The closed-set arm. Each of these publishes a name the brace reader
        // cannot enumerate, so each must come back `null` rather than as a
        // shorter list that reads like a complete one.
        it.each([
            [`export * from './a.js';`, 'star re-export'],
            [`export type * from './a.js';`, 'type-star re-export'],
            [`export const local = 1;`, 'local value declaration'],
            [`export type Local = 1;`, 'local type alias'],
            [`export interface Local { a: 1 }`, 'local interface'],
        ])('refuses to answer for %s (%s)', (code) => {
            expect(
                parseBarrelExports([`export { Real } from './a.js';`, code].join('\n')),
            ).toBeNull();
        });
    });

    describe('importsRuntime', () => {
        // Pinned against synthetic sets, like `parseBarrelExports` above. The
        // `${name}/` in the subpath arm is what separates a real subpath from a
        // package whose name merely starts with the same letters, and the
        // barrel's own externals hold no such pair — only a synthetic set can
        // show that arm doing its job.
        it('matches the name exactly and as a path prefix, but not as a string prefix', () => {
            expect(importsRuntime(new Set(['three']), 'three')).toBe(true);
            expect(importsRuntime(new Set(['three/examples/jsm/Foo.js']), 'three')).toBe(true);
            expect(importsRuntime(new Set(['three-stdlib']), 'three')).toBe(false);
            expect(importsRuntime(new Set(['react']), 'three')).toBe(false);
        });
    });

    it('re-exports exactly eight names, types included', () => {
        // The runtime assertion above cannot see a TYPE, and `BarrelTypeSurface`
        // catches only a removal — so adding `export type { KeyBinding }` here
        // would publish a name on `@chimera-engine/renderer` with nothing to
        // report it. This closed set is what reports it: every other name
        // `renderer/input/` exports is withheld by being absent from it.
        const source = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');

        expect(parseBarrelExports(source)).toEqual([
            'InputAction',
            'InputActionId',
            'InputEvent',
            'InputManager',
            'InputManagerProvider',
            'InputManagerProviderProps',
            'useInputAction',
            'useInputManager',
        ]);
    });

    it('pulls in exactly four input-layer modules and no store', async () => {
        const { inputs, externals } = await analyzeBarrel(resolve(__dirname, '../index.ts'));

        // EXHAUSTIVE, not a denylist. A denylist only rejects the subsystems
        // whoever wrote it thought of; a closed set makes any new edge, into
        // any subsystem, a failure that has to be looked at and either
        // justified here or removed. `InputAction.ts` and `InputManager.ts` are
        // absent because everything the barrel takes from them is a TYPE.
        // `InputManager.ts` is the one that matters: it imports
        // `logging/rendererLogger`, so the moment the barrel needs a VALUE from
        // it that edge enters the graph too.
        //
        // Compared on the last TWO path segments — esbuild reports inputs
        // relative to the CWD vitest ran from (repo root for a single-file run,
        // the renderer package dir under `pnpm -r test`), and those two differ
        // only by a leading `renderer/`.
        const dirAndFile = inputs.map((input) => input.split('/').slice(-2).join('/')).sort();
        expect(dirAndFile).toEqual([
            'input/InputManagerContext.ts',
            'input/InputManagerProvider.tsx',
            'input/index.ts',
            'input/useInputAction.ts',
        ]);

        // Named separately because externalized peers never appear as inputs,
        // so the closed set above cannot speak for them. The barrel must be
        // mountable outside a <Canvas> and outside the engine's own stores.
        //
        // The positive control comes first. Every assertion below it is
        // `toBe(false)`, so an `importsRuntime` that never reports a match — or a
        // bundle whose externals came back empty — would keep all six green while
        // measuring nothing. `react` is an external this barrel really does carry.
        expect(importsRuntime(externals, 'react')).toBe(true);

        expect(importsRuntime(externals, '@react-three/fiber')).toBe(false);
        expect(importsRuntime(externals, 'three')).toBe(false);
        expect(importsRuntime(externals, 'zustand')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/simulation')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/ai')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/networking')).toBe(false);
    });

    it("carries 'use client' on line 1 of every module shipping React surface", () => {
        for (const moduleFile of [
            'useInputAction.ts',
            'InputManagerContext.ts',
            'InputManagerProvider.tsx',
        ]) {
            const source = readFileSync(resolve(__dirname, '..', moduleFile), 'utf8');
            expect(source.split('\n')[0], moduleFile).toBe(`'use client';`);
        }
    });
});
