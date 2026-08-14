/**
 * tools/architecture-overview-extent.test.ts
 *
 * Anti-rot guard for `docs/architecture-overview.md`'s account of its own
 * extent — the section numbers it claims to carry, and the appendices it claims
 * to span.
 *
 * The overview is an index hub: it defines no `## N.` section headings at all,
 * so a top-level `§N` is real only where the index region names it — either in
 * an `## Index:` heading or in a row of the table under one. Both carry real
 * mappings and neither subsumes the other: the rows name 1, 2, 3, 6, 7, 8, 9
 * and 13, while 4 and 10 are named only by their headings (`## Index: Core
 * Components (§4)`, `## Index: Testing (§10, §13)`). Reading rows alone would
 * report 4 and 10 as sections the hub does not define, which is the opposite of
 * true. Its Appendix C.1 scope sentence nonetheless claimed the whole
 * architecture ran "§1 through §18 and Appendices A–C", and both halves were
 * false — sections 5, 11, 12 and 14 through 18 were mapped nowhere, while
 * Appendix D was live and excluded. A reader taking the range at face value
 * goes looking for sections that do not exist, which is measured behaviour: an
 * orphaned architecture-space section-12 citation reached 99 issues before
 * anyone concluded the section was missing rather than merely unread. (The
 * numbers are spelled without their `§` above because a bare architecture-space
 * token for 12 is banned tree-wide by
 * tools/orphaned-section-12-references.test.ts — it resolves, wrongly, in the
 * coding-standards space.)
 *
 * The claim is therefore derived here rather than transcribed. Both conjuncts
 * re-read the document and compare it against itself:
 *
 * 1. **Every section the overview claims, it indexes.** `claimedSections` reads
 *    the tokens the document writes AND expands the ranges it names;
 *    `indexedSections` reads only the index region. Range expansion is what
 *    separates this from a token scan: `§1 through §18` writes just two tokens,
 *    so a scan of written tokens alone would red on §18 and then go green again
 *    the moment someone narrowed the range to `§1 through §13` — a range that
 *    still claims three sections nothing defines.
 * 2. **Any appendix range spans every live appendix.** Derived from the
 *    `## Appendix X` headings, so it catches under-reach (the defect that was
 *    there) as well as over-reach; a one-directional check would pass on
 *    `A–C` for exactly as long as Appendix D stayed unmentioned.
 *
 * ## Ceilings, stated so the assertions are read for what they are
 *
 * Conjunct 2 iterates the ranges the document names, and the document names
 * none — the scope sentence now points at itself instead of enumerating. That
 * assertion is vacuous at the current tree by design: AC-wise a correct
 * `Appendices A–D` is as acceptable as no range at all, so the live check
 * cannot ban ranges outright. What holds it up is `claimedAppendixSpans`'s own
 * fixtures below, which are what fail if the scanner stops matching; the live
 * loop only decides whether a range that IS written is honest.
 *
 * A range whose far endpoint drops its `§` — `§1 through 18` — is read as the
 * lone token `§1` and passes. The alternative reads "retry for §10 to 15
 * seconds" as a range, and a guard that reds on prose is one people delete; the
 * fixture at `does not read a bare number as the far end of a range` pins which
 * way the trade was made.
 *
 * Neither conjunct reads any file but the overview. A citation written in
 * another document is that document's problem; for `§` resolution elsewhere in
 * the tree see tools/orphaned-section-12-references.test.ts,
 * tools/animation-system-section.test.ts, and the section-reachability check in
 * tools/traceability-matrix.test.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const overviewPath = resolve(repoRoot, 'docs/architecture-overview.md');

/**
 * A top-level section number: `§9` and `§13.` yes, `§4.10` no.
 *
 * The lookahead is the whole point. `§4.10` names a subsection of the one
 * numbering space the overview indexes exhaustively, and reading it as a bare
 * `4` would let a subsection stand in for a section it never defines. It
 * rejects a separator only when a digit follows it: the overview ends sentences
 * on a section token ("the module tree in §3."), and a blanket `(?![\d.])` reads
 * that full stop as a subsection and drops the citation entirely.
 */
const TOP_LEVEL_TOKEN = /§(\d+)(?!\d|\.\d)/g;

/**
 * A range of top-level sections.
 *
 * `§` is required on BOTH sides: the document writes its one range that way
 * (`§8–§9`), and dropping the requirement would read "§10 to 15 seconds" as a
 * range. The em dash is deliberately not a range operator — the overview uses
 * it as sentence punctuation, so admitting it turns two citations separated by
 * one ("§9 — §13 covers the e2e tier") into a range spanning both.
 */
const SECTION_RANGE = /§(\d+)(?!\d|\.\d)\s*(?:through|to|–|-)\s*§(\d+)(?!\d|\.\d)/g;

const APPENDIX_HEADING = /^## Appendix ([A-Z])(?![A-Za-z])/gm;

/**
 * A range of appendices, e.g. `Appendices A–C`.
 *
 * Both letters must stand alone, or a hyphen-punctuated heading
 * (`## Appendix A - Technology Versions`) reads as the range A–T. No live
 * heading punctuates with an operator this regex admits, so none of them can
 * demonstrate the lookahead — hence the synthetic hyphen form in the fixture
 * below. A heading the operator set never matches passes it either way.
 */
const APPENDIX_RANGE =
    /Appendi(?:x|ces)\s+([A-Z])(?![A-Za-z])\s*(?:through|to|–|-)\s*([A-Z])(?![A-Za-z])/g;

const INDEX_HEADING_PREFIX = '## Index:';
const APPENDIX_HEADING_PREFIX = '## Appendix';

/**
 * The section numbers the index region maps to a file — those written in an
 * `## Index:` heading or in a row of the table under one.
 *
 * The line filter is the mapping test. Prose between the tables is talk, not a
 * mapping, and admitting it would let a sentence written under an index heading
 * certify a section no table lists — precisely what the check below exists to
 * refuse.
 */
function indexedSections(overview: string): Set<string> {
    const lines = overview.split('\n');
    const start = lines.findIndex((line) => line.startsWith(INDEX_HEADING_PREFIX));
    const end = lines.findIndex((line) => line.startsWith(APPENDIX_HEADING_PREFIX));
    if (start === -1 || end === -1 || end < start) {
        throw new Error(
            `Cannot locate the index region: "${INDEX_HEADING_PREFIX}" at ${start}, "${APPENDIX_HEADING_PREFIX}" at ${end}`,
        );
    }
    const region = lines
        .slice(start, end)
        .filter((line) => line.startsWith(INDEX_HEADING_PREFIX) || line.startsWith('|'))
        .join('\n');
    return new Set([...region.matchAll(TOP_LEVEL_TOKEN)].map((match) => match[1] ?? ''));
}

/** Every section number the overview names — written as a token or spanned by a range. */
function claimedSections(overview: string): Set<string> {
    const claimed = new Set([...overview.matchAll(TOP_LEVEL_TOKEN)].map((match) => match[1] ?? ''));
    for (const match of overview.matchAll(SECTION_RANGE)) {
        const ends = [Number(match[1]), Number(match[2])];
        for (let n = Math.min(...ends); n <= Math.max(...ends); n += 1) {
            claimed.add(String(n));
        }
    }
    return claimed;
}

function appendixHeadings(overview: string): string[] {
    return [...overview.matchAll(APPENDIX_HEADING)].map((match) => match[1] ?? '');
}

function claimedAppendixSpans(overview: string): { text: string; letters: string[] }[] {
    return [...overview.matchAll(APPENDIX_RANGE)].map((match) => {
        const ends = [(match[1] ?? '').charCodeAt(0), (match[2] ?? '').charCodeAt(0)];
        const letters: string[] = [];
        for (let code = Math.min(...ends); code <= Math.max(...ends); code += 1) {
            letters.push(String.fromCharCode(code));
        }
        return { text: match[0], letters };
    });
}

function ascending(tokens: Iterable<string>): string[] {
    return [...tokens].sort((a, b) => Number(a) - Number(b));
}

describe('the index-region reader', () => {
    const doc = [
        '# Title',
        '',
        '| legend | Numbering follows §7. |',
        '',
        '## Index: Things (§2)',
        '',
        'Region prose naming §9, and a `a|b` code span.',
        '',
        '| File | Section |',
        '| ---- | ------- |',
        '| a.md | §3      |',
        '',
        '## Appendix A — Later',
        '',
        '| pitfall | Breaks the rule in §5. |',
    ].join('\n');

    it('reads the sections an index table maps', () => {
        expect(indexedSections(doc).has('3')).toBe(true);
    });

    it('reads a section named only by an index heading', () => {
        // No index table row names the live hub's 4 or 10. Rows-only reads both
        // as undefined and reds the live document on sections it defines.
        expect(indexedSections(doc).has('2')).toBe(true);
    });

    it('does not index a section named by prose inside the region', () => {
        // The line filter is what makes this a mapping test rather than a
        // mention test. Without it a sentence under an index heading certifies a
        // section no table lists — the failure the whole guard exists to refuse.
        // The prose carries a pipe inside a code span so that widening the
        // filter to `includes` rather than `startsWith` is caught here too.
        expect(indexedSections(doc).has('9')).toBe(false);
    });

    it('indexes exactly the mapped sections and nothing else', () => {
        expect(ascending(indexedSections(doc))).toEqual(['2', '3']);
    });

    it('stops at the first appendix', () => {
        // The number sits in an appendix TABLE ROW, not appendix prose: the line
        // filter already drops prose, so a prose fixture here would pass with
        // the region's end bound deleted and measure nothing. The live document
        // makes this concrete — Appendix B's pitfalls table cites §1, §6, §9 and
        // §10 in exactly this shape, and reading past the bound would let an
        // appendix aside certify a section no index table maps.
        expect(indexedSections(doc).has('5')).toBe(false);
    });

    it('starts at the first index heading', () => {
        // The number sits in a table row above the first index heading, for the
        // same reason the end-bound fixture uses one: the line filter drops
        // preamble prose on its own, so a prose fixture here passes with the
        // start bound hardcoded to 0 and measures nothing. Only a row-shaped
        // line separates "the region begins at the heading" from "the region
        // begins at the file".
        expect(indexedSections(doc).has('7')).toBe(false);
    });

    it('does not index a subsection as its parent', () => {
        const subsectionOnly = [
            '## Index: Things',
            '| a.md | §4.10 |',
            '## Appendix A — Later',
        ].join('\n');
        expect(indexedSections(subsectionOnly).size).toBe(0);
    });

    it('throws rather than returning an empty set when the index region is gone', () => {
        // The floor under every "not indexed" verdict: a renamed heading style
        // would otherwise report every section in the document as undefined, or
        // — with the region markers reversed — as defined.
        expect(() => indexedSections('# Title\n\nNo index, no appendix.')).toThrow(/index region/);
    });
});

describe('the claimed-section reader', () => {
    it('counts a token the document writes', () => {
        expect(ascending(claimedSections('Testing lives in §13 of the hub'))).toEqual(['13']);
    });

    it('counts a token that ends a sentence', () => {
        // The overview writes one (`the module tree in §3.`). Reading the full
        // stop as a subsection separator drops the citation, and a section
        // claimed only in that position becomes invisible to the check below.
        expect(ascending(claimedSections('Testing lives in §13.'))).toEqual(['13']);
    });

    it('expands a "through" range across the sections it names', () => {
        // The killer for dropping range expansion: `§1 through §18` writes two
        // tokens and claims eighteen sections.
        expect(ascending(claimedSections('§1 through §18 constitutes the target.'))).toEqual([
            '1',
            '2',
            '3',
            '4',
            '5',
            '6',
            '7',
            '8',
            '9',
            '10',
            '11',
            '12',
            '13',
            '14',
            '15',
            '16',
            '17',
            '18',
        ]);
    });

    it('expands an en-dash range', () => {
        // The form the index headings use (`Security & Trust (§8–§9)`), so a
        // word-only range operator would miss every range in the live document.
        // The endpoints are three apart on purpose: an adjacent pair writes both
        // its numbers as tokens, so it reads the same whether the range is
        // expanded or not and pins neither the operator nor the expansion.
        expect(ascending(claimedSections('## Index: Security & Trust (§1–§4)'))).toEqual([
            '1',
            '2',
            '3',
            '4',
        ]);
    });

    it('does not read a bare number as the far end of a range', () => {
        // Without `§` required on both sides this claims §10 through §15.
        expect(ascending(claimedSections('Retries for §10 to 15 seconds.'))).toEqual(['10']);
    });

    it('does not read an em dash as a range operator', () => {
        // The overview punctuates with em dashes; as an operator they would
        // manufacture a range out of two citations that merely sit either side
        // of one. The dash has to be the ONLY thing between the two tokens or
        // this measures nothing: `\s*` cannot span an intervening clause, so a
        // fixture with words in the gap matches no range under either operator
        // set and passes whatever the answer.
        expect(
            ascending(claimedSections('Host authority is §9 — §13 covers the e2e tier.')),
        ).toEqual(['9', '13']);
    });

    it('does not read a subsection as its parent', () => {
        expect(claimedSections('Assets resolve per §4.10 at compile time.').size).toBe(0);
    });
});

describe('the appendix readers', () => {
    const doc = [
        '## Appendix A — Technology Versions',
        'body',
        '## Appendix Alpha — Not a letter',
        '## Appendix D. Future Extensions',
    ].join('\n');

    it('reads the letter of each appendix heading', () => {
        // `Appendix Alpha` is in there to keep the single-letter lookahead
        // honest: without it the word is read as appendix `A`, and the range
        // check below then compares against a phantom.
        expect(appendixHeadings(doc)).toEqual(['A', 'D']);
    });

    it('does not read a heading title as the far end of a range', () => {
        // A heading is not a claim about A through T. No live heading can show
        // this: none punctuates with an operator the regex admits, so each
        // matches nothing whether the lookahead is there or not — hence the
        // synthetic hyphen form.
        expect(claimedAppendixSpans('## Appendix A - Technology Versions')).toEqual([]);
    });

    it('expands a named range across the appendices it spans', () => {
        expect(claimedAppendixSpans('Appendices A–C constitute the target.')).toEqual([
            { text: 'Appendices A–C', letters: ['A', 'B', 'C'] },
        ]);
    });

    it('reads a singular range too', () => {
        expect(claimedAppendixSpans('See Appendix B through D.')[0]?.letters).toEqual([
            'B',
            'C',
            'D',
        ]);
    });
});

describe('docs/architecture-overview.md', () => {
    const overview = readFileSync(overviewPath, 'utf8');

    it('claims exactly the top-level sections it indexes', () => {
        // The census, pinned rather than left in a commit body: adding a section
        // to the hub should require saying so here.
        expect(ascending(claimedSections(overview))).toEqual([
            '1',
            '2',
            '3',
            '4',
            '6',
            '7',
            '8',
            '9',
            '10',
            '13',
        ]);
    });

    it('names no top-level section that no index table maps', () => {
        const indexed = indexedSections(overview);
        const unindexed = ascending(
            [...claimedSections(overview)].filter((token) => !indexed.has(token)),
        );
        expect(unindexed).toEqual([]);
    });

    it('carries four appendices', () => {
        // The derivation source for the range check below, and the measurement
        // the old `Appendices A–C` contradicted: Appendix D is live, and
        // docs/roadmap-sections/m10-first-public-release-v1.0.0.md cites D.3 and
        // D.4 by name in its feature headings (as bare text — it carries no link
        // into this document).
        expect(appendixHeadings(overview)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('names no appendix range that misses a live appendix', () => {
        const headings = appendixHeadings(overview);
        const dishonest = claimedAppendixSpans(overview)
            .filter((span) => span.letters.join('') !== headings.join(''))
            .map((span) => span.text);
        expect(dishonest).toEqual([]);
    });
});
