/**
 * tools/shell-page-routes.ts
 *
 * The static half of `LoadedRendererGameShell.shellRoutes` (§4.37.17), run by
 * `tools/shell-page-routes.test.ts`.
 *
 * A game promotes one of its own Next routes to a shell page by DECLARING it on
 * the shell payload; the page itself is a physical file in the game's own host
 * tree (`apps/<game>/renderer/app/<route>/page.tsx`). Those two halves can
 * disagree, and the disagreement is invisible at runtime: under `output:
 * 'export'` a route with no page is simply not emitted, so the navigation is a
 * static 404 the renderer never observes. There is nothing to warn about at
 * runtime — only something a static scan can catch.
 *
 * The scan PARSES rather than greps: `shellRoutes` is read off the TypeScript
 * AST as a property assignment with a readable array initializer, so a property
 * signature on a re-stated contract type, a longer identifier that happens to
 * contain the name, or a route mentioned in a comment are all non-matches by
 * construction.
 *
 * The other half is read the same way — from the game's own `renderer/app/`
 * tree, asking which routes it SERVES rather than probing for a file at a
 * guessed path. Route groups (`(pages)/credits/page.tsx`) and parallel slots
 * are legal App Router layouts that serve `/credits` from a path no probe would
 * guess, so a probe would fail a game whose page works.
 *
 * Two more shapes are findings rather than passes. A declaration this cannot
 * read statically, because a computed initializer would silently turn the whole
 * check off for that game. And a route the ENGINE owns, because a consumer app
 * re-exports every engine route into its own tree — so `shellRoutes: ['/debug']`
 * would find a page, pass, and still be inert at runtime, which is exactly the
 * class of mistake this exists to catch.
 *
 * `normalizeRoutePath` and `ENGINE_OWNED_ROUTES` are imported from the renderer
 * module the RUNTIME matcher uses rather than restated here: a second normalizer
 * is how a route passes this check and then never matches in the app.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { ENGINE_OWNED_ROUTES, normalizeRoutePath } from '../renderer/shell/shellRoutes';

import {
    ScriptKind,
    ScriptTarget,
    createSourceFile,
    forEachChild,
    isArrayLiteralExpression,
    isAsExpression,
    isIdentifier,
    isNoSubstitutionTemplateLiteral,
    isPropertyAssignment,
    isSatisfiesExpression,
    isStringLiteral,
    isVariableDeclaration,
} from 'typescript';
import type { Expression, Node, SourceFile } from 'typescript';

/** The shell-payload field a game declares its pages on. */
const SHELL_ROUTES_FIELD = 'shellRoutes';

/** The Next page basenames this recognises; the first is the one it suggests. */
const PAGE_EXTENSIONS = ['tsx', 'jsx', 'ts', 'js'] as const;

/** A game's Next host tree, relative to its app directory. */
const GAME_APP_DIR = 'renderer/app';

/** Directories a source crawl never descends into. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'out', '.next', 'coverage']);

/** `(pages)` — an App Router route GROUP; organisational, absent from the URL. */
const ROUTE_GROUP_SEGMENT = /^\(.+\)$/u;
/** `@modal` — a parallel-route SLOT; a named slot, not a URL segment. */
const PARALLEL_SLOT_PREFIX = '@';

export type ShellRouteFinding =
    | {
          readonly kind: 'missing-page';
          readonly gameDir: string;
          readonly sourceFile: string;
          readonly route: string;
          /** The canonical page path the route needs (the `.tsx` spelling). */
          readonly expected: string;
      }
    | {
          readonly kind: 'engine-owned-route';
          readonly gameDir: string;
          readonly sourceFile: string;
          readonly route: string;
      }
    | {
          readonly kind: 'unreadable-declaration';
          readonly gameDir: string;
          readonly sourceFile: string;
          /** The initializer text, verbatim, so the message can point at it. */
          readonly expression: string;
      };

export interface ShellRouteDeclarations {
    /** Every statically readable declared route, in source order. */
    readonly routes: readonly string[];
    /** Every initializer the scan could not read, as written. */
    readonly unreadable: readonly string[];
}

export interface ShellRouteScanOptions {
    /** Workspace-relative game directories (`apps/<game>`). */
    readonly gameDirs: readonly string[];
    /** Workspace-relative source files to scan for one game. */
    listSourceFiles(gameDir: string): Promise<readonly string[]>;
    readFile(file: string): Promise<string>;
    /** The route paths ONE game's own Next tree serves. */
    listRoutePaths(gameDir: string): Promise<readonly string[]>;
}

/**
 * The routes (and unreadable initializers) one source file declares. Every
 * `shellRoutes` property assignment in the file contributes, wherever it sits —
 * a loader's returned object literal is the ordinary shape, but a game is free
 * to build the payload anywhere.
 */
export function collectShellRouteDeclarations(sourceText: string): ShellRouteDeclarations {
    const source = createSourceFile(
        'shell-routes-scan.ts',
        sourceText,
        ScriptTarget.Latest,
        true,
        ScriptKind.TSX,
    );

    const routes: string[] = [];
    const unreadable: string[] = [];

    const visit = (node: Node): void => {
        if (isPropertyAssignment(node) && propertyNameIsShellRoutes(node.name)) {
            const resolved = readRouteArray(node.initializer, source);
            if (resolved === null) {
                unreadable.push(node.initializer.getText(source));
            } else {
                routes.push(...resolved);
            }
        }
        forEachChild(node, visit);
    };
    forEachChild(source, visit);

    return { routes, unreadable };
}

/**
 * The plainest page path that would serve a declared route, game-dir-relative.
 * Advice for the report, not a claim about the only legal spelling: a route
 * group or a parallel slot serves the same route from a different path.
 */
export function suggestedPagePath(route: string): string {
    const segments = normalizeRoutePath(route)
        .split('/')
        .filter((segment) => segment.length > 0);
    return [GAME_APP_DIR, ...segments, `page.${PAGE_EXTENSIONS[0]}`].join('/');
}

/**
 * The route an app-relative `page.*` file serves (`page.tsx` ⇒ `/`).
 *
 * Route-group and parallel-slot segments are dropped, because Next drops them
 * from the URL. Intercepting segments (`(.)folder`) are deliberately NOT
 * handled — they exist only under a parallel slot and are not a shape a shell
 * page takes.
 */
export function routePathForPageFile(appRelativePath: string): string {
    const segments = appRelativePath
        .split('/')
        .slice(0, -1)
        .filter(
            (segment) =>
                segment.length > 0 &&
                !ROUTE_GROUP_SEGMENT.test(segment) &&
                !segment.startsWith(PARALLEL_SLOT_PREFIX),
        );
    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * Every declared route in every given game, cross-checked against that game's
 * OWN route tree — `listRoutePaths` is asked once per game and never shared, so
 * a route declared by one game is never satisfied by another game's page.
 */
export async function findShellRouteFindings(
    options: ShellRouteScanOptions,
): Promise<readonly ShellRouteFinding[]> {
    const findings: ShellRouteFinding[] = [];

    for (const gameDir of options.gameDirs) {
        const sourceFiles = await options.listSourceFiles(gameDir);
        let servedRoutes: ReadonlySet<string> | undefined;

        for (const sourceFile of sourceFiles) {
            const sourceText = await options.readFile(sourceFile);
            if (!sourceText.includes(SHELL_ROUTES_FIELD)) {
                // A cheap pre-filter only: every match is still decided by the
                // parse below, never by this substring.
                continue;
            }

            const { routes, unreadable } = collectShellRouteDeclarations(sourceText);

            for (const expression of unreadable) {
                findings.push({ kind: 'unreadable-declaration', gameDir, sourceFile, expression });
            }

            for (const route of routes) {
                const routePath = normalizeRoutePath(route);
                if (ENGINE_OWNED_ROUTES.has(routePath)) {
                    findings.push({ kind: 'engine-owned-route', gameDir, sourceFile, route });
                    continue;
                }
                // Resolved lazily and kept: a game with no declaration never pays
                // for the walk, and one with several pays for it once.
                servedRoutes ??= new Set(
                    (await options.listRoutePaths(gameDir)).map((served) =>
                        normalizeRoutePath(served),
                    ),
                );
                if (servedRoutes.has(routePath)) {
                    continue;
                }
                findings.push({
                    kind: 'missing-page',
                    gameDir,
                    sourceFile,
                    route,
                    expected: `${gameDir}/${suggestedPagePath(route)}`,
                });
            }
        }
    }

    return findings;
}

/** A readable report — one paragraph per finding, empty when there are none. */
export function formatShellRouteFindings(findings: readonly ShellRouteFinding[]): string {
    if (findings.length === 0) {
        return '';
    }

    const lines = findings.map((finding) => {
        switch (finding.kind) {
            case 'missing-page':
                return (
                    `${finding.sourceFile} declares the shell route '${finding.route}', but ${finding.gameDir}'s route tree does not serve it. ` +
                    `Add ${finding.expected} (or any route-group spelling that serves it), or drop the declaration — under a static export the route would be a 404 the engine never sees.`
                );
            case 'engine-owned-route':
                return (
                    `${finding.sourceFile} declares the shell route '${finding.route}', which the ENGINE owns. ` +
                    `A game page cannot shadow an engine route, so the declaration is inert: drop it, or move the page to a route the engine does not ship.`
                );
            case 'unreadable-declaration':
                return (
                    `${finding.sourceFile} declares ${SHELL_ROUTES_FIELD} as \`${finding.expression}\`, which this check cannot read. ` +
                    `Declare it as an inline array literal (or a same-file const array literal) so every route can be checked against ${finding.gameDir}'s route tree.`
                );
        }
    });

    return [
        `${findings.length} shell-route problem(s):`,
        ...lines.map((line) => `  - ${line}`),
    ].join('\n');
}

// ─── Real-filesystem helpers (used by the workspace arm of the guard) ─────────

/** Workspace-relative `apps/<game>` directories. */
export async function listGameDirs(workspaceRoot: string): Promise<readonly string[]> {
    const entries = await readdir(path.join(workspaceRoot, 'apps'), { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
        .map((entry) => `apps/${entry.name}`)
        .sort();
}

/** One directory entry, as little of a `Dirent` as the two walks below need. */
export interface DirectoryEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/**
 * How a walk reads a directory. Injectable so which NAMES each walk accepts is
 * measurable against a synthetic tree — see the `listRoutePathsUnder` and
 * `listGameSourceFiles` describes in the sibling test.
 */
export type ReadDirectory = (dir: string) => Promise<readonly DirectoryEntry[]>;

const readWorkspaceDirectory: ReadDirectory = async (dir) =>
    (await readdir(dir, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
    }));

/** Depth-first file walk, skipping the build/vendor directories nothing declares in. */
async function walkFiles(
    root: string,
    readDirectory: ReadDirectory,
    visit: (filePath: string, name: string) => void,
): Promise<void> {
    const walk = async (dir: string): Promise<void> => {
        for (const entry of await readDirectory(dir)) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory) {
                if (!SKIPPED_DIRECTORIES.has(entry.name)) {
                    await walk(entryPath);
                }
                continue;
            }
            visit(entryPath, entry.name);
        }
    };

    await walk(root);
}

/**
 * Workspace-relative TypeScript sources under one game, tests excluded: a test
 * fixture declaring a route is describing a scenario, not shipping a page.
 */
export async function listGameSourceFiles(
    gameAbsoluteDir: string,
    readDirectory: ReadDirectory = readWorkspaceDirectory,
): Promise<readonly string[]> {
    const workspaceRoot = path.resolve(gameAbsoluteDir, '../..');
    const files: string[] = [];

    await walkFiles(gameAbsoluteDir, readDirectory, (entryPath, name) => {
        if (!/\.(?:ts|tsx)$/u.test(name) || /\.test\.tsx?$/u.test(name)) {
            return;
        }
        files.push(path.relative(workspaceRoot, entryPath).split(path.sep).join('/'));
    });

    return files.sort();
}

/** Every route path a Next `app/` tree serves, derived from its `page.*` files. */
export async function listRoutePathsUnder(
    appDir: string,
    readDirectory: ReadDirectory = readWorkspaceDirectory,
): Promise<readonly string[]> {
    const routes: string[] = [];

    await walkFiles(appDir, readDirectory, (entryPath, name) => {
        if (!PAGE_EXTENSIONS.some((extension) => name === `page.${extension}`)) {
            return;
        }
        routes.push(
            routePathForPageFile(path.relative(appDir, entryPath).split(path.sep).join('/')),
        );
    });

    return routes.sort();
}

// ─── AST helpers ─────────────────────────────────────────────────────────────

function propertyNameIsShellRoutes(name: Node): boolean {
    if (isIdentifier(name)) {
        return name.text === SHELL_ROUTES_FIELD;
    }
    if (isStringLiteral(name) || isNoSubstitutionTemplateLiteral(name)) {
        return name.text === SHELL_ROUTES_FIELD;
    }
    return false;
}

/**
 * The route strings an initializer yields, or `null` when it cannot be read
 * statically. `as const` / `satisfies` wrappers are unwrapped; a bare identifier
 * is followed to a same-file variable declaration exactly once (no chains — a
 * chain is a shape to declare more simply, not one to resolve harder).
 */
function readRouteArray(initializer: Expression, source: SourceFile): readonly string[] | null {
    const expression = unwrapAssertions(initializer);

    if (isArrayLiteralExpression(expression)) {
        const routes: string[] = [];
        for (const element of expression.elements) {
            const unwrapped = unwrapAssertions(element);
            if (isStringLiteral(unwrapped) || isNoSubstitutionTemplateLiteral(unwrapped)) {
                routes.push(unwrapped.text);
                continue;
            }
            return null;
        }
        return routes;
    }

    if (isIdentifier(expression)) {
        const declared = findVariableInitializer(source, expression.text);
        if (declared === undefined) {
            return null;
        }
        const unwrapped = unwrapAssertions(declared);
        return isArrayLiteralExpression(unwrapped) ? readRouteArray(unwrapped, source) : null;
    }

    return null;
}

function unwrapAssertions(expression: Expression): Expression {
    let current = expression;
    while (isAsExpression(current) || isSatisfiesExpression(current)) {
        current = current.expression;
    }
    return current;
}

function findVariableInitializer(source: SourceFile, name: string): Expression | undefined {
    let found: Expression | undefined;

    const visit = (node: Node): void => {
        if (
            found === undefined &&
            isVariableDeclaration(node) &&
            isIdentifier(node.name) &&
            node.name.text === name &&
            node.initializer !== undefined
        ) {
            found = node.initializer;
        }
        forEachChild(node, visit);
    };
    forEachChild(source, visit);

    return found;
}
