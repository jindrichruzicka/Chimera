import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards that the blank template ships the minimal smoke harness (#800): a co-located
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

    // The template's build:app bundler is byte-shared with apps/tactics but has no co-located
    // unit test (the tested copy lives in apps/tactics). These source-level guards cover the two
    // dev-debugging seams the VITEST-gated CLI entry can't unit-test: the standalone F9 fix
    // (bundle the packed debug-api.js sibling so the Inspector window loads) and main-process
    // source maps (so `pnpm start:debug` + the "Debug <Game>" launch config bind breakpoints).
    it('ships the F9 debug-preload fallback + main-process source maps in the build:app bundler', async () => {
        const buildMain = await read('electron/build-main.ts');
        expect(buildMain).toContain('resolveInstalledDebugPreloadEntry');
        expect(buildMain).toContain('fileExists: existsSync');
        expect(buildMain).toContain('sourcemap: true');
    });

    it('ships a co-located screen render smoke through the renderer public barrels', async () => {
        const content = await read('screens/__GamePascal__Board.test.tsx');
        expect(content.startsWith('// @vitest-environment jsdom')).toBe(true);
        expect(content).toContain("from '@testing-library/react'");
        expect(content).toContain("from './__GamePascal__Board.js'");
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
        await expect(read('e2e/global-setup.ts')).resolves.toContain('buildAppBundles');
        await expect(read('e2e/playwright.config.ts')).resolves.toContain('electron-e2e');
        // The runner resolution shim names the app's own package, tokenised.
        await expect(read('e2e/tsconfig.json')).resolves.toContain(
            '@chimera-engine/__game_kebab__/*',
        );
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

    it('ships the electron-builder packaging script + deps in the template package.json (#814)', async () => {
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

    // Bundle-trim contract (#817), mirrored from apps/tactics/electron-builder.test.ts. The
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

    it('ships a tokenised electron-builder packaging config mirroring apps/tactics (#814)', async () => {
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

    it('declares a per-game icon override in the manifest, resolvable under the asset dir (#814)', async () => {
        const manifest = await read('manifest.ts');
        // Renderer-relative path the F67 resolver maps to apps/<gameId>/assets/icons/icon.png.
        expect(manifest).toContain("icon: 'icons/icon.png'");
    });

    it('documents the F69 cursor declaration as a commented-out example, shipping no textures (#849)', async () => {
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

    it('forwards the manifest cursor declaration through the shell loader (#849)', async () => {
        // The injector reads `LoadedRendererGameShell.cursor`, not the manifest —
        // without this verbatim forward (mirroring the model game's loaders),
        // uncommenting the manifest example would never reach the renderer.
        const loaders = await read('renderer/loaders.ts');
        expect(loaders).toContain('cursor: __gameCamel__Manifest.cursor');
    });

    it('declares the engine default logo screen as an ACTIVE manifest field (#857)', async () => {
        const manifest = await read('manifest.ts');
        // Active, not a commented-out example like cursor (#849): every scaffolded
        // game boots Chimera-branded out of the box; a game opts out by deleting
        // the field (or points the route at its own custom page).
        expect(manifest).toContain("logoScreen: { route: '/logo-screen' }");
        expect(manifest).not.toContain('// logoScreen');
    });

    it('re-exports the engine logo-screen page at the declared route (#857)', async () => {
        const page = await read('renderer/app/logo-screen/page.tsx');
        expect(page).toContain(
            "export { default } from '@chimera-engine/renderer/shell/logo-screen/page';",
        );
    });

    it('ships the committed engine brand video under renderer/public (#857)', async () => {
        // Next serves each host's own public/, so the template commits its own
        // copy (same pattern as chimera-logo-compact.png). A scaffolded game
        // replacing it with its own media owns that asset (Invariant #97).
        const mp4 = await readFile(
            path.join(blankTemplateDir, 'renderer', 'public', 'chimera_logo.mp4'),
        );
        // ISO base media file format: bytes 4-8 of the first box are 'ftyp'.
        expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp');
    });

    it('names no model game in any smoke file (tokens only)', async () => {
        const files = [
            'manifest.test.ts',
            'screens/__GamePascal__Board.test.tsx',
            'e2e/tests/boot-smoke.spec.ts',
            'e2e/fixtures/electron.fixture.ts',
            'e2e/fixtures/inherit-env.ts',
            'e2e/global-setup.ts',
            'e2e/playwright.config.ts',
            'e2e/tsconfig.json',
            'electron-builder.yml',
        ];
        for (const rel of files) {
            expect((await read(rel)).toLowerCase()).not.toContain('tactics');
        }
    });
});
