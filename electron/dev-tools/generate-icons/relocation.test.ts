/**
 * electron/dev-tools/generate-icons/relocation.test.ts
 *
 * Anti-rot guard for the relocation of the platform icon-set generator out of
 * repo-root `tools/` and into `electron/dev-tools/generate-icons/`, following
 * the dev-harness, fetch-google-fonts and validate-assets precedent (§4.32).
 * Locks the reference surfaces that would otherwise silently drift back to the
 * old path:
 *
 *   - the root `icons:generate` script must RUN the tool at its new home (the
 *     script NAME is unchanged, so every doc and habit that names the script
 *     keeps working — only the path it runs moves);
 *   - neither the root manifest, the tool's own source, the module-boundaries
 *     file tree, nor any live prose surface may still name the retired
 *     `tools/generate-icons` location.
 *
 * The new path CONTAINS the old one as a substring (`dev-tools/generate-icons`),
 * so the stale-reference scan matches the retired path only when it is NOT the
 * `dev-` prefixed one.
 *
 * Prose is enumerated from the git index, not listed by hand, and nothing
 * tracked is exempt — not changesets, not changelogs, not shipped-milestone
 * roadmaps. The sibling relocations excused their
 * append-only records because those genuinely named the path the tool had then;
 * nothing in this repo has ever named the icon generator by path outside the
 * surfaces this branch repoints, so the same carve-out here would be a
 * permanently open hole guarding nothing. If a future append-only record does
 * name the retired path, this reds — the loud, fixable direction.
 *
 * What the move could silently break, beyond the paths above, is where the
 * engine-relative defaults resolve FROM. The tool takes that root from cwd, so
 * the check here is that both defaults exist at the repo root — the cwd
 * `pnpm icons:generate` runs with.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUT_REL, DEFAULT_SOURCE_REL } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** generate-icons → dev-tools → electron → repo root. */
const repoRoot = resolve(__dirname, '..', '..', '..');

const toolPath = resolve(__dirname, 'index.ts');
const rootManifestPath = resolve(repoRoot, 'package.json');
const iconsReadmePath = resolve(repoRoot, 'electron/assets/icons/README.md');
const moduleBoundariesDocPath = resolve(
    repoRoot,
    'docs/executive-architecture/module-boundaries-file-tree.md',
);

/** Matches the retired repo-root location but never `dev-tools/generate-icons`. */
const stalePathPattern = /(?<!dev-)tools\/generate-icons/u;

/**
 * Every `.md` file the repository tracks.
 *
 * Sourced from the index rather than from a directory walk, because "tracked"
 * IS the operational definition of hand-written: it needs no skip-set (build
 * output and vendored trees are ignored already, and a new one needs no edit
 * here), and it cannot red on a file the repo does not contain. That last part
 * is not hypothetical — a code-review report saved anywhere in the tree quotes
 * the retired path dozens of times, and under a filesystem walk that reds a
 * suite CI would pass.
 *
 * The boundary it draws: a `.md` file written but not yet `git add`ed is not
 * scanned. The `git add` itself brings it in — the index, not the commit, is
 * what this reads — so it is covered well before the commit the gate runs on.
 *
 * Rooted at the repo, not at a list of trees: a root list is an allowlist
 * however long it grows, and its omissions are silent. `.changeset/` made that
 * case — a release note naming a retired path is copied verbatim into a
 * published `CHANGELOG.md`, and it sits under none of the trees a per-area list
 * reaches for.
 */
function proseFiles(): readonly string[] {
    const listing = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    return listing
        .split('\0')
        .filter((entry) => entry.length > 0)
        .map((entry) => resolve(repoRoot, entry));
}

/** One nesting level in the annotated file tree is four columns wide. */
const LEVEL_WIDTH = 4;

/**
 * A tree line's connector, its gutter, and the name it introduces. Both
 * connectors are accepted because the last child of any directory is drawn
 * `└──` and the rest `├──`, and which entry is last is not a fact about the
 * repo.
 *
 * The gutter admits ONLY box verticals and spaces, which is what confines the
 * match to actual tree lines: a paragraph or table cell that merely quotes a
 * connector — `The doc shows ├── generate-icons/ under dev-tools/` — has
 * ordinary text to the left of it, so it parses as no entry at all. Widen the
 * gutter and that sentence becomes a phantom entry at a phantom depth, and the
 * duplicate-home count starts reading prose.
 */
const TREE_LINE = /^(?<gutter>[│ ]*)[├└]── (?<name>\S+)/u;

interface RootManifest {
    scripts?: Record<string, string>;
}

interface ElectronManifest {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/** The image codecs the generator needs, and no consumer of the engine does. */
const CODECS = ['sharp', 'png2icons'] as const;

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

/** Walks up from `start` to the directory holding the pnpm workspace marker. */
function locateWorkspaceRoot(start: string): string {
    let current = start;
    for (;;) {
        if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
        const parent = dirname(current);
        if (parent === current) {
            throw new Error(`No pnpm-workspace.yaml above ${start}`);
        }
        current = parent;
    }
}

describe('generate-icons relocation (§4.32 dev-tooling home)', () => {
    it('lives at electron/dev-tools/generate-icons/index.ts', () => {
        expect(existsSync(toolPath)).toBe(true);
    });

    it('is what the root icons:generate script runs, under the unchanged script name', () => {
        const manifest = JSON.parse(readFileSync(rootManifestPath, 'utf8')) as RootManifest;
        // Whole-string, not `toContain`: the claim is that the script RUNS the
        // tool, and a substring match is equally satisfied by a script that
        // merely names the path (`echo electron/dev-tools/...`).
        expect(manifest.scripts?.['icons:generate']).toBe(
            'tsx electron/dev-tools/generate-icons/index.ts',
        );
    });

    it('leaves no stale tools/generate-icons reference in the root manifest', () => {
        expect(readFileSync(rootManifestPath, 'utf8')).not.toMatch(stalePathPattern);
    });

    it('names its own new home, and no retired path, in its own source', () => {
        const source = readFileSync(toolPath, 'utf8');
        expect(source).toContain('electron/dev-tools/generate-icons/index.ts');
        expect(source).not.toMatch(stalePathPattern);
    });

    it('resolves its engine-relative defaults against the repo root, from the repo root', () => {
        // The monorepo entry point is `pnpm icons:generate`, which pnpm runs with
        // cwd = the package that declares the script, i.e. the repo root. Both
        // defaults must land on real paths from there, which is the property the
        // relocation could have broken and the only one that keeps the default
        // run writing the committed set.
        //
        // The tool derives this root from cwd, never from its own module URL —
        // see `runGenerateIconsCli`. A module-relative derivation would be
        // correct here and wrong from `dist/`, where the published bin lives.
        const root = locateWorkspaceRoot(__dirname);
        expect(existsSync(resolve(root, DEFAULT_SOURCE_REL))).toBe(true);
        expect(existsSync(resolve(root, DEFAULT_OUT_REL))).toBe(true);
    });

    it('declares its image codecs as OPTIONAL peers of the package it now ships inside', () => {
        // Relocation is a distribution change, not just a move: electron's
        // build emits every non-test `.ts` under the package and
        // `files: ["dist"]` publishes the result, so the generator's `sharp`
        // and `png2icons` imports now ship inside @chimera-engine/electron —
        // and verify:publish's depcheck reads them as undeclared runtime deps
        // unless the package declares them.
        //
        // Peers, never `dependencies`: `sharp` is a multi-megabyte
        // platform-specific native binary, and a game that never regenerates
        // its icons must not pay for it. `optional` is the load-bearing half —
        // pnpm auto-installs missing peers by default, so a peer declared
        // WITHOUT it would put the native binary in every game install just as
        // surely as a `dependencies` entry would.
        const manifest = JSON.parse(
            readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
        ) as ElectronManifest;

        for (const codec of CODECS) {
            expect(manifest.peerDependencies?.[codec], codec).toBeDefined();
            expect(manifest.peerDependenciesMeta?.[codec]?.optional, codec).toBe(true);
            expect(manifest.dependencies?.[codec], codec).toBeUndefined();
        }
    });

    it('is linked at its new location by the generated icon-set README', () => {
        const readme = readFileSync(iconsReadmePath, 'utf8');
        const link = /\]\((?<target>[^)]*generate-icons[^)]*)\)/u.exec(readme)?.groups?.['target'];
        expect(link, 'the icon-set README links no generate-icons path at all').toBeDefined();
        // Resolved, not string-matched: a link with the wrong number of `../`
        // segments reads correctly and still dangles.
        expect(existsSync(resolve(dirname(iconsReadmePath), link!))).toBe(true);
    });

    it('is documented under dev-tools/ in the module-boundaries file tree, with no stale reference', () => {
        const doc = readFileSync(moduleBoundariesDocPath, 'utf8');
        const entries = treeEntries(doc.split('\n'));

        // The doc's file trees list BARE names, never full paths, so the
        // stale-path scan below can never fire here on its own — a positive
        // anchor has to carry the claim. And the bare name alone is not enough
        // either: re-homing the entry under the repo-root `tools/` tree,
        // duplicating it there, or nesting it under a sibling would all satisfy
        // a doc-wide name match while the documented home is wrong. So walk
        // down to it: electron/ → its dev-tools/ child → its children. Each
        // step is asserted separately, so a failure names which anchor moved
        // rather than reporting one undifferentiated absence.
        const electron = entries.find((entry) => entry.column === 0 && entry.name === 'electron');
        expect(electron, 'the file tree has no top-level electron/ entry').toBeDefined();

        const devTools = childrenOf(entries, electron!).find((entry) => entry.name === 'dev-tools');
        expect(devTools, 'electron/ has no dev-tools/ child entry').toBeDefined();

        expect(childrenOf(entries, devTools!).map((entry) => entry.name)).toContain(
            'generate-icons',
        );

        // Exactly one home doc-wide: a second TREE ENTRY anywhere else is the
        // duplicate-home rot that block membership alone would allow. Counted
        // over parsed ENTRIES, so prose naming the tool is not a false failure,
        // while an entry written without its directory slash is still counted.
        expect(entries.filter((entry) => entry.name === 'generate-icons').length).toBe(1);

        // The retired repo-root `tools/` tree would have named the file itself.
        expect(doc).not.toContain('generate-icons.ts');
        expect(doc).not.toMatch(stalePathPattern);
    });

    it('leaves no stale reference on any tracked prose surface in the repo', () => {
        const prose = proseFiles();

        // Floor: an enumeration that found nothing would satisfy every
        // assertion below.
        expect(prose.length).toBeGreaterThan(150);

        // Named anchors, each one a surface some narrower walk would have
        // dropped. They are not decoration: every one of these was outside a
        // walk this test has already shipped, and the file that motivated the
        // rewrite is the FIRST of them — a changeset is copied verbatim into a
        // published CHANGELOG, so a retired path there escapes the repo.
        for (const anchor of [
            '.changeset/generate-icons-into-dev-tools.md',
            'electron/assets/icons/README.md',
            'electron/CHANGELOG.md',
            'ai/CLAUDE.md',
            'networking/CHANGELOG.md',
            'apps/tactics/CHANGELOG.md',
            'tools/create-chimera-game/README.md',
            'docs/roadmap-sections/m9-package-extraction-v0.9.0.md',
            'README.md',
            'CLAUDE.md',
        ]) {
            expect(prose, anchor).toContain(resolve(repoRoot, anchor));
        }

        for (const filePath of prose) {
            const label = relative(repoRoot, filePath);
            const doc = readFileSync(filePath, 'utf8');
            expect(doc, label).not.toMatch(stalePathPattern);
            // The suite moved too, and its old bare name is the shape a
            // roll-call evidence column reaches for.
            expect(doc, label).not.toContain('generate-icons.test.ts');
        }
    });
});

/**
 * The file-tree walk is what turns "the doc mentions the name somewhere" into
 * "the doc puts it under `electron/dev-tools/`", and the whole strengthened
 * claim rests on `childrenOf` scoping correctly. Against the real document that
 * scoping is invisible: the doc has exactly one `generate-icons` entry, so a
 * `childrenOf` that leaked past its parent's subtree, or that returned
 * grandchildren as children, would return it anyway and the guard would still
 * pass — on a document whose structure had drifted. This fixture is the
 * document that tells those apart.
 */
describe('module-boundaries tree walk', () => {
    /**
     * A same-named entry sits in four places: the right one and three wrong
     * ones. The prose line before the fence quotes a connector the way a real
     * doc paragraph does — it is what separates a gutter-anchored match from
     * one that will accept a connector anywhere on the line.
     */
    const FIXTURE = [
        'The doc shows ├── generate-icons/ under dev-tools/, like so:',
        '',
        '```',
        '├── electron/',
        '│   ├── dev-tools/',
        '│   │   ├── dev-harness/            # sibling',
        '│   │   ├── generate-icons/         # the documented home',
        '│   │   │   └── generate-icons/     # grandchild, NOT a child of dev-tools/',
        '│   │   └── validate-assets/        # sibling',
        '│   └── preload/                    # drawn ├── or └── depending on order',
        '│       └── generate-icons/         # re-homed under a sibling of dev-tools/',
        '│',
        '└── tools/',
        '    └── generate-icons/             # the retired repo-root home',
        '```',
    ];

    /**
     * Resolved inside each test, never at describe scope: a `treeEntries`
     * regression that makes an anchor `undefined` would otherwise throw while
     * the file is being COLLECTED, and vitest reports that as "no tests" —
     * every assertion in this file silently not running, with no `×` naming
     * what broke.
     */
    function anchors(): {
        entries: readonly TreeEntry[];
        electron: TreeEntry;
        devTools: TreeEntry;
    } {
        const entries = treeEntries(FIXTURE);
        const electron = entries.find((entry) => entry.column === 0 && entry.name === 'electron');
        expect(electron, 'the fixture parsed no top-level electron/ entry').toBeDefined();
        const devTools = childrenOf(entries, electron!).find((entry) => entry.name === 'dev-tools');
        expect(devTools, 'the fixture parsed no dev-tools/ child of electron/').toBeDefined();
        return { entries, electron: electron!, devTools: devTools! };
    }

    it('parses one entry per tree line and ignores the fences', () => {
        expect(anchors().entries.map((entry) => entry.name)).toEqual([
            'electron',
            'dev-tools',
            'dev-harness',
            'generate-icons',
            'generate-icons',
            'validate-assets',
            'preload',
            'generate-icons',
            'tools',
            'generate-icons',
        ]);
    });

    it('parses prose that quotes a connector as no entry at all', () => {
        // Floor for the fixture itself: without a connector on line 0 this
        // asserts only that a plain sentence is not a tree entry, which no
        // gutter can get wrong — the whole test would go vacuous on an edit to
        // one string in a data array.
        expect(FIXTURE[0], 'fixture line 0 quotes no connector').toContain('├── ');

        // Kills a gutter widened to accept arbitrary text. The fixture's opening
        // sentence names `generate-icons/` after ordinary words; a permissive
        // gutter turns it into a phantom entry, which inflates the duplicate-home
        // count and can satisfy the documented-home walk from prose alone.
        const { entries } = anchors();
        const fromProse = entries.filter((entry) => entry.index === 0);
        expect(fromProse).toEqual([]);
    });

    it('returns DIRECT children only — never a grandchild', () => {
        // Kills the `+ LEVEL_WIDTH` → `>=` mutant: the grandchild shares the
        // name, so a depth-agnostic filter reports two children where the
        // document declares one.
        const { entries, devTools } = anchors();
        expect(childrenOf(entries, devTools).map((entry) => entry.name)).toEqual([
            'dev-harness',
            'generate-icons',
            'validate-assets',
        ]);
    });

    it('stops at the end of the parent’s subtree', () => {
        // Kills the dropped/weakened `break`: without it the walk runs to the
        // end of the document and picks up `preload/`'s child and the retired
        // repo-root entry as if `dev-tools/` owned them.
        const { entries, electron } = anchors();
        expect(childrenOf(entries, electron).map((entry) => entry.name)).toEqual([
            'dev-tools',
            'preload',
        ]);
    });

    it('counts a same-named entry in every home, so a duplicate is visible', () => {
        expect(anchors().entries.filter((entry) => entry.name === 'generate-icons').length).toBe(4);
    });
});
