// tools/temp-dir-cleanup-census.test.ts
//
// A test file that allocates an OS temp directory and removes nothing leaves
// one behind on every run. Nothing local reports it: the test passes
// and the suite is green.
//
// Lives beside the other repo-wide censuses rather than next to the helper it
// recommends, because its subject is the whole tree.

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allocatesWithoutRemoving } from './__test-support__/tempDirCleanup.js';

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'out', 'playwright-report']);

/**
 * Files the walk must reach.
 *
 * A SAMPLE, and named as one: a root dropped from the walk that is not
 * represented here goes unnoticed. The alternative — deriving the roots from
 * the same walk being checked — would agree with itself whatever the walk did.
 */
const MUST_REACH = [
    'ai/engine/AIBrain.test.ts',
    'apps/tactics/simulation/scenes.test.ts',
    'electron/dev-tools/__test-support__/tempDir.test.ts',
    'networking/provider/InMemoryMultiplayerProvider.test.ts',
    'renderer/components/scene/SceneRouter.test.tsx',
    'simulation/content/ContentLoader.test.ts',
    'tools/create-chimera-game/index.test.ts',
];

describe('allocatesWithoutRemoving', () => {
    // Fed source text rather than read off the tree, because the tree holds no
    // offender — that is the point of the census — so every judgement it makes
    // there is a negative one. Widening either predicate until it clears
    // everything is the failure this catches.

    it('reports a file that allocates and never removes', () => {
        expect(
            allocatesWithoutRemoving(
                `const dir = await mkdtemp(join(tmpdir(), 'chimera-probe-'));`,
            ),
        ).toBe(true);
    });

    it('clears the same file once it removes', () => {
        expect(
            allocatesWithoutRemoving(
                `const dir = await mkdtemp(join(tmpdir(), 'chimera-probe-'));\n` +
                    `await rm(dir, { recursive: true, force: true });`,
            ),
        ).toBe(false);
    });

    it('clears a file that never allocates, however much it removes', () => {
        expect(allocatesWithoutRemoving(`await rm(somewhereElse);`)).toBe(false);
    });

    it('is not satisfied by the letters rm appearing anywhere', () => {
        // The removal predicate reads a CALL, not a substring.
        expect(
            allocatesWithoutRemoving(
                `// normalize the fixture first
const dir = await mkdtemp(join(tmpdir(), 'p-'));`,
            ),
        ).toBe(true);
    });

    it('is not satisfied by a word-suffixed call that merely ends in rm', () => {
        // The leading word boundary. `transform(` ends in `rm` and is a call, so
        // a predicate that dropped \b while keeping the parens would read this
        // file as cleaning up after itself.
        expect(
            allocatesWithoutRemoving(
                `const dir = await mkdtemp(join(tmpdir(), 'p-'));
const out = transform(dir);`,
            ),
        ).toBe(true);
    });

    it('is not satisfied by a word-suffixed call that merely ends in rmSync', () => {
        // The SECOND alternative carries its own word boundary: `\brm\s*\(`
        // cannot reach `rmSync(` — an `S` follows the `rm` — so the guard on
        // `transformSync(` is a different one from the guard on `transform(`.
        expect(
            allocatesWithoutRemoving(
                `const dir = mkdtempSync(join(tmpdir(), 'p-'));
const out = transformSync(dir);`,
            ),
        ).toBe(true);
    });

    it('reads an allocation whose arguments are wrapped across lines', () => {
        // `[^)]*` crosses newlines where `.*` does not, and prettier produces
        // this shape whenever the inner join also exceeds the print width. The
        // \s* after the opening paren absorbs the FIRST newline, so only the
        // interior one separates the two.
        expect(
            allocatesWithoutRemoving(
                [
                    'const dir = await mkdtemp(',
                    '    path.join(',
                    '        os.tmpdir(),',
                    "        'chimera-a-long-prefix-',",
                    '    ),',
                    ');',
                ].join('\n'),
            ),
        ).toBe(true);
    });

    it('ignores an allocation rooted somewhere other than tmpdir', () => {
        expect(allocatesWithoutRemoving(`const dir = await mkdtemp('/srv/scratch/p-');`)).toBe(
            false,
        );
    });

    it('is not satisfied by a removal identifier that is never called', () => {
        expect(
            allocatesWithoutRemoving(
                `import { rmSync } from 'node:fs';
const dir = mkdtempSync(join(tmpdir(), 'p-'));`,
            ),
        ).toBe(true);
    });

    it('reads the synchronous form too', () => {
        expect(
            allocatesWithoutRemoving(`const dir = mkdtempSync(path.join(tmpdir(), 'x-'));`),
        ).toBe(true);
    });
});

describe('temp directory cleanup census', () => {
    it('reaches the files it samples across the tree', async () => {
        // The census below asserts an EMPTY list, which an empty corpus
        // satisfies. This case is what makes that assertion mean something: a
        // walk that collapsed, lost a package, or dropped the `.tsx` arm stops
        // reading the files the census is supposed to judge, and reports
        // nothing wrong while doing it.
        const files = new Set(await collectRelativeTestFiles());

        for (const sample of MUST_REACH) {
            expect(existsSync(join(repoRoot(), sample)), `${sample} has moved`).toBe(true);
            expect(files.has(sample), `the walk did not reach ${sample}`).toBe(true);
        }
    });

    it('finds no test file that allocates a temp directory and removes nothing', async () => {
        // SCOPE, stated here because it is narrower than the case name reads at
        // a glance: a file is cleared by containing ANY removal, so one that
        // removes a single directory while allocating several passes. That
        // shape has occurred and was found by counting per-prefix entries in
        // the temp directory, not here. What this catches is the coarser and
        // more common shape — a file that allocates and never removes at all.
        //
        // Files that allocate directly AND clean up by hand are deliberately
        // left alone rather than converted, so this census is a floor on
        // behaviour and not a house style.
        const offenders: string[] = [];
        for (const path of await collectRelativeTestFiles()) {
            const source = await readFile(join(repoRoot(), path), 'utf8');
            if (allocatesWithoutRemoving(source)) {
                offenders.push(path);
            }
        }

        expect(
            offenders,
            'these test files allocate an OS temp directory and never remove one',
        ).toEqual([]);
    });
});

function repoRoot(): string {
    // Found rather than assumed: the suite runs from the workspace root or from
    // a package depending on how it was invoked.
    let dir = process.cwd();
    for (let depth = 0; depth < 6; depth += 1) {
        if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
            return dir;
        }
        dir = join(dir, '..');
    }
    throw new Error('pnpm-workspace.yaml not found above the test cwd');
}

/** Every test file, as a repo-relative path with forward slashes on every platform. */
async function collectRelativeTestFiles(): Promise<string[]> {
    const found = await collectTestFiles(repoRoot());
    return found.map((file) => relative(repoRoot(), file).split(sep).join('/'));
}

async function collectTestFiles(root: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name)) {
                found.push(...(await collectTestFiles(full)));
            }
            continue;
        }
        if (/\.test\.tsx?$/.test(entry.name)) {
            found.push(full);
        }
    }
    return found;
}
