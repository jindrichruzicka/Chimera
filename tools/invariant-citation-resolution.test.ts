/**
 * tools/invariant-citation-resolution.test.ts
 *
 * Anti-rot guard for the `**Invariant #nn** — <text>` citations the docs carry.
 *
 * Docs restate the rules they depend on as `**Invariant #nn** — <text>`
 * bullets — in a closing list, in a mid-document blockquote callout. The number
 * in each is an index into a 134-entry ledger, it is hand-maintained, and
 * nothing measured it, so it drifted: `GameSnapshot never leaves the main
 * process` was filed under #1 in two docs and under its own #3 in two others,
 * so one property carried two numbers, and the reader who chased #1 landed on
 * the zero-dependency rule with no signal that anything was off.
 *
 * The rule this enforces is the ledger's own, stated in
 * `architecture-invariants.md` under "Citing an Invariant": a citation must
 * share a term with the row it names. It is deliberately a shared-anchor rule
 * rather than a containment one in either direction. A citation is a SHORT FORM,
 * so it drops most of the row (the row cannot be contained in it), and it may
 * add a clause the row leaves implicit — `save-load-persistence.md`'s #26 bullet
 * names `stagedReveals`, which row 26 does not — so it is not contained in the
 * row either.
 *
 * Two conjuncts, each with its own killer fixture:
 *
 * 1. **The number names a row.** A citation of a number with no `**nn.**` row is
 *    a dangling pointer — the shape a renumbering or a typo leaves behind, and
 *    the one conjunct 2 cannot report, since a missing row shares nothing with
 *    anything.
 * 2. **The citation shares a term with that row.** Terms are case-folded runs of
 *    `[a-z0-9]` of at least `MINIMUM_TERM_LENGTH` characters, drawn from code
 *    spans and prose alike, so `` `GameSnapshot` `` and `GameSnapshot` are the
 *    same anchor and `the`/`any`/`its` are not anchors at all.
 *
 * The bar of ONE shared term is not a tuned threshold; it sits in a measured
 * gap. Measured at this tree: the three drifted bullets shared **zero** terms
 * with the rows they used to name, and the lowest count among the other 55 of
 * the 58 citations is **five**. Nothing in the docs sits between 1 and 4.
 *
 * What this does NOT catch, stated rather than left to be discovered:
 *
 * - A citation that shares a term with its row while paraphrasing a different
 *   clause of it. Only the number-to-rule link is measured, not the paraphrase.
 * - A citation of the wrong member of a vocabulary-sharing pair — #20/#21/#22
 *   all name `AssetRef`/`AssetManager`. A strict "the cited row is the ledger's
 *   BEST term match" rule was measured against this tree and rejected: it
 *   reports `module-boundaries-file-tree.md`'s faithful #48 bullet, which loses
 *   on shared vocabulary to #80 and #96.
 * - Any citation shape that is not this bullet. A mid-sentence reference
 *   (`… (especially **Invariant #45** — `pruneTo` …)`) is excluded by the
 *   line-start anchor; a bare number in a table cell (`| #3 | … |`) and the
 *   source-comment header form (`#3 — Only PlayerSnapshot … is consumed here.`)
 *   never carry the `**Invariant #nn**` marker at all. Those forms are unheld,
 *   and whether they should be is a filed decision rather than a list this
 *   docblock keeps growing. A citation written as this bullet is checked; the
 *   markers and separators that count as one are enumerated by the fixture
 *   `reads a citation under every marker and separator form`.
 *
 * Scope is every tracked markdown file under `docs/` at any depth, so package
 * `CHANGELOG.md` files — append-only history that must not be rewritten — are
 * out by construction rather than by exclusion. The listing is the whole
 * `docs/` tree, filtered here rather than by a pathspec, because the obvious
 * pathspec is wrong in a way nothing announces: the double-star form requires a
 * literal `/` after `docs/` and silently drops the five top-level files,
 * `docs/architecture-overview.md` among them. The floor below names files a
 * narrowed listing would drop.
 *
 * Fenced code blocks are skipped, so a doc quoting the bullet form as an example
 * is not resolved against the ledger.
 *
 * Both repo-wide passes are pinned by anti-vacuity floors. A regex that stopped
 * matching, or an `ls-files` glob that stopped reaching the docs tree, would
 * otherwise turn every assertion here into a pass over an empty list.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INVARIANTS_DOC = 'docs/executive-architecture/architecture-invariants.md';

/**
 * The lowest totals this guard may see before it is measuring nothing. The
 * ledger floor sits exactly on the count present when this was written —
 * invariant numbers are never reused, so the ledger only grows. The other two
 * sit below their measured counts (77 markdown files, 58 citations), because
 * deleting a doc or a bullet is ordinary and must not fail this guard.
 */
const MINIMUM_LEDGER_ROWS = 134;
const MINIMUM_DOCS_SCANNED = 60;
const MINIMUM_CITATIONS = 40;

/**
 * One tracked doc at each depth the tree has. The depth-1 sentinel is exactly
 * what the pathspec this guard started with dropped, and 72 files still clears
 * every count floor worth setting — so a name is what catches that revert, not a
 * total. Both are source-of-truth docs; neither moves without a decision.
 */
const SENTINEL_DOCS = ['docs/architecture-overview.md', INVARIANTS_DOC];

/**
 * A tracked file under `docs/` that is not markdown. Naming it is what pins the
 * `.md` filter: the listing is the whole `docs/` tree, so without that filter
 * this PNG is read as UTF-8 and scanned for citations.
 */
const NON_MARKDOWN_DOC = 'docs/assets/chimera-logo.png';

/** A ledger row: `**89.** MAX_NESTED_DISPATCH …`. */
const INVARIANT_ROW = /^\*\*(\d+)\.\*\*\s*(.+)$/;

/**
 * A citation opening a line, after an optional blockquote and/or list marker.
 *
 * The separator is tolerated in every spelling the docs reach for and in none at
 * all, because every tolerance here can only WIDEN what is checked: the docs
 * write an em dash, `electron-shell-ipc-bridge.md` writes the colon inside the
 * emphasis (`**Invariant #79:**`), and a hand-typed en dash, hyphen or bare
 * space would otherwise be dismissed as unparseable and silently skipped.
 */
const CITATION = /^\s*(?:>\s*)?(?:[-*]\s+)?\*\*Invariant #(\d+):?\*\*\s*(?:[—–:-]\s*)?(.+)$/;

/** A fenced code block delimiter. Both fence characters markdown allows. */
const FENCE = /^\s*(?:```|~~~)/;

/**
 * The shortest run of `[a-z0-9]` that counts as an anchor. Four drops the
 * function words two texts about anything share — `the`, `any`, `its`, `has` —
 * while keeping every identifier and every noun that carries a topic. Measured:
 * dropping it to 3 and raising it to 5 both leave the same three drifted bullets
 * as the only ones with nothing shared.
 */
const MINIMUM_TERM_LENGTH = 4;

interface Citation {
    /** Repo-relative path, for a message naming a real line. */
    readonly file: string;
    /** 1-indexed. */
    readonly line: number;
    /** The number the bullet cites. */
    readonly number: number;
    /** Everything after the dash — the bullet's restatement of the rule. */
    readonly text: string;
}

/** Read the ledger's `**N.**` rows as number → row text. */
function parseLedger(markdown: string): Map<number, string> {
    const rows = new Map<number, string>();
    for (const line of markdown.split('\n')) {
        const match = INVARIANT_ROW.exec(line);
        if (match !== null) rows.set(Number(match[1]), match[2] ?? '');
    }
    return rows;
}

/**
 * Read every citation that opens a line outside a fenced block. A doc that shows
 * the bullet form inside a fence is illustrating it, not making the claim.
 */
function parseCitations(file: string, markdown: string): Citation[] {
    const citations: Citation[] = [];
    let inFence = false;

    markdown.split('\n').forEach((line, index) => {
        if (FENCE.test(line)) {
            inFence = !inFence;
            return;
        }
        if (inFence) return;
        const match = CITATION.exec(line);
        if (match === null) return;
        citations.push({
            file,
            line: index + 1,
            number: Number(match[1]),
            text: match[2] ?? '',
        });
    });

    return citations;
}

/**
 * The anchors a text offers: case-folded runs of `[a-z0-9]` at or above the
 * minimum length. Backticks are separators like any other non-alphanumeric, so a
 * code span contributes its identifier parts and nothing else —
 * `` `SaveManager.restoreFromSave(slotId)` `` and `SaveManager.restoreFromSave()`
 * share `savemanager` and `restorefromsave`.
 */
function termsOf(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((term) => term.length >= MINIMUM_TERM_LENGTH),
    );
}

/**
 * Both ways a citation can fail to resolve, as exact strings so a fixture
 * asserts the matched set rather than a count.
 */
function findCitationProblems(
    citations: readonly Citation[],
    ledger: ReadonlyMap<number, string>,
): string[] {
    const problems: string[] = [];

    for (const citation of citations) {
        const row = ledger.get(citation.number);

        // Conjunct 1 — the number names a rule that exists.
        if (row === undefined) {
            problems.push(
                `${citation.file}:${citation.line} cites #${citation.number}, which has no invariant row`,
            );
            continue;
        }

        // Conjunct 2 — the bullet and the rule it names share an anchor.
        const rowTerms = termsOf(row);
        const shared = [...termsOf(citation.text)].filter((term) => rowTerms.has(term));
        if (shared.length === 0) {
            problems.push(
                `${citation.file}:${citation.line} cites #${citation.number} but shares no term with it`,
            );
        }
    }

    return problems;
}

// Fixtures. Each trips exactly one conjunct, so dropping any single check leaves
// a named test failing. Assembled from short synthetic ledgers rather than from
// the tree, so they keep saying what they say as invariants are added.
const LEDGER = parseLedger(
    [
        '**1.** `simulation/` has zero runtime dependencies on React, DOM, or networking.',
        '**2.** `applyAction` and `definition.reduce` are pure functions.',
        '**3.** `GameSnapshot` never leaves the host main process.',
    ].join('\n'),
);

const problemsIn = (markdown: string): string[] =>
    findCitationProblems(parseCitations('fixture.md', markdown), LEDGER);

describe('invariant citations — the checker', () => {
    it('reports nothing when every citation names a row it shares a term with', () => {
        // Positive control: without it, a checker that always reported a problem
        // would satisfy every fixture below.
        expect(
            problemsIn(
                [
                    '- **Invariant #1** — `simulation/` has zero runtime dependencies.',
                    '- **Invariant #3** — `GameSnapshot` never leaves the main process.',
                ].join('\n'),
            ),
        ).toEqual([]);
    });

    it('catches a citation whose number names no invariant row', () => {
        // A renumbering or a typo. Conjunct 2 cannot see this one: a row that is
        // not there shares nothing with anything, so the two must be separate.
        expect(problemsIn('- **Invariant #99** — `GameSnapshot` never leaves.')).toEqual([
            'fixture.md:1 cites #99, which has no invariant row',
        ]);
    });

    it('catches a citation whose number names a rule about something else', () => {
        // The drift exactly: the bullet restates rule 3 under the number 1. Both
        // numbers exist, so only conjunct 2 can see it.
        expect(
            problemsIn('- **Invariant #1** — `GameSnapshot` never leaves the main process.'),
        ).toEqual(['fixture.md:1 cites #1 but shares no term with it']);
    });

    it('accepts a short form that drops most of the row', () => {
        // A citation is a short form by construction, so "the row is contained in
        // the citation" is the wrong direction and must not be what is checked.
        expect(problemsIn('- **Invariant #1** — zero runtime dependencies.')).toEqual([]);
    });

    it('accepts a short form that adds a clause the row leaves implicit', () => {
        // The other direction, which the tree exercises: the `save-load` #26
        // bullet names `stagedReveals`, a term row 26 does not carry.
        expect(
            problemsIn(
                '- **Invariant #3** — `GameSnapshot` never leaves, and `PlayerSnapshot` is projected.',
            ),
        ).toEqual([]);
    });

    it('counts a term as the same anchor whatever case it is written in', () => {
        // The rule the doc states is a CASE-FOLDED term, and nothing else here
        // exercises it: every other fixture copies its row's casing. `stays`
        // reaches no row term and `put` is below the length floor, so
        // `GAMESNAPSHOT` is the only anchor this bullet has.
        expect(problemsIn('- **Invariant #3** — GAMESNAPSHOT stays put.')).toEqual([]);
    });

    it('counts a code span and bare prose as the same anchor', () => {
        // Backticks are separators, so a bullet that quotes an identifier the row
        // writes plainly still resolves — and the reverse.
        expect(problemsIn('- **Invariant #2** — applyAction is pure.')).toEqual([]);
    });

    it('does not let function words carry a citation', () => {
        // `the` and `has` are below the minimum length, so this bullet shares
        // nothing. Without the length filter it would resolve against any row.
        expect(problemsIn('- **Invariant #1** — the renderer has state.')).toEqual([
            'fixture.md:1 cites #1 but shares no term with it',
        ]);
    });

    it('reads a citation under every marker and separator form', () => {
        // Every marker the regex accepts — hyphen list, blockquote,
        // blockquote-then-list, bare and asterisk list — crossed with the em
        // dash, the en dash, the hyphen, a colon outside the emphasis, the colon
        // inside it that `electron-shell-ipc-bridge.md` writes, and no separator
        // at all. Each spelling a reader may type is one the guard must resolve
        // rather than skip. `prettier` rewrites an asterisk bullet to a hyphen,
        // so that one is unreachable through the format gate and pinned here
        // instead of left to the regex to promise on its own.
        const parsed = parseCitations(
            'fixture.md',
            [
                '- **Invariant #1** — a',
                '> **Invariant #1** – b',
                '> - **Invariant #1** - c',
                '**Invariant #1**: d',
                '> **Invariant #1:** e',
                '- **Invariant #1** f',
                '* **Invariant #1** — g',
            ].join('\n'),
        );
        expect(parsed.map((citation) => citation.text)).toEqual([
            'a',
            'b',
            'c',
            'd',
            'e',
            'f',
            'g',
        ]);
    });

    it('does not read a mid-sentence reference as a citation', () => {
        // `simulation-core-action-pipeline.md`'s prose note has this shape. It is
        // a pointer, not a restatement, and resolving it would report a sentence.
        const prose = 'Related invariants (especially **Invariant #1** — retention) are elsewhere.';
        expect(parseCitations('fixture.md', prose)).toEqual([]);
        expect(problemsIn(prose)).toEqual([]);
    });

    it('does not read a citation quoted inside a fenced block', () => {
        // A doc illustrating the bullet form is not making the claim. Without the
        // fence skip, this example would be resolved against the ledger.
        const fenced = ['```md', '- **Invariant #99** — an example bullet.', '```'].join('\n');
        expect(parseCitations('fixture.md', fenced)).toEqual([]);
        expect(problemsIn(fenced)).toEqual([]);
    });

    it('resumes reading after a fenced block closes', () => {
        // The fence toggle, not just the skip: a checker that latched `inFence`
        // on would silently stop reading the rest of the file.
        const afterFence = [
            '```md',
            '- **Invariant #99** — an example bullet.',
            '```',
            '- **Invariant #99** — a real one.',
        ].join('\n');
        expect(parseCitations('fixture.md', afterFence).map((c) => c.line)).toEqual([4]);
    });
});

describe('the docs tree', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'docs'], {
        cwd: repoRoot,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((file) => file.endsWith('.md'));

    const ledger = parseLedger(readFileSync(path.join(repoRoot, INVARIANTS_DOC), 'utf8'));
    const citations = tracked.flatMap((file) =>
        parseCitations(file, readFileSync(path.join(repoRoot, file), 'utf8')),
    );

    it('reads enough of the ledger and the docs for the check below to mean anything', () => {
        // Without this, a reformat that stopped matching either regex would turn
        // the assertion below into a pass over an empty list.
        expect(tracked).toEqual(expect.arrayContaining([...SENTINEL_DOCS]));
        expect(tracked).not.toContain(NON_MARKDOWN_DOC);
        expect(tracked.length).toBeGreaterThanOrEqual(MINIMUM_DOCS_SCANNED);
        expect(ledger.size).toBeGreaterThanOrEqual(MINIMUM_LEDGER_ROWS);
        expect(citations.length).toBeGreaterThanOrEqual(MINIMUM_CITATIONS);
    });

    it('cites no invariant number that names no rule, or a rule it shares no term with', () => {
        expect(findCitationProblems(citations, ledger)).toEqual([]);
    });
});
