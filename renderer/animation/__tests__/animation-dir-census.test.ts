/**
 * renderer/animation/__tests__/animation-dir-census.test.ts
 *
 * The directory census: every module under `renderer/animation/` reaches nothing
 * under `renderer/bridge/`, and none of them is a copy of `useSendAction`.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **Why this is a census and not a lint zone.** The obvious enforcement — a
 * `renderer/animation/**` `no-restricted-imports` block in `eslint.config.mjs` —
 * costs more than it looks. `tools/eslint-deep-relative-import-ban.test.ts`
 * `toEqual`s the set of blocks that declare the rule WITHOUT the deep-relative
 * group at exactly two rows, 'and no others'; the `renderer/**` block declares no
 * such group. So a new renderer-subtree zone either reds that closed set or has
 * to copy the deep-relative group and its verbatim message into a third place.
 *
 * **Why it enumerates.** The membership list is produced by `readdirSync`, not
 * written down, so every module the later F82 tasks add is covered the day it
 * lands rather than the day someone remembers to add a row. That is also why the
 * membership assertion below is a FLOOR and not a closed set: growth is the point.
 *
 * **Two channels.** A binding the module USES pulls the target in as a resolved
 * INPUT. A binding it imports and
 * never uses is elided by esbuild's TypeScript loader before the target is ever
 * resolved, so it reaches no input — but the import record survives on the
 * importer, marked external, carrying the specifier as written. `analyze()`
 * therefore resolves every relative external against its importer and hands the
 * verdict both. A used binding, a bare side-effect import and an unused binding
 * each have a control below.
 *
 * **What it does NOT say.** It speaks only about the reach into
 * `renderer/bridge/`. The framework-purity claim below is a separate,
 * deliberately FIXED list of the three modules this directory starts with — a
 * later module that ships a React hook is expected to import `react`, and folding
 * that claim into the enumerated set would make the census a tripwire for its own
 * successors.
 *
 * Mechanism mirrors `renderer/input/__tests__/input-barrel-side-effects.test.ts`:
 * esbuild bundles each module and the test asserts over the resolved inputs and
 * the externalized specifiers.
 */

import { describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { readdirSync } from 'node:fs';
import { basename, dirname, extname, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANIMATION_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** Modules this issue creates. The floor that stops the census passing vacuously. */
const CANARIES = ['ClipBackend.ts', 'ClipPosition.ts', 'ClipTimeline.ts'] as const;

/**
 * Modules the framework-purity claim covers. Spelled out again rather than
 * aliased to {@link CANARIES}: the two lists mean opposite things — the canaries
 * are a FLOOR meant to grow with the directory, this list is a CEILING meant not
 * to — and aliasing would let one edit move both.
 */
const PURE_MODULES = ['ClipBackend.ts', 'ClipPosition.ts', 'ClipTimeline.ts'] as const;

/** In-repo subtrees no module under `renderer/animation/` may reach. */
const FORBIDDEN_SUBTREE = 'renderer/bridge/';

/** The one subtree the founding modules' whole in-repo graph stays inside. */
const ANIMATION_SUBTREE = 'renderer/animation/';

// ─── enumeration ────────────────────────────────────────────────────────────────

/** Directories holding tests and doubles, which the census does not enumerate. */
function isExcludedDir(name: string): boolean {
    return name === '__tests__' || name === '__test-support__';
}

/** True for a shippable module: a `.ts`/`.tsx` that is neither a test nor a declaration file. */
function isCensusSource(name: string): boolean {
    if (name.endsWith('.d.ts')) {
        return false;
    }
    if (/\.test\.tsx?$/u.test(name)) {
        return false;
    }
    return name.endsWith('.ts') || name.endsWith('.tsx');
}

/** One directory entry, as much of `Dirent` as the walker reads. */
interface DirEntry {
    readonly name: string;
    readonly directory: boolean;
}

/** Reads one directory. Injected so the walker can be pinned without a tree on disk. */
type ReadDir = (dir: string) => readonly DirEntry[];

const readDirFromDisk: ReadDir = (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        directory: entry.isDirectory(),
    }));

/**
 * Every census module under `dir`, as paths relative to `dir`, sorted.
 *
 * Recursive by hand rather than through `readdirSync`'s `recursive` option so the
 * excluded directories are never descended into at all. `readDir` is a parameter
 * because the real tree holds no double under `__test-support__/` today, so the
 * exclusion it exercises would be untrippable — and therefore unpinnable —
 * against the directory as it actually is.
 *
 * `dir` is opaque to the walker: it is only ever concatenated and handed straight
 * back to `readDir`, never interpreted, which is what lets the same function take
 * a native absolute path and a synthetic key.
 */
function enumerateCensusModules(
    dir: string,
    readDir: ReadDir = readDirFromDisk,
): readonly string[] {
    const found: string[] = [];
    for (const entry of readDir(dir)) {
        if (entry.directory) {
            if (isExcludedDir(entry.name)) {
                continue;
            }
            for (const nested of enumerateCensusModules(posix.join(dir, entry.name), readDir)) {
                found.push(posix.join(entry.name, nested));
            }
            continue;
        }
        if (isCensusSource(entry.name)) {
            found.push(entry.name);
        }
    }
    return found.sort();
}

// ─── the predicates the assertions are named for ────────────────────────────────

/**
 * The inputs the census forbids: anything under `renderer/bridge/`, plus any
 * module whose basename is `useSendAction` wherever it sits.
 *
 * Two axes, because they fail differently: the subtree catches reaching the real
 * dispatch hook, the basename catches a copy of it planted outside that subtree.
 */
function censusViolations(inputs: readonly string[]): readonly string[] {
    return inputs.filter(
        (input) =>
            input.startsWith(FORBIDDEN_SUBTREE) ||
            basename(input, extname(input)) === 'useSendAction',
    );
}

/** The paths that do NOT sit under `dirPrefix`. */
function pathsOutside(paths: readonly string[], dirPrefix: string): readonly string[] {
    return paths.filter((path) => !path.startsWith(dirPrefix));
}

/**
 * `specifier`, as written on the module at `importerPath`, resolved to a
 * repo-relative path — or `null` when it is not relative and so names a package
 * rather than a file in this repo.
 */
function resolveRelativeSpecifier(importerPath: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) {
        return null;
    }
    return posix.normalize(posix.join(posix.dirname(importerPath), specifier));
}

// ─── the analyzer ───────────────────────────────────────────────────────────────

/** Marks every bare specifier external so the bundle holds only in-repo source. */
const externalizeBareImports: Plugin = {
    name: 'externalize-bare-imports',
    setup(b) {
        // esbuild filters are Go RE2 regexes — the JS `u` flag is rejected.
        b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
        b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, external: true }));
    },
};

interface Analysis {
    /** Files that entered the bundle — every USED import resolves into one. */
    readonly inputs: readonly string[];
    /** Specifiers esbuild recorded without resolving them into the bundle. */
    readonly externals: readonly string[];
    /**
     * Every in-repo path the entry reaches on either channel: the inputs, plus
     * each relative external resolved against the module that wrote it. This is
     * what the boundary verdict is taken over.
     */
    readonly reached: readonly string[];
}

async function analyze(
    entry: { readonly entryPoint: string } | { readonly source: string },
): Promise<Analysis> {
    const result = await build({
        ...('entryPoint' in entry
            ? { entryPoints: [entry.entryPoint] }
            : {
                  stdin: {
                      contents: entry.source,
                      resolveDir: ANIMATION_DIR,
                      sourcefile: 'census-control.ts',
                      loader: 'ts' as const,
                  },
              }),
        bundle: true,
        treeShaking: true,
        write: false,
        metafile: true,
        format: 'esm',
        platform: 'browser',
        jsx: 'automatic',
        logLevel: 'silent',
        // Pins what the metafile's input paths are relative TO. Without it they
        // follow the CWD vitest happened to run from — the repo root for a
        // single-file run, the renderer package dir under `pnpm -r test` — and
        // the `renderer/bridge/` prefix would silently stop matching in one of them.
        absWorkingDir: REPO_ROOT,
        plugins: [externalizeBareImports],
    });
    // esbuild reports POSIX-separated paths; normalize anyway so the prefixes
    // above are the only spelling this file has to reason about.
    const normalize = (path: string): string => path.split(sep).join('/');

    const inputs = Object.keys(result.metafile.inputs).map(normalize);
    const externals = new Set<string>();
    const reached = new Set(inputs);
    for (const [importerPath, input] of Object.entries(result.metafile.inputs)) {
        for (const imported of input.imports) {
            if (!imported.external) {
                continue;
            }
            externals.add(imported.path);
            const resolved = resolveRelativeSpecifier(normalize(importerPath), imported.path);
            if (resolved !== null) {
                reached.add(resolved);
            }
        }
    }

    return { inputs, externals: [...externals], reached: [...reached] };
}

// ─── the census ─────────────────────────────────────────────────────────────────

describe('renderer/animation directory census', () => {
    describe('the enumeration predicates', () => {
        // Pinned against synthetic names rather than the tree's current contents,
        // so what the filters mean is not defined by what happens to be on disk
        // today. Both ends of every anchor: a name that only STARTS like a
        // match and one that only ENDS like one.
        it('excludes the test and double directories, and nothing else', () => {
            expect(isExcludedDir('__tests__')).toBe(true);
            expect(isExcludedDir('__test-support__')).toBe(true);
            expect(isExcludedDir('backends')).toBe(false);
            expect(isExcludedDir('__tests__extra')).toBe(false);
            expect(isExcludedDir('my__tests__')).toBe(false);
        });

        it('keeps shippable modules and drops tests, declarations and non-modules', () => {
            expect(isCensusSource('ClipPosition.ts')).toBe(true);
            expect(isCensusSource('ClipPlayer.tsx')).toBe(true);
            expect(isCensusSource('ClipPosition.test.ts')).toBe(false);
            expect(isCensusSource('useClipPlayer.test.tsx')).toBe(false);
            expect(isCensusSource('animation.d.ts')).toBe(false);
            expect(isCensusSource('notes.md')).toBe(false);
            expect(isCensusSource('ts')).toBe(false);
            // A file merely CONTAINING `.test.` mid-name is still a module.
            expect(isCensusSource('ClipPosition.testing.ts')).toBe(true);
        });

        it('descends ordinary subdirectories and never enters the excluded ones', () => {
            // Against a synthetic tree, because the real directory holds no
            // double under `__test-support__/` — so on disk the name filter
            // already drops everything the directory exclusion would, and
            // deleting the exclusion changes nothing observable. Both files
            // planted below are ordinary module names: only the exclusion can
            // drop them.
            const tree: Readonly<Record<string, readonly DirEntry[]>> = {
                '/root': [
                    { name: 'ClipPosition.ts', directory: false },
                    { name: 'ClipPosition.test.ts', directory: false },
                    { name: 'backends', directory: true },
                    { name: '__tests__', directory: true },
                    { name: '__test-support__', directory: true },
                ],
                '/root/backends': [{ name: 'MeshClipBackend.ts', directory: false }],
                '/root/__tests__': [{ name: 'analysis.ts', directory: false }],
                '/root/__test-support__': [{ name: 'FakeClipBackend.ts', directory: false }],
            };

            expect(enumerateCensusModules('/root', (dir) => tree[dir] ?? [])).toEqual([
                'ClipPosition.ts',
                'backends/MeshClipBackend.ts',
            ]);
        });
    });

    describe('the violation predicate', () => {
        it('catches the forbidden subtree at its start and its end, and nothing adjacent', () => {
            expect(
                censusViolations([
                    'renderer/bridge/useLeaveGame.ts',
                    'renderer/bridgehead/thing.ts',
                    'apps/x/renderer/bridge/thing.ts',
                    'renderer/animation/ClipTimeline.ts',
                ]),
            ).toEqual(['renderer/bridge/useLeaveGame.ts']);
        });

        it('catches a same-named module wherever it sits, and no name that merely contains it', () => {
            expect(
                censusViolations([
                    'renderer/animation/useSendAction.ts',
                    'renderer/animation/useSendAction.tsx',
                    'renderer/animation/useSendActionShim.ts',
                    'renderer/animation/notUseSendAction.ts',
                ]),
            ).toEqual([
                'renderer/animation/useSendAction.ts',
                'renderer/animation/useSendAction.tsx',
            ]);
        });

        it('reports nothing for a clean input list', () => {
            expect(censusViolations(['renderer/animation/ClipPosition.ts'])).toEqual([]);
        });
    });

    describe('pathsOutside', () => {
        it('keeps a prefix match at the path start only, with the separator required', () => {
            expect(
                pathsOutside(
                    [
                        'renderer/animation/ClipTimeline.ts',
                        'renderer/animations/x.ts',
                        'apps/x/renderer/animation/y.ts',
                        'renderer/state/store.ts',
                    ],
                    ANIMATION_SUBTREE,
                ),
            ).toEqual([
                'renderer/animations/x.ts',
                'apps/x/renderer/animation/y.ts',
                'renderer/state/store.ts',
            ]);
        });
    });

    describe('resolveRelativeSpecifier', () => {
        // The second channel's whole correctness sits in this function: an
        // external specifier is recorded as WRITTEN, relative to its importer, so
        // getting the base wrong would silently point every verdict at the wrong
        // subtree.
        it('resolves a specifier against the directory of the module that wrote it', () => {
            expect(
                resolveRelativeSpecifier(
                    'renderer/animation/ClipPosition.ts',
                    '../bridge/useSendAction.js',
                ),
            ).toBe('renderer/bridge/useSendAction.js');
            expect(
                resolveRelativeSpecifier(
                    'renderer/animation/backends/Mesh.ts',
                    '../../bridge/useSendAction.js',
                ),
            ).toBe('renderer/bridge/useSendAction.js');
            expect(
                resolveRelativeSpecifier('renderer/animation/ClipTimeline.ts', './ClipPosition.js'),
            ).toBe('renderer/animation/ClipPosition.js');
        });

        it('answers null for a package specifier, which names no file in this repo', () => {
            expect(
                resolveRelativeSpecifier('renderer/animation/ClipPosition.ts', 'three'),
            ).toBeNull();
            expect(
                resolveRelativeSpecifier(
                    'renderer/animation/ClipPosition.ts',
                    '@chimera-engine/simulation/foundation/animation-clip-sheet.js',
                ),
            ).toBeNull();
        });
    });

    it('enumerates a non-empty set of modules that includes every founding module', () => {
        const modules = enumerateCensusModules(ANIMATION_DIR);

        // Deliberately ONE-directional. A closed set here would have to be edited
        // by every later F82 task, which is the manual census row this design
        // exists to avoid; what has to be held is that the set never SHRINKS to
        // nothing and never silently loses the modules already covered.
        expect(modules).toEqual(expect.arrayContaining([...CANARIES]));
        expect(modules.length).toBeGreaterThanOrEqual(CANARIES.length);

        // The co-located tests sit beside these modules, so an enumeration that
        // forgot to filter them would come back larger AND would analyse vitest
        // as a dependency of the directory.
        expect(modules.filter((name) => name.includes('.test.'))).toEqual([]);
    });

    it('reaches nothing under renderer/bridge/ from any enumerated module', async () => {
        const modules = enumerateCensusModules(ANIMATION_DIR);

        for (const modulePath of modules) {
            const { inputs, reached } = await analyze({
                entryPoint: resolve(ANIMATION_DIR, modulePath),
            });

            // The per-module positive control: the analysis really saw THIS file.
            // Without it a build that resolved nothing would report no violation.
            expect(inputs, modulePath).toContain(`${ANIMATION_SUBTREE}${modulePath}`);
            expect(censusViolations(reached), modulePath).toEqual([]);
        }
    });

    // The in-test controls for the assertion above, run through the same analyzer
    // from the same directory. They are what separates "no module crosses the
    // boundary" from "the analyzer never looked".
    //
    // Three cases because these three do not arrive the same way: the first two
    // resolve into `inputs`, the third never resolves at all and is caught only
    // because `analyze()` reads the elided specifier back off the importer.
    it.each([
        [
            'a used binding',
            [
                `import { useSendAction } from '../bridge/useSendAction.js';`,
                `export const dispatch = useSendAction;`,
            ],
        ],
        [
            'a bare side-effect import',
            [`import '../bridge/useSendAction.js';`, `export const x = 1;`],
        ],
        [
            'a binding nothing uses',
            [`import { useSendAction } from '../bridge/useSendAction.js';`, `export const x = 1;`],
        ],
    ])('reports a violation end to end for %s', async (_label, lines) => {
        const { reached } = await analyze({ source: lines.join('\n') });

        expect(reached.filter((path) => path.startsWith(FORBIDDEN_SUBTREE))).not.toEqual([]);
        expect(censusViolations(reached)).not.toEqual([]);
    });

    it('reports nothing for a module that imports only its own siblings', async () => {
        // The negative control for the three above: `reached` gained a whole
        // channel, so a `censusViolations` that had started answering
        // unconditionally would keep all three green.
        const { reached } = await analyze({
            source: [
                `import { resolveClipPosition } from './ClipPosition.js';`,
                `export const r = resolveClipPosition;`,
            ].join('\n'),
        });

        expect(censusViolations(reached)).toEqual([]);
    });
});

describe('renderer/animation compile-half purity', () => {
    it('reaches nothing outside this directory and depends on no package at all', async () => {
        for (const modulePath of PURE_MODULES) {
            const { externals, reached } = await analyze({
                entryPoint: resolve(ANIMATION_DIR, modulePath),
            });

            // Positive control first: the analysis really saw this file.
            expect(reached, modulePath).toContain(`${ANIMATION_SUBTREE}${modulePath}`);

            // Both channels, each as a CLOSED set rather than a denylist of the
            // names the issue happened to call out (`three`, `react`,
            // `@react-three/fiber`, `renderer/logging|state|assets`). A denylist
            // rejects only what whoever wrote it thought of; these three modules
            // reach nothing outside their own directory and depend on no package,
            // and the empty set says so about every name at once. Their only
            // cross-package import is `import type`, which erases — which is
            // exactly why the control below is needed.
            expect(pathsOutside(reached, ANIMATION_SUBTREE), modulePath).toEqual([]);
            expect(externals, modulePath).toEqual([]);
        }
    });

    it('would report a framework import if one were there', async () => {
        // The opposite-polarity control for the empty-set assertions above. It
        // names `three` because that is the one the issue asks be shown unreached.
        const { externals } = await analyze({
            source: [`import { Vector3 } from 'three';`, `export const up = Vector3;`].join('\n'),
        });

        expect(externals).toEqual(['three']);
    });
});
