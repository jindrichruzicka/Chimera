/**
 * renderer/components/ui/__tests__/ui-barrel-side-effects.test.ts
 *
 * Asserts the `@chimera-engine/renderer/components/ui` public barrel is
 * SIDE-EFFECT-FREE (AC: "Importing each barrel is side-effect-free
 * — no store/bridge/R3F runtime evaluated").
 *
 * The UI barrel exposes the design primitives, the React-only
 * `EscapeStack` context, and one stateful surface: `useConfirmDialog()`, which
 * queues onto the engine confirm store. That store is the ONE `renderer/state/`
 * module the barrel may reach — the exact-set assertion below is what keeps it
 * one — and it is created lazily, so importing the barrel still constructs no
 * store. Everything else stays out: no IPC bridge (`renderer/bridge/`) and no
 * React-Three-Fiber runtime. A game importing the design primitives must not drag
 * in the host bridge or the 3D runtime (Invariant #96).
 *
 * Mechanism mirrors `networking/__tests__/contract-barrel-side-effects.test.ts`:
 * esbuild bundles the barrel with tree-shaking and the test asserts over
 * the resolved inputs / external specifiers. Bare deps are externalized and `.css`
 * is loaded empty so the `.tsx` / CSS-module barrel bundles without a React or CSS
 * pipeline.
 */

import { describe, it, expect, vi } from 'vitest';
import { build, type Plugin } from 'esbuild';
import type * as Zustand from 'zustand';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Marks every bare specifier external so the bundle holds only in-repo source. */
const externalizeBareImports: Plugin = {
    name: 'externalize-bare-imports',
    setup(b) {
        // esbuild filters are Go RE2 regexes — the JS `u` flag is rejected.
        b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
        // CSS modules are not part of the import side-effect surface under test.
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

describe('@chimera-engine/renderer/components/ui barrel is side-effect-free', () => {
    it('evaluates no store, no IPC bridge, and no React-Three-Fiber / @chimera-engine sibling runtime', async () => {
        const { inputs, externals } = await analyzeBarrel(resolve(__dirname, '../index.ts'));

        // metafile input paths are relative to the esbuild working dir, which is
        // the CWD vitest ran from — repo root under a single-file run, the renderer
        // package dir under `pnpm -r test`. Match path segments CWD-independently.
        const hasInput = (re: RegExp): boolean => inputs.some((input) => re.test(input));

        // Sanity: the analysis ran on the real graph — design primitives ARE
        // bundled, so the absence assertions below are non-vacuous.
        expect(hasInput(/(?:^|\/)components\/ui\/Button/u)).toBe(true);

        // The confirm store is the single sanctioned state module; asserting the
        // exact set (not merely "state/ is allowed") is what stops the next one.
        expect(inputs.filter((input) => /(?:^|\/)state\//u.test(input))).toEqual([
            expect.stringMatching(/(?:^|\/)state\/confirmDialogStore\.ts$/u),
        ]);
        expect(hasInput(/(?:^|\/)bridge\//u)).toBe(false);
        expect(hasInput(/(?:^|\/)components\/r3f\//u)).toBe(false);

        expect(importsRuntime(externals, 'three')).toBe(false);
        expect(importsRuntime(externals, '@react-three/fiber')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/ai')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/networking')).toBe(false);
    });
});

// The graph assertion above says which modules the barrel REACHES; it cannot say
// whether importing them runs anything. Now that one Zustand store sits in that
// graph, "side-effect-free" needs its own instrument: the store must be built on
// first use, never at import. Spying on the factory is the only way to see the
// difference — a lazily-created and an eagerly-created singleton are otherwise
// indistinguishable from outside the module.
const createStoreSpy = vi.hoisted(() => vi.fn());

vi.mock('zustand', async (importOriginal) => {
    const actual = await importOriginal<typeof Zustand>();
    createStoreSpy.mockImplementation(actual.createStore as (...args: never[]) => unknown);
    return { ...actual, createStore: createStoreSpy };
});

describe('@chimera-engine/renderer/components/ui barrel constructs no store at import', () => {
    it('builds the confirm store on first use, not while the barrel evaluates', async () => {
        const barrel = await import('../index');

        // The stateful surface IS reachable, so the assertion below measures
        // laziness rather than the store simply being absent from the barrel.
        expect(typeof barrel.useConfirmDialog).toBe('function');
        expect(createStoreSpy).not.toHaveBeenCalled();

        const { useConfirmDialogStore } = await import('../../../state/confirmDialogStore');
        useConfirmDialogStore.getState();

        expect(createStoreSpy).toHaveBeenCalledTimes(1);
    });
});
