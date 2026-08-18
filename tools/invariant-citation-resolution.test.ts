/**
 * tools/invariant-citation-resolution.test.ts
 *
 * Anti-rot guard for every shape in which the repo cites a numbered invariant.
 *
 * A citation names a row of a 134-entry ledger. The number is hand-maintained
 * and, until this guard existed, nothing measured it, so it drifted:
 * `GameSnapshot never leaves the main process` was filed under #1 in two docs
 * and under its own #3 in two others, so one property carried two numbers, and
 * the reader who chased #1 landed on the zero-dependency rule with no signal
 * that anything was off.
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
 * ## The three shapes, and what decides that a `#nn` is a citation at all
 *
 * The rule is one rule, so one guard owns every reader; only what counts as a
 * citation differs, and each answer is a decision rather than a regex accident,
 * because `#nn` is also how this repo writes an issue number.
 *
 * 1. **The docs bullet** — `- **Invariant #nn** — <text>` opening a line. The
 *    `**Invariant #nn**` marker is itself the decision: nothing else carries it.
 * 2. **The docs table row** — `| #nn | <text> |`, read only under a markdown
 *    heading that names invariants. A bare-number first cell carries no marker of
 *    its own, so the enclosing section is the only thing that says which ledger
 *    the number indexes; a table of issue numbers written this way would resolve
 *    against the invariants. Measured at this tree: all 98 such cells sit under
 *    one of `Invariants`, `Invariant`, `Relevant Invariants`, and
 *    `Invariants introduced by this design (#116–#126)`.
 * 3. **The source-comment entry**, in two markers that need different evidence:
 *    - `Invariant #nn — <text>` opening a comment line spells the word, which
 *      identifies it exactly as the docs bullet's marker does, so it is read
 *      wherever it appears, and most of this tree's source citations are written
 *      that way with no block anywhere near them.
 *    - `#nn — <text>` carries the number alone, so it is read only inside a
 *      block opened by an `Invariants …:` heading — 183 such blocks at this
 *      tree. Outside a block a bare `#nn` opening a comment line says nothing
 *      about which ledger it indexes: this repo writes issue numbers in that
 *      exact shape, and a handful of citations lose their `Invariant` word to a
 *      `prettier` wrap. Reading the citations among them would mean reading the
 *      issue references too, so the rule leaves them all alone.
 *
 * An entry that states a property the ledger has no row for carries NO number.
 * A block admits unnumbered entries, and the shape predates this guard
 * (`Determinism — …`, `§3 Module Boundary — …`).
 * Outside a block the same convergence is simply not spelling the word. That is
 * what to do with a claim the ledger does not make: a bare statement cannot cite
 * the wrong row, whereas a number invented to look like a citation can only ever
 * be one.
 *
 * ## The bar of one shared term
 *
 * Not a tuned threshold for the bullet shape: measured before the bullets were
 * corrected, the three drifted ones shared **zero** terms with the rows they
 * used to name, and the lowest count among the other 55 of the 58 was **five**.
 * Nothing in the bullets sat between 1 and 4.
 *
 * Neither of the other two shapes has that gap, and both were measured at `main`
 * — before this branch corrected them — rather than after, so the bar is not
 * fitted to the tree it produced:
 *
 * - Source comments, 625 citations: 0:84, 1:60, 2:54, 3:51, 4:91, 5:90 — a
 *   continuum. A bar of 2 would report the 60 entries sharing exactly one term.
 *   At this tree the lowest count is still one, and the tree assertion is what
 *   counts how many sit there — so the bar cannot be raised at all without
 *   reporting faithful work.
 * - Table rows, 99 cells: 0:1, 1:1, 2:1, 3:4, 4:1, 5:3, then a long tail to 37,
 *   because a table cell restates its row nearly verbatim. The 0-, 1- and
 *   2-share cells were all three defects, but three points do not make a gap,
 *   and a bar of 3 fitted to them is a constant chosen to match the answer. At
 *   this tree, 98 cells remain and the lowest is 3.
 *
 * So the bar stays at one shared term for every shape — the rule the ledger
 * states — and the extra reach a stronger rule would buy is bought by reading
 * instead. What that leaves uncaught is stated below rather than left to be
 * discovered.
 *
 * ## What this does NOT catch
 *
 * - A citation that shares a term with its row while paraphrasing a different
 *   clause of it. Only the number-to-rule link is measured, not the paraphrase.
 * - A citation whose only shared term carries no topic. `MINIMUM_TERM_LENGTH` is a
 *   length floor, so a four-letter function word — `from`, `that`, `with` — is an
 *   anchor as far as this guard can tell, and a long row shares one with almost
 *   any sentence. A stopword list would replace a measured floor with a hand-kept
 *   one, so the floor stays and the limit is stated here instead.
 * - A citation of the wrong member of a vocabulary-sharing pair — #20/#21/#22
 *   all name `AssetRef`/`AssetManager`. A strict "the cited row is the ledger's
 *   BEST term match" rule was measured against BOTH doc shapes and rejected
 *   twice. On bullets it reports `module-boundaries-file-tree.md`'s faithful #48
 *   bullet, which loses on shared vocabulary to #80 and #96. On table rows it
 *   reported 11 cells at `main` and reports 6 at this tree — every one of the 6
 *   faithful, and all 6 in `replay-system.md`'s single table, because a table of
 *   adjacent invariants shares vocabulary row to row. That weakness is why the
 *   table rows this branch corrected were found by reading, and only one of them
 *   by the rule.
 * - A reference that names no rule at all. A mid-sentence `(Invariant #114)` and
 *   a mid-sentence `**Invariant #45**` are both excluded by the line-start
 *   anchor: they point at a rule rather than restating one, so there is nothing
 *   to resolve. A bare `#nn` in prose outside a block is left alone for the
 *   opposite reason — it is an issue number far more often than an invariant.
 *
 * ## Scope and anti-vacuity
 *
 * The doc shapes scan every tracked markdown file under `docs/` at any depth, so
 * package `CHANGELOG.md` files — append-only history that must not be rewritten
 * — are out by construction rather than by exclusion. The listing is the whole
 * `docs/` tree, filtered here rather than by a pathspec, because the obvious
 * pathspec is wrong in a way nothing announces: the double-star form requires a
 * literal `/` after `docs/` and silently drops the five top-level files,
 * `docs/architecture-overview.md` among them. The source shape scans every
 * tracked `.ts`/`.tsx` file anywhere in the repo.
 *
 * Fenced code blocks are skipped in markdown, so a doc quoting either doc form
 * as an example is not resolved against the ledger.
 *
 * Every repo-wide pass is pinned by anti-vacuity floors AND by named sentinels,
 * because a count floor cannot catch a listing that narrowed: 72 markdown files
 * clears any floor worth setting, and so does a `.ts`-only source listing that
 * dropped every `.tsx`. The sentinels below name one file per axis a narrowing
 * would drop. The issue-reference decision needs no separate tree assertion:
 * an issue number that leaked into the source pass is four digits, so conjunct 1
 * reports it as naming no row.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INVARIANTS_DOC = 'docs/executive-architecture/architecture-invariants.md';

/**
 * The lowest totals each pass may see before it is measuring nothing. The ledger
 * floor sits exactly on the count present when this was written — invariant
 * numbers are never reused, so the ledger only grows. Every other floor sits
 * below its measured count (77 markdown files, 58 bullets, 98 table rows, 1 450
 * source files, 183 comment blocks, and the comment citations `MINIMUM_COMMENT_CITATIONS`
 * floors), because deleting a
 * doc, a bullet, a row, or a file is ordinary and must not fail this guard.
 */
const MINIMUM_LEDGER_ROWS = 134;
const MINIMUM_DOCS_SCANNED = 60;
const MINIMUM_BULLET_CITATIONS = 40;
const MINIMUM_TABLE_CITATIONS = 70;
const MINIMUM_SOURCE_FILES_SCANNED = 900;
const MINIMUM_COMMENT_BLOCKS = 140;
const MINIMUM_COMMENT_CITATIONS = 450;

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

/**
 * One tracked source file per extension the source pass claims to read. The
 * `.tsx` sentinel is the one that matters: a listing narrowed to `.ts` drops
 * every React file at once and still clears any count floor, and this exact
 * `.tsx` header carried one of the citations this branch corrected.
 */
const SENTINEL_SOURCE_FILES = [
    'simulation/engine/ActionPipeline.ts',
    'renderer/app/game/page.test.tsx',
];

/**
 * Docs that must keep contributing table citations, one per heading spelling the
 * scope rule has to admit. `multiplayer-provider-websocket.md` heads its table
 * with the plain `Invariants` and is where three of the corrected table rows
 * were; `ipc-security-model.md` heads its five rows with `Relevant Invariants`,
 * which does NOT start with the word — narrowing the heading rule to a prefix
 * match drops those five and leaves every count floor cleared.
 */
const SENTINEL_TABLE_DOCS = [
    'docs/core-components/multiplayer-provider-websocket.md',
    'docs/security-trust/ipc-security-model.md',
];

/** A ledger row: `**89.** MAX_NESTED_DISPATCH …`. */
const INVARIANT_ROW = /^\*\*(\d+)\.\*\*\s*(.+)$/;

/**
 * A bullet citation opening a line, after an optional blockquote and/or list
 * marker.
 *
 * The separator is tolerated in every spelling the docs reach for and in none at
 * all, because every tolerance here can only WIDEN what is checked: the docs
 * write an em dash, `electron-shell-ipc-bridge.md` writes the colon inside the
 * emphasis (`**Invariant #79:**`), and a hand-typed en dash, hyphen or bare
 * space would otherwise be dismissed as unparseable and silently skipped.
 */
const BULLET_CITATION = /^\s*(?:>\s*)?(?:[-*]\s+)?\*\*Invariant #(\d+):?\*\*\s*(?:[—–:-]\s*)?(.+)$/;

/** A fenced code block delimiter. Both fence characters markdown allows. */
const FENCE = /^\s*(?:```|~~~)/;

/** An ATX markdown heading, at any level. */
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * A heading that opens a section of invariants. Matching the WORD rather than
 * the start of the heading is deliberate: `ipc-security-model.md` writes
 * `Relevant Invariants`, and `audio-system.md` writes
 * `Invariants introduced by this design (#116–#126)`.
 */
const INVARIANT_HEADING = /\bInvariants?\b/i;

/**
 * A two-column table row whose first cell is a bare invariant number. Read only
 * under an invariant heading — the same cell shape carries issue numbers in the
 * traceability matrices.
 */
const TABLE_CITATION = /^\|\s*#(\d+)\s*\|\s*(.+?)\s*\|\s*$/;

/**
 * One line of a `//` or `/* … *\/` comment, capturing its indent inside the
 * comment and its body. A line with no body — a bare `*` or `//` — does not
 * match, and so closes an open block; that is what keeps the prose after a
 * block's blank separator line out of the last citation.
 */
const COMMENT_LINE = /^\s*(?:\/\/|\*)(?!\/)(\s*)(\S.*)$/;

/**
 * The heading line that opens a source-comment invariant block. Nine spellings
 * exist at this tree (`upheld`, `verified`, `covered`, `asserted`, `checked`,
 * `honoured`, `touched`, the bare `Invariants:`, and
 * `Invariants #93 and #94:`), so the qualifier is unconstrained. What makes this a
 * heading rather than a sentence that happens to mention an invariant is the
 * leading word and a single trailing colon, with neither a full stop nor an
 * earlier colon between them —
 * without that last clause `AudioManager.ts`'s "… the pending-fade discipline of
 * Invariant #121 extended to position. Always `null` on a non-spatial voice:"
 * opens a block.
 */
const COMMENT_BLOCK_HEADING = /^Invariants?\b[^:.]*:$/i;

/**
 * An entry that carries the number alone: `#3 — …`. Read ONLY inside a block,
 * because a bare `#nn` opening a comment line is an issue reference at least as
 * often as a citation.
 *
 * The number may be prefixed by a list marker, may be a `/`-joined run of numbers
 * (`#3/#71`, `#59/60`), and may carry a parenthetical qualifier (`#25 (spirit)`)
 * before the separator. The separator class matches the bullet reader's for the
 * same reason: a spelling this does not accept is a citation silently skipped,
 * not a citation caught.
 */
const BARE_COMMENT_CITATION =
    /^(?:[-*]\s+)?#(\d+)((?:\s*\/\s*#?\d+)*)\s*(?:\([^)]*\)\s*)?[—–:-]\s*(.+)$/;

/**
 * An entry that spells the word: `Invariant #3: …`. The marker identifies itself,
 * exactly as `**Invariant #nn**` does in a doc, so this form is read wherever it
 * opens a comment line and needs no block heading above it. That reach is not a
 * generalisation: most of this tree's source citations are written this way, with
 * no block anywhere near them, in file headers that read to a maintainer exactly
 * like a block entry. `reads a spelled citation with no block above it` and
 * `wraps a spelled citation to the end of its paragraph, not its indent` are what
 * pin it.
 *
 * Case-insensitive because `snapshot-contract.ts` writes `INVARIANT #1:`.
 */
const SPELLED_COMMENT_CITATION =
    /^(?:[-*]\s+)?Invariants?\s+#(\d+)((?:\s*\/\s*#?\d+)*)\s*(?:\([^)]*\)\s*)?[—–:-]\s*(.+)$/i;

/**
 * The shortest run of `[a-z0-9]` that counts as an anchor. It is a length floor,
 * NOT a stopword list: `the`, `any`, `its` and `has` fall below it, but `from`,
 * `that` and `with` do not, so a citation can resolve on a word that carries no
 * topic — see "What this does NOT catch". Four is where the bullet corpus is
 * indifferent: dropping it to 3 and raising it to 5 both leave the same three
 * drifted bullets as the only ones with nothing shared.
 */
const MINIMUM_TERM_LENGTH = 4;

interface Citation {
    /** Repo-relative path, for a message naming a real line. */
    readonly file: string;
    /** 1-indexed. */
    readonly line: number;
    /** The number this citation names. */
    readonly number: number;
    /** The citation's restatement of the rule. */
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
 * Read every bullet citation that opens a line outside a fenced block. A doc
 * that shows the bullet form inside a fence is illustrating it, not making the
 * claim.
 */
function parseBulletCitations(file: string, markdown: string): Citation[] {
    const citations: Citation[] = [];
    let inFence = false;

    markdown.split('\n').forEach((line, index) => {
        if (FENCE.test(line)) {
            inFence = !inFence;
            return;
        }
        if (inFence) return;
        const match = BULLET_CITATION.exec(line);
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
 * Read every `| #nn | … |` row that sits under a heading naming invariants. The
 * heading is re-read on every heading line, so the section ends where the next
 * one starts — a `| #890 | … |` issue table under `## Cross-References` is out.
 */
function parseTableCitations(file: string, markdown: string): Citation[] {
    const citations: Citation[] = [];
    let inFence = false;
    let underInvariantHeading = false;

    markdown.split('\n').forEach((line, index) => {
        if (FENCE.test(line)) {
            inFence = !inFence;
            return;
        }
        if (inFence) return;

        const heading = MARKDOWN_HEADING.exec(line);
        if (heading !== null) {
            underInvariantHeading = INVARIANT_HEADING.test(heading[2] ?? '');
            return;
        }
        if (!underInvariantHeading) return;

        const match = TABLE_CITATION.exec(line);
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

/** One entry of a source comment, before its numbers are split out. */
interface CommentEntry {
    /** 1-indexed line of the entry's first line. */
    readonly line: number;
    /** Every number the entry names — `#3/#71` is two. */
    readonly numbers: readonly number[];
    /** Indent inside the comment, which the wrap rule reads. */
    readonly indent: number;
    /** Whether the entry is a list item of a block, which fixes its wrap rule. */
    readonly inBlock: boolean;
    text: string;
}

/**
 * Read every citation a source file's comments make.
 *
 * A line opens an entry when it spells `Invariant #nn`, or when it carries a bare
 * `#nn` while an `Invariants …:` block is open. A block opens at its heading and
 * closes at the end of its comment or at a bare `*` separator line — both are
 * lines `COMMENT_LINE` does not match, and the closing delimiter is one of them.
 *
 * The wrap rule differs by context, because the two contexts are different
 * things. A block is a LIST: indent separates its entries, so only a deeper line
 * wraps, and an unnumbered sibling at the list's own indent can never hand its
 * vocabulary to the entry above it. A citation outside a block is PROSE: it runs
 * to the end of its paragraph, so an equally indented line wraps too. Applying
 * the list rule to prose reports faithful citations whose anchor sits on the
 * second line of the sentence; `wraps a spelled citation to the end of its
 * paragraph, not its indent` is one, and the tree assertion is what counts them.
 */
function parseCommentCitations(file: string, source: string): Citation[] {
    const entries: CommentEntry[] = [];
    let inBlock = false;
    let open: CommentEntry | null = null;

    source.split('\n').forEach((line, index) => {
        const comment = COMMENT_LINE.exec(line);
        if (comment === null) {
            inBlock = false;
            open = null;
            return;
        }

        const indent = (comment[1] ?? '').length;
        const body = comment[2] ?? '';

        if (COMMENT_BLOCK_HEADING.test(body)) {
            inBlock = true;
            open = null;
            return;
        }

        const match =
            SPELLED_COMMENT_CITATION.exec(body) ??
            (inBlock ? BARE_COMMENT_CITATION.exec(body) : null);
        if (match !== null) {
            const rest = (match[2] ?? '')
                .split('/')
                .map((part) => part.trim().replace('#', ''))
                .filter((part) => part.length > 0)
                .map(Number);
            const entry: CommentEntry = {
                line: index + 1,
                numbers: [Number(match[1]), ...rest],
                indent,
                inBlock,
                text: match[3] ?? '',
            };
            entries.push(entry);
            open = entry;
            return;
        }

        if (open !== null && (indent > open.indent || (!open.inBlock && indent === open.indent))) {
            open.text = `${open.text} ${body}`;
            return;
        }
        open = null;
    });

    return entries.flatMap((entry) =>
        entry.numbers.map((number) => ({ file, line: entry.line, number, text: entry.text })),
    );
}

/** How many `Invariants …:` blocks a source file opens. */
function countCommentBlocks(source: string): number {
    let blocks = 0;
    for (const line of source.split('\n')) {
        const comment = COMMENT_LINE.exec(line);
        if (comment !== null && COMMENT_BLOCK_HEADING.test(comment[2] ?? '')) blocks += 1;
    }
    return blocks;
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

        // Conjunct 2 — the citation and the rule it names share an anchor.
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

// Fixtures. Each trips exactly one conjunct or one reader decision, so dropping
// any single check leaves a named test failing. Assembled from short synthetic
// ledgers rather than from the tree, so they keep saying what they say as
// invariants are added.
const LEDGER = parseLedger(
    [
        '**1.** `simulation/` has zero runtime dependencies on React, DOM, or networking.',
        '**2.** `applyAction` and `definition.reduce` are pure functions.',
        '**3.** `GameSnapshot` never leaves the host main process.',
        '**4.** The save checksum uses `crc32` over the canonical form.',
    ].join('\n'),
);

const problemsIn = (markdown: string): string[] =>
    findCitationProblems(parseBulletCitations('fixture.md', markdown), LEDGER);

const tableProblemsIn = (markdown: string): string[] =>
    findCitationProblems(parseTableCitations('fixture.md', markdown), LEDGER);

const commentProblemsIn = (source: string): string[] =>
    findCitationProblems(parseCommentCitations('fixture.ts', source), LEDGER);

describe('invariant citations — the docs bullet', () => {
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

    it('counts a digit-bearing identifier as an anchor', () => {
        // The term alphabet is `[a-z0-9]`, not `[a-z]`. The repo's rows name
        // `crc32`, `Q32.32` and `utf8`, and here `crc32` is this bullet's ONLY
        // shared term. Drop the digits from the alphabet and it becomes the
        // sub-minimum `crc` on both sides, so a faithful citation is reported.
        expect(problemsIn('- **Invariant #4** — CRC32 only.')).toEqual([]);
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
        const parsed = parseBulletCitations(
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
        expect(parseBulletCitations('fixture.md', prose)).toEqual([]);
        expect(problemsIn(prose)).toEqual([]);
    });

    it('does not read a citation quoted inside a fenced block', () => {
        // A doc illustrating the bullet form is not making the claim. Without the
        // fence skip, this example would be resolved against the ledger.
        const fenced = ['```md', '- **Invariant #99** — an example bullet.', '```'].join('\n');
        expect(parseBulletCitations('fixture.md', fenced)).toEqual([]);
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
        expect(parseBulletCitations('fixture.md', afterFence).map((c) => c.line)).toEqual([4]);
    });
});

describe('invariant citations — the docs table row', () => {
    const table = (...rows: readonly string[]): string =>
        ['| #   | Rule |', '| --- | ---- |', ...rows].join('\n');

    it('reports nothing when every row names a rule it shares a term with', () => {
        // Positive control for this reader, as above.
        expect(
            tableProblemsIn(
                [
                    '## Invariants',
                    '',
                    table(
                        '| #1  | `simulation/` has zero runtime dependencies. |',
                        '| #3  | `GameSnapshot` never leaves the main process. |',
                    ),
                ].join('\n'),
            ),
        ).toEqual([]);
    });

    it('catches a row whose number names no invariant row', () => {
        expect(
            tableProblemsIn(
                ['## Invariants', '', table('| #99 | `GameSnapshot` never leaves. |')].join('\n'),
            ),
        ).toEqual(['fixture.md:5 cites #99, which has no invariant row']);
    });

    it('catches a row whose number names a rule about something else', () => {
        // `multiplayer-provider-websocket.md`'s `#38` row exactly: a real number,
        // a real rule, and no overlap between them.
        expect(
            tableProblemsIn(
                [
                    '## Invariants',
                    '',
                    table('| #1  | `GameSnapshot` never leaves the main process. |'),
                ].join('\n'),
            ),
        ).toEqual(['fixture.md:5 cites #1 but shares no term with it']);
    });

    it('does not read a bare-number table outside an invariant section', () => {
        // The traceability matrices key their rows on issue numbers in this exact
        // cell shape. Without the heading scope, `#890` is reported as naming no
        // invariant row, and the guard fails on a table it has no business
        // reading.
        const matrix = ['## Delivered Issues', '', table('| #890 | throwing context hooks |')].join(
            '\n',
        );
        expect(parseTableCitations('fixture.md', matrix)).toEqual([]);
        expect(tableProblemsIn(matrix)).toEqual([]);
    });

    it('does not read a cell whose number is missing the # marker', () => {
        // The `#` is part of the shape a doc writes and part of what separates an
        // invariants table from any other two-column table of numbers. Dropping it
        // from the pattern widens the reader onto tables nobody meant it to read.
        const bare = ['## Invariants', '', table('| 1   | a rule about something. |')].join('\n');
        expect(parseTableCitations('fixture.md', bare)).toEqual([]);
    });

    it('stops reading at the next heading, whatever its level', () => {
        // The scope must END, not latch: a doc that lists its invariants and then
        // cross-references issues puts both tables in one file.
        const doc = [
            '## Invariants',
            '',
            table('| #1  | `simulation/` has zero runtime dependencies. |'),
            '',
            '### Delivered Issues',
            '',
            table('| #890 | throwing context hooks |'),
        ].join('\n');
        expect(parseTableCitations('fixture.md', doc).map((citation) => citation.number)).toEqual([
            1,
        ]);
    });

    it('reads a section whose heading only contains the word', () => {
        // `ipc-security-model.md` writes `Relevant Invariants`, so anchoring the
        // heading rule at the start of the text would silently drop its five rows.
        expect(
            tableProblemsIn(
                [
                    '## Relevant Invariants',
                    '',
                    table('| #1  | `GameSnapshot` never leaves the main process. |'),
                ].join('\n'),
            ),
        ).toEqual(['fixture.md:5 cites #1 but shares no term with it']);
    });

    it('does not read a table quoted inside a fenced block', () => {
        const fenced = [
            '## Invariants',
            '',
            '```md',
            table('| #99 | an example row. |'),
            '```',
        ].join('\n');
        expect(parseTableCitations('fixture.md', fenced)).toEqual([]);
    });
});

describe('invariant citations — the source-comment entry', () => {
    const block = (...entries: readonly string[]): string =>
        ['/**', ' * fixture.ts', ' *', ' * Invariants upheld:', ...entries, ' */'].join('\n');

    it('reports nothing when every entry names a rule it shares a term with', () => {
        // Positive control for this reader, as above.
        expect(
            commentProblemsIn(
                block(
                    ' *   #1 — `simulation/` has zero runtime dependencies.',
                    ' *   #3 — `GameSnapshot` never leaves the main process.',
                ),
            ),
        ).toEqual([]);
    });

    it('catches an entry whose number names no invariant row', () => {
        expect(commentProblemsIn(block(' *   #99 — `GameSnapshot` never leaves.'))).toEqual([
            'fixture.ts:5 cites #99, which has no invariant row',
        ]);
    });

    it('catches an entry whose number names a rule about something else', () => {
        // The drift in its dominant spelling: 18 headers at `main` filed
        // `simulation/ is side-effect-free` under #2 or #3 instead of #1.
        expect(
            commentProblemsIn(block(' *   #2 — `GameSnapshot` never leaves the main process.')),
        ).toEqual(['fixture.ts:5 cites #2 but shares no term with it']);
    });

    it('does not read a number outside an invariants block', () => {
        // A spec header can open on a bare issue number and a dash —
        // `apps/tactics/e2e/tests/in-game-menu-leave.spec.ts` does, and it is not
        // alone. The block heading is what tells such a line from a citation, so the
        // reference below sits in the SAME comment as a real block: a reader that
        // scanned lines instead of blocks would report it as naming no invariant
        // row.
        const header = [
            '/**',
            ' * #743 — E2E coverage for the in-game menu and role-aware leave (M8).',
            ' *',
            ' * Invariants upheld:',
            ' *   #3 — `GameSnapshot` never leaves the main process.',
            ' */',
        ].join('\n');
        expect(parseCommentCitations('fixture.ts', header).map((c) => c.number)).toEqual([3]);
        expect(commentProblemsIn(header)).toEqual([]);
    });

    it('does not open a block on a prose sentence that ends in a colon', () => {
        // `AudioManager.ts` writes "… the pending-fade discipline of Invariant #121
        // extended to position. Always \`null\` on a non-spatial voice:" inside a
        // field's doc comment. It starts with the word and ends with the colon, so
        // only the full stop between them keeps it from opening a block over the
        // prose that follows.
        const prose = [
            '/**',
            ' * Invariant #121 extended to position. Always null on a non-spatial voice:',
            ' *   #99 — the sentence below, read as an entry.',
            ' */',
        ].join('\n');
        expect(parseCommentCitations('fixture.ts', prose)).toEqual([]);
        expect(commentProblemsIn(prose)).toEqual([]);
    });

    it('ends the block at the closing delimiter, with no blank line to help', () => {
        // The delimiter is the ONLY thing between a block and whatever comment
        // follows it. `COMMENT_LINE`'s lookahead is what makes it not a comment
        // line; without that, the issue reference below is read as a block entry.
        const file = [
            '/**',
            ' * Invariants upheld:',
            ' *   #1 — `simulation/` has zero runtime dependencies.',
            ' */',
            '// #743 — see the issue for why this constant is 4.',
            'export const RETENTION = 4;',
        ].join('\n');
        expect(parseCommentCitations('fixture.ts', file).map((c) => c.number)).toEqual([1]);
    });

    it('does not open a block on a sentence that merely ends in the word', () => {
        // `electron/main/index.ts` writes "Security invariants (see …, Invariants #3
        // and #4):" above a bullet list. The heading rule is anchored at the start
        // of the comment body for exactly that line; unanchored, this opens a block
        // and the bare number below it is read.
        const file = [
            '/**',
            ' * Security notes (see the ledger for the full Invariants list):',
            ' *   #743 — the issue that added this bullet.',
            ' */',
        ].join('\n');
        expect(parseCommentCitations('fixture.ts', file)).toEqual([]);
    });

    it('stops reading at the end of the comment that opened the block', () => {
        // A block runs to the end of its comment, not to the end of the file: the
        // module body below it may well contain an issue reference in a comment
        // of its own.
        const file = [
            block(' *   #1 — `simulation/` has zero runtime dependencies.'),
            '',
            '// #743 — see the issue for why this constant is 4.',
            'export const RETENTION = 4;',
        ].join('\n');
        expect(parseCommentCitations('fixture.ts', file).map((c) => c.number)).toEqual([1]);
    });

    it('stops reading at a blank line inside the comment', () => {
        // `tick-driver.ts` separates its block from a trailing `Module boundary:`
        // note with a bare ` *`. Without that stop, the note is read as part of
        // the block.
        const file = [
            '/**',
            ' * Invariants upheld:',
            ' *   #1 — `simulation/` has zero runtime dependencies.',
            ' *',
            ' *   #99 — a note that is no longer part of the list.',
            ' */',
        ].join('\n');
        expect(parseCommentCitations('fixture.ts', file).map((c) => c.number)).toEqual([1]);
    });

    it('counts a wrapped entry as one citation and reads its whole text', () => {
        // Half of the tree's entries wrap, and the anchor is as often on the
        // continuation as on the first line. Every term of the first line here —
        // `host`, `Electron`, `import`, `reaches` — is absent from row 1, so
        // `simulation` on the second line is the entry's only anchor and a reader
        // that dropped the wrap would report this faithful entry.
        expect(
            commentProblemsIn(
                block(
                    ' *   #1 — no host I/O and no Electron import reaches',
                    ' *        `simulation/`.',
                ),
            ),
        ).toEqual([]);
    });

    it('does not let an unnumbered sibling entry rescue the citation above it', () => {
        // `MultiplayerProvider.ts` and its siblings follow their citations with an
        // unnumbered `Module boundary — …` entry at the SAME indent. Joining it to
        // the entry above would hand that entry a whole sentence of vocabulary it
        // never claimed.
        expect(
            commentProblemsIn(
                block(
                    ' *   #1 — no host I/O in the tick loop.',
                    ' *   Module boundary — `simulation/` imports nothing from `renderer/`.',
                ),
            ),
        ).toEqual(['fixture.ts:5 cites #1 but shares no term with it']);
    });

    it('resolves every number of a multi-number entry', () => {
        // `#3/#71`, `#59/#60`, `#38/#39/#47` and `#59/60` are all written at this
        // tree. A reader that took only the first would stop measuring the rest.
        const parsed = parseCommentCitations(
            'fixture.ts',
            block(' *   #1/#2/3 — `simulation/` has zero runtime dependencies.'),
        );
        expect(parsed.map((citation) => citation.number)).toEqual([1, 2, 3]);
        expect(
            commentProblemsIn(block(' *   #1/#3 — `simulation/` has zero runtime dependencies.')),
        ).toEqual(['fixture.ts:5 cites #3 but shares no term with it']);
    });

    it('reads an entry under every marker and separator form the tree writes', () => {
        // The list marker, the spelled-out `Invariant` prefix, the colon
        // separator, and the parenthetical qualifier all appear in real headers;
        // the en dash and hyphen are tolerated for the same reason the bullet
        // reader tolerates them.
        const parsed = parseCommentCitations(
            'fixture.ts',
            block(
                ' *   #1 — a',
                ' *   #1  – b',
                ' *   Invariant #1 - c',
                ' *   - #1: d',
                ' *   #1 (spirit) — e',
            ),
        );
        expect(parsed.map((citation) => citation.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('reads a spelled citation with no block above it', () => {
        // `renderer/state/saveStoreBootstrap.ts` and eight siblings write
        // `Invariant #nn: <restatement>` straight into a file header, with no
        // `Invariants …:` heading anywhere. Spelling the word is what a doc bullet's
        // `**Invariant #nn**` marker does, so it needs no block to disambiguate it.
        // The tree assertion below is what says how many of them resolve.
        const header = [
            '/**',
            ' * fixture.ts',
            ' *',
            ' * Invariant #1: `GameSnapshot` never leaves the main process.',
            ' */',
        ].join('\n');
        expect(commentProblemsIn(header)).toEqual([
            'fixture.ts:4 cites #1 but shares no term with it',
        ]);
    });

    it('reads a spelled citation whatever case it is written in', () => {
        // `simulation/foundation/snapshot-contract.ts` writes `INVARIANT #1:`.
        const header = ['/**', ' * INVARIANT #1: `GameSnapshot` never leaves.', ' */'].join('\n');
        expect(commentProblemsIn(header)).toEqual([
            'fixture.ts:2 cites #1 but shares no term with it',
        ]);
    });

    it('wraps a spelled citation to the end of its paragraph, not its indent', () => {
        // Outside a block a citation is prose, and prose wraps at the SAME indent.
        // `game.fixture.ts` puts its anchor on the second line of the sentence, so
        // the list rule — deeper-indent-only — reports it as unresolved.
        const header = [
            '/**',
            ' * Invariant #1: no host I/O and no Electron import reaches',
            ' * `simulation/`.',
            ' */',
        ].join('\n');
        expect(commentProblemsIn(header)).toEqual([]);
    });

    it('stops a spelled citation at the paragraph break', () => {
        // The wrap must END. A bare `*` closes the paragraph, so the sentence after
        // it cannot lend its vocabulary to the citation above.
        const header = [
            '/**',
            ' * Invariant #1: no host I/O reaches the tick loop.',
            ' *',
            ' * Unrelated prose that happens to mention `simulation/` and networking.',
            ' */',
        ].join('\n');
        expect(commentProblemsIn(header)).toEqual([
            'fixture.ts:2 cites #1 but shares no term with it',
        ]);
    });

    it('does not let a WRAPPED unnumbered sibling rescue the citation above it', () => {
        // The sibling's own line is at the list's indent, so it never wraps — but
        // its continuation is deeper than the citation two lines up, so the reader
        // must have CLOSED the citation when the sibling opened. Without that close,
        // the continuation's `React`/`networking` reach row 1 and this drifted
        // entry resolves. A one-line sibling cannot show the difference, which is
        // why the fixture below does not.
        expect(
            commentProblemsIn(
                block(
                    ' *   #1 — no host I/O reaches the tick loop.',
                    ' *   Determinism — decisions are a pure function of the projected snapshot,',
                    ' *        with no dependency on React, DOM, or networking.',
                ),
            ),
        ).toEqual(['fixture.ts:5 cites #1 but shares no term with it']);
    });

    it('keeps the list wrap rule for an entry inside a block', () => {
        // The two rules must stay distinct: inside a block, an equally indented line
        // is the NEXT entry, and joining it would hand the citation above a sentence
        // it never claimed. Same shape as the prose fixture, opposite verdict.
        expect(
            commentProblemsIn(
                block(
                    ' *   #1 — no host I/O reaches the tick loop.',
                    ' *   Module boundary — `simulation/` imports nothing from `renderer/`.',
                ),
            ),
        ).toEqual(['fixture.ts:5 cites #1 but shares no term with it']);
    });

    it('reads a line-comment block as well as a block-comment one', () => {
        // `renderer/app/game/page.test.tsx` writes its header in `//` comments
        // because `// @vitest-environment jsdom` must be the first line.
        const file = [
            '// @vitest-environment jsdom',
            '// fixture.tsx',
            '//',
            '// Invariants upheld:',
            '//   #1 — `GameSnapshot` never leaves the main process.',
            '',
            'export {};',
        ].join('\n');
        expect(commentProblemsIn(file)).toEqual([
            'fixture.ts:5 cites #1 but shares no term with it',
        ]);
    });

    it('reads every block of a file, not only the first', () => {
        const file = [
            block(' *   #1 — `simulation/` has zero runtime dependencies.'),
            '',
            '/**',
            ' * Invariants verified:',
            ' *   #3 — `GameSnapshot` never leaves the main process.',
            ' */',
        ].join('\n');
        expect(parseCommentCitations('fixture.ts', file).map((c) => c.number)).toEqual([1, 3]);
    });
});

describe('the tree', () => {
    const trackedFiles = execFileSync('git', ['ls-files'], {
        cwd: repoRoot,
        encoding: 'utf8',
    }).split('\n');

    const trackedDocs = trackedFiles.filter(
        (file) => file.startsWith('docs/') && file.endsWith('.md'),
    );
    const trackedSources = trackedFiles.filter(
        (file) => file.endsWith('.ts') || file.endsWith('.tsx'),
    );

    const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

    const ledger = parseLedger(read(INVARIANTS_DOC));
    const bulletCitations = trackedDocs.flatMap((file) => parseBulletCitations(file, read(file)));
    const tableCitations = trackedDocs.flatMap((file) => parseTableCitations(file, read(file)));
    const commentCitations = trackedSources.flatMap((file) =>
        parseCommentCitations(file, read(file)),
    );
    const commentBlocks = trackedSources.reduce(
        (total, file) => total + countCommentBlocks(read(file)),
        0,
    );

    it('reads enough of the ledger, the docs and the sources for the checks below to mean anything', () => {
        // Without this, a reformat that stopped matching any regex, or a listing
        // that narrowed, would turn the assertions below into passes over empty
        // lists. Each floor is paired with a name, because a narrowing that drops
        // a whole class of file still clears every floor worth setting.
        // `arrayContaining([])` passes over any array, so each sentinel list needs
        // its own floor — emptying one is how these assertions go quiet while still
        // reading like they name something.
        expect(SENTINEL_DOCS.length).toBeGreaterThan(0);
        expect(SENTINEL_SOURCE_FILES.length).toBeGreaterThan(0);
        expect(SENTINEL_TABLE_DOCS.length).toBeGreaterThan(0);

        expect(trackedDocs).toEqual(expect.arrayContaining([...SENTINEL_DOCS]));
        expect(trackedDocs).not.toContain(NON_MARKDOWN_DOC);
        expect(trackedSources).toEqual(expect.arrayContaining([...SENTINEL_SOURCE_FILES]));
        expect(trackedSources).not.toContain(INVARIANTS_DOC);

        expect(trackedDocs.length).toBeGreaterThanOrEqual(MINIMUM_DOCS_SCANNED);
        expect(trackedSources.length).toBeGreaterThanOrEqual(MINIMUM_SOURCE_FILES_SCANNED);
        expect(ledger.size).toBeGreaterThanOrEqual(MINIMUM_LEDGER_ROWS);

        expect(bulletCitations.length).toBeGreaterThanOrEqual(MINIMUM_BULLET_CITATIONS);
        expect(tableCitations.length).toBeGreaterThanOrEqual(MINIMUM_TABLE_CITATIONS);
        expect(commentBlocks).toBeGreaterThanOrEqual(MINIMUM_COMMENT_BLOCKS);
        expect(commentCitations.length).toBeGreaterThanOrEqual(MINIMUM_COMMENT_CITATIONS);

        // Named per shape, because a floor cleared by the other two shapes says
        // nothing about the one whose reader broke.
        expect([...new Set(tableCitations.map((citation) => citation.file))]).toEqual(
            expect.arrayContaining([...SENTINEL_TABLE_DOCS]),
        );
        expect([...new Set(commentCitations.map((citation) => citation.file))]).toEqual(
            expect.arrayContaining([...SENTINEL_SOURCE_FILES]),
        );
    });

    it('cites no invariant number in a docs bullet that names no rule, or a rule it shares no term with', () => {
        expect(findCitationProblems(bulletCitations, ledger)).toEqual([]);
    });

    it('cites no invariant number in a docs table that names no rule, or a rule it shares no term with', () => {
        expect(findCitationProblems(tableCitations, ledger)).toEqual([]);
    });

    it('cites no invariant number in a source comment that names no rule, or a rule it shares no term with', () => {
        expect(findCitationProblems(commentCitations, ledger)).toEqual([]);
    });
});
