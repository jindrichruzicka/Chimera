/**
 * renderer/__tests__/shell-layout-graph-census.test.ts
 *
 * The always-mounted layout chunk carries no WebGL runtime (§4.10, §4.37).
 *
 * Each consumer app's `app/layout.tsx` re-exports the engine root layout, so
 * webpack's chunk for it is a `<script>` on every exported route — the boot
 * screen, the logo screen, the settings pane. Nothing the walk below reaches
 * from that layout through a static VALUE edge may name `three`: a game that
 * declares no `shellBackgroundAssets` opens no session at all, and a route that
 * shows no scene should not pay for the renderer core before its first paint.
 *
 * What the walk covers is measured rather than asserted. It follows relative
 * specifiers, the `@chimera-engine/renderer/*` subpaths a consumer names, and the
 * `chimera-game-registration` alias into the app's own composition root. Every
 * bare specifier it declines is REPORTED, and the real-tree arms below pin that
 * set exactly — a shrunken graph would otherwise pass for the wrong reason. A
 * RELATIVE stylesheet is the documented exception: it is not a module, it
 * carries no edge onward, and it is dropped without a record.
 *
 * Two arms over one set of predicates. The synthetic arm drives the walk over
 * an injected file system and hand-written sources, so every import form the
 * census must catch — and the several it must NOT — is exercised against a
 * fixture rather than against whatever the tree happens to hold today. The
 * real-tree arms run the same predicates from each app's real layout.
 *
 * Kill confirmed by mutation: restoring `import { TextureLoader } from 'three'`
 * at the top of `renderer/assets/AssetManager.ts` — the edge this task moved
 * behind `await import` — fails both real-tree arms with that file named.
 *
 * Tests written first (TDD — red confirmed: the real-tree arm reported
 * `renderer/assets/AssetManager.ts` importing `three` at line 1 before the
 * source change).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    createConsumerBareResolver,
    enginePackageSubpath,
    GAME_REGISTRATION_SPECIFIER,
    isStyleSheetSpecifier,
    isWebglRuntimeSpecifier,
    listStaticValueEdges,
    publishedTargetForSubpath,
    RENDERER_PACKAGE,
    resolveRelativeEdge,
    sourceForDistTarget,
    walkStaticValueGraph,
    type GraphFileSystem,
    type ShellLayoutGraph,
} from './shellLayoutGraphCensus';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** A file system over an in-memory tree, keyed by repo-relative POSIX path. */
function fakeFileSystem(tree: Readonly<Record<string, string>>): GraphFileSystem {
    const byAbsolutePath = new Map(
        Object.entries(tree).map(([path, source]) => [resolve(repoRoot, path), source]),
    );
    return {
        isFile: (absolutePath) => byAbsolutePath.has(absolutePath),
        readFile: (absolutePath) => byAbsolutePath.get(absolutePath) ?? '',
    };
}

function specifiersOf(source: string, fileName = 'probe.ts'): readonly string[] {
    return listStaticValueEdges(fileName, source).map((edge) => edge.specifier);
}

describe('listStaticValueEdges', () => {
    it('reports a named value import', () => {
        expect(specifiersOf("import { TextureLoader } from 'three';")).toEqual(['three']);
    });

    it('reports a default import', () => {
        expect(specifiersOf("import THREE from 'three';")).toEqual(['three']);
    });

    it('reports a namespace import', () => {
        expect(specifiersOf("import * as THREE from 'three';")).toEqual(['three']);
    });

    it('reports a side-effect import, which tsc keeps', () => {
        expect(specifiersOf("import 'three';")).toEqual(['three']);
    });

    it('reports a list mixing an inline type binding with a value one', () => {
        expect(specifiersOf("import { type Texture, TextureLoader } from 'three';")).toEqual([
            'three',
        ]);
    });

    it('drops an `import type` declaration', () => {
        expect(specifiersOf("import type { Texture } from 'three';")).toEqual([]);
    });

    it('drops a list whose every binding carries the inline type modifier', () => {
        expect(specifiersOf("import { type Texture, type Group } from 'three';")).toEqual([]);
    });

    it('drops an empty named list', () => {
        expect(specifiersOf("import {} from 'three';")).toEqual([]);
    });

    it('drops a dynamic import, which is a chunk boundary rather than an edge', () => {
        expect(
            specifiersOf(
                [
                    'async function load() {',
                    "    const { TextureLoader } = await import('three');",
                    '    return TextureLoader;',
                    '}',
                ].join('\n'),
            ),
        ).toEqual([]);
    });

    it('drops a specifier that appears only in a comment', () => {
        expect(
            specifiersOf("// import { TextureLoader } from 'three';\nexport const x = 1;"),
        ).toEqual([]);
    });

    it('drops a specifier that appears only inside a string literal', () => {
        expect(specifiersOf(`export const doc = "import { X } from 'three'";`)).toEqual([]);
    });

    it('reports a star re-export', () => {
        expect(specifiersOf("export * from './AssetManager';")).toEqual(['./AssetManager']);
    });

    it('reports a named value re-export', () => {
        expect(specifiersOf("export { createAssetManager } from './AssetManager';")).toEqual([
            './AssetManager',
        ]);
    });

    it('drops an `export type` re-export', () => {
        expect(specifiersOf("export type { AssetManager } from './AssetManager';")).toEqual([]);
    });

    it('drops a re-export list whose every binding carries the inline type modifier', () => {
        expect(specifiersOf("export { type AssetManager } from './AssetManager';")).toEqual([]);
    });

    it('reads JSX sources', () => {
        expect(
            specifiersOf(
                [
                    "import { Canvas } from '@react-three/fiber';",
                    'export const V = () => <Canvas />;',
                ].join('\n'),
                'probe.tsx',
            ),
        ).toEqual(['@react-three/fiber']);
    });

    it('reports the 1-based line of each declaration', () => {
        expect(
            listStaticValueEdges(
                'probe.ts',
                ['// header', "import { a } from './a';", "import { b } from './b';"].join('\n'),
            ),
        ).toEqual([
            { specifier: './a', line: 2 },
            { specifier: './b', line: 3 },
        ]);
    });
});

describe('isWebglRuntimeSpecifier', () => {
    it('matches the package itself', () => {
        expect(isWebglRuntimeSpecifier('three')).toBe(true);
    });

    it('matches a subpath of the package', () => {
        expect(isWebglRuntimeSpecifier('three/examples/jsm/loaders/GLTFLoader.js')).toBe(true);
    });

    it('matches a @react-three binding, which exists to pull the core in', () => {
        expect(isWebglRuntimeSpecifier('@react-three/fiber')).toBe(true);
    });

    it('does not match a package whose name merely starts with the same letters', () => {
        expect(isWebglRuntimeSpecifier('three-way-merge')).toBe(false);
    });

    it('does not match a scope whose name merely starts with the same letters', () => {
        expect(isWebglRuntimeSpecifier('@react-threedom/fiber')).toBe(false);
    });

    it('does not match a relative path that ends in the same word', () => {
        expect(isWebglRuntimeSpecifier('../assets/three')).toBe(false);
    });
});

describe('isStyleSheetSpecifier', () => {
    it('matches a stylesheet side-effect import', () => {
        expect(isStyleSheetSpecifier('../styles/tokens.css')).toBe(true);
    });

    it('does not match a specifier that merely contains the extension', () => {
        expect(isStyleSheetSpecifier('../styles/tokens.css.ts')).toBe(false);
    });
});

describe('resolveRelativeEdge', () => {
    const fileSystem = fakeFileSystem({
        'pkg/entry.ts': '',
        'pkg/sibling.ts': '',
        'pkg/widget.tsx': '',
        'pkg/dir/index.ts': '',
        'pkg/theme.css': '',
    });
    const from = resolve(repoRoot, 'pkg/entry.ts');

    it('resolves a NodeNext `.js` specifier onto its `.ts` source', () => {
        expect(resolveRelativeEdge('./sibling.js', from, fileSystem)).toBe(
            resolve(repoRoot, 'pkg/sibling.ts'),
        );
    });

    it('resolves an extensionless specifier onto a `.tsx` source', () => {
        expect(resolveRelativeEdge('./widget', from, fileSystem)).toBe(
            resolve(repoRoot, 'pkg/widget.tsx'),
        );
    });

    it('resolves a specifier that already carries its module extension', () => {
        expect(resolveRelativeEdge('./widget.tsx', from, fileSystem)).toBe(
            resolve(repoRoot, 'pkg/widget.tsx'),
        );
    });

    it('returns null for a module-extension specifier that names no file', () => {
        expect(resolveRelativeEdge('./ghost.tsx', from, fileSystem)).toBeNull();
    });

    it('returns null for a stylesheet that exists, because it is not a module', () => {
        // The walk parses what it visits as TypeScript, so a `.css` file that
        // resolved would be the wrong grammar read as the wrong language.
        expect(resolveRelativeEdge('./theme.css', from, fileSystem)).toBeNull();
    });

    it('resolves a directory specifier onto its index module', () => {
        expect(resolveRelativeEdge('./dir', from, fileSystem)).toBe(
            resolve(repoRoot, 'pkg/dir/index.ts'),
        );
    });

    it('returns null for a bare specifier, which the walk hands to resolveBare', () => {
        expect(resolveRelativeEdge('three', from, fileSystem)).toBeNull();
    });

    it('returns null for a relative specifier that resolves to nothing', () => {
        expect(resolveRelativeEdge('./missing', from, fileSystem)).toBeNull();
    });
});

describe('publishedTargetForSubpath', () => {
    const exportsMap = {
        './game': { types: './dist/game/index.d.ts', default: './dist/game/index.js' },
        './shell/*': { types: './dist/app/*.d.ts', default: './dist/app/*.js' },
        './styles/*.css': './dist/styles/*.css',
        './typeless': { types: './dist/typeless.d.ts' },
    };

    it('resolves an exact key', () => {
        expect(publishedTargetForSubpath(exportsMap, './game')).toBe('./dist/game/index.js');
    });

    it('substitutes the star of a pattern key', () => {
        expect(publishedTargetForSubpath(exportsMap, './shell/layout')).toBe(
            './dist/app/layout.js',
        );
    });

    it('substitutes a star spanning several segments', () => {
        expect(publishedTargetForSubpath(exportsMap, './shell/a/b')).toBe('./dist/app/a/b.js');
    });

    it('honours the suffix of a pattern key', () => {
        expect(publishedTargetForSubpath(exportsMap, './styles/tokens.css')).toBe(
            './dist/styles/tokens.css',
        );
    });

    it('reads a string-form entry as its own target', () => {
        expect(publishedTargetForSubpath({ './x': './dist/x.js' }, './x')).toBe('./dist/x.js');
    });

    it('returns null for an entry that publishes types only', () => {
        expect(publishedTargetForSubpath(exportsMap, './typeless')).toBeNull();
    });

    it('returns null for a subpath no key covers', () => {
        expect(publishedTargetForSubpath(exportsMap, './absent')).toBeNull();
    });

    it('refuses a subpath that is only the pattern prefix, leaving the star empty', () => {
        expect(
            publishedTargetForSubpath({ './shell/*': './dist/app/*.js' }, './shell/'),
        ).toBeNull();
    });

    it('prefers an exact key over a pattern that also covers it', () => {
        expect(
            publishedTargetForSubpath(
                { './shell/*': './dist/app/*.js', './shell/layout': './dist/special.js' },
                './shell/layout',
            ),
        ).toBe('./dist/special.js');
    });
});

describe('sourceForDistTarget', () => {
    const fileSystem = fakeFileSystem({
        'renderer/app/layout.tsx': '',
        'renderer/game/index.ts': '',
        'renderer/game/rendererGameRegistry.ts': '',
    });

    it('maps a published dist target back onto its `.tsx` source', () => {
        expect(sourceForDistTarget('./dist/app/layout.js', fileSystem, repoRoot)).toBe(
            resolve(repoRoot, 'renderer/app/layout.tsx'),
        );
    });

    it('maps a barrel target back onto its `.ts` source', () => {
        expect(sourceForDistTarget('./dist/game/index.js', fileSystem, repoRoot)).toBe(
            resolve(repoRoot, 'renderer/game/index.ts'),
        );
    });

    it('maps a non-barrel dist module back onto its source', () => {
        expect(
            sourceForDistTarget('./dist/game/rendererGameRegistry.js', fileSystem, repoRoot),
        ).toBe(resolve(repoRoot, 'renderer/game/rendererGameRegistry.ts'));
    });

    it('returns null when no source module is built into that target', () => {
        expect(sourceForDistTarget('./dist/gone.js', fileSystem, repoRoot)).toBeNull();
    });
});

describe('enginePackageSubpath', () => {
    it('maps a subpath specifier onto its exports key', () => {
        expect(enginePackageSubpath(`${RENDERER_PACKAGE}/shell/layout`)).toBe('./shell/layout');
    });

    it('maps the bare package name onto the root key', () => {
        expect(enginePackageSubpath(RENDERER_PACKAGE)).toBe('.');
    });

    it('declines a package whose name merely starts with the engine package name', () => {
        // The segment anchor is only observable here: `.-extras/game` is what a
        // prefix-only match would build, and it resolves to nothing, so the
        // resolver answers `null` either way.
        expect(enginePackageSubpath(`${RENDERER_PACKAGE}-extras/game`)).toBeNull();
    });

    it('declines an unrelated package', () => {
        expect(enginePackageSubpath('react')).toBeNull();
    });
});

describe('createConsumerBareResolver', () => {
    const fileSystem = fakeFileSystem({
        'renderer/package.json': JSON.stringify({
            exports: {
                './game': { default: './dist/game/index.js' },
                './shell/*': { default: './dist/app/*.js' },
            },
        }),
        'renderer/app/layout.tsx': '',
        'renderer/game/index.ts': '',
        'apps/probe/renderer/register.ts': '',
    });
    const resolveBare = createConsumerBareResolver({
        repoRoot,
        appRendererDir: 'apps/probe/renderer',
        fileSystem,
    });

    it('follows the registration alias into the app composition root', () => {
        expect(resolveBare(GAME_REGISTRATION_SPECIFIER)).toBe(
            resolve(repoRoot, 'apps/probe/renderer/register.ts'),
        );
    });

    it('follows an engine subpath through the published exports map', () => {
        expect(resolveBare(`${RENDERER_PACKAGE}/shell/layout`)).toBe(
            resolve(repoRoot, 'renderer/app/layout.tsx'),
        );
    });

    it('follows an engine barrel subpath', () => {
        expect(resolveBare(`${RENDERER_PACKAGE}/game`)).toBe(
            resolve(repoRoot, 'renderer/game/index.ts'),
        );
    });

    it('declines an engine subpath the exports map does not publish', () => {
        expect(resolveBare(`${RENDERER_PACKAGE}/private/internals`)).toBeNull();
    });

    it('declines a real package boundary', () => {
        expect(resolveBare('react')).toBeNull();
    });

    it('declines a package whose name merely starts with the engine package name', () => {
        expect(resolveBare(`${RENDERER_PACKAGE}-extras/game`)).toBeNull();
    });

    it('declines the registration alias when the app holds no composition root', () => {
        const withoutRegister = createConsumerBareResolver({
            repoRoot,
            appRendererDir: 'apps/moved/renderer',
            fileSystem,
        });

        expect(withoutRegister(GAME_REGISTRATION_SPECIFIER)).toBeNull();
    });
});

describe('walkStaticValueGraph over a synthetic tree', () => {
    it('finds a WebGL edge two hops from the entry', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import { Host } from './host';\nexport const e = Host;",
                'pkg/host.ts': "import { m } from './manager';\nexport const Host = m;",
                'pkg/manager.ts':
                    "import { TextureLoader } from 'three';\nexport const m = TextureLoader;",
            }),
        });

        expect(graph.webglEdges).toEqual([{ file: 'pkg/manager.ts', specifier: 'three', line: 1 }]);
    });

    it('finds nothing once the same edge moves behind a dynamic import', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import { Host } from './host';\nexport const e = Host;",
                'pkg/host.ts': "import { m } from './manager';\nexport const Host = m;",
                'pkg/manager.ts':
                    "export const m = async () => (await import('three')).TextureLoader;",
            }),
        });

        expect(graph.webglEdges).toEqual([]);
    });

    it('finds nothing once the same edge is type-only', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import { Host } from './host';\nexport const e = Host;",
                'pkg/host.ts': "import { m } from './manager';\nexport const Host = m;",
                'pkg/manager.ts':
                    "import type { Texture } from 'three';\nexport const m: Texture | null = null;",
            }),
        });

        expect(graph.webglEdges).toEqual([]);
    });

    it('ignores a WebGL edge in a module the entry cannot reach', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import { Host } from './host';\nexport const e = Host;",
                'pkg/host.ts': 'export const Host = 1;',
                'pkg/scene.ts':
                    "import { TextureLoader } from 'three';\nexport const s = TextureLoader;",
            }),
        });

        expect(graph.webglEdges).toEqual([]);
        expect(graph.files).toEqual(['pkg/entry.ts', 'pkg/host.ts']);
    });

    it('follows a star re-export barrel', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "export * from './barrel';",
                'pkg/barrel.ts':
                    "import { TextureLoader } from 'three';\nexport const b = TextureLoader;",
            }),
        });

        expect(graph.webglEdges).toEqual([{ file: 'pkg/barrel.ts', specifier: 'three', line: 1 }]);
    });

    it('reports a relative specifier that resolves to nothing', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import { gone } from './gone';\nexport const e = gone;",
            }),
        });

        expect(graph.unresolved).toEqual([{ file: 'pkg/entry.ts', specifier: './gone', line: 1 }]);
    });

    it('reports a bare stylesheet specifier as a boundary, since a package sits behind it', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import 'some-ui/dist/theme.css';\nexport const e = 1;",
            }),
        });

        expect(graph.unfollowed).toEqual(['some-ui/dist/theme.css']);
    });

    it('does not report a stylesheet side-effect import as unresolved', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import './theme.css';\nexport const e = 1;",
            }),
        });

        expect(graph.unresolved).toEqual([]);
        expect(graph.unfollowed).toEqual([]);
    });

    it('reports every declined bare specifier once, sorted', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import 'zustand';\nimport 'react';\nimport './leaf';",
                'pkg/leaf.ts': "import 'react';\nexport const l = 1;",
            }),
        });

        expect(graph.unfollowed).toEqual(['react', 'zustand']);
    });

    it('carries the walk through a bare specifier the resolver follows', () => {
        const fileSystem = fakeFileSystem({
            'pkg/entry.ts': "import 'aliased';\nexport const e = 1;",
            'pkg/target.ts':
                "import { TextureLoader } from 'three';\nexport const t = TextureLoader;",
        });
        const target = resolve(repoRoot, 'pkg/target.ts');

        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem,
            resolveBare: (specifier) => (specifier === 'aliased' ? target : null),
        });

        expect(graph.files).toEqual(['pkg/entry.ts', 'pkg/target.ts']);
        expect(graph.unfollowed).toEqual([]);
        expect(graph.webglEdges).toEqual([{ file: 'pkg/target.ts', specifier: 'three', line: 1 }]);
    });

    it('terminates on a cycle and still reports the WebGL edge inside it', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import './a';",
                'pkg/a.ts': "import './b';\nimport { TextureLoader } from 'three';",
                'pkg/b.ts': "import './a';",
            }),
        });

        expect(graph.files).toEqual(['pkg/a.ts', 'pkg/b.ts', 'pkg/entry.ts']);
        expect(graph.webglEdges).toEqual([{ file: 'pkg/a.ts', specifier: 'three', line: 2 }]);
    });

    it('visits a diamond-shared module once', () => {
        const graph = walkStaticValueGraph(resolve(repoRoot, 'pkg/entry.ts'), repoRoot, {
            fileSystem: fakeFileSystem({
                'pkg/entry.ts': "import './left';\nimport './right';",
                'pkg/left.ts': "import './shared';",
                'pkg/right.ts': "import './shared';",
                'pkg/shared.ts': 'export const s = 1;',
            }),
        });

        expect(graph.files).toEqual([
            'pkg/entry.ts',
            'pkg/left.ts',
            'pkg/right.ts',
            'pkg/shared.ts',
        ]);
    });
});

/**
 * Every consumer app under `apps/` that ships a Next host, discovered rather
 * than listed, so a new app is censused the moment it holds one.
 *
 * `renderer/`'s own `next.config.ts` mounts the same layout, and is deliberately
 * outside this set: nothing in the build, test or packaging pipeline runs
 * `next build renderer` — that config says so itself — so its chunks reach no
 * player.
 */
function consumerAppRendererDirs(): readonly string[] {
    return readdirSync(resolve(repoRoot, 'apps'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `apps/${entry.name}/renderer`)
        .filter((dir) => existsSync(resolve(repoRoot, dir, 'app/layout.tsx')))
        .sort();
}

/**
 * The package boundaries every consumer's layout graph stops at.
 *
 * Pinned as an exact set, and shared because both apps reach the same engine
 * shell: extending the always-mounted graph with a new package is then a
 * deliberate act that has to re-confirm the package carries no WebGL runtime.
 */
const SHARED_PACKAGE_BOUNDARIES = [
    '@chimera-engine/simulation/bridge/api-types.js',
    '@chimera-engine/simulation/foundation/asset-ref-parse.js',
    '@chimera-engine/simulation/foundation/game-lobby-contract.js',
    '@chimera-engine/simulation/foundation/game-manifest-contract.js',
    '@chimera-engine/simulation/foundation/save-slots.js',
    'next/navigation',
    'react',
    'zustand',
] as const;

/** Boundaries a single app adds on top of the shared set. */
const EXTRA_PACKAGE_BOUNDARIES: Readonly<Record<string, readonly string[]>> = {
    'apps/action/renderer': ['@chimera-engine/simulation/content/audioManifest.js'],
};

describe('the consumer apps whose layout graphs are censused', () => {
    it('are exactly the shipped apps under apps/', () => {
        expect(consumerAppRendererDirs()).toEqual([
            'apps/action/renderer',
            'apps/tactics/renderer',
        ]);
    });
});

/**
 * The walked graph for one app, computed on FIRST USE and reused.
 *
 * Deliberately not computed in the `describe` body: that runs during
 * collection, where a throw takes every test in this file with it and reports
 * "no tests" — including the unit describes above, one of which names the very
 * predicate that would have thrown.
 */
const graphCache = new Map<string, ShellLayoutGraph>();
function layoutGraph(appRendererDir: string): ShellLayoutGraph {
    const cached = graphCache.get(appRendererDir);
    if (cached !== undefined) {
        return cached;
    }
    const graph = walkStaticValueGraph(
        resolve(repoRoot, appRendererDir, 'app/layout.tsx'),
        repoRoot,
        { resolveBare: createConsumerBareResolver({ repoRoot, appRendererDir }) },
    );
    graphCache.set(appRendererDir, graph);
    return graph;
}

describe.each(consumerAppRendererDirs())('the real %s layout graph', (appRendererDir) => {
    it('reaches the asset machinery the shell mounts', () => {
        // Anti-vacuity. An empty `webglEdges` proves nothing unless the walk
        // actually arrives at the modules that carry — or carried — the arms
        // into `three`: `ShellAudioSession` builds a manager directly, and
        // `ShellBackgroundHost` reaches one through `GameAssetSession`.
        expect(layoutGraph(appRendererDir).files).toEqual(
            expect.arrayContaining([
                'renderer/app/AppShell.tsx',
                'renderer/components/shell/ShellAudioSession.tsx',
                'renderer/components/shell/ShellBackgroundHost.tsx',
                'renderer/app/gameAssetSession.tsx',
                'renderer/assets/criticalAssetPreload.ts',
                'renderer/assets/AssetManager.ts',
            ]),
        );
    });

    it('reaches the game registration arm and the engine barrel behind it', () => {
        // The second anti-vacuity pin, and the one the relative-only walk
        // missed: the app's composition root arrives through the
        // `chimera-game-registration` alias, and the engine's public `game`
        // barrel arrives from there through the package exports map.
        expect(layoutGraph(appRendererDir).files).toEqual(
            expect.arrayContaining([
                `${appRendererDir}/register.ts`,
                `${appRendererDir}/loaders.ts`,
                'renderer/game/index.ts',
                'renderer/game/rendererGameRegistry.ts',
            ]),
        );
    });

    it('resolves every relative edge it walks', () => {
        expect(layoutGraph(appRendererDir).unresolved).toEqual([]);
    });

    it('stops at exactly the package boundaries this census names', () => {
        expect(layoutGraph(appRendererDir).unfollowed).toEqual(
            [
                ...SHARED_PACKAGE_BOUNDARIES,
                ...(EXTRA_PACKAGE_BOUNDARIES[appRendererDir] ?? []),
            ].sort((left, right) => left.localeCompare(right)),
        );
    });

    it('names no WebGL runtime through a static value edge', () => {
        expect(layoutGraph(appRendererDir).webglEdges).toEqual([]);
    });
});
