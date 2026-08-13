/**
 * tools/orphaned-section-12-references.test.ts
 *
 * Guard against an architecture-space `§12` citation.
 *
 * There is no architecture-space §12. `docs/architecture-overview.md` writes the
 * token nowhere, carries no `## 12.` heading, and lists no §12 row in any of its
 * four index tables, so a citation naming one resolves to nothing.
 *
 * What makes that worse than a dead link is that it is not dead — it lands.
 * `§12` resolves in ONE live space, the coding standards
 * (`docs/coding-standards-sections/testing.md`, `# §12 Testing`), so an agent
 * following an architecture-space citation reads TDD and toolchain prose. The
 * two numbering spaces collide on this number, and only the reading context
 * distinguishes them.
 *
 * The citation was reaching new issues, not only old ones: the templates under
 * `.claude/skills/github/assets/` carried it into every feature and task issue
 * authored from them.
 *
 * ## What this bans, and what it deliberately spares
 *
 * Banned: `§12` NOT followed by a `.<digit>` — the top-level architecture
 * section. Spared: `§12.<digit>`, which names a coding-standards SUBsection and
 * is correct wherever it appears; and the lines that DEFINE the coding-standards
 * §12, which necessarily write the bare token.
 *
 * A citation is equally wrong in `.claude/`, in a doc and in a source comment,
 * so `SANCTIONED` excuses exact file+line pairs: a whole-file excuse would make
 * the one file most likely to attract a §12 citation the one place it could
 * never be caught. The single path-keyed exclusion is `SELF`, bounded below by
 * a test asserting the walk drops exactly that one file and no other.
 *
 * The scan covers every tracked file rather than a source-extension subset. The
 * templates that emitted the citation are markdown under `.claude/`, which no
 * extension-keyed census would have read.
 *
 * ## Its ceiling, stated so the assertions are read for what they are
 *
 * Three of the sites repaired alongside this guard are invisible to it. They
 * wrote the SUBsection form — `§12.1`, `§12.2`, `§12.3` — under a heading
 * directing the reader at `docs/architecture-overview.md`. The token shape was
 * legal; what was wrong was the space it was read in, and no regex can see that.
 * A citation is only mechanically checkable here when its shape belongs to one
 * space, which is true of the bare form and false of `§12.x`. Re-introducing a
 * milestone-checklist pointer in the `§12.<digit>` form would pass this guard.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The one file dropped from the walk by path: this guard names the token it bans
 * in its own header. A stale value here reds the guard on that prose rather than
 * widening it silently, and `drops exactly one file from the walk` bounds it to
 * this path alone.
 */
const SELF = 'tools/orphaned-section-12-references.test.ts';

/**
 * The section marker, kept apart from the digits so every fixture below reads
 * `${SECTION}12` in source and is not itself a match.
 */
const SECTION = `§`;

/**
 * A bare architecture-space §12: the section marker, an optional space, `12`,
 * and NOT a `.` or another digit — `§12.3` and `§120` are other tokens.
 */
const ORPHANED_SECTION_12 = new RegExp(`${SECTION} ?12(?![.0-9])`);

/**
 * The lines that define the surviving coding-standards §12 and so must write the
 * bare token. Exact `path:line` pairs: a whole-file allowance would let a new
 * citation in beside a definition.
 */
const SANCTIONED: ReadonlySet<string> = new Set([
    'docs/coding-standards-sections/testing.md:2',
    'docs/coding-standards-sections/testing.md:7',
    'docs/coding-standards.md:46',
]);

function citesOrphanedSection12(line: string): boolean {
    return ORPHANED_SECTION_12.test(line);
}

function trackedFiles(): string[] {
    const out = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' });
    return out.split('\n').filter((file) => file.length > 0 && file !== SELF);
}

/**
 * Every unsanctioned citation in ONE file, as `path:line: text`.
 *
 * Split out from the tree walk so the allowance can be driven with synthetic
 * contents: the difference between sanctioning a LINE and sanctioning its FILE
 * is invisible against the real tree, where the sanctioned files happen to carry
 * nothing else.
 */
function orphanedCitationsIn(file: string, contents: string): string[] {
    const hits: string[] = [];
    contents.split('\n').forEach((line, index) => {
        const location = `${file}:${index + 1}`;
        if (citesOrphanedSection12(line) && !SANCTIONED.has(location)) {
            hits.push(`${location}: ${line.trim()}`);
        }
    });
    return hits;
}

/** Every unsanctioned citation in the tree. */
function findOrphanedCitations(): string[] {
    return trackedFiles().flatMap((file) => {
        let contents: string;
        try {
            contents = readFileSync(resolve(repoRoot, file), 'utf8');
        } catch {
            return []; // a blob that cannot be read as text cannot carry a citation
        }
        return orphanedCitationsIn(file, contents);
    });
}

/** A synthetic stand-in for the head of the sanctioned coding-standards file. */
const SANCTIONED_FILE_HEAD = [
    '---',
    `title: 'Chimera Coding Standards — ${SECTION}12 Testing'`,
    "description: 'TDD cycle, toolchain, file conventions.'",
    'tags: [testing, tdd]',
    '---',
    '',
    `# ${SECTION}12 Testing`,
].join('\n');

describe('orphaned architecture-space §12 citations — the predicate', () => {
    it('matches every shape the emission sites wrote', () => {
        // The shapes the citation was written in: a finished criterion, a
        // placeholder one, a source comment, a parenthetical — plus the spaced
        // form, which no site used but which the pattern admits.
        expect(citesOrphanedSection12(`- [ ] ${SECTION}12 checklist items are green`)).toBe(true);
        expect(
            citesOrphanedSection12(`- [ ] <Relevant ${SECTION}12 checklist item is green>`),
        ).toBe(true);
        expect(citesOrphanedSection12(`// the ${SECTION}12 "Electron boots" check`)).toBe(true);
        expect(citesOrphanedSection12(`real data/ directory (${SECTION}12 M1 checklist)`)).toBe(
            true,
        );
        expect(citesOrphanedSection12(`this ${SECTION} 12 item`)).toBe(true);
    });

    it('spares a coding-standards subsection citation', () => {
        // `§12.3` names `## 12.3 File conventions`, which is live and correct.
        // Without this the ban would be broader than its claim and would sweep
        // five true citations out of the tree.
        expect(citesOrphanedSection12(`Per ${SECTION}12.3 this pattern is`)).toBe(false);
        expect(citesOrphanedSection12(`written \`${SECTION}11.2\` or \`${SECTION}12.3\``)).toBe(
            false,
        );
        expect(citesOrphanedSection12(`${SECTION}12.4 something`)).toBe(false);
    });

    it('spares the coding-standards definition lines by exact path and line', () => {
        // The heading that resolves the token. It writes the bare form, so only
        // an exact `path:line` allowance can spare it without sparing its file.
        expect(citesOrphanedSection12(`# ${SECTION}12 Testing`)).toBe(true);
        expect(SANCTIONED.has('docs/coding-standards-sections/testing.md:7')).toBe(true);
        expect(SANCTIONED.has('docs/coding-standards-sections/testing.md:26')).toBe(false);
    });

    it('does not match a longer number that merely starts with 12', () => {
        expect(citesOrphanedSection12(`${SECTION}120 something`)).toBe(false);
        expect(citesOrphanedSection12(`${SECTION}128`)).toBe(false);
    });

    it('does not match a neighbouring top-level section', () => {
        expect(citesOrphanedSection12(`${SECTION}1 and ${SECTION}2`)).toBe(false);
        expect(citesOrphanedSection12(`${SECTION}13 End-to-End Testing`)).toBe(false);
    });
});

describe('the allowance', () => {
    it('spares the two definition lines of the coding-standards section', () => {
        // Lines 2 and 7 both write the bare token because they DEFINE it. Without
        // the allowance the guard would report the section that resolves it.
        expect(
            orphanedCitationsIn('docs/coding-standards-sections/testing.md', SANCTIONED_FILE_HEAD),
        ).toEqual([]);
    });

    it('still reports a new citation added beside a sanctioned definition', () => {
        // The reason the allowance is keyed on `path:line` and not on the path:
        // a file-wide excuse would make the one file most likely to attract a
        // §12 citation the one place it can never be caught.
        const withANewCitation = [
            SANCTIONED_FILE_HEAD,
            '',
            `- [ ] ${SECTION}12 checklist items for this feature are green`,
        ].join('\n');
        expect(
            orphanedCitationsIn('docs/coding-standards-sections/testing.md', withANewCitation),
        ).toEqual([
            `docs/coding-standards-sections/testing.md:9: - [ ] ${SECTION}12 checklist items for this feature are green`,
        ]);
    });

    it('does not carry a sanctioned line number across to another file', () => {
        // `path:line` is one key, not two independent ones: line 7 of some other
        // doc is not excused by testing.md's line 7 being excused.
        expect(orphanedCitationsIn('docs/some-other-doc.md', SANCTIONED_FILE_HEAD)).toEqual([
            `docs/some-other-doc.md:2: title: 'Chimera Coding Standards — ${SECTION}12 Testing'`,
            `docs/some-other-doc.md:7: # ${SECTION}12 Testing`,
        ]);
    });
});

describe('the tree', () => {
    it('drops exactly one file from the walk — this one', () => {
        // `SELF` is the guard's only path-keyed exclusion, and an exclusion is
        // only as narrow as what it actually removes. Widening it to a directory
        // or a glob would carve a hole no line-keyed assertion could see.
        const everyTrackedFile = execFileSync('git', ['ls-files'], {
            cwd: repoRoot,
            encoding: 'utf8',
        })
            .split('\n')
            .filter((file) => file.length > 0);
        const scanned = new Set(trackedFiles());
        expect(everyTrackedFile.filter((file) => !scanned.has(file))).toEqual([SELF]);
    });

    it('scans every tracked file, not an extension subset', () => {
        // The emission surface was markdown under `.claude/`. A census keyed on
        // source extensions would have read none of it and passed vacuously.
        const files = trackedFiles();
        expect(files.length).toBeGreaterThan(500);
        expect(files).toContain('.claude/skills/github/assets/feature-template.md');
        expect(files).toContain('.claude/skills/github/bootstrap-milestone/SKILL.md');
    });

    it('sanctions only lines that really define the coding-standards section', () => {
        // A sanctioned pair that stopped citing §12 would silently widen the
        // allowance; each must still carry the token it is excused for.
        for (const location of SANCTIONED) {
            const [path, lineNumber] = location.split(':');
            const line = readFileSync(resolve(repoRoot, path ?? ''), 'utf8').split('\n')[
                Number(lineNumber) - 1
            ];
            expect(line, `${location} no longer exists`).toBeDefined();
            expect(citesOrphanedSection12(line ?? ''), `${location} no longer cites it`).toBe(true);
        }
    });

    it('carries no architecture-space §12 citation', () => {
        expect(findOrphanedCitations()).toEqual([]);
    });
});
