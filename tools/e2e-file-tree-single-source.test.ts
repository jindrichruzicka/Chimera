/**
 * tools/e2e-file-tree-single-source.test.ts
 *
 * What `docs/executive-architecture/module-boundaries-file-tree.md` and
 * `docs/testing/e2e-testing-playwright.md` §13.3 each owe about a consumer app's
 * `e2e/` directory — every one of them, enumerated in `E2E_SUITES` below.
 *
 * The directory was described in both. Only one of them is opened when the directory
 * changes, so the other fell behind — and in one direction only: every name it listed
 * existed, while files that existed went unlisted. That is the harder kind to notice,
 * because nothing a reader clicks on breaks.
 *
 * So, over those two docs:
 *
 *   - the architecture doc keeps the ENTRY and points at §13.3 instead of repeating
 *     it, with the pointer on the entry itself;
 *   - every path §13.3 names exists — the doc→disk direction;
 *   - nothing tracked under §13.3's complete lists goes unrepresented — the disk→doc
 *     direction, which is the one the abandoned copy failed.
 *
 * Which lists are the complete ones is read from §13.3, not fixed here: a row that
 * names `ls` as its census is declaring itself a selection, and the rest are declaring
 * themselves whole. So the doc decides what it promises and the guard holds it to that.
 *
 * The trees are parsed from their ``` fences by indentation, not grepped. A name's
 * depth is what says which directory it belongs to, and a substring search cannot see
 * depth — a row dedented out of `helpers/` reads identically to one still in it.
 */
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTreeRow } from './__test-support__/annotated-file-tree.js';

const repoRoot = path.resolve(import.meta.dirname, '..');

/** The architecture doc that must NOT carry a second copy of the tree. */
const BOUNDARIES_DOC = 'docs/executive-architecture/module-boundaries-file-tree.md';
/** The doc that owns the tree, in its §13.3. */
const E2E_DOC = 'docs/testing/e2e-testing-playwright.md';
/** One consumer app's suite, as the two docs describe it. */
interface E2eSuite {
    /** The directory both docs describe. */
    readonly dir: string;
    /**
     * Floor for the row count of this suite's tree in §13.3.
     *
     * Per suite rather than shared: an unparsed tree names nothing, and one
     * floor over both would be met by the larger tree alone. Each sits a little
     * under its tree's real size, so it fires on a parser that stopped matching
     * rather than on a row someone removed.
     */
    readonly minRows: number;
}

/**
 * Every suite the two docs owe a tree for.
 *
 * A CENSUS, not a sample: the defect this file exists for is a directory that
 * changed while the doc describing it did not, and a suite missing from this
 * list is a suite nothing holds to its tree at all. A second consumer app
 * (`apps/action`) is exactly how that arrives.
 */
const E2E_SUITES: readonly E2eSuite[] = [
    { dir: 'apps/tactics/e2e', minRows: 20 },
    { dir: 'apps/action/e2e', minRows: 20 },
];

/**
 * A row opts out of the completeness check by naming the `ls` that supersedes it —
 * `ls apps/tactics/e2e/tests/` and friends. Matching the pointer rather than the bare
 * word matters: "a complete census of this directory" contains `census` too, and would
 * disarm the check while claiming the opposite of what the opt-out means.
 */
const censusPointerFor = (directory: string): string => `ls ${directory}/`;

/**
 * Whether `annotation` hands the WHOLE of `directory` off to `ls`.
 *
 * The pointer has to end where the directory ends. `ls <dir>/*.test.ts` hands off one
 * class of file — the device the suite root uses — and reads as a narrowing, so taking
 * it as a whole-directory opt-out would switch the completeness check off for
 * everything else in there while the annotation says the opposite.
 */
function handsOffToLs(annotation: string, directory: string): boolean {
    const pointer = censusPointerFor(directory);
    for (
        let at = annotation.indexOf(pointer);
        at !== -1;
        at = annotation.indexOf(pointer, at + 1)
    ) {
        const next = annotation[at + pointer.length];
        if (next === undefined || next === '`' || /\s/u.test(next)) return true;
    }
    return false;
}

/** One entry of a fenced tree, as the path it resolves to under the tree's root. */
interface TreeEntry {
    /** Directory the entry sits in, relative to the tree root (`''` at the root). */
    readonly parent: string;
    readonly name: string;
    readonly isDirectory: boolean;
    /** The entry's own row plus the comment-only rows that follow it. */
    readonly annotation: string;
}

/**
 * Every entry in the fenced tree whose root line is `rootLine`.
 *
 * The fence is chosen by the line that follows its opener, not by being the first one
 * in the file — a doc may fence anything. `rootLine` is that line, and is the tree's
 * own root rather than an entry. An entry's annotation runs to the next row or to a
 * blank line, so a multi-line comment stays attached to what it describes without
 * swallowing whatever follows the tree.
 */
function treeEntries(markdown: string, rootLine: string): TreeEntry[] {
    const lines = markdown.split('\n');
    const openedAt = lines.findIndex(
        (line, i) => line.trim() === '```' && lines[i + 1]?.trim() === rootLine,
    );
    if (openedAt === -1) return [];
    const closedAt = lines.findIndex((line, i) => i > openedAt && line.trim() === '```');
    // An unclosed fence is not a tree to read half of: `slice(_, -1)` would silently
    // return everything but the file's last line. Report nothing and let a floor fire.
    if (closedAt === -1) return [];
    const body = lines.slice(openedAt + 2, closedAt);

    const entries: TreeEntry[] = [];
    const openPath: string[] = [];
    body.forEach((line, index) => {
        const row = parseTreeRow(line);
        if (row === undefined) return;
        const parent = row.depth === 0 ? '' : (openPath[row.depth - 1] ?? '');

        const annotation = [line];
        for (const next of body.slice(index + 1)) {
            if (parseTreeRow(next) !== undefined || next.trim() === '') break;
            annotation.push(next);
        }

        entries.push({
            parent,
            name: row.name,
            isDirectory: row.isDirectory,
            annotation: annotation.join('\n'),
        });
        openPath[row.depth] = parent === '' ? row.name : `${parent}/${row.name}`;
        openPath.length = row.depth + 1;
    });
    return entries;
}

/**
 * What a tree row for `directory` has to account for: every tracked path inside it,
 * reduced to the entry a row would draw — a file by its name, anything deeper by the
 * subdirectory it sits in. A nested file therefore requires its directory to appear,
 * which is what keeps this from going quiet the moment someone adds a folder.
 *
 * `.gitkeep` is dropped here because it names no module and no tree draws it. Every
 * other class of file — co-located unit tests included — is left in, for a `*` row in
 * the doc to excuse or not.
 */
function drawnEntries(relativePaths: readonly string[]): string[] {
    const entries = relativePaths
        .filter((relative) => !/(?:^|\/)\.gitkeep$/u.test(relative))
        .map((relative) => relative.split('/')[0] ?? relative);
    return [...new Set(entries)];
}

/**
 * {@link drawnEntries} over what git tracks inside `directory`.
 *
 * `git ls-files` rather than a directory read, so build output the suite drops in
 * place (`playwright-report/`, `results/`) is out by construction rather than by a
 * hand-kept skip list.
 */
function trackedEntries(directory: string): string[] {
    return drawnEntries(
        execFileSync('git', ['ls-files', directory], { cwd: repoRoot, encoding: 'utf8' })
            .split('\n')
            .filter(Boolean)
            .map((file) => path.relative(directory, file)),
    );
}

/**
 * Whether one of `rows` accounts for `name`.
 *
 * A row is usually a literal filename, but the tree also draws `*` rows — the suite's
 * co-located unit tests are one row rather than one row each. Honouring them here is
 * what lets a directory decline to enumerate a class of file in the doc.
 */
function isAccountedFor(name: string, rows: readonly string[]): boolean {
    return rows.some((row) => {
        if (!row.includes('*')) return row === name;
        const pattern = row
            .split('*')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
            .join('[^/]*');
        return new RegExp(`^${pattern}$`, 'u').test(name);
    });
}

/**
 * The directories a tree promises in FULL: every drawn directory that does not hand
 * off to `ls`, plus the tree's own root.
 *
 * The root has to be added by hand because it is the fence's root line rather than a
 * row in it. Left out, a file dropped straight into the root — the plainest form of
 * the drift this guard is about — goes unnoticed.
 */
function completeDirectoriesOf(entries: readonly TreeEntry[], treeRoot: string): TreeEntry[] {
    const root: TreeEntry = { parent: '', name: '', isDirectory: true, annotation: '' };
    return [root, ...entries.filter((entry) => entry.isDirectory)].filter(
        (entry) => !handsOffToLs(entry.annotation, path.join(treeRoot, entry.parent, entry.name)),
    );
}

/**
 * Paths under `treeRoot` that `listing` reports and no row of the tree accounts for.
 *
 * `listing` is a parameter so the failure path can be driven from a fixture: over the
 * real docs it is {@link trackedEntries}, which is green, and a green input exercises
 * only the answer this returns when there is nothing to report.
 */
function unaccountedUnder(
    entries: readonly TreeEntry[],
    treeRoot: string,
    listing: (directory: string) => string[],
): string[] {
    return completeDirectoriesOf(entries, treeRoot).flatMap((entry) => {
        const directory = path.join(treeRoot, entry.parent, entry.name);
        const rows = entries
            .filter((row) => row.parent === path.relative(treeRoot, directory))
            .map((row) => row.name);
        return listing(directory)
            .filter((name) => !isAccountedFor(name, rows))
            .map((name) => path.join(directory, name));
    });
}

const read = (relative: string): Promise<string> => readFile(path.join(repoRoot, relative), 'utf8');

describe.each(E2E_SUITES)(
    '$dir, across the two docs that describe it',
    ({ dir: E2E_DIR, minRows }) => {
        it('is named but NOT re-listed by the architecture file tree', async () => {
            const markdown = await read(BOUNDARIES_DOC);
            const entries = treeEntries(markdown, 'chimera/');

            // Floor: without it, a parser that stops matching reports every directory as
            // childless and this whole case passes by finding nothing.
            expect(entries.length).toBeGreaterThan(100);

            // The entry stays — the architecture tree should still say the suite exists.
            expect(entries.map((entry) => entry.name)).toContain(E2E_DIR);
            // Its contents do not. Any child here is a second tree maintained by nobody.
            const relisted = entries.filter(
                (entry) => entry.parent === E2E_DIR || entry.parent.startsWith(`${E2E_DIR}/`),
            );
            expect(relisted).toEqual([]);
        });

        it('sends the reader on from the entry itself, not from a footer', async () => {
            const markdown = await read(BOUNDARIES_DOC);
            const target = path.relative(path.dirname(BOUNDARIES_DOC), E2E_DOC);

            // The pointer has to sit ON the entry: that is where a reader who came looking
            // for the listing is standing. A row in the doc's Cross-References footer is a
            // convenience and cannot stand in for it, so this is scoped to the entry's own
            // annotation rather than to the file, which the footer row alone would satisfy.
            const entry = treeEntries(markdown, 'chimera/').find((row) => row.name === E2E_DIR);

            expect(entry).toBeDefined();
            expect(entry?.annotation).toContain(target);
        });

        it('names only paths that exist', async () => {
            const entries = treeEntries(await read(E2E_DOC), `${E2E_DIR}/`);

            // Floor, as above: an unparsed tree names nothing and would resolve vacuously.
            expect(entries.length).toBeGreaterThan(minRows);

            const missing = entries
                // `*.test.ts` is a stated wildcard row, not a filename.
                .filter((entry) => !entry.name.includes('*'))
                .map((entry) => path.join(E2E_DIR, entry.parent, entry.name))
                .filter((relative) => !existsSync(path.join(repoRoot, relative)));

            expect(missing).toEqual([]);
        });

        it('leaves nothing tracked unrepresented, in the directories it does not call a selection', async () => {
            const entries = treeEntries(await read(E2E_DOC), `${E2E_DIR}/`);

            // Floor: the checked set collapsing to the root alone would quietly shrink this
            // to a single directory while still passing. The root is always in it, so a
            // bare non-empty floor could never fire.
            expect(completeDirectoriesOf(entries, E2E_DIR).length).toBeGreaterThan(1);

            // A second floor, and this one is about the DISK. `trackedEntries` reads
            // `git ls-files`, so a suite whose files are not committed yet reports
            // nothing to account for — and the check below would pass against an empty
            // listing while the doc said whatever it liked.
            expect(trackedEntries(E2E_DIR).length).toBeGreaterThan(1);

            expect(unaccountedUnder(entries, E2E_DIR, trackedEntries)).toEqual([]);
        });
    },
);

/**
 * The cases above read the real docs, which are green — so they exercise only the
 * passing path of the predicates underneath them, and a predicate weakened to accept
 * anything would keep them green. These build their own inputs and drive the failure
 * path directly.
 */
describe('the predicates those checks are built from', () => {
    it('keeps a co-located unit test, leaving the excusing to a doc row', () => {
        // Dropping a class of file here rather than in the doc hides it from the check
        // in a directory the doc calls complete, and every case above stays green.
        expect(drawnEntries(['inherit-env.test.ts'])).toEqual(['inherit-env.test.ts']);
    });

    it('reads a row as belonging to the directory its depth puts it in', () => {
        const fence = [
            '```',
            'root/',
            '├── top.ts',
            '├── sub/',
            '│   └── inner.ts',
            '└── after.ts',
            '```',
        ].join('\n');

        expect(treeEntries(fence, 'root/')).toEqual([
            { parent: '', name: 'top.ts', isDirectory: false, annotation: '├── top.ts' },
            { parent: '', name: 'sub', isDirectory: true, annotation: '├── sub/' },
            { parent: 'sub', name: 'inner.ts', isDirectory: false, annotation: '│   └── inner.ts' },
            // Back at the root: `sub`'s subtree ended, so this must not read as its child.
            { parent: '', name: 'after.ts', isDirectory: false, annotation: '└── after.ts' },
        ]);
    });

    it('picks the fence by its root line, not by being the first fence in the file', () => {
        const fence = [
            '```',
            'decoy/',
            '└── wrong.ts',
            '```',
            '',
            '```',
            'root/',
            '└── right.ts',
            '```',
        ].join('\n');

        // Both docs happen to put their tree in the first fence today, so nothing else
        // here would notice this being read as "the first fence" — and a fence added
        // anywhere above the tree would then silently re-point the whole guard.
        expect(treeEntries(fence, 'root/').map((entry) => entry.name)).toEqual(['right.ts']);
    });

    it('reads nothing from a fence that is never closed', () => {
        const fence = ['```', 'root/', '├── a.ts', 'trailing prose, no closing fence'].join('\n');

        // Returning entries here would mean reading to the second-to-last line of the
        // whole file and calling the result a tree.
        expect(treeEntries(fence, 'root/')).toEqual([]);
    });

    it('stops an annotation at a blank line, so it cannot absorb the next block', () => {
        const fence = ['```', 'root/', '├── a.ts', '', '#   ls root/b/ is the census', '```'].join(
            '\n',
        );

        // A run-on annotation is not cosmetic: text swept up from below can carry an
        // `ls` hand-off, which switches the completeness check off for that directory.
        expect(treeEntries(fence, 'root/')[0]?.annotation).toBe('├── a.ts');
    });

    it('reduces anything nested to the directory a row would draw', () => {
        expect(drawnEntries(['sub/a.ts', 'sub/deep/b.ts', 'top.ts'])).toEqual(['sub', 'top.ts']);
    });

    it('drops .gitkeep, which no tree draws', () => {
        expect(drawnEntries(['.gitkeep', 'a.ts'])).toEqual(['a.ts']);
    });

    it('accounts for a name only when a row actually names it', () => {
        // The whole disk→doc check is this predicate. Answering true unconditionally
        // empties its result and every case above still passes.
        expect(isAccountedFor('electron.fixture.ts', ['electron.fixture.ts'])).toBe(true);
        expect(isAccountedFor('electron.fixture.ts', ['lobby.fixture.ts'])).toBe(false);
        expect(isAccountedFor('electron.fixture.ts', [])).toBe(false);
        // Whole name, not a substring of one: a row is a filename, so `fixture.ts`
        // standing in for `electron.fixture.ts` would excuse a file nobody drew.
        expect(isAccountedFor('electron.fixture.ts', ['fixture.ts'])).toBe(false);
    });

    it('reads a * row as the class of file it draws, and no wider', () => {
        expect(isAccountedFor('inherit-env.test.ts', ['*.test.ts'])).toBe(true);
        expect(isAccountedFor('inherit-env.ts', ['*.test.ts'])).toBe(false);
        // A row draws one directory's contents, so its `*` may not span a separator —
        // otherwise a root `*.test.ts` row would excuse every test file beneath it.
        expect(isAccountedFor('sub/inherit-env.test.ts', ['*.test.ts'])).toBe(false);
        // The row ends where it ends: a name that continues past it is a different
        // file, and `.tsx` modules are a class this suite really does contain.
        expect(isAccountedFor('inherit-env.test.tsx', ['*.test.ts'])).toBe(false);
        expect(isAccountedFor('inherit-env.test.ts.bak', ['*.test.ts'])).toBe(false);
        // The literal parts stay literal — with `.` left as a wildcard, `latest.ts`
        // reads as `la` + `test` + any + `ts` and would be excused by this row.
        expect(isAccountedFor('latest.ts', ['*.test.ts'])).toBe(false);
    });

    it('holds the tree ROOT to its own list, not only the directories drawn inside it', () => {
        const fence = ['```', 'root/', '├── listed.ts', '└── sub/', '    └── inner.ts', '```'].join(
            '\n',
        );
        const tracked: Record<string, string[]> = {
            root: ['listed.ts', 'sub', 'stray.ts'],
            'root/sub': ['inner.ts', 'extra.ts'],
        };

        // Both terms of the checked set at once: the root, which is the fence's root
        // line and so has to be added by hand, and a directory the fence draws.
        expect(
            unaccountedUnder(treeEntries(fence, 'root/'), 'root', (d) => tracked[d] ?? []),
        ).toEqual(['root/stray.ts', 'root/sub/extra.ts']);
    });

    it('matches a name against its OWN directory rows, not every row in the tree', () => {
        const fence = [
            '```',
            'root/',
            '├── listed.ts',
            '└── sub/',
            '    └── shared.ts',
            '```',
        ].join('\n');
        const tracked: Record<string, string[]> = {
            root: ['listed.ts', 'sub', 'shared.ts'],
            'root/sub': ['shared.ts'],
        };

        // One basename in two directories is the case that separates a scoped lookup
        // from a global one: `sub/shared.ts` is drawn, the root's is not, and only a
        // lookup that respects depth can tell them apart.
        expect(
            unaccountedUnder(treeEntries(fence, 'root/'), 'root', (d) => tracked[d] ?? []),
        ).toEqual(['root/shared.ts']);
    });

    it('skips a directory that hands off to ls, and only that directory', () => {
        const fence = [
            '```',
            'root/',
            '├── listed.ts',
            '└── sub/                        # `ls root/sub/` is the census',
            '```',
        ].join('\n');
        const tracked: Record<string, string[]> = {
            root: ['listed.ts', 'sub', 'stray.ts'],
            'root/sub': ['whatever.ts'],
        };

        // `sub/` opted out; the root did not, so its stray file is still reported.
        expect(
            unaccountedUnder(treeEntries(fence, 'root/'), 'root', (d) => tracked[d] ?? []),
        ).toEqual(['root/stray.ts']);
    });

    it('opts a directory out on the ls hand-off, not on merely naming it', () => {
        const directory = 'apps/tactics/e2e/fixtures';

        expect(handsOffToLs(`#   \`ls ${directory}/\` is the census.`, directory)).toBe(true);
        expect(handsOffToLs(`#   ls ${directory}/ is the census`, directory)).toBe(true);
        // An annotation that mentions the directory — or claims to be a complete census
        // of it — must not read as the hand-off that switches the check off.
        expect(handsOffToLs(`# see ${directory} in the repo`, directory)).toBe(false);
        expect(handsOffToLs(`# A complete census of ${directory}.`, directory)).toBe(false);
        // Nor may a hand-off of one CLASS of file inside it stand for the whole
        // directory — that reads as narrowing and would switch the check off entirely.
        expect(handsOffToLs(`#   \`ls ${directory}/*.test.ts\` is the census.`, directory)).toBe(
            false,
        );
        // And it is this directory's own pointer that counts, not a sibling's.
        expect(handsOffToLs(`#   \`ls ${directory}-other/\` is the census.`, directory)).toBe(
            false,
        );
    });

    it.each(E2E_SUITES)(
        'lists $dir for real, so an empty listing cannot make the check vacuous',
        ({ dir }) => {
            // `unaccountedUnder` asserts an EMPTY result over the real docs. That is only
            // a statement about the tree while the disk side actually reports something,
            // so the production listing is pinned here rather than only through the
            // fixtures' own closures. Both suites, because `git ls-files` answers nothing
            // for a directory that is not committed yet — which is exactly the state a
            // NEW suite arrives in, and the state in which every doc check above would
            // pass against an empty listing.
            const entries = trackedEntries(dir);

            expect(entries).toContain('fixtures');
            expect(entries).toContain('playwright.config.ts');
            // Reporter output, which a suite writes into its own directory: untracked,
            // so `git ls-files` leaves it out without a skip list naming it.
            expect(entries).not.toContain('playwright-report');
        },
    );
});
