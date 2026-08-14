/**
 * tools/traceability-matrix.test.ts
 *
 * Anti-rot guard for `docs/roadmap-sections/architecture-traceability-matrix.md`
 * — the file that answers "which architecture section authorised this feature?".
 *
 * The matrix states its own admission rule: every feature maps to at least one
 * architecture section, and a feature without a `§` reference must not be
 * planned. Nothing measured that rule, so it drifted.
 *
 * Four things rot independently and each is ratcheted here.
 *
 * **The census predicate.** The gap went unseen because the grep that looked for
 * it anchored on `###`, and only M10 writes feature headings at that depth —
 * M1–M9 use `##`. A census that keys on one milestone's formatting measures one
 * milestone. `FEATURE_HEADING` therefore admits any heading depth, and the
 * anti-vacuity floor below fails if the count ever collapses back to one
 * milestone's worth.
 *
 * **Range notation.** Rows on both sides express membership as `F30–F34` /
 * `§4.33–§4.36` rather than as individual names, so a literal token scan
 * under-reports coverage. The feature and §4 sets are built through expanders,
 * pinned against synthetic input rather than against the tree.
 *
 * **Feature coverage.** Every feature with a roadmap heading must appear in the
 * matrix table and in the Feature-to-Milestone Index. Each is asserted as an
 * exact set difference, never as a count. The converse — a row naming a feature
 * that has no heading — is deliberately not asserted: F73 shipped without ever
 * gaining a roadmap section and is carried by the §3 row on purpose.
 *
 * **Section reachability.** A row naming a section nothing else knows about is
 * the same defect wearing the opposite sign — it reads as a resolved anchor and
 * is not. The rows this guard was written against resolved only inside
 * `docs/coding-standards-sections/`, a different numbering space, so a feature
 * whose acceptance criterion cited one could never discharge it. The §4 space is
 * checked in both directions against the overview index, so a section authored
 * without a matrix row fails just as loudly as a matrix row without a section.
 *
 * The top-level space is checked far more weakly, and the weakness is the point
 * at which to read the assertions rather than their names: it asks only whether
 * the overview mentions the number ANYWHERE, because the overview does not index
 * the top-level space the way it indexes §4. The consequence is measured below:
 * a number named only in a summary sentence passes. What it does catch is a
 * number the overview never writes at all, which is the state the deleted rows
 * were in.
 *
 * The index ↔ files axis is checked on one general property — every index row
 * links a file that exists — which is what makes an authored section's deletion
 * loud rather than silent. Nothing here opened an indexed file before.
 *
 * It is deliberately NOT extended into a tree-wide banner assertion. Indexed
 * files disagree about the banner: some carry none, and those that do write the
 * section list in their own way (`§4.5 and §7`, `§ 4.1 and § 4.1a`,
 * `§4.21 + §4.23`, `§4.16–§4.17`) against a comma-separated index cell. A
 * banner-match assertion would fail on rows that are not defects. `§6` is
 * checked for its banner individually instead, because its row is the one that
 * named a section no document defined.
 *
 * The converse still is NOT seen: a section authored on disk but never added to
 * the overview index. `§4.15` was in that state when this was written, and no
 * assertion here re-measures it.
 *
 * `readFileSync` throws if a doc moves, so this guard fails loud rather than
 * passing vacuously on a renamed path.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const MATRIX_DOC = 'docs/roadmap-sections/architecture-traceability-matrix.md';
const OVERVIEW_DOC = 'docs/architecture-overview.md';
const ROADMAP_DIR = 'docs/roadmap-sections';

/**
 * The milestone files the feature census reads. Listed rather than globbed: a
 * glob silently shrinks when a file is renamed, and a census that quietly stops
 * covering a milestone is the exact defect this guard exists to catch.
 */
const MILESTONE_DOCS = [
    'm1-skeleton-v0.1.0.md',
    'm2-networked-lobby-v0.2.0.md',
    'm3-action-registry-game-loop-v0.3.0.md',
    'm4-ai-framework-v0.4.0.md',
    'm5-state-projection-obfuscation-v0.5.0.md',
    'm6-e2e-testing-v0.6.0.md',
    'm7-3d-render-integration-v0.7.0.md',
    'm8-hardening-v0.8.0.md',
    'm9-package-extraction-v0.9.0.md',
    'm10-first-public-release-v1.0.0.md',
] as const;

/**
 * A feature heading at any depth. The depth is deliberately unconstrained: the
 * gap this guard was written for hid behind a census that assumed `###`.
 */
const FEATURE_HEADING = /^#+[ \t]+(F\d+)\b(.*)$/gm;

/**
 * What a heading has to carry for its anchor to be readable without opening the
 * GitHub issue. `§` covers the numbered space; `Appendix` covers F65–F67, whose
 * anchors are appendix subsections and carry no `§`.
 */
const HEADING_ANCHOR = /§|Appendix/;

/** The dash characters a written range may use between its endpoints. */
const RANGE_DASH = '[–—-]';

// ─── Token parsing ──────────────────────────────────────────────────────────────

/**
 * Strips markdown link syntax down to its text, so `[F30](m6.md)–[F34](m6.md)`
 * reads as `F30–F34`. Without this the range expander would have to reach across
 * a URL that itself contains digits and dashes.
 */
function stripLinks(text: string): string {
    return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** Normalises a feature number to the two-digit form the docs are written in. */
function normaliseFeature(digits: string): string {
    return `F${digits.padStart(2, '0')}`;
}

/**
 * Every feature number a cell names, ranges expanded.
 *
 * The interior of a range is what the second loop cannot see; both endpoints are
 * picked up by the literal scan whichever order they are written in, so a
 * descending range needs no branch of its own — it simply contributes no
 * interior.
 */
function expandFeatureTokens(cell: string): string[] {
    const text = stripLinks(cell);
    const found = new Set<string>();

    const ranges = new RegExp(`F(\\d+)\\s*${RANGE_DASH}\\s*F(\\d+)`, 'g');
    for (const match of text.matchAll(ranges)) {
        for (let n = Number(match[1]); n <= Number(match[2]); n++) {
            found.add(normaliseFeature(String(n)));
        }
    }

    for (const match of text.matchAll(/F(\d+)/g)) {
        found.add(normaliseFeature(match[1] ?? ''));
    }
    return [...found].sort();
}

/**
 * Every plain `§4.N` token a cell names, ranges expanded.
 *
 * "Plain" means an integer subsection: `§4.1a` and `§4.2.1` are admitted by
 * neither side of the comparison below. They are real anchors, but they are
 * indexed and rowed inconsistently by design (the overview folds `§4.1a` into
 * the `§4.1` row), and a comparison that included them would fail on a
 * difference that is not a defect. Excluding them by one predicate keeps both
 * sides measured the same way.
 *
 * A descending range contributes no interior, exactly as on the feature side:
 * ordering the endpoints first would expand `§4.36–§4.33` into a full set and so
 * hide a reversed range from the bidirectional comparison, which is one of the
 * typos that comparison exists to surface.
 */
function expandSectionTokens(cell: string): string[] {
    const text = stripLinks(cell);
    const found = new Set<string>();

    const ranges = new RegExp(`§4\\.(\\d+)\\s*${RANGE_DASH}\\s*§?4\\.(\\d+)`, 'g');
    for (const match of text.matchAll(ranges)) {
        for (let n = Number(match[1]); n <= Number(match[2]); n++) {
            found.add(`4.${n}`);
        }
    }

    for (const match of text.matchAll(/§4\.(\d+)(?![\d.a-z])/g)) {
        found.add(`4.${match[1]}`);
    }
    return [...found].sort();
}

/**
 * Every top-level `§N` token a cell names — `§3`, `§10`; never `§4.2` or
 * `§Appendix C`.
 *
 * The lookahead's real work is on the numbering spaces that are NOT §4: a row
 * written `§11.2` or `§12.3` names a coding-standards subsection, not an
 * architecture section, and admitting it as `11` would send a resolvable anchor
 * to the reachability check as though it were dead.
 */
function topLevelSectionTokens(cell: string): string[] {
    return [...stripLinks(cell).matchAll(/§(\d+)(?![\d.])/g)]
        .map((match) => match[1] ?? '')
        .filter((token) => token !== '4');
}

/**
 * Whether `overview` writes the top-level number `token` anywhere at all.
 *
 * Deliberately a mention test, not a definition test — see the header. Its
 * strength is pinned by the fixtures under `the top-level reachability
 * predicate`, so nobody has to infer it from the call site.
 */
function overviewMentionsSection(overview: string, token: string): boolean {
    return new RegExp(`§${token}(?![\\d.])`).test(overview);
}

// ─── Document readers ───────────────────────────────────────────────────────────

/**
 * Splits one table line into trimmed cells.
 *
 * The split is on unescaped pipes only: the §4.22 row's description carries a
 * literal `\|` inside a code span, and splitting on it would shift every cell
 * after it by one — harmless while only the first and last are read, and a trap
 * the moment a middle column is.
 */
function splitCells(line: string): string[] {
    return line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim());
}

/**
 * The rows of the first markdown table following `heading`, header and
 * alignment rows dropped, cells trimmed so Prettier's column padding never
 * reaches an assertion.
 *
 * Two things end the table: the next heading, and — because a document may put
 * a second table under the same heading — the first non-table line after the
 * body has started. Both are needed, and `parses only the first table under a
 * heading` is the fixture for the second.
 */
function parseTableAfter(text: string, heading: string): string[][] {
    const lines = text.split('\n');
    const start = lines.indexOf(heading);
    expect(start, `heading not found: ${heading}`).toBeGreaterThanOrEqual(0);

    const rows: string[][] = [];
    let separatorSeen = false;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i]?.trim() ?? '';
        if (line.startsWith('#')) {
            break;
        }
        if (!line.startsWith('|')) {
            if (rows.length > 0) {
                break;
            }
            continue;
        }
        const cells = splitCells(line);
        if (!separatorSeen) {
            separatorSeen = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
            continue;
        }
        rows.push(cells);
    }
    return rows;
}

/** `parseTableAfter` over a document on disk. */
function tableRowsUnder(doc: string, heading: string): string[][] {
    return parseTableAfter(read(doc), heading);
}

/** Every feature that has a roadmap heading, with the milestone file it lives in. */
function featureCensus(): { feature: string; doc: string; heading: string }[] {
    const census: { feature: string; doc: string; heading: string }[] = [];
    for (const doc of MILESTONE_DOCS) {
        const text = read(path.join(ROADMAP_DIR, doc));
        for (const match of text.matchAll(FEATURE_HEADING)) {
            census.push({
                feature: normaliseFeature((match[1] ?? '').slice(1)),
                doc,
                heading: `${match[1] ?? ''}${match[2] ?? ''}`,
            });
        }
    }
    return census;
}

/** The matrix's main table: `| Architecture Section | Description | Features |`. */
function matrixRows(): string[][] {
    return tableRowsUnder(MATRIX_DOC, '# Architecture Traceability Matrix').filter(
        (cells) => cells.length >= 3,
    );
}

/** The Feature-to-Milestone Index at the foot of the matrix. */
function milestoneIndexRows(): string[][] {
    return tableRowsUnder(MATRIX_DOC, '## Feature-to-Milestone Index');
}

/** The `Architecture Section` column of the overview's Core Components index. */
function overviewSectionCells(): string[] {
    return tableRowsUnder(OVERVIEW_DOC, '## Index: Core Components (§4)').map(
        (cells) => cells[1] ?? '',
    );
}

/** Every distinct token produced by running `extract` over `cells`. */
function unionOf(cells: readonly string[], extract: (cell: string) => string[]): string[] {
    return [...new Set(cells.flatMap(extract))].sort();
}

// ─── The predicates ─────────────────────────────────────────────────────────────

describe('the feature-token expander', () => {
    it('expands a linked range to every member, not just its endpoints', () => {
        expect(expandFeatureTokens('[F30](m6.md)–[F34](m6.md)')).toEqual([
            'F30',
            'F31',
            'F32',
            'F33',
            'F34',
        ]);
    });

    it('reads an unlinked name and a linked name the same way', () => {
        expect(expandFeatureTokens('F02, [F28](m5.md)')).toEqual(['F02', 'F28']);
    });

    it('normalises an unpadded number onto the two-digit form the docs use', () => {
        // `F1` and `F01` are the same feature; a set differenced against the
        // census must not report one as missing because of its padding.
        expect(expandFeatureTokens('F1, F01')).toEqual(['F01']);
    });

    it('accepts every dash a written range may use', () => {
        for (const dash of ['–', '—', '-']) {
            expect(expandFeatureTokens(`F07${dash}F09`), `range written with "${dash}"`).toEqual([
                'F07',
                'F08',
                'F09',
            ]);
        }
    });

    it('reads a descending range as its two endpoints and invents no interior', () => {
        // Ordering the endpoints before iterating would forge F31–F33 out of a
        // typo. The endpoints survive because the literal scan sees them.
        expect(expandFeatureTokens('F34–F30')).toEqual(['F30', 'F34']);
    });

    it('does not read a feature number out of a link target', () => {
        // The old literal scan read digits out of URLs; `m6-e2e-testing` has no
        // F-token, but a filename that did would have forged coverage.
        expect(expandFeatureTokens('[F30](https://example.test/F99/x)')).toEqual(['F30']);
    });
});

describe('the section-token expander', () => {
    it('expands a section range to every member', () => {
        expect(expandSectionTokens('§4.33–§4.36')).toEqual(['4.33', '4.34', '4.35', '4.36']);
    });

    it('reads several tokens out of one cell', () => {
        expect(expandSectionTokens('§4.16, §4.17')).toEqual(['4.16', '4.17']);
    });

    it('reads nothing out of a lettered variant standing alone', () => {
        // Alone, not beside `§4.1` — with the plain form in the same cell the
        // expected set is identical whether or not the variant is excluded, so
        // that fixture cannot fail for this and the exclusion goes unpinned.
        expect(expandSectionTokens('§4.1a Extension System')).toEqual([]);
    });

    it('reads nothing out of a sub-numbered variant standing alone', () => {
        expect(expandSectionTokens('§4.2.1 Determinism')).toEqual([]);
    });

    it('admits the plain form alongside both variants', () => {
        expect(expandSectionTokens('§4.1, §4.1a, §4.2, §4.2.1')).toEqual(['4.1', '4.2']);
    });

    it('reads a descending range as its two endpoints and invents no interior', () => {
        // The feature-side expander refuses the same ordering for the same
        // reason: a reversed range expanded into a full set is a typo the
        // bidirectional comparison would then never report.
        expect(expandSectionTokens('§4.36–§4.33')).toEqual(['4.33', '4.36']);
    });

    it('reads no §4 token out of a top-level section', () => {
        expect(expandSectionTokens('§4 Core components, §10 Testing')).toEqual([]);
    });
});

describe('the top-level section reader', () => {
    it('reads bare section numbers and ignores the §4 subsection space', () => {
        expect(topLevelSectionTokens('§3 Naming, §4.10 Assets, §13 E2E')).toEqual(['3', '13']);
    });

    it('ignores a §4 row heading, which is not a top-level claim of its own', () => {
        expect(topLevelSectionTokens('§4.2.1 Determinism')).toEqual([]);
    });

    it('drops a subsection outside the §4 space rather than reading its parent', () => {
        // `§11.2` resolves in docs/coding-standards-sections/security.md. Read
        // as a bare `11` it would be handed to the reachability check and
        // reported dead, which is the opposite of true. The `§4` fixtures above
        // cannot measure this — the bare-§4 filter satisfies them either way.
        expect(topLevelSectionTokens('§11.2 Prototype pollution, §13 E2E')).toEqual(['13']);
    });

    it('drops a bare §4, which names the subsection space rather than a section', () => {
        // The lookahead only rejects `§4.10`; a bare `§4` reaches the filter,
        // and without it the reachability check would demand the overview
        // define a top-level "§4" it never states as one.
        expect(topLevelSectionTokens('§4 Core components, §10 Testing')).toEqual(['10']);
    });
});

describe('the top-level reachability predicate', () => {
    it('counts a number written only in prose', () => {
        // This is the predicate's ceiling, stated as a fixture rather than left
        // to be discovered: `§1 through §18` in the closing summary is enough to
        // satisfy a hypothetical §18 row. Strengthening it means indexing the
        // top-level space the way §4 is indexed, which no document does yet.
        expect(
            overviewMentionsSection('Everything here — §1 through §18 — constitutes v1.', '18'),
        ).toBe(true);
    });

    it('rejects a number the overview never writes', () => {
        expect(overviewMentionsSection('§10 Testing, §13 E2E', '12')).toBe(false);
    });

    it('does not accept a subsection in place of its parent', () => {
        expect(overviewMentionsSection('§12.4 something', '12')).toBe(false);
    });
});

describe('the table reader', () => {
    const doc = [
        '## Heading',
        '',
        'Prose before the table.',
        '',
        '| Section | Features |',
        '| ------- | -------- |',
        '|   §3    |  F01     |',
        '| §4.22   | a `\\|` pipe | F02 |',
        '',
        'Prose after the table.',
        '',
        '| Section | Features |',
        '| ------- | -------- |',
        '| §9      | F99      |',
    ].join('\n');

    it('drops the header and alignment rows and trims the column padding', () => {
        // The header row is what an off-by-one in the separator scan lets
        // through, so the first data row is asserted whole rather than probed.
        expect(parseTableAfter(doc, '## Heading')[0]).toEqual(['§3', 'F01']);
    });

    it('parses only the first table under a heading', () => {
        // Without the non-table break the second table's rows leak in, and a
        // feature named only there would forge coverage.
        expect(parseTableAfter(doc, '## Heading').flat()).not.toContain('F99');
    });

    it('does not split a cell on an escaped pipe', () => {
        expect(parseTableAfter(doc, '## Heading')[1]).toEqual(['§4.22', 'a `\\|` pipe', 'F02']);
    });
});

// ─── The guard ──────────────────────────────────────────────────────────────────

describe('the feature census', () => {
    it('covers every milestone, not one milestone’s heading depth', () => {
        const census = featureCensus();
        // Anti-vacuity with teeth: the original defect was a census that saw
        // only M10's 15 headings. A floor of 80 cannot be met by any single
        // milestone, so re-narrowing the predicate fails here.
        expect(census.length).toBeGreaterThanOrEqual(80);

        const perDoc = new Set(census.map((entry) => entry.doc));
        expect([...perDoc].sort()).toEqual([...MILESTONE_DOCS].sort());

        const features = census.map((entry) => entry.feature);
        // Both heading depths are represented: `## F44` (M8) and `### F82` (M10).
        expect(features).toContain('F44');
        expect(features).toContain('F82');
    });

    it('gives every feature heading a readable anchor', () => {
        // The root cause of the M10 cluster: M1–M9 headings carry their anchor
        // inline, M10's carried none, so the anchors lived only in GitHub issue
        // titles and nothing transcribed them into the matrix.
        const anchorless = featureCensus()
            .filter((entry) => !HEADING_ANCHOR.test(entry.heading))
            .map((entry) => `${entry.doc}: ${entry.heading}`);

        expect(anchorless, 'feature headings carry no architecture anchor').toEqual([]);
    });
});

describe('every feature reaches an architecture section', () => {
    it('names every feature with a roadmap heading in the matrix table', () => {
        const census = [...new Set(featureCensus().map((entry) => entry.feature))].sort();
        const covered = unionOf(
            matrixRows().map((cells) => cells.at(-1) ?? ''),
            expandFeatureTokens,
        );

        // Anti-vacuity: both sides are non-empty and the ranges really expanded.
        expect(census.length).toBeGreaterThanOrEqual(80);
        expect(covered).toContain('F31');
        expect(covered).toContain('F60');

        const missing = census.filter((feature) => !covered.includes(feature));
        expect(missing, 'features with a roadmap heading but no matrix row').toEqual([]);
    });

    it('names every feature with a roadmap heading in the Feature-to-Milestone Index', () => {
        const census = [...new Set(featureCensus().map((entry) => entry.feature))].sort();
        const indexed = unionOf(
            milestoneIndexRows().map((cells) => cells[0] ?? ''),
            expandFeatureTokens,
        );

        expect(indexed).toContain('F01');

        const missing = census.filter((feature) => !indexed.includes(feature));
        expect(missing, 'features with a roadmap heading but no milestone-index row').toEqual([]);
    });
});

describe('every section a row names is reachable', () => {
    it('matches the §4 space of the matrix and the overview index in both directions', () => {
        const inMatrix = unionOf(
            matrixRows().map((cells) => cells[0] ?? ''),
            expandSectionTokens,
        );
        const inOverview = unionOf(overviewSectionCells(), expandSectionTokens);

        // Anti-vacuity: the ranges expanded on the overview side too.
        expect(inOverview).toContain('4.34');
        expect(inMatrix.length).toBeGreaterThan(30);

        expect(
            inMatrix.filter((token) => !inOverview.includes(token)),
            'matrix rows naming a §4 section the overview does not index',
        ).toEqual([]);
        expect(
            inOverview.filter((token) => !inMatrix.includes(token)),
            'sections the overview indexes with no matrix row',
        ).toEqual([]);
    });

    it('names no top-level section the overview never writes', () => {
        // The two rows this replaced resolved only inside
        // docs/coding-standards-sections/, a different numbering space — so a
        // feature whose acceptance criterion cited one could never discharge it.
        // Those two were absent from the overview outright, which is all this
        // catches; a mention of any kind satisfies it.
        const overview = read(OVERVIEW_DOC);
        const claimed = unionOf(
            matrixRows().map((cells) => cells[0] ?? ''),
            topLevelSectionTokens,
        );

        expect(claimed).toContain('3');

        const unreachable = claimed.filter((token) => !overviewMentionsSection(overview, token));
        expect(unreachable, 'matrix rows naming a section the overview never writes').toEqual([]);
    });
});

// ─── index ↔ files ────────────────────────────────────────────────────────────

/** `| [core-components/x.md](core-components/x.md) | §4.1 | … |` → the link target. */
const INDEX_ROW_LINK = /^\|\s*\[[^\]]+\]\(([^)]+)\)/;

/**
 * An index row whose Architecture Section cell is exactly `§6`.
 *
 * The cell is matched whole, between its pipes: `§4.6` and `§6.1` both contain
 * the substring `§6` and neither is this section.
 */
function indexRowClaimsSection6(line: string): boolean {
    return INDEX_ROW_LINK.test(line) && /\|\s*§6\s*\|/.test(line);
}

/** Every file linked from an `## Index:` row, as a repo-relative path. */
function indexedDocPaths(markdown: string): string[] {
    return markdown
        .split('\n')
        .map((line) => INDEX_ROW_LINK.exec(line)?.[1])
        .filter((link): link is string => link !== undefined)
        .map((link) => `docs/${link}`);
}

describe('the overview index and the files it links', () => {
    it('reads a link target out of an index row and ignores everything else', () => {
        // Pinned against synthetic input rather than the tree, so the extractor
        // keeps saying what it says as rows are added.
        expect(
            indexedDocPaths(
                [
                    '| File | Architecture Section | Contents |',
                    '| ---- | -------------------- | -------- |',
                    '| [core-components/a.md](core-components/a.md) | §4.1 | thing |',
                    '| §6 Client prediction | `ClientPredictor` | [F17](m3.md) |',
                    'prose mentioning [a link](elsewhere.md)',
                ].join('\n'),
            ),
        ).toEqual(['docs/core-components/a.md']);
    });

    it('links a file that exists from every index row', () => {
        // The hole this closes: nothing else here opens an indexed file, so a
        // section deleted from disk leaves its index row pointing at nothing and
        // every other assertion still passes.
        const paths = indexedDocPaths(read(OVERVIEW_DOC));
        expect(paths.length).toBeGreaterThan(30);
        expect(paths.filter((p) => !existsSync(path.join(ROOT, p)))).toEqual([]);
    });

    it('selects an index row by its whole section cell, not by a substring', () => {
        // Pinned separately from the tree, where exactly one row satisfies both
        // the exact and the sloppy form so a coarsened predicate would stay
        // green. `§6.1` and `§4.6` both contain the substring `§6`.
        const rows = [
            '| [a.md](a.md) | §4.6 | a section that merely contains 6 |',
            '| [b.md](b.md) | §6.1 | a subsection of 6 |',
            '| [c.md](c.md) | §6 | the section itself |',
            '| [d.md](d.md) | §4.5, §7 | a multi-section cell |',
        ];
        expect(rows.filter(indexRowClaimsSection6).map((r) => INDEX_ROW_LINK.exec(r)?.[1])).toEqual(
            ['c.md'],
        );
    });

    it('selects only rows that are index rows, not every table row with a §6 cell', () => {
        // The predicate's other conjunct. The matrix's OWN rows put the section
        // in the first cell and carry their links later, so a `| §6 |` cell is
        // not by itself evidence of an index row — and the fixture above cannot
        // see the difference, because every row in it is index-shaped.
        const rows = [
            '| §6 | `ClientPredictor`, `ReconcileBuffer` | [F17](m3.md), [F49](m8.md) |',
            '| §6 | plain prose with no link at all |',
            '| [c.md](c.md) | §6 | the section itself |',
        ];
        expect(rows.filter(indexRowClaimsSection6)).toEqual([
            '| [c.md](c.md) | §6 | the section itself |',
        ]);
    });

    it('gives §6 a document that declares itself §6', () => {
        // The matrix's §6 row once named a section no document defined, which
        // read as a resolved anchor and was not. A mention test cannot tell the
        // difference, so this row is checked against the owning doc's banner.
        const row = read(OVERVIEW_DOC).split('\n').find(indexRowClaimsSection6);
        expect(row, 'no overview index row carries §6').toBeDefined();

        const link = INDEX_ROW_LINK.exec(row ?? '')?.[1];
        expect(read(`docs/${link ?? ''}`)).toContain('> §6 of the Chimera architecture.');
    });
});
