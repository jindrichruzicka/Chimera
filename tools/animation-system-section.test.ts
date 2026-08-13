/**
 * tools/animation-system-section.test.ts
 *
 * Anti-rot guard for the Animation System core-component section — the number
 * F82 reserved and F89 built a second feature's worth of surface underneath.
 *
 * Three things rot independently and each is ratcheted here.
 *
 * **The number.** A reserved section number is cited by prose that says it is
 * reserved; once the section exists that prose is false. So every tracked file
 * carrying the token must also carry a path that RESOLVES to the section — a
 * dead path or a bare basename is the same defect wearing the right name — and
 * the two sentences that reserved it must be gone rather than reworded.
 *
 * **The index.** `docs/architecture-overview.md` is the hub every other section
 * is reached through; a section absent from its table is unreachable however
 * good it is.
 *
 * **The pointers.** The section states named rules and invariants and points
 * each at the test that measures it. A pointer to a renamed test is worse than
 * no pointer: it reads as evidence and is not. Every one is resolved here
 * against the tree — the file must exist, and the title must still be the title
 * of a `describe` or an `it` inside it — and the parsed count is checked
 * against the `›` separators in the cell, so a pointer cannot escape resolution
 * by ceasing to be a link.
 *
 * `readFileSync` throws if a doc moves, so this guard fails loud rather than
 * passing vacuously on a renamed path.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

/** This guard scans the tree for a token it necessarily discusses, so it skips itself. */
const SELF = 'tools/animation-system-section.test.ts';

const SECTION_DOC = 'docs/core-components/animation-system.md';
const OVERVIEW_DOC = 'docs/architecture-overview.md';
const ROADMAP_DOC = 'docs/roadmap-sections/m10-first-public-release-v1.0.0.md';

/**
 * The section number, assembled at run time so this file's own source never
 * carries the contiguous token the tree-wide scan below looks for. The
 * self-skip is the second belt, not the only one.
 */
const SECTION_TOKEN = `${'§'}4.${'40'}`;

/** What a citation has to carry for a reader to reach the section. */
const SECTION_BASENAME = 'animation-system.md';

/** The named module rules the section states, in the order it states them. */
const NAMED_RULES = [
    'SPEED-NON-NEGATIVE',
    'STEP-BOUNDED',
    'LAST-WRITER-WINS',
    'GLOBAL-BY-DEFAULT',
    'ONE-ACTION-PER-CLIP',
    'HANDLER-ISOLATION',
    'POSING-RELEASE',
] as const;

/** The invariants the section states rather than re-derives, in the order it states them. */
const STATED_INVARIANTS = ['21', '96', '128', '129', '130', '131', '132'] as const;

// ─── Pointer parsing ────────────────────────────────────────────────────────────

/** One `[link](path) › `test title`` pointer out of a "Measured by" cell. */
interface Pointer {
    readonly file: string;
    readonly title: string;
}

/**
 * Reads every pointer in one table cell. The separator between the link and the
 * title is the single character `›`, which appears nowhere else in these cells,
 * so several pointers may share a cell without a delimiter to get wrong.
 */
function parsePointers(cell: string): Pointer[] {
    return [...cell.matchAll(/\[[^\]]*\]\(([^)]+)\)\s*›\s*`([^`]+)`/g)].map((match) => ({
        file: match[1] ?? '',
        title: match[2] ?? '',
    }));
}

/** Escapes a test title for use inside a `RegExp`. */
function escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The rows of the markdown table directly under `heading`, header row and
 * alignment row dropped. Cells are trimmed, so Prettier's column padding does
 * not reach the assertions.
 */
function tableRowsUnder(heading: string): string[][] {
    const lines = read(SECTION_DOC).split('\n');
    const start = lines.indexOf(heading);
    expect(start, `heading not found in ${SECTION_DOC}: ${heading}`).toBeGreaterThanOrEqual(0);

    const rows: string[][] = [];
    let separatorSeen = false;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i]?.trim() ?? '';
        if (line.startsWith('#')) {
            break;
        }
        if (!line.startsWith('|')) {
            continue;
        }
        const cells = line
            .split('|')
            .slice(1, -1)
            .map((cell) => cell.trim());
        if (!separatorSeen) {
            // The alignment row is the last line before the body; everything up
            // to and including it is the header.
            separatorSeen = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
            continue;
        }
        rows.push(cells);
    }
    return rows;
}

/** Resolves one pointer against the tree: the file must exist and still carry the title. */
function assertPointerResolves(pointer: Pointer, label: string): void {
    expect(pointer.file, `${label}: pointer must name a test file`).toMatch(/\.test\.tsx?$/);
    const target = path.relative(ROOT, path.resolve(ROOT, path.dirname(SECTION_DOC), pointer.file));
    // Throws — loudly, with the path — when the test file has moved.
    const source = readFileSync(path.join(ROOT, target), 'utf8');
    expect(
        source,
        `${label}: ${target} no longer declares a test titled "${pointer.title}"`,
    ).toMatch(new RegExp(`(?:describe|it)\\(\\s*['"\`]${escapeForRegExp(pointer.title)}['"\`]`));
}

/**
 * Resolves every pointer in one "Measured by" cell.
 *
 * The parsed count is checked against the number of `›` separators the cell
 * actually carries, because a pointer that loses its markdown link parses to
 * nothing at all: without this conjunct a de-linked pointer would be silently
 * dropped from the set, and a cell with one surviving pointer would still look
 * fully resolved.
 */
function assertEveryPointerResolves(cell: string, label: string): void {
    const written = (cell.match(/›/g) ?? []).length;
    const pointers = parsePointers(cell);

    expect(written, `${label} cites no test`).toBeGreaterThan(0);
    expect(
        pointers.length,
        `${label}: ${written} pointer(s) written, ${pointers.length} parsed — one is not a link`,
    ).toBe(written);

    for (const pointer of pointers) {
        assertPointerResolves(pointer, label);
    }
}

/**
 * Whether `file` carries a path that actually resolves to the section.
 *
 * The basename alone is not enough — a dead path, or the name mentioned in
 * prose, resolves nowhere, which is the defect this guard exists to catch. Both
 * of the repo's citation idioms are accepted: relative to the citing file (a
 * markdown link) and relative to the repo root (how a module header names a
 * doc).
 */
function citesTheSection(file: string): boolean {
    return pathsResolvingToTheSection(read(file), path.dirname(file)).length > 0;
}

/** The paths in `text` that resolve to the section, either from `dir` or from the repo root. */
function pathsResolvingToTheSection(text: string, dir: string): string[] {
    const pattern = new RegExp(`[\\w./-]*${escapeForRegExp(SECTION_BASENAME)}`, 'g');
    return (text.match(pattern) ?? []).filter(
        (candidate) =>
            path.normalize(path.join(dir, candidate)) === SECTION_DOC ||
            path.normalize(candidate) === SECTION_DOC,
    );
}

/** Every tracked file the tree-wide citation scan reads. */
function trackedTextFiles(): string[] {
    // `--others --exclude-standard` adds files that exist but are not staged
    // yet, so a section written and not yet `git add`ed is still scanned.
    const out = execFileSync(
        'git',
        [
            'ls-files',
            '--cached',
            '--others',
            '--exclude-standard',
            '*.md',
            '*.ts',
            '*.tsx',
            '*.mts',
            '*.cts',
            '*.js',
            '*.jsx',
            '*.mjs',
            '*.cjs',
            '*.json',
            '*.yml',
            '*.yaml',
            '*.sh',
            '*.css',
        ],
        { cwd: ROOT, encoding: 'utf8' },
    );
    return out.split('\n').filter((file) => file.length > 0 && file !== SELF);
}

// ─── The guard ──────────────────────────────────────────────────────────────────

describe('the pointer parser', () => {
    it('reads several pointers out of one cell and ignores a link with no title', () => {
        const cell =
            '[a.test.ts](../../a/a.test.ts) › `first title`; ' +
            '[b.test.tsx](../../b/b.test.tsx) › `second title`; ' +
            '[plain link](../../c/c.test.ts)';

        expect(parsePointers(cell)).toEqual([
            { file: '../../a/a.test.ts', title: 'first title' },
            { file: '../../b/b.test.tsx', title: 'second title' },
        ]);
    });

    it('reads no pointer out of prose that names a test without linking it', () => {
        expect(parsePointers('measured by `ClipPlayer.test.ts`')).toEqual([]);
    });
});

describe('the citation-path check', () => {
    it('accepts both citation idioms — relative to the citing file, and repo-rooted', () => {
        expect(
            pathsResolvingToTheSection(
                'see [the section](animation-system.md)',
                'docs/core-components',
            ),
        ).toEqual(['animation-system.md']);
        expect(
            pathsResolvingToTheSection(
                'see ../core-components/animation-system.md',
                'docs/testing',
            ),
        ).toEqual(['../core-components/animation-system.md']);
        expect(
            pathsResolvingToTheSection(
                'see docs/core-components/animation-system.md',
                'renderer/animation',
            ),
        ).toEqual(['docs/core-components/animation-system.md']);
    });

    it('rejects a dead path and a bare mention, which resolve nowhere', () => {
        expect(pathsResolvingToTheSection('see docs/foo/animation-system.md', 'docs')).toEqual([]);
        expect(
            pathsResolvingToTheSection('written up in animation-system.md', 'docs/testing'),
        ).toEqual([]);
    });
});

describe('the section exists and owns its number', () => {
    it('declares the number in the banner every core-component section carries', () => {
        expect(read(SECTION_DOC)).toContain(`> ${SECTION_TOKEN} of the Chimera architecture.`);
    });

    it('is linked from the architecture-overview index, on every row that links it', () => {
        // Every row rather than the first: two rows linking the section under
        // different numbers is exactly the state a `.find()` would call clean.
        const rows = read(OVERVIEW_DOC)
            .split('\n')
            .filter((line) => line.includes(`core-components/${SECTION_BASENAME}`));

        expect(rows, `${OVERVIEW_DOC} has no index row linking ${SECTION_BASENAME}`).not.toEqual(
            [],
        );
        for (const row of rows) {
            expect(row).toContain(SECTION_TOKEN);
        }
    });
});

describe('every citation of the number resolves to the section', () => {
    it('names the section path in every tracked text file that carries the number', () => {
        const files = trackedTextFiles();
        // Anti-vacuity: the scan must cover the tree, not an empty list.
        expect(files.length).toBeGreaterThan(1000);
        expect(files).toContain(ROADMAP_DOC);
        expect(files).toContain(SECTION_DOC);

        const citing = files.filter((file) => read(file).includes(SECTION_TOKEN));
        // Anti-vacuity: the two files that must cite it, do.
        expect(citing).toContain(OVERVIEW_DOC);
        expect(citing).toContain(ROADMAP_DOC);

        const unresolved = citing.filter((file) => file !== SECTION_DOC && !citesTheSection(file));
        expect(
            unresolved,
            'files cite the section number without a path that resolves to the section',
        ).toEqual([]);
    });

    it('carries neither of the two sentences that reserved the number', () => {
        const roadmap = read(ROADMAP_DOC);
        // The two sentences that made the number resolve nowhere — one per
        // feature section. Matched case-insensitively because the emphasis
        // ("RESERVED") is a formatting choice a reflow may change, and the
        // claim is about the sentence, not about how it was capitalised. This
        // bans exactly these two phrasings, which is what the title says: a
        // freshly invented way to say the same thing is a review concern, not
        // something a string ratchet can see.
        expect(roadmap).not.toMatch(/is reserved, not written/i);
        expect(roadmap).not.toMatch(/the number stays reserved/i);
    });
});

describe('the named rules point at the tests that measure them', () => {
    const rows = (): string[][] => tableRowsUnder('## Named rules');

    it('lists exactly the seven rule names this guard pins, in that order', () => {
        const names = rows().map((cells) => /`([A-Z][A-Z-]+)`/.exec(cells[0] ?? '')?.[1] ?? '');
        expect(names).toEqual([...NAMED_RULES]);
    });

    it('resolves every rule pointer against the tree', () => {
        for (const cells of rows()) {
            assertEveryPointerResolves(cells.at(-1) ?? '', cells[0] ?? '');
        }
    });
});

describe('the stated invariants point at the tests that measure them', () => {
    const rows = (): string[][] => tableRowsUnder('## Invariants');

    it('lists exactly the invariant numbers this guard pins, in that order', () => {
        const numbers = rows().map((cells) => /#(\d+)/.exec(cells[0] ?? '')?.[1] ?? '');
        expect(numbers).toEqual([...STATED_INVARIANTS]);
    });

    it('resolves every invariant pointer against the tree', () => {
        for (const cells of rows()) {
            assertEveryPointerResolves(cells.at(-1) ?? '', cells[0] ?? '');
        }
    });
});
