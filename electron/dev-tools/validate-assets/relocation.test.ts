/**
 * electron/dev-tools/validate-assets/relocation.test.ts
 *
 * Anti-rot guard for the relocation of the asset-reference validator (the
 * Invariant #22/#52 build-time gate) out of repo-root `tools/` and into
 * `electron/dev-tools/validate-assets/`, following the dev-harness and
 * fetch-google-fonts precedent (§4.32). Locks the reference surfaces that
 * would otherwise silently drift back to the old path:
 *
 *   - the root `validate:assets` script must run the tool at its new home
 *     (the script NAME is unchanged, so CI and the invariant roll-call are
 *     untouched — only the path it runs moves);
 *   - neither the root manifest, the module-boundaries file tree, the
 *     Invariant #22 rule text, nor the tool's own source may still name the
 *     retired `tools/validate-assets` location. The new path contains
 *     `dev-tools/validate-assets`, so the stale-reference scan matches the old
 *     path only when it is NOT the `dev-` prefixed one.
 *
 * Prose is WALKED, not listed: every `.md` under `docs/` and `electron/
 * dev-tools/` is scanned, with the shipped-milestone roadmap sections as the
 * stated exception (append-only records, correct about the path the tool had
 * then). The migration that was deferred while the tool moved has landed, so
 * the exception it was held under is gone — and a walk, unlike the allowlist
 * that would have replaced it, also covers the next doc to name the gate.
 *
 * `CHANGELOG.md` sits outside both trees and is therefore never reached; it is
 * the same kind of record and would be excluded anyway.
 *
 * Relocation also makes electron's `typescript` dependency load-bearing rather
 * than incidental: the package's build config emits every non-test `.ts` under
 * it and `files: ["dist"]` publishes the result, so the tool's runtime VALUE
 * import of `typescript` now ships inside `@chimera-engine/electron` and must
 * be a declared dependency or `verify:publish`'s depcheck fails.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

const rootManifestPath = resolve(repoRoot, 'package.json');
const moduleBoundariesDocPath = resolve(
    repoRoot,
    'docs/executive-architecture/module-boundaries-file-tree.md',
);
const invariantsDocPath = resolve(
    repoRoot,
    'docs/executive-architecture/architecture-invariants.md',
);

/** Matches the retired repo-root location but never `dev-tools/validate-assets`. */
const stalePathPattern = /(?<!dev-)tools\/validate-assets/u;

/**
 * Append-only records of shipped milestones, matched repo-relative. They
 * describe what was built then, at the path it had then, and are correct as
 * written — so they are the only prose the stale-path scan skips.
 *
 * Single-digit by construction, and deliberately so: `m10-` does not match and
 * never will, so the live section stays SCANNED — and keeps being scanned after
 * M10 ships. If it then names a retired path, this reds on what has become an
 * append-only record: a loud, fixable failure, which is the safe direction for
 * a boundary to drift in.
 */
const HISTORICAL_RECORDS = /^docs\/roadmap-sections\/m[1-9]-/u;

/** Every `.md` file under `directory`, recursively. */
function markdownFilesUnder(directory: string): readonly string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = resolve(directory, entry.name);
        if (entry.isDirectory()) return markdownFilesUnder(entryPath);
        return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
    });
}

/** One nesting level in the annotated file tree is four columns wide. */
const LEVEL_WIDTH = 4;

/**
 * A tree line's connector, its gutter, and the name it introduces. Both
 * connectors are accepted because the last child of any directory is drawn
 * `└──` and the rest `├──`, and which entry is last is not a fact about the
 * repo. The gutter admits only box verticals and spaces, so the connector has
 * to be the line's own — never a `──` sequence inside a trailing comment.
 */
const TREE_LINE = /^(?<gutter>[│ ]*)[├└]── (?<name>\S+)/u;

interface RootManifest {
    scripts?: Record<string, string>;
}

interface ElectronManifest {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

interface TreeEntry {
    /** Line index in the document. */
    readonly index: number;
    /** Column of the connector — the entry's nesting depth, in columns. */
    readonly column: number;
    /** Entry name with any trailing directory slash removed. */
    readonly name: string;
}

/** Every file-tree entry in the doc; prose, blanks and separators yield none. */
function treeEntries(lines: readonly string[]): readonly TreeEntry[] {
    return lines.flatMap((line, index) => {
        const groups = TREE_LINE.exec(line)?.groups;
        if (groups === undefined) return [];
        return [
            {
                index,
                column: (groups['gutter'] ?? '').length,
                name: (groups['name'] ?? '').replace(/\/$/u, ''),
            },
        ];
    });
}

/** The DIRECT children of `parent`. */
function childrenOf(entries: readonly TreeEntry[], parent: TreeEntry): readonly TreeEntry[] {
    const children: TreeEntry[] = [];
    for (const entry of entries) {
        if (entry.index <= parent.index) continue;
        if (entry.column <= parent.column) break; // parent's subtree is over
        if (entry.column === parent.column + LEVEL_WIDTH) children.push(entry);
    }
    return children;
}

describe('validate-assets relocation (Invariant #22/#52 tooling home)', () => {
    it('lives at electron/dev-tools/validate-assets/index.ts', () => {
        expect(existsSync(resolve(__dirname, 'index.ts'))).toBe(true);
    });

    it('is what the root validate:assets script runs, under the unchanged script name', () => {
        const manifest = JSON.parse(readFileSync(rootManifestPath, 'utf8')) as RootManifest;
        // Whole-string, not `toContain`: the claim is that the script RUNS the
        // tool, and a substring match is equally satisfied by a script that
        // merely names the path (`echo electron/dev-tools/...`).
        expect(manifest.scripts?.['validate:assets']).toBe(
            'pnpm build:packages && tsx electron/dev-tools/validate-assets/index.ts',
        );
    });

    it('leaves no stale tools/validate-assets reference in the root manifest', () => {
        expect(readFileSync(rootManifestPath, 'utf8')).not.toMatch(stalePathPattern);
    });

    it('carries no retired-path reference in its own source', () => {
        expect(readFileSync(resolve(__dirname, 'index.ts'), 'utf8')).not.toMatch(stalePathPattern);
    });

    it('is documented under dev-tools/ in the module-boundaries file tree, with no stale reference', () => {
        const doc = readFileSync(moduleBoundariesDocPath, 'utf8');
        const lines = doc.split('\n');

        // The doc's file trees list BARE names, never full paths, so the
        // stale-path scan below can never fire here on its own — a positive
        // anchor has to carry the claim. And the bare name alone is not
        // enough either: re-homing the entry under the repo-root `tools/`
        // tree, duplicating it there, or nesting it under a sibling would all
        // satisfy a doc-wide name match while the documented home is wrong.
        // So walk down to it: electron/ → its dev-tools/ child → its children.
        // Each step is asserted separately, so a failure names which anchor
        // moved rather than reporting one undifferentiated absence.
        const entries = treeEntries(lines);

        const electron = entries.find((entry) => entry.column === 0 && entry.name === 'electron');
        expect(electron, 'the file tree has no top-level electron/ entry').toBeDefined();

        const devTools = childrenOf(entries, electron!).find((entry) => entry.name === 'dev-tools');
        expect(devTools, 'electron/ has no dev-tools/ child entry').toBeDefined();

        expect(childrenOf(entries, devTools!).map((entry) => entry.name)).toContain(
            'validate-assets',
        );

        // Exactly one home doc-wide: a second TREE ENTRY anywhere else is the
        // duplicate-home rot that block membership alone would allow. Counted
        // over parsed ENTRIES, so prose naming the gate is not a false failure,
        // while an entry written without its directory slash is still counted.
        // Deliberately doc-wide:
        // the duplicate-home rot lands OUTSIDE electron's subtree (under
        // repo-root `tools/`), so a scoped count would miss it; the cost is
        // that a second, legitimate tree elsewhere in this doc would read as a
        // duplicate home.
        expect(entries.filter((entry) => entry.name === 'validate-assets').length).toBe(1);

        // The retired repo-root `tools/` tree named the file itself, so the
        // old bare file name must be gone everywhere.
        expect(doc).not.toContain('validate-assets.ts');
        expect(doc).not.toMatch(stalePathPattern);
    });

    it('declares typescript as a runtime dependency of the package it now ships inside', () => {
        // The tool imports `createSourceFile`/`forEachChild`/`isCallExpression`
        // as VALUES for its on-demand-load AST scan. Inside repo-root `tools/`
        // that import was never published and resolved via root-devDep
        // hoisting; inside electron it is emitted to `dist/` and published by
        // `files: ["dist"]`, so verify:publish's depcheck reads it as an
        // undeclared runtime dep unless electron declares it itself.
        const manifest = JSON.parse(
            readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
        ) as ElectronManifest;
        expect(manifest.dependencies?.['typescript']).toBeDefined();
        expect(manifest.devDependencies?.['typescript']).toBeUndefined();
    });

    it('exempts only SHIPPED milestone records, never the live one', () => {
        // The boundary is load-bearing and invisible from the walk itself:
        // widening it to the whole directory would silently exempt the M10
        // section, which this feature edits and which carried two claims the
        // relocation falsified.
        expect(
            HISTORICAL_RECORDS.test('docs/roadmap-sections/m7-3d-render-integration-v0.7.0.md'),
        ).toBe(true);
        expect(
            HISTORICAL_RECORDS.test('docs/roadmap-sections/m10-first-public-release-v1.0.0.md'),
        ).toBe(false);
    });

    it('leaves no stale reference on any LIVE prose surface', () => {
        // Walked, not listed. The exception these surfaces were held under
        // while the tool moved has expired, and an allowlist would only ever
        // cover the files this migration happened to touch — the next doc to
        // name the gate would be free to name it at the retired path.
        const prose = [
            ...markdownFilesUnder(resolve(repoRoot, 'docs')),
            ...markdownFilesUnder(resolve(repoRoot, 'electron/dev-tools')),
        ].filter((filePath) => !HISTORICAL_RECORDS.test(relative(repoRoot, filePath)));

        // Floor: a walk that found nothing would satisfy every assertion below.
        expect(prose.length).toBeGreaterThan(50);

        for (const filePath of prose) {
            const label = relative(repoRoot, filePath);
            const doc = readFileSync(filePath, 'utf8');
            expect(doc, label).not.toMatch(stalePathPattern);
            // The suite files moved too, and their old bare name is the shape a
            // roll-call evidence column reaches for.
            expect(doc, label).not.toContain('validate-assets.test.ts');
        }
    });

    it('is named at its new path by the Invariant #22 rule text', () => {
        const doc = readFileSync(invariantsDocPath, 'utf8');
        const invariant22 = doc.split('\n').find((line) => line.startsWith('**22.**'));
        expect(invariant22).toBeDefined();
        // The invariant names the gate by path; a stale path there points a
        // reader at a file that no longer exists.
        expect(invariant22).toContain('electron/dev-tools/validate-assets/index.ts');
        expect(doc).not.toMatch(stalePathPattern);
    });
});
