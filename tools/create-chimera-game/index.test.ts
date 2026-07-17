import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveTemplatesRoot, scaffoldGame } from './index';
import { InvalidGameNameError } from './normalize';
import { findLeftoverTokens } from './tokens';

/**
 * Integration tests for the `create-chimera-game` scaffold core. Each test builds a throwaway
 * repo in a temp dir — a `templates/<id>/` skeleton plus the two repo-root files the scaffolder
 * must wire (`package.json`, `tsconfig.build.json`) — and drives {@link scaffoldGame} directly.
 * The `pnpm install` side effect lives only in the CLI-entry guard (VITEST-excluded), so these
 * tests never spawn a real install and stay hermetic.
 */
describe('resolveTemplatesRoot', () => {
    it('returns the package-relative templates dir when running from the source layout', () => {
        // Source run: tools/create-chimera-game/index.ts → ./templates is a sibling.
        const entryDir = path.join('/repo', 'tools', 'create-chimera-game');
        const sourceTemplates = path.join(entryDir, 'templates');
        const exists = (p: string): boolean => p === sourceTemplates;
        expect(resolveTemplatesRoot(entryDir, exists)).toBe(sourceTemplates);
    });

    it('returns the dist-sibling templates dir when running from the built dist layout', () => {
        // Published/dist run: dist/index.js → ../templates (templates ships beside dist/).
        const pkgDir = path.join('/pkg', 'create-chimera-game');
        const entryDir = path.join(pkgDir, 'dist');
        const distSiblingTemplates = path.join(pkgDir, 'templates');
        // dist/templates does NOT exist; only the package-root templates/ does.
        const exists = (p: string): boolean => p === distSiblingTemplates;
        expect(resolveTemplatesRoot(entryDir, exists)).toBe(distSiblingTemplates);
    });
});

describe('scaffoldGame', () => {
    let repoRoot: string;

    /** Recursively collect file paths (relative to `dir`, posix-joined) under a directory. */
    const listFiles = async (dir: string, prefix = ''): Promise<string[]> => {
        const entries = await readdir(dir, { withFileTypes: true });
        const out: string[] = [];
        for (const entry of entries) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory())
                out.push(...(await listFiles(path.join(dir, entry.name), rel)));
            else out.push(rel);
        }
        return out;
    };

    const write = async (relPath: string, contents: string): Promise<void> => {
        const abs = path.join(repoRoot, relPath);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, contents, 'utf8');
    };

    beforeEach(async () => {
        repoRoot = await mkdtemp(path.join(tmpdir(), 'chimera-create-game-'));
        await mkdir(path.join(repoRoot, 'apps'), { recursive: true });

        // templates/blank — a minimal tokenised skeleton with tokens in BOTH contents and names,
        // plus a node_modules dir that must NOT be copied.
        await write(
            'templates/blank/package.json',
            JSON.stringify(
                {
                    name: '@chimera-engine/__game_kebab__',
                    private: true,
                    dependencies: { '@chimera-engine/simulation': 'workspace:*' },
                },
                null,
                4,
            ),
        );
        await write(
            'templates/blank/content/__gameCamel__Content.ts',
            [
                "// __Game Title__'s content module.",
                'export const __gameCamel__Content = {};',
                "export const __GAME_CONSTANT___GAME_ID = '__game_kebab__';",
            ].join('\n'),
        );
        await write(
            'templates/blank/screens/__GamePascal__Board.tsx',
            'export function __GamePascal__Board() { return null; }',
        );
        // The build + e2e tsconfigs carry monorepo-relative refs/paths (workspace-correct); the
        // standalone emit must neutralise them (#816). JSONC with comments — emitted verbatim then
        // rewritten by string-splice.
        await write(
            'templates/blank/tsconfig.build.json',
            [
                '{',
                '    // Composite build for this @chimera-engine/<game> consumer app.',
                '    "extends": "../../tsconfig.json",',
                '    "compilerOptions": { "composite": true, "outDir": "./dist" },',
                '    "references": [',
                '        { "path": "../../simulation/tsconfig.build.json" },',
                '        { "path": "../../electron/tsconfig.build.json" }',
                '    ],',
                '    "include": ["**/*.ts", "**/*.tsx"]',
                '}',
                '',
            ].join('\n'),
        );
        await write(
            'templates/blank/e2e/tsconfig.json',
            [
                '{',
                '    "extends": "../../../tsconfig.json",',
                '    "compilerOptions": {',
                '        "baseUrl": "../../..",',
                '        "paths": {',
                '            "@chimera-engine/simulation/*": ["simulation/dist/*"],',
                '            "@chimera-engine/electron/*": ["electron/dist/*"],',
                '            "@chimera-engine/__game_kebab__/*": ["apps/__game_kebab__/*"]',
                '        }',
                '    }',
                '}',
                '',
            ].join('\n'),
        );
        await write('templates/blank/node_modules/junk.js', 'module.exports = {};');

        // A SECOND template, used to prove template parametrisation with no CLI code change.
        await write(
            'templates/other/manifest.ts',
            'export const __gameCamel__Manifest = { id: "__game_kebab__" };',
        );

        // Repo-root files the scaffolder wires (full tactics parity).
        await write(
            'package.json',
            JSON.stringify(
                {
                    name: 'chimera',
                    dependencies: {
                        '@chimera-engine/ai': 'workspace:*',
                        '@chimera-engine/tactics': 'workspace:*',
                    },
                    scripts: {
                        typecheck: 'tsc --noEmit && tsc --noEmit -p apps/tactics/tsconfig.json',
                    },
                },
                null,
                4,
            ),
        );
        await write(
            'tsconfig.build.json',
            JSON.stringify(
                { files: [], references: [{ path: './apps/tactics/tsconfig.build.json' }] },
                null,
                4,
            ),
        );
    });

    afterEach(async () => {
        await rm(repoRoot, { recursive: true, force: true });
    });

    const readRootPkg = async (): Promise<{
        dependencies: Record<string, string>;
        scripts: Record<string, string>;
    }> => JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

    const readRootTsconfig = async (): Promise<{ references: { path: string }[] }> =>
        JSON.parse(await readFile(path.join(repoRoot, 'tsconfig.build.json'), 'utf8'));

    it('scaffolds apps/<kebab> from the default blank template, substituting names + contents', async () => {
        const result = await scaffoldGame({ repoRoot, name: 'My Game' });

        expect(result.appDir).toBe(path.join(repoRoot, 'apps', 'my-game'));
        expect(result.filesWritten.length).toBeGreaterThan(0);

        const contentPath = path.join(result.appDir, 'content', 'myGameContent.ts');
        const content = await readFile(contentPath, 'utf8');
        expect(content).toContain('myGameContent');
        expect(content).toContain("My Game's content module");
        expect(content).toContain("MY_GAME_GAME_ID = 'my-game'");

        const boardPath = path.join(result.appDir, 'screens', 'MyGameBoard.tsx');
        expect(await readFile(boardPath, 'utf8')).toContain('MyGameBoard');

        const pkg = JSON.parse(await readFile(path.join(result.appDir, 'package.json'), 'utf8'));
        expect(pkg.name).toBe('@chimera-engine/my-game');
    });

    it('does not copy the template node_modules and leaves no token markers behind', async () => {
        const result = await scaffoldGame({ repoRoot, name: 'My Game' });

        const files = await listFiles(result.appDir);
        expect(files.some((f) => f.includes('node_modules'))).toBe(false);

        for (const rel of files) {
            const text = await readFile(path.join(result.appDir, rel), 'utf8');
            expect(findLeftoverTokens(text)).toEqual([]);
            expect(findLeftoverTokens(rel)).toEqual([]);
        }
    });

    it('copies binary template files byte-for-byte without token substitution', async () => {
        // A binary asset (e.g. an image/font a game template ships): a NUL byte marks
        // it binary, and the ASCII bytes spell a token literal that MUST survive verbatim
        // — proving binary files bypass the utf8 read + token substitution that would
        // otherwise corrupt them.
        const bytes = Buffer.concat([
            Buffer.from([0x00, 0x01, 0x02, 0xff]),
            Buffer.from('__game_kebab__'),
            Buffer.from([0xfe, 0x00]),
        ]);
        const abs = path.join(repoRoot, 'templates', 'blank', 'renderer', 'public', 'logo.bin');
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, bytes);

        const result = await scaffoldGame({ repoRoot, name: 'My Game' });

        const copied = await readFile(path.join(result.appDir, 'renderer', 'public', 'logo.bin'));
        expect(copied.equals(bytes)).toBe(true);
    });

    it('wires the new app into root package.json, tsconfig.build.json, and the typecheck script', async () => {
        await scaffoldGame({ repoRoot, name: 'My Game' });

        const pkg = await readRootPkg();
        expect(pkg.dependencies['@chimera-engine/my-game']).toBe('workspace:*');
        // Alphabetically ordered within the @chimera-engine/* block.
        const keys = Object.keys(pkg.dependencies);
        expect(keys).toEqual([...keys].sort());
        expect(pkg.scripts['typecheck']).toContain('tsc --noEmit -p apps/my-game/tsconfig.json');

        const tsconfig = await readRootTsconfig();
        expect(tsconfig.references).toContainEqual({
            path: './apps/my-game/tsconfig.build.json',
        });
    });

    it('wires a per-game packaging script into root package.json (workspace mode)', async () => {
        // F67/#814: a scaffolded app inherits the same package-from-monorepo flow as
        // apps/tactics' root `package:tactics` — build the packages + renderer + app bundle,
        // then run the app's electron-builder. The script is tokenised on the kebab name.
        await scaffoldGame({ repoRoot, name: 'My Game' });

        const pkg = await readRootPkg();
        const script = pkg.scripts['package:my-game'];
        expect(script).toBeDefined();
        expect(script).toContain('pnpm build:packages');
        expect(script).toContain('next build apps/my-game/renderer');
        expect(script).toContain('pnpm --filter @chimera-engine/my-game build:app');
        expect(script).toContain('pnpm --filter @chimera-engine/my-game run package');
    });

    it('resolves an arbitrary --template id with no CLI code change', async () => {
        const result = await scaffoldGame({ repoRoot, name: 'Space Duel', template: 'other' });

        const manifest = await readFile(path.join(result.appDir, 'manifest.ts'), 'utf8');
        expect(manifest).toContain('spaceDuelManifest');
        expect(manifest).toContain('id: "space-duel"');
    });

    it('resolves templates from an explicit templatesRoot decoupled from repoRoot', async () => {
        // The published CLI bundles templates beside its own code, NOT under the output
        // repo root. Prove the split: a templatesRoot OUTSIDE repoRoot still scaffolds,
        // and the app still lands under the output root (repoRoot/apps).
        const templatesRoot = await mkdtemp(path.join(tmpdir(), 'chimera-templates-'));
        try {
            await mkdir(path.join(templatesRoot, 'solo'), { recursive: true });
            await writeFile(
                path.join(templatesRoot, 'solo', 'manifest.ts'),
                'export const __gameCamel__Id = "__game_kebab__";',
                'utf8',
            );

            const result = await scaffoldGame({
                repoRoot,
                name: 'Solo Game',
                template: 'solo',
                templatesRoot,
            });

            const manifest = await readFile(path.join(result.appDir, 'manifest.ts'), 'utf8');
            expect(manifest).toContain('soloGameId');
            expect(manifest).toContain('"solo-game"');
            // Output root is unchanged — the app lands under repoRoot/apps, not templatesRoot.
            expect(result.appDir).toBe(path.join(repoRoot, 'apps', 'solo-game'));
        } finally {
            await rm(templatesRoot, { recursive: true, force: true });
        }
    });

    it('errors and lists available template ids for an unknown template', async () => {
        await expect(
            scaffoldGame({ repoRoot, name: 'Whatever', template: 'nope' }),
        ).rejects.toThrow(/blank/);
    });

    it('refuses to overwrite an existing app', async () => {
        await write('apps/my-game/keep.txt', 'do not clobber');

        await expect(scaffoldGame({ repoRoot, name: 'My Game' })).rejects.toThrow(/exists/i);

        expect(await readFile(path.join(repoRoot, 'apps', 'my-game', 'keep.txt'), 'utf8')).toBe(
            'do not clobber',
        );
    });

    it('rejects an invalid game name before any write', async () => {
        await expect(scaffoldGame({ repoRoot, name: '123' })).rejects.toBeInstanceOf(
            InvalidGameNameError,
        );
    });

    it('emits a self-contained project (root files + rewritten app deps) in standalone mode and leaves the monorepo untouched', async () => {
        // The published CLI (and verify:scaffold via `--out`) drive standalone mode: the app lands
        // under `outputRoot/apps/<kebab>` and a project root is emitted around it (toolchain
        // manifest, workspace yaml, vitest config, tsconfig) with the app's @chimera-engine/* deps onto
        // their published ranges. No monorepo is wired.
        const outputRoot = await mkdtemp(path.join(tmpdir(), 'chimera-standalone-'));
        try {
            const pkgBefore = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
            const tsconfigBefore = await readFile(
                path.join(repoRoot, 'tsconfig.build.json'),
                'utf8',
            );

            const result = await scaffoldGame({
                repoRoot,
                name: 'My Game',
                mode: 'standalone',
                outputRoot,
            });

            // App lands under outputRoot, not repoRoot.
            expect(result.appDir).toBe(path.join(outputRoot, 'apps', 'my-game'));
            expect(await readdir(path.join(repoRoot, 'apps'))).not.toContain('my-game');

            // The standalone project root is emitted.
            for (const file of [
                'package.json',
                'pnpm-workspace.yaml',
                'vitest.config.mts',
                'tsconfig.json',
            ]) {
                expect(
                    await readFile(path.join(outputRoot, file), 'utf8'),
                    `expected ${file} at the project root`,
                ).toBeTruthy();
            }
            const rootPkg = JSON.parse(
                await readFile(path.join(outputRoot, 'package.json'), 'utf8'),
            );
            expect(rootPkg.private).toBe(true);
            expect(rootPkg.devDependencies.vitest).toBeDefined();
            const rootTsconfig = JSON.parse(
                await readFile(path.join(outputRoot, 'tsconfig.json'), 'utf8'),
            );
            expect(rootTsconfig.compilerOptions.strict).toBe(true);
            // The standalone root carries the per-game packaging flow too (#814).
            expect(rootPkg.scripts.package).toContain(
                'pnpm --filter @chimera-engine/my-game run package',
            );

            // The app's @chimera-engine/* deps are rewritten onto published ranges — no workspace:* survives.
            const appPkg = JSON.parse(
                await readFile(path.join(result.appDir, 'package.json'), 'utf8'),
            );
            expect(appPkg.name).toBe('@chimera-engine/my-game');
            // A caret range, optionally with an `-rc.N` release-candidate suffix (`^1.0.0-rc.0`).
            expect(appPkg.dependencies['@chimera-engine/simulation']).toMatch(
                /^\^\d+\.\d+\.\d+(?:-rc\.\d+)?$/,
            );
            expect(JSON.stringify(appPkg)).not.toContain('workspace:*');

            // The app's build/e2e tsconfigs no longer reference monorepo sibling packages (#816):
            // `tsc` / Playwright resolve the engine from node_modules instead.
            const appTsconfigBuild = await readFile(
                path.join(result.appDir, 'tsconfig.build.json'),
                'utf8',
            );
            expect(appTsconfigBuild).not.toContain('../../simulation/tsconfig.build.json');
            expect(appTsconfigBuild).not.toContain('../../electron/tsconfig.build.json');
            expect(appTsconfigBuild).toContain('"references": []');

            const appE2eTsconfig = await readFile(
                path.join(result.appDir, 'e2e', 'tsconfig.json'),
                'utf8',
            );
            expect(appE2eTsconfig).not.toContain('simulation/dist');
            expect(appE2eTsconfig).not.toContain('electron/dist');
            // The game's own path (standalone-valid) is kept.
            expect(appE2eTsconfig).toContain('apps/my-game');

            // The monorepo root is untouched: no dependency added, no tsconfig reference.
            expect(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).toBe(pkgBefore);
            expect(await readFile(path.join(repoRoot, 'tsconfig.build.json'), 'utf8')).toBe(
                tsconfigBefore,
            );
        } finally {
            await rm(outputRoot, { recursive: true, force: true });
        }
    });
});
