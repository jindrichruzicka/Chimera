/**
 * renderer/shell/__tests__/route-classification-census.test.ts
 *
 * ONE classifier (§4.37.18). Across every production module in `renderer/`,
 * exactly one imports a pathname-consuming helper from the route vocabulary:
 * `ShellStateBridge`. Every other consumer reads the classified surface off the
 * shell-state store.
 *
 * The census walks the REAL tree; the synthetic arm below drives the same
 * predicates over an injected directory reader and hand-written sources, so
 * every shape the walk must catch (and several it must not) is exercised
 * against a fixture rather than against whatever the tree happens to hold
 * today.
 *
 * The writer arm answers a question the classifier arm does not imply: a module
 * that called `setShellRoute` with a literal surface would import no vocabulary
 * verb and pass the classifier census clean. Both arms together are what holds
 * "written by enumerated engine sites only"; they share the file predicates, not
 * a walk.
 *
 * Scope: `renderer/` only. `renderer/shell/*` is not reachable from a game —
 * the package maps `"./shell/*"` at `dist/app/*` — so no `apps/*` module can
 * name the vocabulary at all (Invariant #96).
 *
 * Kill confirmed by mutation: re-adding
 * `import { matchesDeclaredShellRoute } from '../shell/shellRoutes'` to
 * `GameStoreBootstrap.tsx` — the import this task removed — fails the real-tree
 * arm with both files listed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CLASSIFICATION_VERBS,
    findClassificationImports,
    findShellStateWriterImports,
    isCensusSourceFile,
    listCensusFiles,
    namesRouteVocabulary,
    namesShellStateStore,
    ROUTE_VOCABULARY_FILE,
    ROUTE_WRITERS,
    SHELL_STATE_FILE,
    SOLE_CLASSIFIER,
    TRANSITION_WRITER_SITES,
    TRANSITION_WRITERS,
    type CensusDirectoryEntry,
    type ReadCensusDirectory,
} from './routeClassificationCensus';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function classifyingFilesInRendererTree(): readonly string[] {
    const files = listCensusFiles('renderer').filter((file) => file !== ROUTE_VOCABULARY_FILE);
    const classifying = new Set<string>();
    for (const file of files) {
        const source = readFileSync(resolve(repoRoot, file), 'utf8');
        for (const found of findClassificationImports(file, source)) {
            classifying.add(found.file);
        }
    }
    return [...classifying].sort();
}

function writerCallersInRendererTree(verbs: readonly string[]): readonly string[] {
    const files = listCensusFiles('renderer').filter((file) => file !== SHELL_STATE_FILE);
    const callers = new Set<string>();
    for (const file of files) {
        const source = readFileSync(resolve(repoRoot, file), 'utf8');
        for (const found of findShellStateWriterImports(file, source, verbs)) {
            callers.add(found.file);
        }
    }
    return [...callers].sort();
}

describe('route classification — the real renderer tree', () => {
    it('has exactly one classifier', () => {
        expect(classifyingFilesInRendererTree()).toEqual([SOLE_CLASSIFIER]);
    });

    it('walks a tree big enough for the answer to mean something', () => {
        // A broken walk that returned nothing would satisfy the case above.
        const files = listCensusFiles('renderer');
        expect(files.length).toBeGreaterThan(200);
        expect(files).toContain(SOLE_CLASSIFIER);
        expect(files).toContain(ROUTE_VOCABULARY_FILE);
    });

    it('reaches the two modules that used to classify, so their conversion is what the answer reflects', () => {
        const files = listCensusFiles('renderer');
        expect(files).toContain('renderer/components/shell/ShellBackgroundHost.tsx');
        expect(files).toContain('renderer/app/GameStoreBootstrap.tsx');
    });

    it('answers the same from the package directory as from the repo root', () => {
        // vitest runs from the repo root for a single-file run and from
        // `renderer/` under `pnpm -r test`. A walk root resolved against the CWD
        // finds nothing in the second, and an EMPTY census passes every
        // assertion above — which is exactly how this first went green here and
        // red in CI.
        const fromRoot = listCensusFiles('renderer');
        const previousCwd = process.cwd();
        try {
            process.chdir(resolve(repoRoot, 'renderer'));
            expect(listCensusFiles('renderer')).toEqual(fromRoot);
        } finally {
            process.chdir(previousCwd);
        }
    });

    it('names verbs the route vocabulary actually exports', async () => {
        const vocabulary = (await import('../shellRoutes')) as Record<string, unknown>;
        for (const verb of CLASSIFICATION_VERBS) {
            expect(vocabulary[verb]).toBeDefined();
        }
    });
});

describe('shell-state writers — the real renderer tree', () => {
    it('publishes the classified route from one site', () => {
        expect(writerCallersInRendererTree(ROUTE_WRITERS)).toEqual([SOLE_CLASSIFIER]);
    });

    it('arms and clears the transition from the enumerated match-entry flows only', () => {
        expect(writerCallersInRendererTree(TRANSITION_WRITERS)).toEqual([
            ...TRANSITION_WRITER_SITES,
        ]);
    });

    it('names writers the store actually exports', async () => {
        const store = (await import('../shellStateStore')) as Record<string, unknown>;
        for (const writer of [...ROUTE_WRITERS, ...TRANSITION_WRITERS]) {
            expect(store[writer]).toBeDefined();
        }
    });

    it('excludes the store module itself, which names its own exports', () => {
        expect(listCensusFiles('renderer')).toContain(SHELL_STATE_FILE);
        expect(writerCallersInRendererTree(ROUTE_WRITERS)).not.toContain(SHELL_STATE_FILE);
    });
});

// ── Synthetic arm ─────────────────────────────────────────────────────────────

type FixtureTree = Readonly<Record<string, readonly CensusDirectoryEntry[]>>;

function readerFor(tree: FixtureTree): ReadCensusDirectory {
    return (path) => tree[path] ?? [];
}

function dir(name: string): CensusDirectoryEntry {
    return { name, isDirectory: true };
}

function file(name: string): CensusDirectoryEntry {
    return { name, isDirectory: false };
}

describe('listCensusFiles', () => {
    it('walks nested directories and returns repo-relative POSIX paths, sorted', () => {
        const tree: FixtureTree = {
            root: [dir('shell'), file('a.ts')],
            'root/shell': [file('b.tsx')],
        };

        expect(listCensusFiles('root', readerFor(tree))).toEqual(['root/a.ts', 'root/shell/b.tsx']);
    });

    it.each(['node_modules', 'out', 'dist', 'build', '.next'])(
        'never descends into %s',
        (skipped) => {
            const tree: FixtureTree = {
                root: [dir(skipped)],
                [`root/${skipped}`]: [file('a.ts')],
            };

            expect(listCensusFiles('root', readerFor(tree))).toEqual([]);
        },
    );

    it.each(['__tests__', '__test-support__', 'fixtures'])(
        'never descends into %s — a helper beside a test is skipped for the reason the test is',
        (skipped) => {
            const tree: FixtureTree = {
                root: [dir(skipped)],
                [`root/${skipped}`]: [file('helper.ts')],
            };

            expect(listCensusFiles('root', readerFor(tree))).toEqual([]);
        },
    );

    it('keeps .ts and .tsx and drops everything else', () => {
        const tree: FixtureTree = {
            root: [
                file('keep.ts'),
                file('keep.tsx'),
                file('skip.test.ts'),
                file('skip.test.tsx'),
                file('skip.d.ts'),
                file('skip.js'),
                file('skip.css'),
                file('skip.json'),
            ],
        };

        expect(listCensusFiles('root', readerFor(tree))).toEqual(['root/keep.ts', 'root/keep.tsx']);
    });
});

describe('isCensusSourceFile', () => {
    it.each([
        ['module.ts', true],
        ['Component.tsx', true],
        ['module.test.ts', false],
        ['Component.test.tsx', false],
        ['types.d.ts', false],
        ['script.js', false],
        ['styles.module.css', false],
    ])('classifies %s as %s', (name, expected) => {
        expect(isCensusSourceFile(name)).toBe(expected);
    });
});

describe('namesShellStateStore', () => {
    it.each(['./shellStateStore', '../shell/shellStateStore', '../../shell/shellStateStore.js'])(
        'matches %s',
        (specifier) => {
            expect(namesShellStateStore(specifier)).toBe(true);
        },
    );

    it.each(['./shellRoutes', './shellStateStoreHelper', './myShellStateStore', 'zustand'])(
        'does not match %s',
        (specifier) => {
            expect(namesShellStateStore(specifier)).toBe(false);
        },
    );
});

describe('findShellStateWriterImports', () => {
    it('finds a named import of a writer', () => {
        const found = findShellStateWriterImports(
            'x.ts',
            `import { setShellRoute } from '../shell/shellStateStore';`,
            ROUTE_WRITERS,
        );

        expect(found).toEqual([{ file: 'x.ts', verb: 'setShellRoute' }]);
    });

    it('ignores the READ surface, which every consumer may reach', () => {
        const found = findShellStateWriterImports(
            'x.ts',
            `import { getShellState, useShellState } from '../shell/shellStateStore';`,
            [...ROUTE_WRITERS, ...TRANSITION_WRITERS],
        );

        expect(found).toEqual([]);
    });

    it('ignores the game-reachable draft writer, which is not an engine site', () => {
        const found = findShellStateWriterImports(
            'x.ts',
            `import { setShellDraft } from '../shell/shellStateStore';`,
            [...ROUTE_WRITERS, ...TRANSITION_WRITERS],
        );

        expect(found).toEqual([]);
    });

    it('reports every writer for a namespace import of the store', () => {
        const found = findShellStateWriterImports(
            'x.ts',
            `import * as store from '../shell/shellStateStore';`,
            TRANSITION_WRITERS,
        );

        expect(found.map((entry) => entry.verb).sort()).toEqual([...TRANSITION_WRITERS].sort());
    });

    it('ignores a writer NAME imported from somewhere else', () => {
        const found = findShellStateWriterImports(
            'x.ts',
            `import { setShellRoute } from './somewhereElse';`,
            ROUTE_WRITERS,
        );

        expect(found).toEqual([]);
    });
});

describe('namesRouteVocabulary', () => {
    it.each([
        './shellRoutes',
        '../shell/shellRoutes',
        '../../shell/shellRoutes',
        './shellRoutes.js',
        '../shell/shellRoutes.ts',
        'shellRoutes',
    ])('matches %s', (specifier) => {
        expect(namesRouteVocabulary(specifier)).toBe(true);
    });

    it.each([
        './shellStateStore',
        '../shell/useShellNavigate',
        './shellRoutesHelper',
        './myShellRoutesThing',
        'next/navigation',
    ])('does not match %s', (specifier) => {
        expect(namesRouteVocabulary(specifier)).toBe(false);
    });
});

describe('findClassificationImports', () => {
    it('finds a named import of a verb', () => {
        const found = findClassificationImports(
            'x.ts',
            `import { classifyShellSurface } from '../shell/shellRoutes';`,
        );

        expect(found).toEqual([{ file: 'x.ts', verb: 'classifyShellSurface' }]);
    });

    it('finds every verb, not just the first', () => {
        const found = findClassificationImports(
            'x.ts',
            `import { isEngineOwnedRoute, normalizeRoutePath } from './shellRoutes';`,
        );

        expect(found.map((entry) => entry.verb).sort()).toEqual([
            'isEngineOwnedRoute',
            'normalizeRoutePath',
        ]);
    });

    it('finds a verb reached under an alias', () => {
        const found = findClassificationImports(
            'x.ts',
            `import { normalizeRoutePath as normalize } from './shellRoutes';`,
        );

        expect(found).toEqual([{ file: 'x.ts', verb: 'normalizeRoutePath' }]);
    });

    it('finds a TYPE-position import of a verb — a value re-exported as a type is still a graph edge', () => {
        const found = findClassificationImports(
            'x.ts',
            `import type { ENGINE_ROUTE_SURFACES } from './shellRoutes';`,
        );

        expect(found).toHaveLength(1);
    });

    it('reports every verb for a namespace import, which names no member', () => {
        const found = findClassificationImports('x.ts', `import * as routes from './shellRoutes';`);

        expect(found.map((entry) => entry.verb).sort()).toEqual([...CLASSIFICATION_VERBS].sort());
    });

    it('reports every verb for a dynamic import of the vocabulary', () => {
        const found = findClassificationImports(
            'x.ts',
            `async function f() { return import('../shell/shellRoutes'); }`,
        );

        expect(found).toHaveLength(CLASSIFICATION_VERBS.length);
    });

    it('finds a verb re-exported by name', () => {
        const found = findClassificationImports(
            'x.ts',
            `export { matchesDeclaredShellRoute } from './shellRoutes';`,
        );

        expect(found).toEqual([{ file: 'x.ts', verb: 'matchesDeclaredShellRoute' }]);
    });

    it('reports every verb for a star re-export of the vocabulary', () => {
        const found = findClassificationImports('x.ts', `export * from './shellRoutes';`);

        expect(found).toHaveLength(CLASSIFICATION_VERBS.length);
    });

    it('finds an import nested inside a block rather than at the top level of the walk', () => {
        // `ts.forEachChild` from the source file reaches statements at any depth;
        // this is the shape a top-level-only scan would miss.
        const found = findClassificationImports(
            'x.ts',
            `function f() { void import('./shellRoutes'); }`,
        );

        expect(found).toHaveLength(CLASSIFICATION_VERBS.length);
    });

    it('ignores the non-classifying exports, which carry no pathname', () => {
        const found = findClassificationImports(
            'x.ts',
            `import { SHELL_BACKGROUND_SURFACES, type ShellSurface } from './shellRoutes';`,
        );

        expect(found).toEqual([]);
    });

    it('ignores a verb NAME imported from somewhere else', () => {
        const found = findClassificationImports(
            'x.ts',
            `import { classifyShellSurface } from './somewhereElse';`,
        );

        expect(found).toEqual([]);
    });

    it('ignores the verb name in a comment, a JSDoc link and a string', () => {
        const found = findClassificationImports(
            'x.ts',
            [
                `// classifyShellSurface lives in shellRoutes`,
                `/** See {@link normalizeRoutePath} in \`shellRoutes\`. */`,
                `const label = 'isEngineOwnedRoute';`,
            ].join('\n'),
        );

        expect(found).toEqual([]);
    });

    it('ignores a same-named local declaration', () => {
        const found = findClassificationImports(
            'x.ts',
            `function classifyShellSurface(): string { return 'boot'; }`,
        );

        expect(found).toEqual([]);
    });
});
