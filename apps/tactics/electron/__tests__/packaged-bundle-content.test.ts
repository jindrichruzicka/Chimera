/**
 * packaged-bundle-content.test.ts
 *
 * Proves the Runtime Debug Layer LEAVES the packaged bundles (§4.12).
 *
 * Every other build-main test injects a no-op `BuildFn` and asserts on the
 * `BundleSpec` objects — deliberately, so the suite spawns nothing. That cannot
 * answer the question this file exists for, which is about esbuild's OUTPUT and
 * not about its configuration: whether folding the debug gate to `if (false)`
 * actually prunes the dynamic-import records behind it. So this one runs a real
 * bundle, following the precedent in `simulation/__tests__/contract-barrel-side-effects.test.ts`
 * (real esbuild, `write: false`, assert the emitted text).
 *
 * It drives the production `buildAppBundles` rather than re-deriving a config,
 * so the assertion cannot pass against a bundle plan the shipped build does not
 * use. Nothing is written to disk — important, because `build:app` writes the
 * same `apps/tactics/dist` path a dev launch runs from.
 *
 * Requires the workspace packages to be BUILT (`pnpm build:packages`): the debug
 * graph is reached through the built `@chimera-engine/simulation` dist, which is
 * precisely why the gate could not fold on the imported constant. CI builds
 * packages before running tests.
 */

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';

import {
    buildAppBundles,
    createEsbuildBuild,
    resolveDevDebugPreloadEntry,
    PACKAGED_BUILD_ENV,
    VERIFY_PACK_NODE_MODULES_ENV,
    type BuildFn,
    type BundleSpec,
    type EsbuildBundleOptions,
} from '../build-main.js';
import {
    ALL_DEBUG_GRAPH_MARKERS as ALL_MARKERS,
    DEBUG_BRIDGE_GLOBAL,
    DEBUG_GRAPH_MARKERS,
    DEBUG_PUSH_CHANNEL_LITERAL,
    DEBUG_REQUEST_CHANNEL_RE,
} from '@chimera-engine/electron/packaged-bundle';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.resolve(APP_DIR, '../..');
const MAIN_INDEX = path.join(ROOT, 'electron/main/index.ts');
const DEBUG_BRIDGE_SPECIFIER = './debug-bridge.js';

/**
 * The debug-layer markers are the ENGINE'S (`@chimera-engine/electron/packaged-bundle`):
 * the real-artifact gates — the monorepo's `tools/verify-packaged-bundle.ts`
 * driver AND every scaffolded game's own `verify:packaged-bundle` — assert the
 * same set against the bytes a packaging run emits. A second copy would drift
 * silently and in one direction only — the weaker copy stops naming a module
 * and keeps passing; `tools/verify-packaged-bundle.test.ts` ratchets the
 * single-definition property repo-wide.
 */

interface BundledApp {
    readonly labels: readonly string[];
    /** Emitted text per bundle label — EVERY planned bundle, not just `main`. */
    readonly code: ReadonlyMap<string, string>;
    /** The planned specs, so a test can assert WHICH resolution route it took. */
    readonly specs: readonly BundleSpec[];
}

interface BundleOptions {
    /** Omit to exercise the SCAFFOLD route (no monorepo source entry). */
    readonly withSourceDebugEntry?: boolean;
    /** Inject the existence probe the standalone packed-sibling fallback needs. */
    readonly withFileExists?: boolean;
}

/**
 * The esbuild options the SHIPPED CLI passes for `spec`, captured by running its
 * own `BuildFn` with esbuild and the FS swapped out.
 *
 * Asserting about the CLI's source text instead cannot hold: any guard over the
 * `buildSync({ ... })` literal's declared options is blind to a second spread
 * (`...{ define: {} }`) — which drops the packaging define and reships the
 * whole debug graph. Executing the real factory removes the class: there is no
 * option list here to fall out of date.
 */
function shippedEsbuildOptions(spec: BundleSpec): EsbuildBundleOptions {
    const captured: EsbuildBundleOptions[] = [];
    createEsbuildBuild({
        runBuild: (options) => {
            captured.push(options);
        },
        ensureDir: () => {},
    })(spec);

    expect(captured, 'the shipped BuildFn must invoke esbuild exactly once per spec').toHaveLength(
        1,
    );
    return captured[0]!;
}

/** Bundle the app for real with the given env, in memory. */
async function bundleApp(
    env: Record<string, string | undefined>,
    options: BundleOptions = {},
): Promise<BundledApp> {
    const { withSourceDebugEntry = true, withFileExists = false } = options;
    const specs: BundleSpec[] = [];
    const collect: BuildFn = (spec) => {
        specs.push(spec);
    };

    const debugPreloadEntry = withSourceDebugEntry
        ? resolveDevDebugPreloadEntry(ROOT, existsSync)
        : undefined;

    buildAppBundles({
        build: collect,
        readJson: (file) => JSON.parse(readFileSync(file, 'utf8')) as { name?: string },
        // Mirrors the CLI's own resolver, INCLUDING the `nodeModules` switch. A
        // resolver that discards the argument silently keeps the preload on the
        // monorepo route even when the main bundle takes the packed one — half
        // of what the packed-route case's name claims.
        resolvePreload: (nodeModules?: string) =>
            createRequire(
                nodeModules !== undefined
                    ? path.join(path.dirname(nodeModules), 'package.json')
                    : path.join(APP_DIR, 'package.json'),
            ).resolve('@chimera-engine/electron/preload/api'),
        env,
        root: ROOT,
        appDir: APP_DIR,
        ...(debugPreloadEntry !== undefined ? { debugPreloadEntry } : {}),
        ...(withFileExists ? { fileExists: existsSync } : {}),
    });

    expect(
        specs.some((spec) => spec.label === 'main'),
        'buildAppBundles must always plan a main bundle',
    ).toBe(true);

    // EVERY planned bundle is emitted and scanned. Checking only `main` would
    // leave the preload — which also ships in every distributable — unexamined,
    // and a debug import added there invisible to this test.
    const code = new Map<string, string>();
    for (const spec of specs) {
        const result = await build({
            // The SHIPPED options, EXECUTED out of the CLI's own `BuildFn` —
            // not a restatement of them, and not a subset the test picked. Any
            // esbuild option the shipped build passes is therefore an option
            // this bundle is built with, whether or not anyone thought to name
            // it here. `write: false` is the only override: it keeps the bytes
            // in memory, because `build:app` writes the same `apps/tactics/dist`
            // path a dev launch runs from.
            ...shippedEsbuildOptions(spec),
            write: false,
            logLevel: 'silent',
        });
        // `sourcemap: true` emits a sibling `.map`, so pick the bundle by
        // extension rather than by position.
        const emitted = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';

        // Every content assertion below is a `.not.` — so an empty string would
        // satisfy all of them. Selecting the bundle by extension makes that a
        // reachable failure (no match ⇒ `''`), not a hypothetical one.
        expect(
            emitted.length,
            `the ${spec.label} bundle must emit a non-empty .js output`,
        ).toBeGreaterThan(0);

        // `sourcemap` is a content option in disguise. Switched to `'inline'` it
        // embeds the original TypeScript — debug sources included — INSIDE the
        // bundle that ships, and every marker assertion below still passes
        // because base64 hides the plain strings. The marker checks cannot see
        // this class at all, so it needs naming directly.
        expect(
            emitted,
            `the ${spec.label} bundle embeds an inline sourcemap, which would ship its sources`,
        ).not.toContain('sourceMappingURL=data:');
        code.set(spec.label, emitted);
    }

    return { labels: specs.map((spec) => spec.label), code, specs };
}

/**
 * Every module specifier the DEBUG gate dynamically imports.
 *
 * Parsed, not text-matched. The composition root has more than one gated import
 * site — the dev-harness fixture loader sits behind its own `CHIMERA_DEV_HARNESS`
 * gate (Invariant #77) — and a regex over the whole file sweeps those in too,
 * demanding markers for modules this test has no business asserting about.
 * Identifying the debug gate specifically requires the structure.
 */
function gatedImportSpecifiers(): string[] {
    const source = ts.createSourceFile(
        MAIN_INDEX,
        readFileSync(MAIN_INDEX, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );

    const specifierOf = (node: ts.Node): string | undefined => {
        if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
            return undefined;
        }
        const arg = node.arguments[0];
        return arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : undefined;
    };

    // The debug gate is the `if` whose then-branch imports the debug bridge.
    let gate: ts.IfStatement | undefined;
    const walk = (node: ts.Node, visit: (n: ts.Node) => void): void => {
        visit(node);
        node.forEachChild((child) => walk(child, visit));
    };
    walk(source, (node) => {
        if (specifierOf(node) !== DEBUG_BRIDGE_SPECIFIER) return;
        for (let cur: ts.Node | undefined = node; cur?.parent !== undefined; cur = cur.parent) {
            const parent: ts.Node = cur.parent;
            if (ts.isIfStatement(parent) && parent.thenStatement === cur) {
                gate = parent;
                return;
            }
        }
    });

    expect(
        gate,
        `no \`if\` in ${path.basename(MAIN_INDEX)} encloses the ${DEBUG_BRIDGE_SPECIFIER} import — ` +
            'this probe cannot enumerate a gate it cannot find',
    ).toBeDefined();

    const specifiers = new Set<string>();
    if (gate !== undefined) {
        walk(gate.thenStatement, (node) => {
            const specifier = specifierOf(node);
            if (specifier !== undefined) specifiers.add(specifier);
        });
    }

    // Relative STATIC imports count too. A debug module imported at the top of
    // the file and merely USED behind the gate is bundled unconditionally, so it
    // needs a marker just as much — and enumerating only dynamic imports left
    // exactly that case unguarded by all three guards.
    walk(source, (node) => {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier)) return;
        if (node.importClause?.isTypeOnly === true) return;
        const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith('./debug') || specifier.startsWith('./network-diagnostics')) {
            specifiers.add(specifier);
        }
    });

    return [...specifiers];
}

// Real esbuild over every planned bundle, twice — and cheap despite that
// (~200 ms), because esbuild is Go and the plan resolves through prebuilt dist.
// There is no cost argument for narrowing what this file covers.
describe('packaged bundle content (§4.12)', () => {
    it('a PACKAGED build carries no debug module graph, in any bundle', async () => {
        const { labels, code } = await bundleApp({ [PACKAGED_BUILD_ENV]: '1' });

        for (const [label, text] of code) {
            for (const marker of ALL_MARKERS) {
                expect(text, `packaged ${label} bundle still contains "${marker}"`).not.toContain(
                    marker,
                );
            }

            expect(
                text,
                `packaged ${label} bundle still references the chimera:debug request channel`,
            ).not.toMatch(DEBUG_REQUEST_CHANNEL_RE);
            expect(
                text,
                `packaged ${label} bundle still references ${DEBUG_PUSH_CHANNEL_LITERAL}`,
            ).not.toContain(DEBUG_PUSH_CHANNEL_LITERAL);
            expect(
                text,
                `packaged ${label} bundle carries the ${DEBUG_BRIDGE_GLOBAL} surface`,
            ).not.toContain(DEBUG_BRIDGE_GLOBAL);
        }
        expect(labels).not.toContain('debug-preload');
    });

    // The route a SCAFFOLDED distributable actually takes. Every other case here
    // resolves the engine through the monorepo SOURCE alias. A scaffolded game
    // has no engine source, so `computeEsbuildAlias` drops that alias and esbuild
    // resolves `@chimera-engine/electron/main` from `nodePaths` — reaching the
    // COMPILED dist, whose gate has been through `tsc` instead of being read from
    // source. The changeset claims the benefit for scaffolded games, so that emit
    // needs its own assertion: `tsc` is free to reformat the gate expression, and
    // only the exact dot-access shape folds under `define`.
    it('a PACKAGED build through the COMPILED engine dist carries no debug graph either', async () => {
        const packedEngine = { [VERIFY_PACK_NODE_MODULES_ENV]: path.join(APP_DIR, 'node_modules') };

        const packaged = await bundleApp({ ...packedEngine, [PACKAGED_BUILD_ENV]: '1' });
        const packagedMain = packaged.code.get('main') ?? '';

        // Prove the route before asserting about its output. If the engine source
        // alias were still in play this would be the source-route test again
        // under a different name, and would pass for the wrong reason.
        const mainSpec = packaged.specs.find((spec) => spec.label === 'main');
        expect(mainSpec?.alias).not.toHaveProperty('@chimera-engine/electron/main');
        expect(mainSpec?.nodePaths.length, 'the packed route must resolve via nodePaths').toBe(1);

        for (const marker of ALL_MARKERS) {
            expect(
                packagedMain,
                `packed-route packaged main bundle still contains "${marker}"`,
            ).not.toContain(marker);
        }
        expect(packagedMain).not.toMatch(DEBUG_REQUEST_CHANNEL_RE);
        expect(packagedMain).not.toContain(DEBUG_PUSH_CHANNEL_LITERAL);
        expect(packaged.labels).not.toContain('debug-preload');

        // Anti-vacuity for THIS route specifically: prove the same resolution
        // reaches the real engine, rather than some stub that trivially contains
        // no markers. Without it, a dist that failed to expose the debug graph at
        // all would read as a successful exclusion.
        const devMain = (await bundleApp(packedEngine)).code.get('main') ?? '';
        for (const marker of ALL_MARKERS) {
            expect(
                devMain,
                `packed-route DEV main bundle is missing "${marker}" — the route may not reach the engine`,
            ).toContain(marker);
        }
    });

    // Anti-vacuity. Without this the assertions above could pass because a
    // marker was renamed, the entry failed to resolve, or the bundle came back
    // empty — none of which mean the graph left.
    it('a DEV build still carries all of it, so the check above cannot pass vacuously', async () => {
        const { labels, code } = await bundleApp({});

        const mainCode = code.get('main') ?? '';
        for (const marker of ALL_MARKERS) {
            expect(mainCode, `dev main bundle is missing "${marker}"`).toContain(marker);
        }

        // Each artifact-keyed marker needs its own home bundle, or its packaged
        // absence proves nothing about where it would have lived.
        expect(mainCode).toMatch(DEBUG_REQUEST_CHANNEL_RE);
        expect(mainCode).toContain(DEBUG_PUSH_CHANNEL_LITERAL);
        expect(code.get('debug-preload') ?? '').toContain(DEBUG_BRIDGE_GLOBAL);

        // Invariant #28 in dev too: the GAME preload never carries the bridge —
        // only the separate Inspector preload does.
        expect(code.get('preload') ?? '').not.toContain(DEBUG_BRIDGE_GLOBAL);

        expect(labels).toContain('debug-preload');
    });

    // The define's own effect on the emitted text, which `computePackagedDefine`'s
    // docblock describes and only this assertion establishes.
    it('folds IS_DEBUG_MODE to the literal false when packaged, and keeps the read in dev', async () => {
        const packaged = (await bundleApp({ [PACKAGED_BUILD_ENV]: '1' })).code.get('main') ?? '';
        expect(packaged, 'packaged main bundle must contain the folded literal').toContain(
            'IS_DEBUG_MODE = false',
        );

        const dev = (await bundleApp({})).code.get('main') ?? '';
        expect(dev, 'a dev build must keep the runtime env read').toContain(
            `process.env.CHIMERA_DEBUG === "1"`,
        );
        expect(dev).not.toContain('IS_DEBUG_MODE = false');
    });

    // The route a SCAFFOLDED game's packaging run actually takes: no monorepo
    // source entry, so `resolveInstalledDebugPreloadEntry` resolves the packed
    // engine's sibling instead. Applying the packaged drop to only the source
    // branch would leave every scaffolded game emitting the 532 KB debug preload
    // into its own `dist/preload/` while the case above stayed green. It would
    // not reach the packaged app either way — the blank template's
    // `electron-builder.yml` `files` allowlist names `dist/preload/api.js` only —
    // but it has no business in a packaging build's output tree.
    it('drops the debug preload on the SCAFFOLD route too, not just the monorepo one', async () => {
        const { labels } = await bundleApp(
            { [PACKAGED_BUILD_ENV]: '1' },
            { withSourceDebugEntry: false, withFileExists: true },
        );
        expect(labels).not.toContain('debug-preload');

        // Anti-vacuity for this route specifically — unflagged, it IS emitted.
        const dev = await bundleApp({}, { withSourceDebugEntry: false, withFileExists: true });
        expect(dev.labels).toContain('debug-preload');
    });

    // The dependency shape the CLI block actually passes: a resolved source entry
    // AND the existence probe, together. Every other case here supplies one or the
    // other, so a drop keyed on that COMBINATION — `debugPreloadEntry === undefined
    // || fileExists === undefined` — would satisfy all of them while the shipped
    // build, which supplies both, kept emitting the preload.
    it('drops the debug preload under the dependency shape the CLI actually passes', async () => {
        const { labels } = await bundleApp(
            { [PACKAGED_BUILD_ENV]: '1' },
            { withSourceDebugEntry: true, withFileExists: true },
        );
        expect(labels).not.toContain('debug-preload');

        const dev = await bundleApp({}, { withSourceDebugEntry: true, withFileExists: true });
        expect(dev.labels).toContain('debug-preload');
    });

    // The dev-harness graph is the CONTRAST case, asserted so the distinction
    // stays true rather than merely documented. Its imports are dynamic too, but
    // gated on a runtime CLI value rather than a define-foldable literal, so
    // esbuild cannot prune them and `electron/main/dev/` ships in every
    // distributable. That is by design — Invariant #77 gates on env, not on file
    // absence. Asserted rather than assumed, because "the imports are dynamic"
    // reads like a reason the graph leaves, and for this gate it is not one.
    it('does NOT prune the dev-harness graph — only a foldable gate can do that', async () => {
        const { code } = await bundleApp({ [PACKAGED_BUILD_ENV]: '1' });
        expect(
            code.get('main') ?? '',
            'the dev-harness graph is expected to SHIP in a packaged bundle (Invariant #77 gates ' +
                'it at runtime); if this now fails, the §4.12 pruning story has changed and the ' +
                'comment at the harness gate in electron/main/index.ts must be revisited',
        ).toContain('DevHarnessCoordinator');
    });

    // Anti-rot: a THIRD module added behind the gate with no marker here would
    // be unprotected — hoisting it out would ship it with this file still green.
    it('every module the gate dynamically imports has a marker', () => {
        const unmarked = gatedImportSpecifiers().filter(
            (specifier) => DEBUG_GRAPH_MARKERS[specifier] === undefined,
        );
        expect(
            unmarked,
            'these modules are dynamically imported by the composition root but have no marker in ' +
                'DEBUG_GRAPH_MARKERS, so nothing here would notice them shipping in a packaged build',
        ).toEqual([]);
    });
});
