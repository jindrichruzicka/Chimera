// tools/shell-page-routes.test.ts
//
// The static half of `LoadedRendererGameShell.shellRoutes` (§4.37.17), and the
// place that runs it. A declared route with no physical page in the game's Next
// tree is a static-export 404: the router never reaches the engine, so no runtime
// warning can exist and only a scan can catch it.
//
// The last block guards the workspace itself: every route a game DECLARES is
// served by that game's own route tree, and `ENGINE_OWNED_ROUTES` still names
// exactly the engine's own page tree — the set that decides which routes are
// candidate game pages at all.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ENGINE_OWNED_ROUTES } from '../renderer/shell/shellRoutes';
import {
    collectShellRouteDeclarations,
    findShellRouteFindings,
    formatShellRouteFindings,
    listGameDirs,
    listGameSourceFiles,
    listRoutePathsUnder,
    routePathForPageFile,
    suggestedPagePath,
    type DirectoryEntry,
    type ReadDirectory,
    type ShellRouteFinding,
} from './shell-page-routes';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Assembled at runtime so this file's own text can never satisfy the scanner it
// exercises (the fixtures below are the only declarations under test).
const FIELD = `shell${'Routes'}`;

describe('collectShellRouteDeclarations', () => {
    it('reads an inline array literal', () => {
        const source = `export const shell = { ${FIELD}: ['/credits', '/atlas'] };`;

        expect(collectShellRouteDeclarations(source)).toEqual({
            routes: ['/credits', '/atlas'],
            unreadable: [],
        });
    });

    it('reads through an `as const` assertion', () => {
        const source = `export const shell = { ${FIELD}: ['/credits'] as const };`;

        expect(collectShellRouteDeclarations(source).routes).toEqual(['/credits']);
    });

    it('reads through a `satisfies` expression', () => {
        const source = `export const shell = { ${FIELD}: ['/credits'] satisfies string[] };`;

        expect(collectShellRouteDeclarations(source).routes).toEqual(['/credits']);
    });

    it('reads a quoted property name', () => {
        const source = `export const shell = { '${FIELD}': ['/credits'] };`;

        expect(collectShellRouteDeclarations(source).routes).toEqual(['/credits']);
    });

    it('reads a double-quoted route string and a template literal route', () => {
        const source = `export const shell = { ${FIELD}: ["/credits", \`/atlas\`] };`;

        expect(collectShellRouteDeclarations(source).routes).toEqual(['/credits', '/atlas']);
    });

    it('follows an identifier to a same-file const array', () => {
        const source = [
            `const pages = ['/credits', '/atlas'] as const;`,
            `export const shell = { ${FIELD}: pages };`,
        ].join('\n');

        expect(collectShellRouteDeclarations(source).routes).toEqual(['/credits', '/atlas']);
    });

    it('reports an initializer it cannot read statically rather than passing it', () => {
        const source = `export const shell = { ${FIELD}: buildPages() };`;

        const declarations = collectShellRouteDeclarations(source);
        expect(declarations.routes).toEqual([]);
        expect(declarations.unreadable).toEqual(['buildPages()']);
    });

    it('reports an identifier that resolves to no readable array', () => {
        const source = [
            `import { pages } from './pages.js';`,
            `const shell = { ${FIELD}: pages };`,
        ].join('\n');

        expect(collectShellRouteDeclarations(source).unreadable).toEqual(['pages']);
    });

    it('ignores a TYPE member of the same name', () => {
        // `interface X { shellRoutes?: readonly string[] }` is a property
        // SIGNATURE, not a declaration — matching it would make every re-stated
        // contract type demand pages.
        const source = `export interface Shell { ${FIELD}?: readonly string[] }`;

        expect(collectShellRouteDeclarations(source)).toEqual({ routes: [], unreadable: [] });
    });

    it('ignores a property whose name merely contains the field name', () => {
        const source = `export const shell = { legacy${FIELD}: ['/credits'] };`;

        expect(collectShellRouteDeclarations(source).routes).toEqual([]);
    });

    it('finds a declaration nested inside a returned object', () => {
        const source = [
            `export async function loadShell() {`,
            `    return { ${FIELD}: ['/credits'] };`,
            `}`,
        ].join('\n');

        expect(collectShellRouteDeclarations(source).routes).toEqual(['/credits']);
    });

    it('finds every declaration in a file, not only the first', () => {
        const source = [
            `const a = { ${FIELD}: ['/credits'] };`,
            `const b = { ${FIELD}: ['/atlas'] };`,
        ].join('\n');

        expect(collectShellRouteDeclarations(source).routes).toEqual(['/credits', '/atlas']);
    });
});

describe('suggestedPagePath', () => {
    it('names the plainest page path that would serve a declared route', () => {
        expect(suggestedPagePath('/credits')).toBe('renderer/app/credits/page.tsx');
    });

    it('accepts a nested route', () => {
        expect(suggestedPagePath('/extras/credits')).toBe('renderer/app/extras/credits/page.tsx');
    });

    it('normalizes a declaration written with a trailing slash', () => {
        expect(suggestedPagePath('/credits/')).toBe('renderer/app/credits/page.tsx');
    });
});

describe('routePathForPageFile', () => {
    it('maps the root page to the root route', () => {
        expect(routePathForPageFile('page.tsx')).toBe('/');
    });

    it('maps a nested page to its route', () => {
        expect(routePathForPageFile('replays/player/page.tsx')).toBe('/replays/player');
    });

    it('drops a route-group segment, which Next drops from the URL', () => {
        expect(routePathForPageFile('(pages)/credits/page.tsx')).toBe('/credits');
    });

    it('drops a route group at any depth, and several of them', () => {
        expect(routePathForPageFile('(a)/extras/(b)/credits/page.tsx')).toBe('/extras/credits');
    });

    it('drops a parallel-slot segment', () => {
        expect(routePathForPageFile('@modal/credits/page.tsx')).toBe('/credits');
    });

    it('keeps a segment that merely CONTAINS parentheses', () => {
        // Only a fully wrapped segment is a group; `credits(2)` is a route.
        expect(routePathForPageFile('credits(2)/page.tsx')).toBe('/credits(2)');
    });

    it('maps a page whose only segments are groups to the root route', () => {
        expect(routePathForPageFile('(pages)/page.tsx')).toBe('/');
    });
});

describe('findShellRouteFindings', () => {
    const SOURCE = 'apps/demo/renderer/loaders.ts';

    function hostFor(files: Readonly<Record<string, string>>, served: readonly string[]) {
        return {
            gameDirs: ['apps/demo'],
            listSourceFiles: async (): Promise<readonly string[]> => Object.keys(files),
            readFile: async (file: string): Promise<string> => files[file] ?? '',
            listRoutePaths: async (): Promise<readonly string[]> => served,
        };
    }

    it('reports nothing when the game tree serves every declared route', async () => {
        const findings = await findShellRouteFindings(
            hostFor({ [SOURCE]: `export const s = { ${FIELD}: ['/credits'] };` }, ['/credits']),
        );

        expect(findings).toEqual([]);
    });

    it('accepts a page the game serves from inside a route group', async () => {
        // `(pages)/credits/page.tsx` is a legal App Router layout that serves
        // /credits; a check that probed for a file path would fail a game whose
        // page works.
        const findings = await findShellRouteFindings({
            ...hostFor({ [SOURCE]: `export const s = { ${FIELD}: ['/credits'] };` }, []),
            listRoutePaths: async () => [routePathForPageFile('(pages)/credits/page.tsx')],
        });

        expect(findings).toEqual([]);
    });

    it('matches a declaration written with a trailing slash against the served route', async () => {
        const findings = await findShellRouteFindings(
            hostFor({ [SOURCE]: `export const s = { ${FIELD}: ['/credits/'] };` }, ['/credits']),
        );

        expect(findings).toEqual([]);
    });

    it('reports a declared route the game tree does not serve', async () => {
        const findings = await findShellRouteFindings(
            hostFor({ [SOURCE]: `export const s = { ${FIELD}: ['/credits'] };` }, []),
        );

        expect(findings).toEqual([
            {
                kind: 'missing-page',
                gameDir: 'apps/demo',
                sourceFile: SOURCE,
                route: '/credits',
                expected: 'apps/demo/renderer/app/credits/page.tsx',
            },
        ] satisfies ShellRouteFinding[]);
    });

    it('reports the route that is missing, not the sibling that is served', async () => {
        const findings = await findShellRouteFindings(
            hostFor({ [SOURCE]: `export const s = { ${FIELD}: ['/credits', '/atlas'] };` }, [
                '/credits',
            ]),
        );

        expect(findings.map((finding) => finding.kind === 'missing-page' && finding.route)).toEqual(
            ['/atlas'],
        );
    });

    it('never satisfies one game declaration with ANOTHER game route tree', async () => {
        // BOTH games declare, and each is served only by its own tree. A lookup
        // shared across games — one `servedRoutes` for the whole walk — answers
        // the second game from the first game's tree, and reports a page it
        // ships as missing. Ordering the SERVED game second is what makes the
        // shared cache produce a finding rather than swallow one.
        const declared = new Map([
            ['apps/a', '/credits'],
            ['apps/b', '/atlas'],
        ]);
        const findings = await findShellRouteFindings({
            gameDirs: [...declared.keys()],
            listSourceFiles: async (gameDir) => [`${gameDir}/renderer/loaders.ts`],
            readFile: async (file) => {
                const gameDir = file.slice(0, file.indexOf('/renderer/'));
                return `export const s = { ${FIELD}: ['${declared.get(gameDir) ?? ''}'] };`;
            },
            listRoutePaths: async (gameDir) => [declared.get(gameDir) ?? ''],
        });

        expect(findings).toEqual([]);
    });

    it('reports the game whose OWN tree does not serve its declaration', async () => {
        // The mirror of the case above: game B ships /credits, game A only
        // declares it. Neither the shared-lookup shape nor a cross-game fallback
        // may let B's page answer for A.
        const declaring = 'apps/a/renderer/loaders.ts';
        const findings = await findShellRouteFindings({
            gameDirs: ['apps/a', 'apps/b'],
            listSourceFiles: async (gameDir) => [`${gameDir}/renderer/loaders.ts`],
            readFile: async (file) =>
                file === declaring ? `export const s = { ${FIELD}: ['/credits'] };` : '',
            listRoutePaths: async (gameDir) => (gameDir === 'apps/b' ? ['/credits'] : []),
        });

        expect(findings).toEqual([
            {
                kind: 'missing-page',
                gameDir: 'apps/a',
                sourceFile: declaring,
                route: '/credits',
                expected: 'apps/a/renderer/app/credits/page.tsx',
            },
        ] satisfies ShellRouteFinding[]);
    });

    it('reports a declared route the ENGINE owns, page or no page', async () => {
        // A consumer app re-exports every engine route into its own tree, so the
        // page exists — and the declaration is still inert at runtime.
        const findings = await findShellRouteFindings(
            hostFor({ [SOURCE]: `export const s = { ${FIELD}: ['/debug'] };` }, ['/debug']),
        );

        expect(findings).toEqual([
            {
                kind: 'engine-owned-route',
                gameDir: 'apps/demo',
                sourceFile: SOURCE,
                route: '/debug',
            },
        ] satisfies ShellRouteFinding[]);
    });

    it('reports a declaration it cannot read statically', async () => {
        const findings = await findShellRouteFindings(
            hostFor({ [SOURCE]: `export const s = { ${FIELD}: buildPages() };` }, []),
        );

        expect(findings).toEqual([
            {
                kind: 'unreadable-declaration',
                gameDir: 'apps/demo',
                sourceFile: SOURCE,
                expression: 'buildPages()',
            },
        ] satisfies ShellRouteFinding[]);
    });

    it('ignores a sibling game file that declares nothing', async () => {
        const other = 'apps/demo/shell/pages.ts';
        const findings = await findShellRouteFindings(
            hostFor(
                {
                    [SOURCE]: `export const s = { ${FIELD}: ['/credits'] };`,
                    [other]: 'export const nothing = 1;',
                },
                ['/credits'],
            ),
        );

        expect(findings).toEqual([]);
    });

    it('walks a game route tree only when that game declares something', async () => {
        let walks = 0;
        await findShellRouteFindings({
            gameDirs: ['apps/demo'],
            listSourceFiles: async () => ['apps/demo/shell/pages.ts'],
            readFile: async () => 'export const nothing = 1;',
            listRoutePaths: async () => {
                walks += 1;
                return [];
            },
        });

        expect(walks).toBe(0);
    });
});

describe('formatShellRouteFindings', () => {
    it('names the game, the declaration site and the page the route needs', () => {
        const message = formatShellRouteFindings([
            {
                kind: 'missing-page',
                gameDir: 'apps/demo',
                sourceFile: 'apps/demo/renderer/loaders.ts',
                route: '/credits',
                expected: 'apps/demo/renderer/app/credits/page.tsx',
            },
        ]);

        expect(message).toContain('/credits');
        expect(message).toContain('apps/demo/renderer/loaders.ts');
        expect(message).toContain('apps/demo/renderer/app/credits/page.tsx');
    });

    it('explains why an unreadable declaration cannot be checked', () => {
        const message = formatShellRouteFindings([
            {
                kind: 'unreadable-declaration',
                gameDir: 'apps/demo',
                sourceFile: 'apps/demo/renderer/loaders.ts',
                expression: 'buildPages()',
            },
        ]);

        expect(message).toContain('buildPages()');
        expect(message).toContain('array literal');
    });

    it('says why an engine-owned declaration is inert', () => {
        const message = formatShellRouteFindings([
            {
                kind: 'engine-owned-route',
                gameDir: 'apps/demo',
                sourceFile: 'apps/demo/renderer/loaders.ts',
                route: '/debug',
            },
        ]);

        expect(message).toContain('/debug');
        expect(message).toContain('inert');
    });

    it('is empty for no findings', () => {
        expect(formatShellRouteFindings([])).toBe('');
    });
});

/**
 * A directory reader over a literal tree: `{ 'credits': { 'page.jsx': null } }`,
 * so each walk's accepted name set is pinned against a tree that holds every
 * name it must accept and several it must not.
 */
interface FixtureTree {
    [name: string]: FixtureTree | null;
}

function readerFor(tree: FixtureTree, root: string): ReadDirectory {
    return async (dir: string): Promise<readonly DirectoryEntry[]> => {
        const relative = path.relative(root, dir);
        const segments = relative.length === 0 ? [] : relative.split(path.sep);
        let node: FixtureTree | null = tree;
        for (const segment of segments) {
            node = node?.[segment] ?? null;
        }
        if (node === null) {
            throw new Error(`fixture tree has no directory '${dir}'`);
        }
        return Object.entries(node).map(([name, child]) => ({
            name,
            isDirectory: child !== null,
        }));
    };
}

describe('listRoutePathsUnder', () => {
    const ROOT = path.join(path.sep, 'fixture', 'app');

    it('recognises a page under EVERY extension it accepts, and nothing else', async () => {
        const routes = await listRoutePathsUnder(
            ROOT,
            readerFor(
                {
                    'page.tsx': null,
                    credits: { 'page.jsx': null, 'layout.tsx': null },
                    atlas: { 'page.ts': null },
                    codex: { 'page.js': null },
                    notes: { 'page.mdx': null, 'index.tsx': null },
                },
                ROOT,
            ),
        );

        // The exact set: a dropped extension loses its route, and a widened
        // match picks up `page.mdx` or the sibling `layout`/`index` files.
        expect(routes).toEqual(['/', '/atlas', '/codex', '/credits']);
    });

    it('drops route-group and parallel-slot segments from the served route', async () => {
        const routes = await listRoutePathsUnder(
            ROOT,
            readerFor({ '(pages)': { credits: { 'page.tsx': null } } }, ROOT),
        );

        expect(routes).toEqual(['/credits']);
    });

    it('never descends into a build or vendor directory', async () => {
        const routes = await listRoutePathsUnder(
            ROOT,
            readerFor(
                {
                    kept: { 'page.tsx': null },
                    out: { stale: { 'page.tsx': null } },
                    dist: { stale: { 'page.tsx': null } },
                    node_modules: { pkg: { 'page.tsx': null } },
                    '.next': { server: { 'page.tsx': null } },
                    coverage: { report: { 'page.tsx': null } },
                },
                ROOT,
            ),
        );

        expect(routes).toEqual(['/kept']);
    });
});

describe('listGameSourceFiles', () => {
    const GAME = path.join(path.sep, 'workspace', 'apps', 'demo');

    it('returns the workspace-relative TypeScript sources, tests excluded', async () => {
        // A test fixture declaring a route is describing a scenario, not
        // shipping a page — and `.js`/`.json` neighbours carry no declaration
        // this scan can parse.
        const files = await listGameSourceFiles(
            GAME,
            readerFor(
                {
                    'manifest.ts': null,
                    'manifest.test.ts': null,
                    renderer: {
                        'loaders.ts': null,
                        'loaders.test.ts': null,
                        app: { credits: { 'page.tsx': null, 'page.test.tsx': null } },
                    },
                    'legacy.js': null,
                    'data.json': null,
                    dist: { 'loaders.ts': null },
                },
                GAME,
            ),
        );

        expect(files).toEqual([
            'apps/demo/manifest.ts',
            'apps/demo/renderer/app/credits/page.tsx',
            'apps/demo/renderer/loaders.ts',
        ]);
    });
});

describe('the workspace itself', () => {
    it('has a physical page for every shell route its games declare', async () => {
        const gameDirs = await listGameDirs(ROOT);
        expect(gameDirs.length).toBeGreaterThan(0);

        let filesScanned = 0;
        let routesDeclared = 0;
        const findings = await findShellRouteFindings({
            gameDirs,
            listSourceFiles: async (gameDir) => {
                const files = await listGameSourceFiles(path.join(ROOT, gameDir));
                filesScanned += files.length;
                return files;
            },
            readFile: async (file) => {
                const source = await readFile(path.join(ROOT, file), 'utf8');
                routesDeclared += collectShellRouteDeclarations(source).routes.length;
                return source;
            },
            listRoutePaths: async (gameDir) =>
                listRoutePathsUnder(path.join(ROOT, gameDir, 'renderer/app')),
        });

        // A crawl that found nothing to read would make the assertion below
        // vacuous whatever the games declare.
        expect(filesScanned).toBeGreaterThan(0);
        // And the count the crawl DID find, so a route added or dropped is a
        // number that has to be re-read here rather than a silence. One today:
        // the action app's `/select` picker.
        expect(routesDeclared).toBe(1);
        expect(findings, formatShellRouteFindings(findings)).toEqual([]);
    });

    it('pins ENGINE_OWNED_ROUTES to the engine app tree', async () => {
        const routes = await listRoutePathsUnder(path.join(ROOT, 'renderer/app'));

        expect([...ENGINE_OWNED_ROUTES].sort()).toEqual([...routes].sort());
    });
});
