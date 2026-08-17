/**
 * tools/module-boundaries-file-tree.test.ts
 *
 * Every row of the Annotated File Tree points at something real.
 *
 * The tree is a module-boundary document: a reader opens it to learn which module owns
 * what. That makes a row naming the wrong directory worse than a missing row — it
 * answers the question, incorrectly, in the same confident voice as the rows that are
 * right. Files move, the tree does not follow, and nothing notices.
 *
 * The other direction is settled by the doc rather than by a check: the tree is a
 * SELECTION, stated as such where it starts, so a file arriving without a row is not a
 * defect. That is the honest reading of a 300-row tree over a repo of thousands, and it
 * is why the only thing pinned here is that what IS drawn resolves.
 *
 * Placeholder rows — `apps/<game>/…` and friends — describe a shape rather than a path,
 * so they are exempt. Which rows those are is read from the markers the doc names, so
 * the exemption cannot quietly widen to cover a genuinely stale row.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTreeRow } from './__test-support__/annotated-file-tree.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const DOC = 'docs/executive-architecture/module-boundaries-file-tree.md';
/** The line that opens the tree, which is also its root. */
const TREE_ROOT = 'chimera/';

/**
 * What marks a row as describing a shape rather than a path.
 *
 * `<name>` stands in for a value the reader supplies; `…` elides rows deliberately.
 * The doc has to say so — see the case below — because a reader meeting `apps/<game>/`
 * needs to know it is a form, and because this list is what the resolution check
 * exempts.
 */
const PLACEHOLDER_MARKERS = ['<', '…'];

/**
 * The section's own prose: what sits between its heading and the tree it introduces.
 *
 * Scoped rather than searched file-wide, because the annotations inside the tree use
 * the same everyday words the statements below are looking for — "selection markers"
 * on an R3F row, "Future placeholder" on the Steam provider. A file-wide search finds
 * those and reports a convention nobody wrote down.
 */
async function sectionPreamble(): Promise<string> {
    const lines = (await readFile(path.join(repoRoot, DOC), 'utf8')).split('\n');
    const headingAt = lines.findIndex((line) => line.startsWith('## Annotated File Tree'));
    if (headingAt === -1) return '';
    const fenceAt = lines.findIndex((line, i) => i > headingAt && line.trim() === '```');
    return lines.slice(headingAt + 1, fenceAt === -1 ? undefined : fenceAt).join('\n');
}

/** Full paths of every row in the tree, in document order. */
async function treePaths(): Promise<string[]> {
    const lines = (await readFile(path.join(repoRoot, DOC), 'utf8')).split('\n');
    const openedAt = lines.findIndex(
        (line, i) => line.trim() === '```' && lines[i + 1]?.trim() === TREE_ROOT,
    );
    if (openedAt === -1) return [];
    const closedAt = lines.findIndex((line, i) => i > openedAt && line.trim() === '```');
    if (closedAt === -1) return [];

    const paths: string[] = [];
    const openPath: string[] = [];
    for (const line of lines.slice(openedAt + 2, closedAt)) {
        const row = parseTreeRow(line);
        if (row === undefined) continue;
        const parent = row.depth === 0 ? '' : (openPath[row.depth - 1] ?? '');
        const full = parent === '' ? row.name : `${parent}/${row.name}`;
        paths.push(full);
        openPath[row.depth] = full;
        openPath.length = row.depth + 1;
    }
    return paths;
}

/**
 * Every tracked path, plus every directory on the way to one.
 *
 * Tracked rather than `existsSync`, so the answer is the same in a fresh clone as on a
 * machine that has built: `dist/` and `node_modules/` exist for one and not the other,
 * and a guard that changes its mind between them is a guard nobody trusts.
 */
function trackedPaths(): Set<string> {
    const resolved = new Set<string>();
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
    for (const file of tracked) {
        resolved.add(file);
        const segments = file.split('/');
        for (let i = 1; i < segments.length; i += 1) {
            resolved.add(segments.slice(0, i).join('/'));
        }
    }
    return resolved;
}

const isPlaceholder = (candidate: string): boolean =>
    PLACEHOLDER_MARKERS.some((marker) => candidate.includes(marker));

describe('the Annotated File Tree', () => {
    it('draws no path that is not there', async () => {
        const paths = await treePaths();
        // Floor: a parse that stops matching resolves nothing and would pass silently.
        expect(paths.length).toBeGreaterThan(100);

        const resolved = trackedPaths();
        const concrete = paths.filter((candidate) => !isPlaceholder(candidate));
        // Floor: if the exemption ever swallowed the tree, the case above it would too.
        expect(concrete.length).toBeGreaterThan(100);

        expect(concrete.filter((candidate) => !resolved.has(candidate))).toEqual([]);
    });

    it('reads its preamble as the prose before the tree, not as the whole file', async () => {
        const preamble = await sectionPreamble();

        // The two cases below are only real while this holds. Widened to the file, both
        // pass on today's tree by accident — an R3F row says "selection markers" and the
        // Steam row says "Future placeholder" — so a deleted statement would go unnoticed
        // and this guard would report a convention nobody wrote down.
        expect(preamble.length).toBeGreaterThan(0);
        expect(preamble).not.toMatch(/[├└]── /u);
    });

    it('says up front that it is a selection, so a file without a row is not a defect', async () => {
        // The claim the tree would otherwise make by drawing directories at all. Without
        // it, every file added anywhere is silently missing from a document that reads
        // like an inventory — the direction nobody notices.
        expect(await sectionPreamble()).toContain('selection');
    });

    it('names the markers that exempt a row, so the exemption is the doc’s rule', async () => {
        const preamble = await sectionPreamble();
        const paths = await treePaths();

        // Both markers are in use, so both have to be explained…
        for (const marker of PLACEHOLDER_MARKERS) {
            expect(paths.some((candidate) => candidate.includes(marker))).toBe(true);
            expect(preamble).toContain(marker);
        }
        // …and the exemption has to be a stated convention rather than a habit this
        // file inferred, or it is the guard deciding which rows it need not check.
        expect(preamble).toContain('placeholder');
    });
});
