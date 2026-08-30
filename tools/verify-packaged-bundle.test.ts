/**
 * tools/verify-packaged-bundle.test.ts
 *
 * Ratchets the THIN-DRIVER shape of the monorepo's `verify:packaged-bundle`
 * gate. The predicates, the marker set, and the self-validating orchestration
 * moved into the engine (`@chimera-engine/electron/packaged-bundle`) so the
 * monorepo and every scaffolded game verify the same property through ONE
 * definition; they are unit-tested there
 * (`electron/packaged-bundle/verify-packaged-bundle.test.ts`).
 *
 * What must hold HERE is the property the move exists for and the wiring the
 * engine cannot see:
 *
 *   - exactly one marker definition repo-wide — a second copy drifts silently
 *     and in one direction only (the weaker copy stops naming a module and its
 *     checks keep passing), which is the multi-copy failure mode that defeated
 *     several review rounds before the set was consolidated;
 *   - the driver drives the ENGINE helper at the app's own bundle plan and the
 *     real packaging invocation, and carries no predicate or marker copies of
 *     its own — a driver that regrew local checks would fork the definition
 *     with every assertion still green;
 *   - the root script still reaches this driver, because the CI and merge-gate
 *     pins (`ci-workflow.test.ts`, `merge-gate.test.ts`) hold `pnpm
 *     verify:packaged-bundle` and would not notice the script pointing at
 *     nothing.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';

import { VERIFIED_APPS, verifyAllApps } from './verify-packaged-bundle.js';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const driverPath = path.join(workspaceRoot, 'tools/verify-packaged-bundle.ts');
const engineMarkersPath = 'electron/packaged-bundle/debug-bundle-markers.ts';

/**
 * Every `apps/<game>` carrying an Electron composition root — the apps whose own
 * `build:app` and `electron-builder.yml` can reship the debug layer, and
 * therefore the apps this gate must cover. DISCOVERED, so an app added without
 * an entry in the driver's `VERIFIED_APPS` fails here rather than going
 * silently unverified.
 */
function discoverElectronApps(): readonly string[] {
    const appsRoot = path.join(workspaceRoot, 'apps');
    if (!existsSync(appsRoot)) return [];
    return readdirSync(appsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `apps/${entry.name}`)
        .filter((dir) => existsSync(path.join(workspaceRoot, dir, 'electron/build-main.ts')))
        .sort();
}

/**
 * The app directories the driver's `VERIFIED_APPS` names, read positionally off
 * the IMPORTED array rather than out of the file's text.
 *
 * Importing the driver is safe and is the stronger reading: its `main()` is
 * double-guarded (`VITEST` unset AND direct run), so nothing builds, and the
 * value cannot be satisfied by a path that merely appears somewhere in the
 * source. Reading the first member by POSITION is what makes a swapped
 * `[package, dir]` tuple fail loudly instead of resolving to a plausible string.
 *
 * The sibling ratchet below still parses each app's `build-main.ts` with the
 * AST — that one is an `apps/` file, and importing it would be the §3 edge
 * `tools/` must not have.
 */
function verifiedAppDirs(): readonly string[] {
    return VERIFIED_APPS.map(([dir]) => dir).sort();
}

/** Build-output and dependency dirs — generated copies of the source are expected there. */
const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'out',
    '.next',
    '.git',
    '.e2e-build',
    '.dev-userdata',
    'release',
    'coverage',
]);

/** Every checked-in .ts/.tsx file under `dir`, workspace-relative. */
function walkTypeScriptSources(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
                files.push(...walkTypeScriptSources(path.join(dir, entry.name)));
            }
            continue;
        }
        if (/\.tsx?$/.test(entry.name)) {
            files.push(path.relative(workspaceRoot, path.join(dir, entry.name)));
        }
    }
    return files;
}

describe('verify:packaged-bundle thin driver (Invariant #27, single-definition contract)', () => {
    it('defines the debug-bundle marker set exactly once, in the engine package', () => {
        // Assembled from parts so this scanner's own source never matches itself.
        const definition = ['export', 'const', 'DEBUG_GRAPH_MARKERS'].join(' ');
        const definitions = walkTypeScriptSources(workspaceRoot).filter((file) =>
            readFileSync(path.join(workspaceRoot, file), 'utf8').includes(definition),
        );
        expect(definitions).toEqual([engineMarkersPath]);
    });

    it('has dropped the app-local marker copy the engine export replaced', () => {
        expect(
            existsSync(path.join(workspaceRoot, 'apps/tactics/electron/debug-bundle-markers.ts')),
        ).toBe(false);
    });

    it('drives the engine-exported helper instead of carrying its own checks', () => {
        const source = readFileSync(driverPath, 'utf8');
        expect(source).toContain("from '@chimera-engine/electron/packaged-bundle'");
        expect(source).toContain('verifyPackagedBundle(');
        // No local predicate or marker residue: any of these names in the driver
        // means checking logic grew back outside the single engine definition.
        for (const forked of ['SnapshotRingBuffer', 'chimera:debug', 'checkBundleText']) {
            expect(source, `driver must not carry a local copy of ${forked}`).not.toContain(forked);
        }
    });

    it('points the helper at the engine bundle plan and the real packaging invocation', () => {
        const source = readFileSync(driverPath, 'utf8');
        // The gate tracks the plan, never restates it: the outfile map comes from
        // the engine plan the app's own build:app driver runs, and the build is
        // the same `--filter <app> build:app` segment the packaging scripts run,
        // keyed by the same env var.
        expect(source).toContain("from '@chimera-engine/electron/build-main'");
        expect(source).toContain('appBundleOutfiles(');
        expect(source).toContain("'build:app'");
        // The packaging env var arrives by IMPORT from the plan, not as a
        // restated literal that could drift from what the bundler reads.
        expect(source).toContain('PACKAGED_BUILD_ENV');
    });

    it('imports nothing from apps/ (§3 dependency direction)', () => {
        // Reading the plan through the engine subpath rather than through an
        // app's `electron/build-main.js` is what keeps `tools/` off an app
        // import — the same rule its sibling `tools/verify-pack.ts` holds
        // itself to.
        const source = readFileSync(driverPath, 'utf8');
        expect(source).not.toMatch(/from '[^']*\bapps\//u);
    });

    it('verifies every app that ships an Electron composition root', () => {
        // The driver's app list is a literal (each entry costs two real esbuild
        // runs, so it is a deliberate choice rather than a directory scan). That
        // makes an app easy to forget — and a forgotten app is one whose
        // app-owned `build:app` / `electron-builder.yml` can reship the debug
        // layer with the gate green. This is the census that notices.
        //
        // The EXACT set, both ways: an app the driver misses is unverified, and
        // an entry naming a directory with no composition root is a build the
        // gate would try to run and fail on.
        expect(verifiedAppDirs()).toEqual(discoverElectronApps());
        // Two floors: an empty discovery, or an empty declaration, would each
        // make the comparison above vacuously true.
        expect(discoverElectronApps().length).toBeGreaterThan(1);
        expect(verifiedAppDirs().length).toBeGreaterThan(1);
    });

    it('names each app with its own workspace package', () => {
        // The other member of each tuple, which the census above reads past. A
        // wrong package name is a `--filter` that matches nothing, and pnpm
        // exits 0 on an empty filter — so the gate would report a pass for an
        // app it never built.
        const workspacePackages = new Map(
            discoverElectronApps().map((dir) => [
                dir,
                (
                    JSON.parse(
                        readFileSync(path.join(workspaceRoot, dir, 'package.json'), 'utf8'),
                    ) as { name: string }
                ).name,
            ]),
        );

        expect(new Map(VERIFIED_APPS.map(([dir, pkg]) => [dir, pkg]))).toEqual(workspacePackages);
    });

    it('decides the verdict on EVERY app, and only when all of them passed', () => {
        // Neither half is observable through the CLI: `main()` is unexported and
        // double-guarded, so a `some` that lets a passing first app mask a
        // failing second one — or a short-circuit that never builds the second
        // app at all — would ship with this suite green.
        const verify = vi.fn((dir: string) => dir !== 'apps/second');
        const apps = [
            ['apps/first', '@scope/first'],
            ['apps/second', '@scope/second'],
            ['apps/third', '@scope/third'],
        ] as const;

        expect(verifyAllApps(apps, verify)).toBe(false);
        // EAGER: the failing middle app must not stop the third from running.
        expect(verify.mock.calls.map(([dir]) => dir)).toEqual([
            'apps/first',
            'apps/second',
            'apps/third',
        ]);
    });

    it('passes only when no app failed', () => {
        // The positive control for the check above: a verdict wired to a
        // constant `false` would satisfy it while failing every real run.
        expect(verifyAllApps([['apps/first', '@scope/first']], () => true)).toBe(true);
        expect(verifyAllApps([], () => false)).toBe(true);
    });

    it('hands each app its own package name', () => {
        const verify = vi.fn(() => true);

        verifyAllApps(
            [
                ['apps/first', '@scope/first'],
                ['apps/second', '@scope/second'],
            ],
            verify,
        );

        expect(verify.mock.calls).toEqual([
            ['apps/first', '@scope/first'],
            ['apps/second', '@scope/second'],
        ]);
    });

    it.each(discoverElectronApps())(
        "takes the engine default only because %s's driver does too",
        (appDir) => {
            // The cost of the import above: this gate no longer reads the APP's
            // outfile map, so it is right only while each app driver passes none
            // of its own. A scaffolded game's gate has no such luxury and imports
            // from `./build-main.js`, whose re-export tracks that game's driver.
            //
            // AST, not a substring: the property could arrive through a spread,
            // and an opaque spread is exactly the shape that would hide it — so
            // the walk reports one rather than quietly stepping over it.
            const appBuildMainPath = path.join(workspaceRoot, appDir, 'electron/build-main.ts');
            const source = readFileSync(appBuildMainPath, 'utf8');
            const parsed = ts.createSourceFile(
                appBuildMainPath,
                source,
                ts.ScriptTarget.Latest,
                true,
            );

            let call: ts.CallExpression | undefined;
            const findCall = (node: ts.Node): void => {
                if (
                    ts.isCallExpression(node) &&
                    ts.isIdentifier(node.expression) &&
                    node.expression.text === 'buildAppBundles'
                ) {
                    call = node;
                }
                ts.forEachChild(node, findCall);
            };
            findCall(parsed);
            expect(call, 'no buildAppBundles(…) call found in the app driver').toBeDefined();

            const argument = call?.arguments[0];
            expect(argument !== undefined && ts.isObjectLiteralExpression(argument)).toBe(true);

            const assigned: string[] = [];
            const opaqueSpreads: string[] = [];
            const collect = (node: ts.Node): void => {
                if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
                    assigned.push(node.name.getText());
                }
                if (ts.isSpreadAssignment(node)) {
                    // A spread is auditable only when its members are inline
                    // object literals — which this same walk then descends into.
                    // Anything else (a variable, a call) could carry any key.
                    let spreadsInlineObject = false;
                    const findObject = (inner: ts.Node): void => {
                        if (ts.isObjectLiteralExpression(inner)) spreadsInlineObject = true;
                        ts.forEachChild(inner, findObject);
                    };
                    findObject(node.expression);
                    if (!spreadsInlineObject) opaqueSpreads.push(node.expression.getText());
                }
                ts.forEachChild(node, collect);
            };
            if (argument !== undefined) collect(argument);

            expect(
                opaqueSpreads,
                'an opaque spread could smuggle any option past this check',
            ).toEqual([]);
            // Floor: a collector that found nothing would pass while checking nothing.
            expect(assigned).toContain('build');
            for (const forbidden of ['outfiles', 'overrides']) {
                expect(
                    assigned,
                    `${appDir}'s driver passes "${forbidden}" — its plan no longer matches the ` +
                        'engine default this gate reads, so the gate is now checking the wrong ' +
                        "files. Import the app's own map here, or drop the override.",
                ).not.toContain(forbidden);
            }
        },
    );

    it('remains reachable from the pinned root script', () => {
        // ci-workflow.test.ts and merge-gate.test.ts pin `pnpm
        // verify:packaged-bundle`; this is the link from that name to this file.
        const rootPkg = JSON.parse(
            readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'),
        ) as { scripts?: Record<string, string> };
        expect(rootPkg.scripts?.['verify:packaged-bundle']).toBe(
            'tsx tools/verify-packaged-bundle.ts',
        );
    });
});
