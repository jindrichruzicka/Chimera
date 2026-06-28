/**
 * renderer/components/ui/__tests__/ui-barrel-side-effects.test.ts
 *
 * Asserts the `@chimera-engine/renderer/components/ui` public barrel is
 * SIDE-EFFECT-FREE (issue #772, AC #3: "Importing each barrel is side-effect-free
 * — no store/bridge/R3F runtime evaluated").
 *
 * The UI barrel exposes stateless design primitives plus the React-only
 * `EscapeStack` context. Unlike the chat barrel — which legitimately carries the
 * renderer's (lazily-created) Zustand stores — the UI barrel must pull NO store
 * at all: no `renderer/state/` module, no IPC bridge (`renderer/bridge/`), and no
 * React-Three-Fiber runtime. A game importing only the design primitives must not
 * drag in renderer state, the host bridge, or the 3D runtime (Invariant #96).
 *
 * Mechanism mirrors `networking/__tests__/contract-barrel-side-effects.test.ts`
 * (#768): esbuild bundles the barrel with tree-shaking and the test asserts over
 * the resolved inputs / external specifiers. Bare deps are externalized and `.css`
 * is loaded empty so the `.tsx` / CSS-module barrel bundles without a React or CSS
 * pipeline.
 */

import { describe, it, expect } from 'vitest';
import { build, type Plugin } from 'esbuild';
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

describe('@chimera-engine/renderer/components/ui barrel is side-effect-free (issue #772)', () => {
    it('evaluates no store, no IPC bridge, and no React-Three-Fiber / @chimera-engine sibling runtime', async () => {
        const { inputs, externals } = await analyzeBarrel(resolve(__dirname, '../index.ts'));

        // metafile input paths are relative to the esbuild working dir, which is
        // the CWD vitest ran from — repo root under a single-file run, the renderer
        // package dir under `pnpm -r test`. Match path segments CWD-independently.
        const hasInput = (re: RegExp): boolean => inputs.some((input) => re.test(input));

        // Sanity: the analysis ran on the real graph — design primitives ARE
        // bundled, so the absence assertions below are non-vacuous.
        expect(hasInput(/(?:^|\/)components\/ui\/Button/u)).toBe(true);

        expect(hasInput(/(?:^|\/)state\//u)).toBe(false);
        expect(hasInput(/(?:^|\/)bridge\//u)).toBe(false);
        expect(hasInput(/(?:^|\/)components\/r3f\//u)).toBe(false);

        expect(importsRuntime(externals, 'three')).toBe(false);
        expect(importsRuntime(externals, '@react-three/fiber')).toBe(false);
        expect(importsRuntime(externals, 'zustand')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/ai')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/networking')).toBe(false);
    });
});
