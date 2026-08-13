/**
 * tools/invariant-section-headings.test.ts
 *
 * Anti-rot guard for the range headings in
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
const MINIMUM_ROWS = 132;
const MINIMUM_SECTIONS = 6;

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

describe('architecture-invariants.md', () => {
    const sections = parseInvariantSections(read(INVARIANTS_DOC));

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
});
