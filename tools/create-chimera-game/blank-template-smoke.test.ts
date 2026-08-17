import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { GROWTH_DIRECTORIES } from './__test-support__/template-contract.js';
import { GAME_TOKENS } from './tokens.js';

/**
 * Guards that the blank template ships the minimal smoke harness: a co-located
 * unit smoke (manifest descriptor + the one stub screen renders) and exactly one e2e
 * boot-smoke spec, plus the tokenised test config a generated app needs so `pnpm test`
 * and `pnpm test:e2e` are green the moment a game is scaffolded.
 *
 * These assert on the REAL `templates/blank/` tree (read-only) so the suite goes red if
 * the harness is dropped or a file is renamed. Assertions stay game-agnostic: every
 * smoke file uses tokens only and names no model game — the "no hardcoded game name"
 * acceptance criterion is enforced by the `tactics` sweep below. The end-to-end proof
 * (a scaffolded app's suites actually passing) is a manual verification, not encoded
 * here — it needs a full package build + Electron launch.
 */
const blankTemplateDir = path.resolve(import.meta.dirname, 'templates/blank');

const read = (rel: string): Promise<string> => readFile(path.join(blankTemplateDir, rel), 'utf8');

describe('blank template smoke harness', () => {
    it('ships a co-located manifest unit smoke that asserts the manifest descriptor', async () => {
        const content = await read('manifest.test.ts');
        expect(content).toContain("from './manifest.js'");
        expect(content).toContain("from './simulation/constants.js'");
        expect(content).toContain('__gameCamel__Manifest');
        expect(content).toContain('__GAME_CONSTANT___GAME_ID');
    });

    // Canonical game-app layout: deterministic gameplay lives under simulation/
    // (mirrors apps/tactics — actions/constants/visibility-rules are simulation
    // modules; manifest/settings-schema stay at the app root as the registration
    // surface). Keeps scaffolded games inside the apps/*/simulation ESLint
    // determinism + boundary zones.
    it('keeps deterministic gameplay under simulation/ and wires imports through it', async () => {
        await expect(read('simulation/actions.ts')).resolves.toContain("from './constants.js'");
        await expect(read('simulation/constants.ts')).resolves.toContain(
            '__GAME_CONSTANT___GAME_ID',
        );
        await expect(read('simulation/visibility-rules.ts')).resolves.toContain('VisibilityRules');
        // Match initialization (the first-player resolver) is its own simulation
        // module, kept separate from the action registry (mirrors apps/tactics).
        await expect(read('simulation/init.ts')).resolves.toContain(
            'resolve__GamePascal__FirstPlayer',
        );
        const main = await read('electron/main.ts');
        expect(main).toContain("from '@chimera-engine/__game_kebab__/simulation/actions.js'");
        expect(main).toContain("from '@chimera-engine/__game_kebab__/simulation/init.js'");
        expect(main).toContain(
            "from '@chimera-engine/__game_kebab__/simulation/visibility-rules.js'",
        );
        expect(main).toContain("from '@chimera-engine/__game_kebab__/simulation/constants.js'");
        await expect(read('renderer/register.ts')).resolves.toContain(
            "from '../simulation/constants.js'",
        );
    });

    // The template's `build:app` is a THIN DRIVER over the engine-exported bundle plan
    // (`@chimera-engine/electron/build-main`) — the same engine-owns-the-logic /
    // app-owns-the-paths split as the verify:packaged-bundle gate below. The plan itself is
    // unit-tested in the engine (`electron/build-main/bundle-plan.test.ts`), including the
    // external-sourcemap contract and both debug-preload resolution routes. What CANNOT be
    // tested there is what this driver injects, because the CLI entry is VITEST-gated: these
    // pins cover it.
    it('drives the engine bundle plan rather than carrying its own', async () => {
        const buildMain = await read('electron/build-main.ts');
        expect(buildMain).toContain("from '@chimera-engine/electron/build-main'");
        expect(buildMain).toContain('buildAppBundles(');
        // esbuild is reached ONLY through the engine's factory. A hand-spelled
        // `buildSync({ … })` here would put the whole option set — the production
        // `define` included — outside everything the engine's assertions execute.
        expect(buildMain).toContain('createEsbuildBuild(');
        expect(buildMain).toContain('runBuild: buildSync');
    });

    // The two dev-debugging seams the VITEST-gated CLI entry can't unit-test, both of which
    // are DRIVER-owned by design: the plan is handed the probe and the source-tree lookup
    // rather than resolving either itself, so that a build which wants no debug bundle can
    // withhold them. A plan that resolved either on its own could not be told to stop.
    it('injects both debug-preload resolution signals into the plan (F9 in a standalone game)', async () => {
        const buildMain = await read('electron/build-main.ts');
        expect(buildMain).toContain('resolveDevDebugPreloadEntry(');
        expect(buildMain).toContain('fileExists: existsSync');
    });

    // The Invariant #27 packaged-bundle gate: a scaffolded game's
    // `build-main.ts` and `electron-builder.yml` are adopter-editable, so the
    // template ships its own `verify:packaged-bundle` — a THIN driver over the
    // engine-exported helper (`@chimera-engine/electron/packaged-bundle`), never
    // a copy of the marker set or predicates (copies drift silently, and only
    // in the weaker direction). verify:scaffold runs the generated app's gate
    // for real; these pins keep the template wiring from being dropped.
    it('ships a thin verify:packaged-bundle gate driving the engine-exported helper (Invariant #27)', async () => {
        const gate = await read('electron/verify-packaged-bundle.ts');
        expect(gate).toContain("from '@chimera-engine/electron/packaged-bundle'");
        expect(gate).toContain('verifyPackagedBundle(');
        // The gate tracks the app's own bundle plan rather than restating it.
        expect(gate).toContain("from './build-main.js'");
        expect(gate).toContain('appBundleOutfiles(');
        // It runs the app's own build:app script under the same packaging flag
        // the standalone `package` script sets — the real shipped invocation.
        // The env var name arrives by import from the plan, never as a restated
        // literal that could drift from what build-main reads.
        expect(gate).toContain('PACKAGED_BUILD_ENV');
        expect(gate).toContain("'build:app'");
        // Import-safe: vitest collection or an import must never trigger real builds.
        expect(gate).toContain("process.env['VITEST'] === undefined");
        // No local marker/predicate residue — the single definition lives in the engine.
        expect(gate).not.toContain('SnapshotRingBuffer');
        expect(gate).not.toContain('DEBUG_GRAPH_MARKERS');
    });

    it('wires the verify:packaged-bundle script into the template package.json (Invariant #27)', async () => {
        const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
        expect(pkg.scripts['verify:packaged-bundle']).toBe(
            'tsx electron/verify-packaged-bundle.ts',
        );
    });

    it('ships a co-located screen render smoke through the renderer public barrels', async () => {
        const content = await read('screens/__GamePascal__Playfield.test.tsx');
        expect(content.startsWith('// @vitest-environment jsdom')).toBe(true);
        expect(content).toContain("from '@testing-library/react'");
        expect(content).toContain("from './__GamePascal__Playfield.js'");
    });

    it('ships exactly one e2e boot-smoke spec that launches Electron via the fixture', async () => {
        const content = await read('e2e/tests/boot-smoke.spec.ts');
        expect(content).toContain("from '../fixtures/electron.fixture'");
        expect(content).toContain('__chimera');
    });

    it('ships the tokenised e2e harness the generated app needs', async () => {
        await expect(read('e2e/fixtures/electron.fixture.ts')).resolves.toContain('CHIMERA_E2E');
        await expect(read('e2e/fixtures/inherit-env.ts')).resolves.toContain(
            'ELECTRON_RUN_AS_NODE',
        );
        await expect(read('e2e/fixtures/user-data-root.ts')).resolves.toContain(
            'E2E_USER_DATA_ROOT',
        );
        await expect(read('e2e/global-setup.ts')).resolves.toContain('buildAppBundles');
        await expect(read('e2e/playwright.config.ts')).resolves.toContain('electron-e2e');
        // The runner resolution shim names the app's own package, tokenised.
        await expect(read('e2e/tsconfig.json')).resolves.toContain(
            '@chimera-engine/__game_kebab__/*',
        );
    });

    it('ships an e2e config whose retry cannot buy a green run', async () => {
        // `retries: 1` without `failOnFlakyTests` makes Playwright print
        // `N flaky` and exit 0, so a scaffolded suite reports a clean run for a
        // spec that failed its first attempt. The three settle together — the
        // retry is kept for the trace, and `on-first-retry` records nothing at
        // all when there is no retry to take — so each is pinned by VALUE.
        //
        // Parsed rather than grepped, because POSITION is half of what makes
        // each one work: `failOnFlakyTests` is declared on the config and
        // nowhere else, so a copy nested in a `projects` entry is read by
        // nothing and Playwright reports neither an error nor a warning, while
        // a `retries` nested there OVERRIDES the top-level value. Reading
        // declarations also makes the comment syntax irrelevant — a key inside
        // a comment of any form is not a property.
        //
        // Parsed rather than imported, because the config's own
        // `e2e/tsconfig.json` extends a root that exists only once the template
        // is scaffolded, so importing it here cannot resolve.
        const settingsOf = (source: string): ts.ObjectLiteralExpression | undefined => {
            const parsed = ts.createSourceFile(
                'playwright.config.ts',
                source,
                ts.ScriptTarget.Latest,
                true,
            );
            for (const statement of parsed.statements) {
                if (!ts.isExportAssignment(statement)) continue;
                const call = statement.expression;
                if (!ts.isCallExpression(call)) continue;
                const [argument] = call.arguments;
                if (argument !== undefined && ts.isObjectLiteralExpression(argument)) {
                    return argument;
                }
            }
            return undefined;
        };

        const valueOf = (object: ts.ObjectLiteralExpression, key: string): string | undefined => {
            for (const property of object.properties) {
                if (ts.isPropertyAssignment(property) && property.name.getText() === key) {
                    return property.initializer.getText();
                }
            }
            return undefined;
        };

        const nested = (object: ts.ObjectLiteralExpression, key: string) => {
            for (const property of object.properties) {
                if (
                    ts.isPropertyAssignment(property) &&
                    property.name.getText() === key &&
                    ts.isObjectLiteralExpression(property.initializer)
                ) {
                    return property.initializer;
                }
            }
            return undefined;
        };

        // The predicate against synthetic inputs, both ends: a key Playwright
        // reads, and the two placements that LOOK like it in the file's text.
        const synthetic = (body: string): ts.ObjectLiteralExpression | undefined =>
            settingsOf(`export default defineConfig({\n${body}\n});\n`);
        expect(valueOf(synthetic('    failOnFlakyTests: true,')!, 'failOnFlakyTests')).toBe('true');
        expect(
            valueOf(
                synthetic('    projects: [{ name: "e2e", failOnFlakyTests: true }],')!,
                'failOnFlakyTests',
            ),
        ).toBeUndefined();
        expect(
            valueOf(synthetic('    /*\n    failOnFlakyTests: true,\n    */')!, 'failOnFlakyTests'),
        ).toBeUndefined();

        const settings = settingsOf(await read('e2e/playwright.config.ts'));
        expect(settings, 'no `export default defineConfig({…})` in the config').toBeDefined();

        expect(valueOf(settings!, 'failOnFlakyTests')).toBe('true');
        expect(valueOf(settings!, 'retries')).toBe('1');
        expect(valueOf(nested(settings!, 'use')!, 'trace')).toBe("'on-first-retry'");

        // And no project quietly takes any of them back — a project-level value
        // wins over the top-level one, so a `use` declared there would drop the
        // trace this config keeps its retry for. `projects` is read from the
        // same parse, so an empty or missing array would make this vacuous —
        // hence the count.
        const projects = settings!.properties
            .filter(ts.isPropertyAssignment)
            .find((property) => property.name.getText() === 'projects')?.initializer;
        expect(projects !== undefined && ts.isArrayLiteralExpression(projects)).toBe(true);
        const entries = (projects as ts.ArrayLiteralExpression).elements.filter(
            ts.isObjectLiteralExpression,
        );
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
            expect(valueOf(entry, 'failOnFlakyTests')).toBeUndefined();
            expect(valueOf(entry, 'retries')).toBeUndefined();
            expect(valueOf(entry, 'use')).toBeUndefined();
        }
    });

    it('wires test + test:e2e scripts into the template package.json', async () => {
        const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
        expect(pkg.scripts['test']).toBeDefined();
        expect(pkg.scripts['test:e2e']).toContain('playwright test');
    });

    it('wires the dev:mp multiplayer-harness script through the chimera-dev-mp bin (§4.32)', async () => {
        const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
        expect(pkg.scripts['dev:mp']).toBe('cross-env CHIMERA_DEV_HARNESS=1 chimera-dev-mp');
    });

    it('ships tokenised dev-harness fixtures: two profiles and a default scenario (§4.32)', async () => {
        const p1 = JSON.parse(await read('dev/profiles/p1.json')) as {
            localProfileId: string;
            displayName: string;
            locale: string;
        };
        const p2 = JSON.parse(await read('dev/profiles/p2.json')) as { localProfileId: string };
        expect(p1.localProfileId).not.toBe(p2.localProfileId);
        expect(p1.displayName).toContain('__Game Title__');
        expect(p1.locale).toBeDefined();

        const scenario = JSON.parse(await read('dev/scenarios/default.json')) as {
            gameId: string;
            seats: readonly { profile?: string }[];
        };
        expect(scenario.gameId).toBe('__game_kebab__');
        expect(scenario.seats).toHaveLength(2);
        expect(scenario.seats[0]?.profile).toBe('p1.json');
        expect(scenario.seats[1]?.profile).toBe('p2.json');
    });

    it('ships the electron-builder packaging script + deps in the template package.json', async () => {
        const pkg = JSON.parse(await read('package.json')) as {
            scripts: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        expect(pkg.scripts['package']).toBe('electron-builder');
        // electron-builder + electron at the app level so `pnpm --filter <game> run package`
        // resolves in both the workspace and standalone install modes (mirrors apps/tactics).
        expect(pkg.devDependencies?.['electron-builder']).toBeDefined();
        expect(pkg.devDependencies?.['electron']).toBeDefined();
    });

    // Bundle-trim contract, mirrored from apps/tactics/electron-builder.test.ts. The
    // app's `build:app` esbuild-INLINES every @chimera-engine/* package into dist/electron/main.js
    // + dist/preload/api.js, and electron-builder ALWAYS ships the production `dependencies` tree
    // (a `!node_modules` glob does NOT exclude it — #813). So declaring the engine packages as
    // production deps would dereference ~hundreds of MB of already-bundled code into every
    // scaffolded game's packaged .app. They stay build-time-only: in `devDependencies` so the
    // pnpm workspace symlink (esbuild resolution, `tsc -b` references, the icon file set) still
    // resolves, and OUT of `dependencies` so electron-builder collects nothing to copy.
    const ENGINE_PACKAGES = [
        '@chimera-engine/simulation',
        '@chimera-engine/ai',
        '@chimera-engine/renderer',
        '@chimera-engine/electron',
    ] as const;

    it.each(ENGINE_PACKAGES)(
        'declares %s as a devDependency, never a production dependency (#817 bundle-trim)',
        async (name) => {
            const pkg = JSON.parse(await read('package.json')) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };
            expect(pkg.devDependencies ?? {}).toHaveProperty(name);
            expect(pkg.dependencies ?? {}).not.toHaveProperty(name);
        },
    );

    it('ships a tokenised electron-builder packaging config mirroring apps/tactics', async () => {
        const yml = await read('electron-builder.yml');
        // Identity fields are tokenised so each scaffolded game gets its own app identity.
        expect(yml).toContain('appId: com.chimera.__game_kebab__');
        expect(yml).toContain('productName: __GamePascal__');
        // The bundle + runtime icon is the game's own committed placeholder (electron-builder
        // generates .icns/.ico from this single PNG).
        expect(yml).toContain('icon: assets/icons/icon.png');
        // The assets file set is remapped under the game's own apps/<id> subtree so the host's
        // resolveRuntimePaths (../../apps/<gameId>/assets) finds it in the bundle.
        expect(yml).toContain('to: apps/__game_kebab__/assets');
    });

    it('ships the ENGINE icon set to the exact path the runtime fallback resolves', async () => {
        // `resolveAppIcon` reads the FIXED filename `<app>/assets/icons/
        // chimera.png`, so both halves of this block are load-bearing and each
        // fails silently on its own: a wrong `from:` ships the game's asset dir,
        // which on a fresh scaffold holds only icon.png; a wrong `to:` ships the
        // right files where nothing looks. Either way the fallback resolves to a
        // missing file the day an author drops the manifest `icon`.
        //
        // Matched as an anchored PAIR rather than two substrings: the two lines
        // have to be these two lines, adjacent, at their real indentation.
        // `toContain` would accept them apart or in a comment — and this file's
        // own prose discusses `from: assets/icons`, so a bare negative would red
        // on a documentation edit.
        const yml = await read('electron-builder.yml');
        expect(yml).toMatch(
            /^ {2}- from: node_modules\/@chimera-engine\/electron\/assets\/icons\n {4}to: assets\/icons$/mu,
        );
    });

    // The `files:` allowlist must name the two shipped bundles individually. A
    // `dist/**` glob would sweep in whatever else dist/ holds — including a
    // debug preload left by an earlier dev build, since `build:app` overwrites
    // but never cleans (mirrors apps/tactics/electron-builder.test.ts).
    it('names dist files individually rather than globbing dist/**', async () => {
        const yml = await read('electron-builder.yml');
        const distEntries = yml
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('- dist/'));

        expect(distEntries).toEqual(['- dist/electron/main.js', '- dist/preload/api.js']);
        expect(yml).not.toMatch(/dist\/\*\*/);
        expect(yml).not.toMatch(/debug-api/);
    });

    // Debug builds (the scaffold's .vscode task / `pnpm start:debug`) leave browser source
    // maps with full TSX sourcesContent in renderer/out, and the bare `package` script hands
    // electron-builder whatever out/ currently holds — the file set must refuse *.map so a
    // debug build's maps never ship in a distributable (mirrors apps/tactics).
    it('excludes renderer source maps from the packaged renderer/out file set', async () => {
        const yml = await read('electron-builder.yml');
        expect(yml).toMatch(/from:\s*renderer\/out[\s\S]{0,200}?!\*\*\/\*\.map/);
    });

    it('ships a committed per-game placeholder icon under the game asset dir, not renderer/public (Invariant #97)', async () => {
        const png = await readFile(path.join(blankTemplateDir, 'assets', 'icons', 'icon.png'));
        // PNG magic number — a real raster placeholder, not a stub text file.
        const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        expect(png.subarray(0, 8).equals(pngSignature)).toBe(true);
        // Invariant #97: game-owned, NOT under renderer/public.
        await expect(
            readFile(path.join(blankTemplateDir, 'renderer', 'public', 'icon.png')),
        ).rejects.toThrow();
    });

    it('declares a per-game icon override in the manifest, resolvable under the asset dir', async () => {
        const manifest = await read('manifest.ts');
        // Renderer-relative path the F67 resolver maps to apps/<gameId>/assets/icons/icon.png.
        expect(manifest).toContain("icon: 'icons/icon.png'");
    });

    it('documents the F69 cursor declaration as a commented-out example, shipping no textures', async () => {
        const manifest = await read('manifest.ts');
        // The example stays commented out: absent `cursor` ⇒ the plain system cursor,
        // so a fresh scaffold boots unchanged until the game opts in with its own art.
        expect(manifest).toContain('// cursor: {');
        expect(manifest).toContain('cursors/default.png');
        expect(manifest).toContain('hotspot');
        // Invariant #97: cursor textures are game-owned opt-ins — the template must
        // not ship placeholder PNGs under assets/cursors/.
        await expect(readdir(path.join(blankTemplateDir, 'assets', 'cursors'))).rejects.toThrow();
    });

    it('forwards the manifest cursor declaration through the shell loader', async () => {
        // The injector reads `LoadedRendererGameShell.cursor`, not the manifest —
        // without this verbatim forward (mirroring the model game's loaders),
        // uncommenting the manifest example would never reach the renderer.
        const loaders = await read('renderer/loaders.ts');
        expect(loaders).toContain('cursor: __gameCamel__Manifest.cursor');
    });

    it('declares the engine default logo screen as an ACTIVE manifest field', async () => {
        const manifest = await read('manifest.ts');
        // Active, not a commented-out example like cursor: every scaffolded
        // game boots Chimera-branded out of the box; a game opts out by deleting
        // the field (or points the route at its own custom page).
        expect(manifest).toContain("logoScreen: { route: '/logo-screen' }");
        expect(manifest).not.toContain('// logoScreen');
    });

    it('re-exports the engine logo-screen page at the declared route', async () => {
        const page = await read('renderer/app/logo-screen/page.tsx');
        expect(page).toContain(
            "export { default } from '@chimera-engine/renderer/shell/logo-screen/page';",
        );
    });

    it('ships the committed engine brand video under renderer/public', async () => {
        // Next serves each host's own public/, so the template commits its own
        // copy (same pattern as chimera-logo-compact.png). A scaffolded game
        // replacing it with its own media owns that asset (Invariant #97).
        const mp4 = await readFile(
            path.join(blankTemplateDir, 'renderer', 'public', 'chimera_logo.mp4'),
        );
        // ISO base media file format: bytes 4-8 of the first box are 'ftyp'.
        expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp');
    });

    // Day-one font self-hosting (Invariant #97): the committed asset dir, an
    // empty `gameFonts` declaration site forwarded through the shell loader,
    // and an app-level fetch script naming the published bin. The explicit
    // `--out-dir assets/fonts` is load-bearing: pnpm runs package scripts with
    // cwd = apps/<kebab>, where the tool's default outDir would derive the
    // doubled `apps/<kebab>/apps/<kebab>/assets/fonts`; a relative --out-dir
    // resolves against that cwd and lands the download in the game's own
    // asset dir.
    it('establishes the committed assets/fonts/ convention', async () => {
        await expect(readdir(path.join(blankTemplateDir, 'assets', 'fonts'))).resolves.toContain(
            '.gitkeep',
        );
    });

    // The three canonical game directories tactics grew into that carry no
    // day-one file. Shipping them empty costs nothing at build time — a
    // directory holding only `.gitkeep` is invisible to eslint and to tsc,
    // which select by extension — and it puts an author's first AI policy,
    // colour palette or reusable component in the place the guards already
    // expect. They cannot be inferred from the copier: it emits FILES, so an
    // empty directory would simply not exist in a scaffolded game.
    //
    // Each is a distinct contract:
    //   ai/     per-game agent policies. Both lint modes already reach it: the
    //           standalone preset zones `chimera/no-fromfloat-in-simulation`
    //           over `ai/**`, and a --workspace game additionally inherits the
    //           monorepo's apps/*/ai determinism and boundary zones.
    //   data/   JSON rows the Content DB loads. `content/` declares the
    //           collections; `data/<collection>/*.json` holds their payloads.
    //   components/
    //           every reusable piece of the game's UI, whether it renders to
    //           the DOM or inside the Canvas: shared React components, the
    //           hooks and stores two screens have to agree on, and the
    //           react-three-fiber primitives the playfield screen renders as
    //           children of its GameCanvas (Invariant #127). `screens/` keeps
    //           only what the screen registry names.
    it('ships the three canonical growth directories, held by .gitkeep', async () => {
        for (const dir of GROWTH_DIRECTORIES) {
            await expect(
                readdir(path.join(blankTemplateDir, dir)),
                `${dir}/ must ship, held open by a .gitkeep`,
            ).resolves.toContain('.gitkeep');
        }
    });

    it('ships an empty gameFonts stub on the type-only shell contract', async () => {
        const fonts = await read('shell/fonts.ts');
        expect(fonts).toContain(
            "import type { GameFontFace } from '@chimera-engine/simulation/foundation/game-shell-contract.js';",
        );
        expect(fonts).toContain('export const gameFonts: readonly GameFontFace[] = [];');
    });

    it('forwards the gameFonts stub through the shell loader', async () => {
        const loaders = await read('renderer/loaders.ts');
        expect(loaders).toContain("import { gameFonts } from '../shell/fonts.js';");
        expect(loaders).toContain('fonts: gameFonts');
    });

    it('ships an empty asset manifest at the basename the validator discovers', async () => {
        // `chimera-validate-assets` finds a game's manifest by BASENAME —
        // `asset-manifest.ts` and nothing else. A differently-named file is not a
        // manifest that fails to validate, it is a manifest the gate never sees.
        const manifest = await read('asset-manifest.ts');
        expect(manifest).toContain(
            "import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';",
        );
        expect(manifest).toContain('export const __gameCamel__AssetManifest: AssetManifest = {');
        expect(manifest).toContain('gameId: __GAME_CONSTANT___GAME_ID,');
        // Empty, but a real array literal: the commented worked example beside it
        // is what an author uncomments, so the shape has to be the one that works.
        expect(manifest).toMatch(/entries:\s*\[[\s\n]*(?:\/\/[^\n]*\n\s*)*\],/u);
    });

    it('forwards the asset manifest through the game loader', async () => {
        // The forward is the whole point of shipping the manifest: the field is
        // OPTIONAL on `LoadedRendererGame`, so omitting it is silent at every
        // gate and fails only at runtime, on the first load, as
        // `UnknownAssetManifestEntryError`.
        const loaders = await read('renderer/loaders.ts');
        expect(loaders).toContain("import('../asset-manifest.js')");
        expect(loaders).toContain('assetManifest: assetManifestModule.__gameCamel__AssetManifest');
    });

    it('ships a manifest test that grows with the manifest rather than pinning it empty', async () => {
        // An `expect(entries).toHaveLength(0)` would red the moment an author
        // followed the manifest's own instructions. The per-entry checks are
        // loops, so they cost nothing empty and start working at the first asset.
        const test = await read('asset-manifest.test.ts');
        expect(test).toContain("from '@chimera-engine/electron/test-support'");
        expect(test).toContain('for (const entry of __gameCamel__AssetManifest.entries)');
        expect(test).not.toMatch(/toHaveLength\(0\)|entries\)\.toEqual\(\[\]\)/u);
    });

    it('wires an app-level fetch:fonts script naming the bin with an explicit --out-dir', async () => {
        const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
        const script = pkg.scripts['fetch:fonts'];
        expect(script).toContain('chimera-fetch-fonts');
        expect(script).toContain('--game __game_kebab__');
        expect(script).toContain('--out-dir assets/fonts');
        // No `--url` placeholder: the CSS URL arrives as a TRAILING ARGUMENT
        // (`pnpm fetch:fonts --url '<css-url>'`), which pnpm appends to the last
        // command in the script. Baking a placeholder in made the script
        // unrunnable until hand-edited — see the redirection sweep below for why
        // it did not merely fail, it failed while blaming the wrong thing.
        expect(script).not.toContain('--url');
    });

    // A package script runs through `sh`, so an angle-bracket placeholder is a
    // REDIRECTION, not prose. `--url <google-css-url>` never reached the bin at
    // all: sh tried to open a file named `google-css-url`, and the resulting
    // `sh: google-css-url: No such file or directory` names neither the script
    // nor the tool — it reads as "chimera-fetch-fonts is missing from the
    // scaffold". Sweeping EVERY script (not just the one that carried it) is the
    // point: the failure mode belongs to the placeholder convention, not to
    // fonts, and the next tool to document an argument inline would repeat it.
    //
    // Only `<` and `>` are swept. They have no legitimate use in these scripts,
    // whereas `&&` sequencing is normal and appears in the standalone ROOT
    // manifest's scripts.
    it('leaves no shell redirection in any template script', async () => {
        const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
        for (const [name, command] of Object.entries(pkg.scripts)) {
            expect(
                /[<>]/u.test(command),
                `script "${name}" contains a shell redirection character; sh consumes it as ` +
                    `a redirect and the command dies before the tool runs: ${command}`,
            ).toBe(false);
        }
    });

    // Day-one asset-reference validation (Invariants #22/#52): the same cwd
    // rationale as fetch:fonts, in the opposite direction. pnpm runs package
    // scripts with cwd = apps/<kebab>, and the validator resolves its
    // positional argument against that cwd — so `../..` lands on the project
    // root, whose `apps/*` discovery then finds this one game and resolves
    // `apps/<kebab>/assets/...` exactly as it does in the monorepo. The script
    // is app-level because the depth depends on it: a root-cwd run would
    // resolve `../..` ABOVE the project entirely. In a standalone project the
    // bin is also reachable only from here — the emitted root manifest carries
    // no `@chimera-engine/electron`, so pnpm links it into
    // apps/<kebab>/node_modules/.bin alone.
    it('wires an app-level validate:assets script pointing discovery at the project root', async () => {
        const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
        // Whole-string, because the DEPTH is the entire mechanism. A missing
        // or too-shallow argument now refuses loudly, but `../../..` resolves
        // ABOVE the project onto some unrelated ancestor, and whether that
        // refuses or silently validates a stranger's tree depends on what
        // happens to be there. Only the exact value is safe.
        expect(pkg.scripts['validate:assets']).toBe('chimera-validate-assets ../..');
    });

    // Opt-in icon regeneration. Unlike fetch:fonts and validate:assets this
    // script needs no path arithmetic — pnpm runs it with cwd = apps/<kebab>,
    // which is already where both the master and the generated set belong.
    // `electron-builder.yml` carries why each flag is spelled out; the short of
    // it is that omitting `--out` does not fail, it writes into the game's
    // `electron/` source tree and exits 0.
    it('wires an app-level icons:generate script naming the bin with both paths', async () => {
        const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
        // Whole-string: the SOURCE is the same committed `icon.png` the manifest
        // and electron-builder already read, which is what makes replacing that
        // one file rebrand everything. Pointed anywhere else, the generated set
        // would drift from the installer and window icons on the next edit.
        expect(pkg.scripts['icons:generate']).toBe(
            'chimera-generate-icons --source assets/icons/icon.png --out assets/icons',
        );
    });

    // Every `chimera-*` command a template script invokes is a BIN of
    // `@chimera-engine/electron` — the only engine package the scaffold installs
    // that declares any. pnpm links a dependency's declared bins into
    // `apps/<kebab>/node_modules/.bin`, so a script naming a command the engine
    // does not declare resolves to nothing and dies with `command not found` —
    // at scaffold time, in the user's project, with no earlier signal.
    //
    // `verify:scaffold` runs all four bins, but it installs the engine from
    // LOCALLY PACKED TARBALLS, so it proves the template agrees with the engine
    // SOURCE. It cannot see this drift either, because the drift is between the
    // template and what `electron/package.json` DECLARES. That declaration is
    // what the published tarball's `bin` map is built from, so checking it here
    // is the earliest place the mismatch can surface.
    it('names only chimera-* commands that @chimera-engine/electron declares as bins', async () => {
        const enginePkg = JSON.parse(
            await readFile(
                path.resolve(import.meta.dirname, '../../electron/package.json'),
                'utf8',
            ),
        ) as { bin: Record<string, string> };
        const declared = new Set(Object.keys(enginePkg.bin));
        // Positive control: the guard is only meaningful if the engine declares
        // bins at all. An empty/renamed `bin` map would otherwise make every
        // lookup below vacuously... fail — but a missing `bin` key entirely would
        // throw on Object.keys, so pin that the map is populated.
        expect(declared.size).toBeGreaterThan(0);

        const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
        const invoked = new Set<string>();
        for (const command of Object.values(pkg.scripts)) {
            for (const token of command.split(/\s+/u)) {
                if (token.startsWith('chimera-')) invoked.add(token);
            }
        }
        // The template must actually exercise this guard — if a refactor stops
        // naming bins directly (routing through `pnpm exec`, say), the loop below
        // would pass while checking nothing.
        expect(invoked.size).toBeGreaterThan(0);

        for (const bin of invoked) {
            expect(
                declared.has(bin),
                `template script invokes "${bin}", which electron/package.json does not declare ` +
                    `as a bin (declared: ${[...declared].join(', ')}). A scaffolded game would ` +
                    'fail with "command not found".',
            ).toBe(true);
        }
    });

    it('declares no image codec anywhere — sharp stays opt-in', async () => {
        // The lean-install half of the contract: a scaffolded game that never
        // regenerates its icons must not carry the native binary. Every
        // dependency-bearing section is checked, not just the two obvious ones —
        // pnpm installs `optionalDependencies` by default, so a codec parked
        // there would land in every scaffold while a two-map check stayed green.
        const pkg = JSON.parse(await read('package.json')) as Record<
            string,
            Record<string, string> | readonly string[] | undefined
        >;
        const sections = [
            'dependencies',
            'devDependencies',
            'optionalDependencies',
            'peerDependencies',
            // npm defines these two as ARRAYS of names, not maps. Indexing an
            // array by a package name always yields undefined, so a map-shaped
            // check over them cannot fire whatever they contain.
            'bundledDependencies',
            'bundleDependencies',
        ];
        for (const section of sections) {
            const declared = pkg[section];
            // Normalised to the NAMES declared, so one assertion covers both shapes.
            const names = Array.isArray(declared) ? [...declared] : Object.keys(declared ?? {});
            for (const codec of ['sharp']) {
                expect(names, `${section}.${codec}`).not.toContain(codec);
            }
        }
    });

    it('names no model game in any smoke file (tokens only)', async () => {
        const files = [
            'manifest.test.ts',
            'asset-manifest.ts',
            'asset-manifest.test.ts',
            'screens/__GamePascal__Playfield.test.tsx',
            'screens/__GamePascal__Playfield.module.css',
            'e2e/tests/boot-smoke.spec.ts',
            'e2e/fixtures/electron.fixture.ts',
            'e2e/fixtures/inherit-env.ts',
            'e2e/fixtures/user-data-root.ts',
            'e2e/global-setup.ts',
            'e2e/playwright.config.ts',
            'e2e/tsconfig.json',
            'electron-builder.yml',
            'electron/build-main.ts',
            'electron/verify-packaged-bundle.ts',
            'shell/fonts.ts',
            'renderer/loaders.ts',
            'package.json',
        ];
        for (const rel of files) {
            expect((await read(rel)).toLowerCase()).not.toContain('tactics');
        }
    });
});

/**
 * The architecture-lint guardrails a scaffolded game gets on day one (§4.32).
 *
 * A game leaving the monorepo used to lose every `chimera/*` rule — a
 * `fromFloat()` in a reducer or a hardcoded hex in a screen went unflagged, and
 * the app's own `lint` script was a hard error because no config existed. These
 * assert the template files that change that, on the REAL template tree.
 *
 * None of them is linted in this repo (`tools/create-chimera-game/templates/**`
 * is globally ignored), so nothing else here would notice one being dropped,
 * malformed, or emptied.
 *
 * These assertions read the template TEXT. What happens to it afterwards is
 * proven elsewhere: `index.test.ts` asserts which files reach a scaffolded app
 * in which mode (the flat config is emitted for a STANDALONE project only), and
 * `verify:scaffold` asserts the emitted config runs clean and actually fires,
 * against an installed project.
 */
describe('blank template lint guardrails', () => {
    it('ships a flat config composing the engine preset onto the game', async () => {
        const content = await read('eslint.config.mjs');

        expect(content).toContain("from '@chimera-engine/electron/eslint'");
        expect(content).toContain('standaloneLintConfig');
    });

    it('hands its whole base to silenceOnCss', async () => {
        // Two of the curated rules lint CSS through `@eslint/css`, and a flat
        // config applies every matching block — so an unscoped base has its JS
        // rules run against the stylesheet, which ABORTS the run rather than
        // false-firing. The preset silences those only for the configs it is
        // given, so the base has to be a named value passed in, not spread
        // inline where it cannot be referenced twice.
        const content = await read('eslint.config.mjs');

        expect(content).toMatch(/silenceOnCss:\s*base/u);
        expect(content).toMatch(/\.\.\.base/u);
        // …and `base` is a real rule set, not an empty array that would satisfy
        // both patterns above while linting nothing.
        expect(content).toMatch(/const base = \[[^\]]*js\.configs\.recommended/u);
        expect(content).toContain('tseslint.configs.recommended');
    });

    it('ships a token-override stylesheet under the guarded path', async () => {
        // `no-unknown-token-overrides` matches `apps/<name>/styles/tokens-override.css`
        // by name. Without the file the rule is configured, resolvable and
        // guards nothing — the guardrail would be dormant until the day a game
        // author happened to create it.
        // Matched inside a `:root` block, not anywhere in the file: the
        // doc-comment above it names `--ch-*` twice, so a bare substring check
        // stays green against a stub whose declarations were all deleted.
        const content = await read('styles/tokens-override.css');

        expect(content).toMatch(/:root\s*\{[\s\S]*--ch-[\w-]+\s*:/u);
    });

    it('overrides only tokens the engine declares, so a fresh scaffold lints clean', async () => {
        // The stub is the one file in the template the token rule reads, so an
        // undeclared name here reds `pnpm lint` on a game nobody has touched.
        //
        // Read from the renderer SOURCE while the rule resolves the published
        // `dist` copy. `copy-renderer-css.ts` copies that file verbatim, so the
        // two agree here — but a scaffolded game installs a released renderer,
        // a tree this test cannot see. The proof for that direction is the
        // scaffold gate running against an installed probe.
        const declared = new Set(
            Array.from(
                await readFile(
                    path.resolve(import.meta.dirname, '../../renderer/styles/tokens.css'),
                    'utf8',
                ).then((css) => css.matchAll(/(?:^|[\s{;])(--ch-[\w-]+)\s*:/gmu)),
                (match) => match[1],
            ),
        );
        const overridden = Array.from(
            (await read('styles/tokens-override.css')).matchAll(/(?:^|[\s{;])(--ch-[\w-]+)\s*:/gmu),
            (match) => match[1],
        );

        expect(overridden.length).toBeGreaterThan(0);
        expect(overridden.filter((token) => !declared.has(token))).toEqual([]);

        // The stub tells its reader to move the accent family as a unit. This
        // is what holds the stub to its own advice.
        expect(overridden).toContain('--ch-color-accent');
        expect(overridden).toContain('--ch-color-accent-hover');
        expect(overridden).toContain('--ch-color-accent-strong');
    });

    it('ships a screen stylesheet under the guarded path whose values are tokens or keywords', async () => {
        // The CSS arm of `no-hardcoded-design-values` matches
        // `screens/**/*.module.css`. It is the arm no other file in the template
        // exercises — the override stub above sits under `styles/`, and a rule
        // whose only zone matches nothing is indistinguishable from a rule that
        // was never wired.
        const content = await read('screens/__GamePascal__Playfield.module.css');

        // This is a property of the STUB, not a restatement of the rule. It is
        // deliberately the stricter of the two, and no attempt is made to track
        // where the two diverge: what matters is that a scaffold nobody has
        // touched lints green, and every literal excluded here is one the stub
        // has no reason to carry.
        const withoutComments = content.replace(/\/\*[\s\S]*?\*\//gu, '');
        const values = Array.from(
            withoutComments.matchAll(/^[ \t]+[\w-]+:\s*([^;{]+);/gmu),
            (match) => match[1]?.trim() ?? '',
        );

        // Every declaration in the file was scanned. Indentation depth is not
        // the property under test, so a nested block — which a fixed-indent
        // pattern skips ENTIRELY, taking its literals with it — has to red here
        // rather than shrink the sample in silence.
        expect(values).toHaveLength((withoutComments.match(/;/gu) ?? []).length);
        expect(values.some((value) => /^var\(--ch-[\w-]+\)$/u.test(value))).toBe(true);
        expect(
            values.filter((value) =>
                /#[^\s;)]+|\d*\.?\d+(?:px|rem)\b|\b(?:rgb|rgba|hsl|hsla)\(/iu.test(value),
            ),
        ).toEqual([]);
    });

    it('references only tokens the engine declares from the screen stylesheet', async () => {
        // Same direction as the override stub, different rule: an undeclared
        // `--ch-*` here resolves to nothing at runtime, so the playfield renders
        // unstyled rather than erroring. Read from the renderer SOURCE for the
        // reason given above.
        const declared = new Set(
            Array.from(
                await readFile(
                    path.resolve(import.meta.dirname, '../../renderer/styles/tokens.css'),
                    'utf8',
                ).then((css) => css.matchAll(/(?:^|[\s{;])(--ch-[\w-]+)\s*:/gmu)),
                (match) => match[1],
            ),
        );
        const referenced = Array.from(
            (await read('screens/__GamePascal__Playfield.module.css')).matchAll(
                /var\((--ch-[\w-]+)\)/gu,
            ),
            (match) => match[1],
        );

        expect(referenced.length).toBeGreaterThan(0);
        expect(referenced.filter((token) => !declared.has(token))).toEqual([]);
    });

    it('has the playfield consume that stylesheet', async () => {
        // A CSS module nothing imports is dead weight the first author deletes,
        // and it takes the rule's only zone with it. Bracket access, not
        // `styles.playfield`: the app's tsconfig sets
        // `noPropertyAccessFromIndexSignature`, so the dotted form fails the
        // scaffold's own build.
        const playfield = await read('screens/__GamePascal__Playfield.tsx');
        const stylesheet = await read('screens/__GamePascal__Playfield.module.css');

        expect(playfield).toContain("import styles from './__GamePascal__Playfield.module.css'");
        expect(playfield).toContain("className={styles['playfield']}");
        expect(stylesheet).toMatch(/^\.playfield\s*\{/mu);
    });

    it('roots the screen in a full-bleed scene host', async () => {
        // Why absolute positioning is the load-bearing part is written out once,
        // in the stylesheet this asserts on — the file a scaffolded game's author
        // actually opens. Both halves are pinned here: the rule, and the screen
        // ROOT carrying it (an in-flow wrapper above it would restore the
        // auto-height link the rule exists to skip).
        const playfield = await read('screens/__GamePascal__Playfield.tsx');
        const stylesheet = await read('screens/__GamePascal__Playfield.module.css');

        expect(stylesheet).toMatch(/^\.sceneHost\s*\{/mu);
        expect(stylesheet).toMatch(/^\.sceneHost\s*\{[^}]*\bposition:\s*absolute;/mu);
        expect(stylesheet).toMatch(/^\.sceneHost\s*\{[^}]*\binset:\s*0;/mu);
        expect(playfield).toMatch(/return \(\s*<div className=\{styles\['sceneHost'\]\}>/u);
    });
});

/**
 * The template tree as a whole, rather than any one file in it.
 *
 * Both checks exist because of a hole the same shape: `index.test.ts` scaffolds
 * from a SYNTHETIC fixture it writes itself, so anything it asserts grades that
 * fixture and never the tree that ships. These read the real one.
 */
describe('blank template, whole-tree properties', () => {
    it('leaves no placeholder of any spelling in any template file', async () => {
        // `findLeftoverTokens` knows only the CANONICAL literals, by design — so
        // a near-miss like `__GameTitle__` (the real token is `__Game Title__`,
        // with a space) is substituted by nothing, flagged by nothing, and ships
        // into every generated game. This is the only check that would see it.
        const files = await collectTemplateFiles(blankTemplateDir);
        const offenders: string[] = [];

        for (const rel of files) {
            const raw = await readFile(path.join(blankTemplateDir, rel));
            if (raw.includes(0)) continue; // binary asset

            // Canonical tokens are REMOVED first; whatever dunder shape is left
            // is the offender. Removing them is what lets the pattern admit
            // underscores — and it has to, because every canonical token
            // contains one, so space→underscore is the likeliest mistyping of
            // `__Game Title__`.
            let text = raw.toString('utf8');
            for (const token of Object.keys(GAME_TOKENS)) text = text.split(token).join('');

            for (const match of text.matchAll(/__[A-Za-z][A-Za-z0-9 _]*__/gu)) {
                if (match[0] === '__tests__') continue; // a real directory name
                offenders.push(`${rel}: ${match[0]}`);
            }
        }

        // A floor: an enumeration that found no files would pass vacuously.
        expect(files.length).toBeGreaterThan(40);
        expect(offenders.sort()).toEqual([]);
    });

    it('states its ignores as a GLOBAL ignore, with no sibling key', async () => {
        // The most-documented flat-config foot-gun, in a file whose own comment
        // invites edits: an `ignores` key is a global ignore only while it is
        // the ONLY key in its object. Add a `files` beside it and it silently
        // becomes a per-config exclusion — the tree lints clean until someone
        // runs a build, and then a single 400 KB Playwright report reports over
        // a thousand errors.
        //
        // Read from the LOADED config, not the file text: the entry list is
        // checked as text above, but shape is not a property text can carry.
        const loaded = (await import(path.join(blankTemplateDir, 'eslint.config.mjs')))
            .default as Record<string, unknown>[];

        const ignoreBlocks = loaded.filter((block) => block['ignores'] !== undefined);

        expect(ignoreBlocks).toHaveLength(1);
        expect(Object.keys(ignoreBlocks[0] ?? {})).toEqual(['ignores']);
    });

    it('ignores every path this app is configured to write', async () => {
        // The list has broken twice, both times because it was hand-written
        // against a guess at the layout. Each entry is paired here with the
        // config that produces the artefact, so changing one without the other
        // reds — rather than surfacing as a lint run over a 400 KB bundled
        // Playwright report.
        const lintConfig = await read('eslint.config.mjs');
        const nextConfig = await read('renderer/next.config.ts');
        const playwrightConfig = await read('e2e/playwright.config.ts');
        const builderConfig = await read('electron-builder.yml');
        const buildTsconfig = await read('tsconfig.build.json');

        const distDir = /distDir:\s*'([^']+)'/u.exec(nextConfig)?.[1];
        const reportDir = /outputFolder:\s*'([^']+)'/u.exec(playwrightConfig)?.[1];
        const junitFile = /outputFile:\s*'([^']+)'/u.exec(playwrightConfig)?.[1];
        const releaseDir = /^\s*output:\s*(\S+)\s*$/mu.exec(builderConfig)?.[1];
        const outDir = /"outDir":\s*"\.\/([^"]+)"/u.exec(buildTsconfig)?.[1];

        for (const [label, value] of Object.entries({
            distDir,
            reportDir,
            junitFile,
            releaseDir,
            outDir,
        })) {
            expect(value, `no ${label} found in the config that declares it`).toBeDefined();
        }

        for (const ignored of [
            `${outDir}/**`,
            `${releaseDir}/**`,
            `renderer/${distDir}/**`,
            // Next's own scratch dir, which `distDir` does not move, and the
            // declaration file it owns beside it.
            'renderer/.next/**',
            'renderer/next-env.d.ts',
            `e2e/${reportDir}/**`,
            `e2e/${junitFile?.split('/')[0]}/**`,
            // Playwright's default outputDir, and the dev harness's per-instance
            // data dirs — neither is declared in a config, so both are named.
            'e2e/test-results/**',
            '.dev-userdata/**',
        ]) {
            expect(lintConfig, `eslint.config.mjs does not ignore ${ignored}`).toContain(
                `'${ignored}'`,
            );
        }
    });
});

/**
 * The scaffold README's two ENUMERATIONS, kept in step with what they describe.
 *
 * Both are the kind of prose that reads as authoritative and rots silently: the
 * guardrail table had already drifted to four of the five rules the preset
 * curated at the time before anyone noticed, and the layout tree omitted three
 * directories the template
 * ships. Neither drift breaks a build, and both mislead exactly the reader who
 * has no other source — someone who scaffolded a game and has only this file.
 *
 * The rule ids are read out of `curated-rules.ts` as TEXT rather than imported.
 * `@chimera-engine/electron/eslint` does not re-export the list, and importing
 * the built subpath would make a documentation test depend on `dist/` being
 * fresh; parsing the source is what `tools/root-eslint-config.test.ts` already
 * does for this same subtree. Each extraction therefore asserts it FOUND
 * something first — a regex that silently matches nothing would turn both of
 * these into tests that pass by looking at an empty set.
 */
describe('scaffold README enumerations', () => {
    const readmePath = path.resolve(import.meta.dirname, 'README.md');
    const curatedRulesPath = path.resolve(
        import.meta.dirname,
        '../../electron/dev-tools/eslint/curated-rules.ts',
    );

    /** `ruleId`s inside one exported array — the file has two, and they mean opposite things. */
    const ruleIdsIn = (source: string, exportName: string): readonly string[] => {
        const start = source.indexOf(`export const ${exportName}`);
        expect(start, `${exportName} not found in curated-rules.ts`).toBeGreaterThan(-1);
        const next = source.indexOf('\nexport const ', start + 1);
        const block = source.slice(start, next === -1 ? undefined : next);
        return [...block.matchAll(/ruleId:\s*'chimera\/([a-z0-9-]+)'/gu)].map((m) => m[1] ?? '');
    };

    it('names every curated lint rule in the guardrail table, and no withheld one', async () => {
        const curated = await readFile(curatedRulesPath, 'utf8');
        const shipped = ruleIdsIn(curated, 'STANDALONE_LINT_RULES');
        const withheld = ruleIdsIn(curated, 'STANDALONE_LINT_EXCLUSIONS');

        // Floors: a renamed `ruleId` key, or a slice that silently landed on the
        // wrong array, would otherwise leave both loops iterating nothing.
        expect(shipped.length, 'no shipped ruleIds parsed').toBeGreaterThan(3);
        expect(withheld.length, 'no withheld ruleIds parsed').toBeGreaterThan(0);
        expect(shipped).not.toEqual(expect.arrayContaining([...withheld]));

        // Match the TABLE, not the file. Prose elsewhere in this README names
        // rules legitimately, so a whole-file `toContain` reports a present row
        // for a rule whose row was deleted, and a whole-file `not.toContain`
        // would red a README that merely EXPLAINS why a rule is withheld. Both
        // directions need the row set, not the document.
        const readme = await readFile(readmePath, 'utf8');
        const sectionStart = readme.indexOf('### The architecture guardrails');
        expect(sectionStart, 'guardrail section heading not found').toBeGreaterThan(-1);
        const after = readme.indexOf('\n### ', sectionStart + 1);
        const section = readme.slice(sectionStart, after === -1 ? undefined : after);
        const rows = new Set(
            [...section.matchAll(/^\|\s*`([a-z0-9-]+)`/gmu)].map((m) => m[1] ?? ''),
        );
        expect(rows.size, 'no rule rows parsed out of the guardrail table').toBeGreaterThan(3);

        for (const id of shipped) {
            expect([...rows], `the guardrail table omits ${id}`).toContain(id);
        }
        // The other half, and the reason the two arrays must not be conflated:
        // an exclusion is a rule the preset deliberately does NOT ship, so
        // giving it a row would be a stronger claim than the engine makes.
        for (const id of withheld) {
            expect(
                [...rows],
                `the guardrail table promises ${id}, which the preset withholds`,
            ).not.toContain(id);
        }
    });

    it('lists exactly the template top-level entries in the emitted-layout tree', async () => {
        const readme = await readFile(readmePath, 'utf8');
        const layout = /## Emitted app layout[\s\S]*?```\n([\s\S]*?)```/u.exec(readme)?.[1];
        expect(layout, 'could not locate the Emitted app layout code fence').toBeDefined();

        // Rows look like `├── name/   # comment` or a final `└── a / b / c`
        // covering several root files at once. Continuation rows start with `│`
        // and carry no name. The name runs to the first `#`, whatever the
        // column alignment — keying on run-length would make this test a
        // whitespace assertion wearing a contents assertion's name.
        const documented = new Set<string>();
        for (const row of (layout ?? '').split('\n')) {
            const named = /^[├└]──\s+([^#]+)/u.exec(row);
            if (!named) continue;
            for (const part of (named[1] ?? '').split(' / ')) {
                const name = part.trim().replace(/\/$/u, '');
                if (name !== '') documented.add(name);
            }
        }
        expect(documented.size, 'no rows parsed out of the layout tree').toBeGreaterThan(10);

        // `node_modules/` is a local install artifact — gitignored, in the
        // copier's SKIP_DIRS, and never emitted — so it is correctly absent.
        const actual = (await readdir(blankTemplateDir)).filter((name) => name !== 'node_modules');
        const globs = [...documented].filter((name) => name.includes('*'));
        const literals = new Set([...documented].filter((name) => !name.includes('*')));
        // A glob row is the one shape that can disarm the "ships but
        // undocumented" direction wholesale: broaden `tsconfig*.json` to `*` and
        // every actual entry is covered, so that loop passes vacuously while the
        // other direction still looks healthy. Pinning the set means widening
        // one has to be a deliberate edit here, not a side effect there.
        expect(globs, 'the layout tree grew a glob row').toEqual(['tsconfig*.json']);

        for (const name of actual) {
            const covered =
                literals.has(name) ||
                globs.some((glob) =>
                    new RegExp(`^${glob.split('*').map(escapeForRegExp).join('.*')}$`, 'u').test(
                        name,
                    ),
                );
            expect(covered, `the template ships ${name}, which the README tree does not list`).toBe(
                true,
            );
        }
        for (const name of literals) {
            expect(
                actual,
                `the README tree lists ${name}, which the template does not ship`,
            ).toContain(name);
        }
    });
});

/** Escape a literal fragment for embedding in a `RegExp` source string. */
function escapeForRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Every file under `dir`, as paths relative to it, skipping nothing. */
async function collectTemplateFiles(dir: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
            files.push(...(await collectTemplateFiles(path.join(dir, entry.name), rel)));
        } else if (entry.isFile()) {
            files.push(rel);
        }
    }
    return files;
}
