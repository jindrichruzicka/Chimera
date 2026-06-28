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
        ];
        for (const rel of files) {
            expect((await read(rel)).toLowerCase()).not.toContain('tactics');
        }
    });
});
