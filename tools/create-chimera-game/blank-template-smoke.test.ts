import { readFile } from 'node:fs/promises';
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
        expect(content).toContain("from './constants.js'");
        expect(content).toContain('__gameCamel__Manifest');
        expect(content).toContain('__GAME_CONSTANT___GAME_ID');
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
