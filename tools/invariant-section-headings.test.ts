/**
 * tools/invariant-section-headings.test.ts
 *
 * Anti-rot guard for the range headings and the Thematic Index in
 * `docs/executive-architecture/architecture-invariants.md`.
 *
 * The file groups its `**N.**` rows under `## Invariants A–B` headings. A
 * heading is a claim about the rows beneath it, and nothing measured that claim,
 * so it drifted: `## Invariants 81–88` came to hold rows 81–90, disclaiming
 * Invariants #89 (`MAX_NESTED_DISPATCH`) and #90 (`ReduceContext.logger`) and
 * sending a reader scanning the headings on to 91–132, where they are not.
 *
 * The heading is therefore derived here rather than transcribed:
 * `findRangeProblems` re-reads the rows and compares. Four properties rot
 * independently, so each is a separate conjunct with its own killer fixture
 * below — a fixture tripping two at once would leave the drop-either-one mutant
 * alive.
 *
 * 1. **Label vs contents.** A heading's declared range equals its rows' first
 *    and last. Both ends get their own fixture: an invariant can be unhoused off
 *    the front of a block as easily as off the back, and a fixture that only
 *    moves the last row leaves the `first !== from` half unmeasured.
 * 2. **Row contiguity.** A section's rows ascend by exactly one. A heading can
 *    name its own endpoints correctly while a number in the middle is missing or
 *    repeated, and conjunct 1 cannot see either.
 * 3. **Section tiling.** Each heading's declared range starts one past the
 *    previous heading's declared end. Two sections can each be internally honest
 *    and still leave a number belonging to no block at all.
 * 4. **Every row is housed.** A row parsed outside every `Invariants` block is
 *    reported rather than dropped, and a non-`Invariants` heading closes the
 *    block it follows — otherwise the `## Cross-References` tail would be read
 *    as a continuation of the last range.
 *
 * The parse is pinned by an anti-vacuity floor rather than left to speak for
 * itself: a renamed heading style or a reflowed row marker would otherwise empty
 * every assertion above into a vacuous pass over zero sections. `readFileSync`
 * throws if the doc moves, so a renamed path fails loud for the same reason.
 *
 * The same file carries a second navigation surface with the same rot: the
 * `## Thematic Index` table, which the range checks above deliberately treat as
 * a block terminator and therefore never read as content. Invariant #134 landed
 * with its body, its range heading and its roll-call row all correct, and no
 * `Audio playback (§4.25)` entry — unreachable through the index that lists
 * every other audio invariant. `findIndexProblems` closes that by relating the
 * two parses, again as independent conjuncts:
 *
 * 5. **Every invariant is indexed.** Each `**N.**` row number appears in at
 *    least one index row. Membership, not partition: a number is expected in
 *    several themes, so a clean fixture files one number twice.
 * 6. **Every indexed number exists.** An index entry naming a number with no
 *    `**N.**` row is a dangling pointer — the shape a renumbering leaves behind.
 *    Measured before it was asserted: at the tree that added this check, zero
 *    index entries dangled, so the direction is a live assertion rather than a
 *    documented exclusion.
 * 7. **Every entry is readable.** A cell token that is not a plain integer (a
 *    `116–126` range shorthand, a typo) is reported instead of skipped —
 *    silently dropping it would narrow the index the guard is checking against.
 *
 * #134 was repaired by hand before this guard existed. Run against the ledger it
 * was written for, conjunct 5 named four further invariants reachable through no
 * theme: 45, 98, 102 and 109.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const INVARIANTS_DOC = 'docs/executive-architecture/architecture-invariants.md';

/**
 * The lowest totals this guard may see before it is measuring nothing. Both sit
 * exactly on the counts present when it was written, so a parse that silently
 * stops matching drops below them instead of passing over an empty set.
 */
const MINIMUM_ROWS = 134;
const MINIMUM_SECTIONS = 6;

/**
 * An anti-vacuity floor of the same kind for the Thematic Index parse. Conjunct 5
 * fails loud when the index is unreadable (every invariant reads as unindexed),
 * but conjunct 6 would pass vacuously over an empty entry set, so the themes and
 * their numbers are counted directly. Both of these two sit exactly on the counts
 * present when they were written.
 */
const MINIMUM_INDEX_THEMES = 11;
const MINIMUM_INDEXED_NUMBERS = 134;

interface InvariantSection {
    /** The heading with its `## ` prefix stripped, for messages naming a real line. */
    readonly heading: string;
    /** `null` when the heading is not in `Invariants A–B` form at all. */
    readonly declared: { readonly from: number; readonly to: number } | null;
    /** The `**N.**` row numbers beneath it, in the order they appear. */
    readonly rows: readonly number[];
}

const SECTION_HEADING = /^## (Invariants\b.*)$/;
/** The declared range. The doc writes an en dash; hyphen and em dash are tolerated. */
const DECLARED_RANGE = /^Invariants\s+(\d+)\s*[–—-]\s*(\d+)\s*$/;
/** A ledger row: `**89.** MAX_NESTED_DISPATCH …`. */
const INVARIANT_ROW = /^\*\*(\d+)\.\*\*/;

/** The sentinel a row parsed outside every `Invariants` block is filed under. */
const ORPHAN_HEADING = '(outside every Invariants section)';

/**
 * Split the document into its `## Invariants …` blocks. Any other `## ` heading
 * (`## Cross-References`, `## Thematic Index`) closes the current block, so rows
 * are never attributed across a section boundary.
 *
 * Rows found while no `Invariants` block is open are returned under
 * `ORPHAN_HEADING` rather than dropped — a row housed by no heading is the same
 * navigation defect with no heading to blame it on.
 */
function parseInvariantSections(markdown: string): InvariantSection[] {
    const sections: InvariantSection[] = [];
    let heading: string | null = null;
    let rows: number[] = [];
    const orphanRows: number[] = [];

    const close = (): void => {
        if (heading === null) return;
        const declaredMatch = DECLARED_RANGE.exec(heading);
        sections.push({
            heading,
            declared:
                declaredMatch === null
                    ? null
                    : { from: Number(declaredMatch[1]), to: Number(declaredMatch[2]) },
            rows,
        });
        heading = null;
        rows = [];
    };

    for (const line of markdown.split('\n')) {
        const headingMatch = SECTION_HEADING.exec(line);
        if (headingMatch !== null) {
            close();
            heading = (headingMatch[1] ?? '').trim();
            continue;
        }
        if (line.startsWith('## ')) {
            close();
            continue;
        }
        const rowMatch = INVARIANT_ROW.exec(line);
        if (rowMatch !== null) {
            if (heading === null) orphanRows.push(Number(rowMatch[1]));
            else rows.push(Number(rowMatch[1]));
        }
    }
    close();

    if (orphanRows.length > 0) {
        sections.push({ heading: ORPHAN_HEADING, declared: null, rows: orphanRows });
    }
    return sections;
}

/**
 * Every way a heading can lie about the rows beneath it, as exact strings so a
 * fixture asserts the matched set rather than a count.
 */
function findRangeProblems(sections: readonly InvariantSection[]): string[] {
    const problems: string[] = [];
    let previousDeclaredTo: number | null = null;

    for (const section of sections) {
        if (section.declared === null) {
            problems.push(`heading "${section.heading}" is not in "Invariants A–B" form`);
            continue;
        }
        const { from, to } = section.declared;

        // Conjunct 1 — the label names the rows it actually holds, at both ends.
        if (section.rows.length === 0) {
            problems.push(`heading "${section.heading}" holds no invariant rows`);
        } else {
            const first = section.rows[0];
            const last = section.rows[section.rows.length - 1];
            if (first !== from || last !== to) {
                problems.push(
                    `heading "${section.heading}" holds rows ${first}–${last}, not ${from}–${to}`,
                );
            }

            // Conjunct 2 — no number inside the block is missing or repeated.
            let previousRow: number | null = null;
            for (const row of section.rows) {
                if (previousRow !== null && row !== previousRow + 1) {
                    problems.push(
                        `heading "${section.heading}" jumps from ${previousRow} to ${row}`,
                    );
                }
                previousRow = row;
            }
        }

        // Conjunct 3 — the blocks tile the numbering space with no gap or overlap.
        const expectedFrom = previousDeclaredTo === null ? 1 : previousDeclaredTo + 1;
        if (from !== expectedFrom) {
            problems.push(`heading "${section.heading}" should start at ${expectedFrom}`);
        }
        previousDeclaredTo = to;
    }

    return problems;
}

/** A theme row of the `## Thematic Index` table. */
interface ThemeRow {
    /** The theme with its `**` emphasis stripped, for messages naming a real cell. */
    readonly theme: string;
    /** The invariant numbers the row claims, in cell order. */
    readonly numbers: readonly number[];
    /** Cell entries that are not plain integers, kept so conjunct 7 can report them. */
    readonly unreadable: readonly string[];
}

const INDEX_HEADING = /^## Thematic Index\s*$/;
/** An emphasised theme cell. The table's header and `---` separator have none, which is how both are skipped. */
const THEME_CELL = /^\*\*(.+)\*\*$/;

/**
 * Read the `## Thematic Index` table. Any following `## ` heading closes the
 * block, so a table elsewhere in the file is never mistaken for index content.
 *
 * A row counts only when its first cell is emphasised, which is the table's own
 * convention and excludes both the `| Theme | Invariants |` header and the
 * `| --- | --- |` separator without naming either. An unemphasised theme row is
 * therefore skipped — and its invariants then read as indexed nowhere, which
 * conjunct 5 reports, so the strictness fails loud rather than silently.
 */
function parseThematicIndex(markdown: string): ThemeRow[] {
    const rows: ThemeRow[] = [];
    let insideIndex = false;

    for (const line of markdown.split('\n')) {
        if (line.startsWith('## ')) {
            insideIndex = INDEX_HEADING.test(line);
            continue;
        }
        if (!insideIndex || !line.startsWith('|')) continue;

        const cells = line.split('|').slice(1, -1);
        if (cells.length !== 2) continue;
        const themeMatch = THEME_CELL.exec((cells[0] ?? '').trim());
        if (themeMatch === null) continue;

        const numbers: number[] = [];
        const unreadable: string[] = [];
        for (const entry of (cells[1] ?? '').split(',')) {
            const token = entry.trim();
            if (token === '') continue;
            if (/^\d+$/.test(token)) numbers.push(Number(token));
            else unreadable.push(token);
        }
        rows.push({ theme: (themeMatch[1] ?? '').trim(), numbers, unreadable });
    }

    return rows;
}

/**
 * Relate the ledger to the index in both directions, as exact strings so a
 * fixture asserts the matched set rather than a count.
 */
function findIndexProblems(
    sections: readonly InvariantSection[],
    themeRows: readonly ThemeRow[],
): string[] {
    const problems: string[] = [];
    const ledger = new Set(sections.flatMap((section) => section.rows));
    const indexed = new Set<number>();

    for (const row of themeRows) {
        // Conjunct 7 — an entry the parse could not read is named, not dropped.
        for (const token of row.unreadable) {
            problems.push(`Thematic Index row "${row.theme}" has an unreadable entry "${token}"`);
        }
        // Conjunct 6 — the index points only at invariants that exist.
        for (const number of row.numbers) {
            indexed.add(number);
            if (!ledger.has(number)) {
                problems.push(
                    `Thematic Index row "${row.theme}" names ${number}, which has no invariant row`,
                );
            }
        }
    }

    // Conjunct 5 — every invariant is reachable through the index.
    for (const number of ledger) {
        if (!indexed.has(number)) {
            problems.push(`invariant ${number} appears in no Thematic Index row`);
        }
    }

    return problems;
}

// Fixtures. Each trips exactly one conjunct, so dropping any single check leaves
// a named test failing. Assembled from short synthetic ledgers rather than from
// the tree, so they keep saying what they say as invariants are added.
const CLEAN = [
    '## Invariants 1–2',
    '**1.** a',
    '**2.** b',
    '## Invariants 3–4',
    '**3.** c',
    '**4.** d',
].join('\n');

/** Declared end stops short of the rows; the start is correct. */
const MISLABELLED_END = [
    '## Invariants 1–2',
    '**1.** a',
    '**2.** b',
    '## Invariants 3–4',
    '**3.** c',
    '**4.** d',
    '**5.** e',
].join('\n');

/** Declared start reaches past the rows; the end is correct, and it still tiles. */
const MISLABELLED_START = [
    '## Invariants 1–2',
    '**1.** a',
    '**2.** b',
    '## Invariants 3–5',
    '**4.** d',
    '**5.** e',
].join('\n');

const GAP_INSIDE_A_SECTION = ['## Invariants 1–4', '**1.** a', '**2.** b', '**4.** d'].join('\n');

const REPEATED_ROW = [
    '## Invariants 1–3',
    '**1.** a',
    '**2.** b',
    '**2.** b, filed twice',
    '**3.** c',
].join('\n');

const EMPTY_SECTION = ['## Invariants 1–2', '**1.** a', '**2.** b', '## Invariants 3–4'].join('\n');

const UNTILED_SECTIONS = [
    '## Invariants 1–2',
    '**1.** a',
    '**2.** b',
    '## Invariants 4–5',
    '**4.** d',
    '**5.** e',
].join('\n');

/** A row after a non-`Invariants` heading — the `## Cross-References` tail's shape. */
const ROW_AFTER_A_FOREIGN_HEADING = [
    '## Invariants 1–2',
    '**1.** a',
    '**2.** b',
    '## Cross-References',
    '**9.** a numbered line that is not a ledger row',
].join('\n');

/** The two dash forms `DECLARED_RANGE` tolerates besides the doc's en dash. */
const HYPHEN_AND_EM_DASH = [
    '## Invariants 1-2',
    '**1.** a',
    '**2.** b',
    '## Invariants 3—4',
    '**3.** c',
    '**4.** d',
].join('\n');

/** The ledger every index fixture below is checked against. */
const FOUR_INVARIANTS = ['## Invariants 1–4', '**1.** a', '**2.** b', '**3.** c', '**4.** d'];

/** A Thematic Index whose theme rows are the given cell bodies. */
const indexedDoc = (...themeRows: string[]): string =>
    [
        '## Thematic Index',
        '| Theme | Invariants |',
        '| ----- | ---------- |',
        ...themeRows,
        ...FOUR_INVARIANTS,
    ].join('\n');

/** Every invariant indexed, and 2 filed under two themes — membership, not partition. */
const FULLY_INDEXED = indexedDoc('| **Alpha** | 1, 2 |', '| **Beta** | 2, 3, 4 |');

/** 4 is named by no theme; every other number is indexed and readable. */
const UNINDEXED_INVARIANT = indexedDoc('| **Alpha** | 1, 2 |', '| **Beta** | 2, 3 |');

/** 9 is indexed with no ledger row behind it; the forward direction is clean. */
const DANGLING_INDEX_ENTRY = indexedDoc('| **Alpha** | 1, 2 |', '| **Beta** | 2, 3, 4, 9 |');

/** A range shorthand. Alpha already indexes 3 and 4, so only conjunct 7 can see it. */
const RANGE_SHORTHAND = indexedDoc('| **Alpha** | 1, 2, 3, 4 |', '| **Beta** | 3–4 |');

/** A second table after a foreign heading — the leak that would index 9 from outside. */
const TABLE_OUTSIDE_THE_INDEX = [
    indexedDoc('| **Alpha** | 1, 2, 3, 4 |'),
    '## Some Other Section',
    '| Theme | Invariants |',
    '| ----- | ---------- |',
    '| **Gamma** | 9 |',
].join('\n');

/**
 * A row carrying a stray third cell. Beta indexes all four numbers, so the row's
 * fate is visible only in the parsed themes — which is what pins the arity guard.
 */
const THREE_CELL_ROW = indexedDoc('| **Alpha** | 1, 2 | 3 |', '| **Beta** | 1, 2, 3, 4 |');

/**
 * Prose inside the index block that happens to contain pipes. Dropping the
 * leading-pipe guard leaves this line's middle two fields parsed as a theme row,
 * so the guard is not merely a fast path for the arity check below it.
 */
const PIPED_PROSE_IN_THE_INDEX = indexedDoc(
    '| **Beta** | 1, 2, 3, 4 |',
    'read as **Gamma** | **Gamma** | 9 | and skip it',
);

/** The shape a renamed or deleted index heading leaves behind. */
const NO_INDEX_AT_ALL = FOUR_INVARIANTS.join('\n');

describe('invariant range headings — the checker', () => {
    it('reports nothing for headings that name their contents and tile', () => {
        // Positive control: without it, a checker that always reports a problem
        // would satisfy every fixture below.
        expect(findRangeProblems(parseInvariantSections(CLEAN))).toEqual([]);
    });

    it('catches a heading whose declared end stops short of its rows', () => {
        // Rows run one past what the label admits, while the rows themselves are
        // contiguous and the sections still tile.
        expect(findRangeProblems(parseInvariantSections(MISLABELLED_END))).toEqual([
            'heading "Invariants 3–4" holds rows 3–5, not 3–4',
        ]);
    });

    it('catches a heading whose declared start reaches past its first row', () => {
        // The mirror of the case above: the number is unhoused off the FRONT of
        // the block. The declared end is correct and the sections still tile, so
        // only the `first !== from` half can see it.
        expect(findRangeProblems(parseInvariantSections(MISLABELLED_START))).toEqual([
            'heading "Invariants 3–5" holds rows 4–5, not 3–5',
        ]);
    });

    it('catches a number missing from the middle of an otherwise honest block', () => {
        // The label's endpoints are both correct here, so conjunct 1 sees nothing.
        expect(findRangeProblems(parseInvariantSections(GAP_INSIDE_A_SECTION))).toEqual([
            'heading "Invariants 1–4" jumps from 2 to 4',
        ]);
    });

    it('catches a number filed twice inside an otherwise honest block', () => {
        // The other direction of the same conjunct: endpoints correct, rows
        // ascending-or-equal rather than strictly ascending.
        expect(findRangeProblems(parseInvariantSections(REPEATED_ROW))).toEqual([
            'heading "Invariants 1–3" jumps from 2 to 2',
        ]);
    });

    it('catches a heading left with no rows beneath it at all', () => {
        // The state a block reaches when its rows are moved or reformatted away.
        // It still tiles, so only the empty-rows branch can see it.
        expect(findRangeProblems(parseInvariantSections(EMPTY_SECTION))).toEqual([
            'heading "Invariants 3–4" holds no invariant rows',
        ]);
    });

    it('catches two internally honest sections that leave a number unhoused', () => {
        // Both labels match their rows and both blocks are contiguous; only the
        // seam between them is wrong.
        expect(findRangeProblems(parseInvariantSections(UNTILED_SECTIONS))).toEqual([
            'heading "Invariants 4–5" should start at 3',
        ]);
    });

    it('carries a row that precedes every section instead of dropping it', () => {
        const stray = ['**7.** stray', '## Invariants 1–2', '**1.** a', '**2.** b'].join('\n');
        const sections = parseInvariantSections(stray);

        // The attribution itself, not just the report: a parse that dropped the
        // row would still produce no `Invariants` problem, so the row number is
        // what has to be asserted.
        expect(sections.find((section) => section.heading === ORPHAN_HEADING)?.rows).toEqual([7]);
        expect(findRangeProblems(sections)).toEqual([
            `heading "${ORPHAN_HEADING}" is not in "Invariants A–B" form`,
        ]);
    });

    it('stops a block at a non-Invariants heading rather than reading past it', () => {
        // Without the close on a foreign `## `, the trailing row would be folded
        // into `Invariants 1–2` and reported as that block's contents instead.
        const sections = parseInvariantSections(ROW_AFTER_A_FOREIGN_HEADING);
        expect(sections.find((section) => section.heading === 'Invariants 1–2')?.rows).toEqual([
            1, 2,
        ]);
        expect(findRangeProblems(sections)).toEqual([
            `heading "${ORPHAN_HEADING}" is not in "Invariants A–B" form`,
        ]);
    });

    it('reads a range written with a hyphen or an em dash', () => {
        // The doc uses an en dash throughout; the other two forms are tolerated so
        // a hand-typed heading is checked rather than dismissed as unparseable.
        expect(findRangeProblems(parseInvariantSections(HYPHEN_AND_EM_DASH))).toEqual([]);
    });
});

describe('Thematic Index membership — the checker', () => {
    const problemsIn = (markdown: string): string[] =>
        findIndexProblems(parseInvariantSections(markdown), parseThematicIndex(markdown));

    it('reports nothing when every invariant is indexed and every entry exists', () => {
        // Positive control, and the pin that a number filed under two themes is
        // membership rather than a double-index problem.
        expect(problemsIn(FULLY_INDEXED)).toEqual([]);
    });

    it('reads the theme rows without the header or separator row', () => {
        // The parse itself, not just its verdict: a header row read as a theme
        // would carry the entry "Invariants" and land in conjunct 7 instead.
        expect(parseThematicIndex(FULLY_INDEXED)).toEqual([
            { theme: 'Alpha', numbers: [1, 2], unreadable: [] },
            { theme: 'Beta', numbers: [2, 3, 4], unreadable: [] },
        ]);
    });

    it('catches an invariant that appears in no index row', () => {
        // The #134 defect exactly: body and range heading correct, index entry
        // never added. Nothing dangles and nothing is unreadable here.
        expect(problemsIn(UNINDEXED_INVARIANT)).toEqual([
            'invariant 4 appears in no Thematic Index row',
        ]);
    });

    it('catches an index entry that names an invariant with no row', () => {
        // The mirror direction, which a membership-only check cannot see: every
        // invariant is indexed, and the index still points at nothing.
        expect(problemsIn(DANGLING_INDEX_ENTRY)).toEqual([
            'Thematic Index row "Beta" names 9, which has no invariant row',
        ]);
    });

    it('catches a range shorthand rather than silently dropping the entry', () => {
        // Both endpoints are indexed elsewhere, so the entry vanishing would
        // otherwise leave every other conjunct clean.
        expect(problemsIn(RANGE_SHORTHAND)).toEqual([
            'Thematic Index row "Beta" has an unreadable entry "3–4"',
        ]);
    });

    it('stops the index at a foreign heading rather than reading a later table', () => {
        // Without the close, "Gamma" would be read as a theme row and its 9
        // reported as dangling — a problem invented from outside the index.
        expect(parseThematicIndex(TABLE_OUTSIDE_THE_INDEX).map((row) => row.theme)).toEqual([
            'Alpha',
        ]);
        expect(problemsIn(TABLE_OUTSIDE_THE_INDEX)).toEqual([]);
    });

    it('skips a row that is not exactly two cells rather than reading its first two', () => {
        // A stray third cell survives `prettier --parser markdown` — the row is
        // re-padded, not repaired — so the formatter cannot rule the shape out
        // ahead of this guard. The row is dropped whole and
        // its numbers fall to conjunct 5 — never half-read with a cell silently
        // discarded. Beta indexes every number, so only the theme list can see it.
        expect(parseThematicIndex(THREE_CELL_ROW).map((row) => row.theme)).toEqual(['Beta']);
        expect(problemsIn(THREE_CELL_ROW)).toEqual([]);
    });

    it('skips a prose line whose pipes would otherwise parse as a theme row', () => {
        // The middle two fields of this line are a well-formed emphasised cell
        // and a number, so the arity check alone would accept them and report 9
        // as dangling — a problem invented from a sentence.
        expect(parseThematicIndex(PIPED_PROSE_IN_THE_INDEX).map((row) => row.theme)).toEqual([
            'Beta',
        ]);
        expect(problemsIn(PIPED_PROSE_IN_THE_INDEX)).toEqual([]);
    });

    it('reports every invariant when the index heading is gone', () => {
        // A renamed or deleted `## Thematic Index` empties the parse; conjunct 5
        // has to fail loud on that rather than pass over an empty entry set.
        expect(problemsIn(NO_INDEX_AT_ALL)).toEqual([
            'invariant 1 appears in no Thematic Index row',
            'invariant 2 appears in no Thematic Index row',
            'invariant 3 appears in no Thematic Index row',
            'invariant 4 appears in no Thematic Index row',
        ]);
    });
});

describe('architecture-invariants.md', () => {
    const markdown = read(INVARIANTS_DOC);
    const sections = parseInvariantSections(markdown);
    const themeRows = parseThematicIndex(markdown);

    it('parses enough of the ledger for the checks below to mean anything', () => {
        // Without this, a reformat that stopped matching either regex would turn
        // every assertion here into a pass over an empty list.
        const rowCount = sections.reduce((total, section) => total + section.rows.length, 0);
        expect(sections.length).toBeGreaterThanOrEqual(MINIMUM_SECTIONS);
        expect(rowCount).toBeGreaterThanOrEqual(MINIMUM_ROWS);
    });

    it('has no heading that misstates its range, skips a number or unhouses one', () => {
        expect(findRangeProblems(sections)).toEqual([]);
    });

    it('parses enough of the Thematic Index for the membership check to mean anything', () => {
        const indexed = new Set(themeRows.flatMap((row) => row.numbers));
        expect(themeRows.length).toBeGreaterThanOrEqual(MINIMUM_INDEX_THEMES);
        expect(indexed.size).toBeGreaterThanOrEqual(MINIMUM_INDEXED_NUMBERS);
    });

    it('indexes every invariant under a theme and names no number without a row', () => {
        expect(findIndexProblems(sections, themeRows)).toEqual([]);
    });
});
