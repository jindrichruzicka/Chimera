import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scaffoldGame } from './index';
import { InvalidGameNameError } from './normalize';
import { findLeftoverTokens } from './tokens';

/**
 * Integration tests for the `create-chimera-game` scaffold core. Each test builds a throwaway
 * repo in a temp dir — a `templates/<id>/` skeleton plus the two repo-root files the scaffolder
 * must wire (`package.json`, `tsconfig.build.json`) — and drives {@link scaffoldGame} directly.
 * The `pnpm install` side effect lives only in the CLI-entry guard (VITEST-excluded), so these
 * tests never spawn a real install and stay hermetic.
 */
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
                    name: '@chimera/__game_kebab__',
                    private: true,
                    dependencies: { '@chimera/simulation': 'workspace:*' },
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
                        '@chimera/ai': 'workspace:*',
                        '@chimera/tactics': 'workspace:*',
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
        const result = await scaffoldGame({ repoRoot, name: 'My Card Game' });

        expect(result.appDir).toBe(path.join(repoRoot, 'apps', 'my-card-game'));
        expect(result.filesWritten.length).toBeGreaterThan(0);

        const contentPath = path.join(result.appDir, 'content', 'myCardGameContent.ts');
        const content = await readFile(contentPath, 'utf8');
        expect(content).toContain('myCardGameContent');
        expect(content).toContain("My Card Game's content module");
        expect(content).toContain("MY_CARD_GAME_GAME_ID = 'my-card-game'");

        const boardPath = path.join(result.appDir, 'screens', 'MyCardGameBoard.tsx');
        expect(await readFile(boardPath, 'utf8')).toContain('MyCardGameBoard');

        const pkg = JSON.parse(await readFile(path.join(result.appDir, 'package.json'), 'utf8'));
        expect(pkg.name).toBe('@chimera/my-card-game');
    });

    it('does not copy the template node_modules and leaves no token markers behind', async () => {
        const result = await scaffoldGame({ repoRoot, name: 'My Card Game' });

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

        const result = await scaffoldGame({ repoRoot, name: 'My Card Game' });

        const copied = await readFile(path.join(result.appDir, 'renderer', 'public', 'logo.bin'));
        expect(copied.equals(bytes)).toBe(true);
    });

    it('wires the new app into root package.json, tsconfig.build.json, and the typecheck script', async () => {
        await scaffoldGame({ repoRoot, name: 'My Card Game' });

        const pkg = await readRootPkg();
        expect(pkg.dependencies['@chimera/my-card-game']).toBe('workspace:*');
        // Alphabetically ordered within the @chimera/* block.
        const keys = Object.keys(pkg.dependencies);
        expect(keys).toEqual([...keys].sort());
        expect(pkg.scripts['typecheck']).toContain(
            'tsc --noEmit -p apps/my-card-game/tsconfig.json',
        );

        const tsconfig = await readRootTsconfig();
        expect(tsconfig.references).toContainEqual({
            path: './apps/my-card-game/tsconfig.build.json',
        });
    });

    it('resolves an arbitrary --template id with no CLI code change', async () => {
        const result = await scaffoldGame({ repoRoot, name: 'Space Duel', template: 'other' });

        const manifest = await readFile(path.join(result.appDir, 'manifest.ts'), 'utf8');
        expect(manifest).toContain('spaceDuelManifest');
        expect(manifest).toContain('id: "space-duel"');
    });

    it('errors and lists available template ids for an unknown template', async () => {
        await expect(
            scaffoldGame({ repoRoot, name: 'Whatever', template: 'nope' }),
        ).rejects.toThrow(/blank/);
    });

    it('refuses to overwrite an existing app', async () => {
        await write('apps/my-card-game/keep.txt', 'do not clobber');

        await expect(scaffoldGame({ repoRoot, name: 'My Card Game' })).rejects.toThrow(/exists/i);

        expect(
            await readFile(path.join(repoRoot, 'apps', 'my-card-game', 'keep.txt'), 'utf8'),
        ).toBe('do not clobber');
    });

    it('rejects an invalid game name before any write', async () => {
        await expect(scaffoldGame({ repoRoot, name: '123' })).rejects.toBeInstanceOf(
            InvalidGameNameError,
        );
    });
});
