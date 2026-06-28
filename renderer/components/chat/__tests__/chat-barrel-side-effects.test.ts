/**
 * renderer/components/chat/__tests__/chat-barrel-side-effects.test.ts
 *
 * Asserts the `@chimera-engine/renderer/components/chat` public barrel is
 * SIDE-EFFECT-FREE at import (issue #772, AC #3: "Importing each barrel is
 * side-effect-free — no store/bridge/R3F runtime evaluated").
 *
 * The chat barrel's only export is `ChatPanel`, a stateful component wired to the
 * renderer `chatStore`/`lobbyStore`/`toastStore`. Those stores are renderer-only
 * Zustand state and are LAZILY created (on first access), so merely importing the
 * barrel instantiates no store — the host IPC bridge (`window.__chimera`) is
 * touched only at runtime inside effects/handlers, never at import. This test
 * proves both halves:
 *
 *   1. importing the barrel evaluates NO store (zustand `createStore` is never
 *      called) — the literal AC #3 guarantee, and the regression guard against a
 *      store ever reverting to an eager module-level singleton;
 *   2. the first store access lazily creates exactly one instance — the wiring is
 *      intact, not merely dead.
 *
 * A second, static esbuild assertion (below) proves the barrel pulls no IPC
 * bridge module and no React-Three-Fiber / sibling-package runtime, mirroring
 * `networking/__tests__/contract-barrel-side-effects.test.ts` (#768): like the
 * networking barrel, the chat barrel legitimately carries the runtime it needs
 * (the pure Zustand stores), so the assertion is over the bundle's resolved
 * inputs/externals, not bundle emptiness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as ZustandModule from 'zustand';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * esbuild plugin that marks every bare (non-relative, non-absolute) specifier
 * external, so the bundle contains only in-repo renderer source. The external
 * specifiers are then inspected to assert no R3F / sibling-package runtime is
 * pulled into the barrel.
 */
const externalizeBareImports: Plugin = {
    name: 'externalize-bare-imports',
    setup(b) {
        // esbuild filters are Go RE2 regexes — the JS `u` flag is rejected.
        b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
        // CSS modules are not part of the import side-effect surface under test.
        b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, external: true }));
    },
};

/**
 * Bundle a barrel entry with esbuild (bundle + tree-shake) and return its
 * resolved in-repo input file paths plus the set of external (bare) specifiers
 * it imports. `import type` specifiers are stripped by esbuild before resolution,
 * so type-only contract imports (`@chimera-engine/simulation/*`, `@chimera-engine/electron/*`)
 * never appear.
 */
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

// A spy fronting zustand's `createStore`, hoisted so the `vi.mock` factory can
// close over it. Counts every store instantiation across all three stores.
const { createStoreSpy } = vi.hoisted(() => ({ createStoreSpy: vi.fn() }));

vi.mock('zustand', async (importOriginal) => {
    const actual = await importOriginal<typeof ZustandModule>();
    return {
        ...actual,
        createStore: (...args: unknown[]): unknown => {
            createStoreSpy();
            return (actual.createStore as (...a: unknown[]) => unknown)(...args);
        },
    };
});

describe('@chimera-engine/renderer/components/chat barrel is side-effect-free at import (issue #772)', () => {
    beforeEach(() => {
        createStoreSpy.mockClear();
        vi.resetModules();
    });

    it('importing the chat barrel instantiates no store (no store evaluated at import)', async () => {
        await import('../index');
        expect(createStoreSpy).not.toHaveBeenCalled();
    });

    it('the first store access lazily creates exactly one instance (wiring intact)', async () => {
        await import('../index');
        expect(createStoreSpy).not.toHaveBeenCalled();

        const { useChatStore } = await import('../../../state/chatStore');
        useChatStore.getState();
        expect(createStoreSpy).toHaveBeenCalledTimes(1);

        // Second access reuses the singleton — no new instance.
        useChatStore.getState();
        expect(createStoreSpy).toHaveBeenCalledTimes(1);
    });
});

describe('@chimera-engine/renderer/components/chat barrel pulls no bridge / R3F / sibling runtime (issue #772)', () => {
    it('evaluates no IPC bridge module and no React-Three-Fiber / @chimera-engine sibling runtime', async () => {
        const { inputs, externals } = await analyzeBarrel(resolve(__dirname, '../index.ts'));

        // metafile input paths are relative to the esbuild working dir, which is
        // the CWD vitest ran from — repo root under a single-file run, the renderer
        // package dir under `pnpm -r test`. Match path segments CWD-independently.
        const hasInput = (re: RegExp): boolean => inputs.some((input) => re.test(input));

        // Sanity: the analysis ran on the real graph — ChatPanel and the pure
        // Zustand stores it depends on ARE bundled (the barrel is stateful by
        // design); the assertions below are therefore non-vacuous.
        expect(hasInput(/(?:^|\/)components\/chat\/ChatPanel/u)).toBe(true);
        expect(hasInput(/(?:^|\/)state\/chatStore/u)).toBe(true);

        // The host IPC bridge is reached only at runtime (`window.__chimera`),
        // never imported — so no `renderer/bridge/` module is bundled. ChatPanel
        // renders no 3D scene, so no R3F runtime is pulled. The three pure Zustand
        // store *modules* under `renderer/state/` are legitimately present (the
        // barrel is stateful by design) but instantiate nothing at import — see
        // the lazy-store assertions above.
        expect(hasInput(/(?:^|\/)bridge\//u)).toBe(false);
        expect(hasInput(/(?:^|\/)components\/r3f\//u)).toBe(false);

        expect(importsRuntime(externals, 'three')).toBe(false);
        expect(importsRuntime(externals, '@react-three/fiber')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/ai')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/networking')).toBe(false);
    });
});
