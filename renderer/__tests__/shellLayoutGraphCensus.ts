// renderer/__tests__/shellLayoutGraphCensus.ts
//
// The static-graph walk behind the shell-layout WebGL census (§4.10, §4.37).
//
// `renderer/app/layout.tsx` is the root layout every consumer app re-exports
// (`@chimera-engine/renderer/shell/layout`), so the chunk webpack builds for it
// is loaded on EVERY route — the boot screen and the logo screen included.
// `three` must not be in it: a game that never opens a 3D surface, and a route
// that shows no scene at all, would otherwise pay for it on first paint.
//
// The walk follows three classes of specifier — relative, the
// `@chimera-engine/renderer/*` subpaths a consumer names, and the
// `chimera-game-registration` alias — and stops at every other bare one,
// REPORTING it. So what the walk covers is a measurement its callers assert
// (`ShellLayoutGraph.unfollowed`), not a property claimed here.
//
// Split out of the test that consumes it so every predicate below is a named
// function pinnable against synthetic inputs.
//
// It parses rather than greps, and the distinction is the whole guard:
//
//   * `import type { Texture } from 'three'` and a named list whose every
//     binding carries the inline `type` modifier are ERASED by tsc
//     (`verbatimModuleSyntax: false`), so they put nothing in any chunk. A grep
//     for the specifier cannot tell them from the value form.
//   * `await import('three')` is a chunk BOUNDARY, not an edge into this one —
//     it is the shape `loadGltf` and `loadTexture` already use. A grep counts it
//     as a hit.
//   * a specifier inside a comment or a string is neither.
//
// What the walk does and does not reach is the case list in
// `shell-layout-graph-census.test.ts`.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * The packages whose presence in the layout chunk this census refuses.
 *
 * `three` is the payload. `@react-three/*` is on the list because it exists to
 * pull `three` in — a static edge to the fiber reconciler puts the renderer
 * core in the same chunk just as surely as naming `three` does.
 *
 * Assembled at runtime rather than written as literals, per the source-scan
 * guard convention in the TDD skill's green-confirmation checklist.
 */
const THREE_PACKAGE = `thr${'ee'}`;
const REACT_THREE_SCOPE = `@react-${'three'}`;

/** Repo-relative POSIX path of a module, plus the specifier it names. */
export interface StaticValueEdge {
    /** The module specifier exactly as written. */
    readonly specifier: string;
    /** 1-based line of the import/export declaration. */
    readonly line: number;
}

/** One refused edge, as the census reports it. */
export interface WebglStaticEdge {
    /** Repo-relative POSIX path of the module holding the edge. */
    readonly file: string;
    readonly specifier: string;
    readonly line: number;
}

/**
 * True for a specifier that resolves into `three`'s runtime — the package
 * itself, any of its subpaths, and the `@react-three/*` bindings that re-export
 * it.
 *
 * Prefix-matched on a path SEGMENT boundary, never on a bare `startsWith`:
 * a package literally named `three-way-merge` shares the first five characters
 * and ships no WebGL at all.
 */
export function isWebglRuntimeSpecifier(specifier: string): boolean {
    return (
        specifier === THREE_PACKAGE ||
        specifier.startsWith(`${THREE_PACKAGE}/`) ||
        specifier.startsWith(`${REACT_THREE_SCOPE}/`)
    );
}

/**
 * True for a specifier a bundler resolves to a stylesheet rather than a module.
 *
 * A stylesheet carries no edge onward, so a RELATIVE one is dropped instead of
 * reported unresolved; a bare one is still reported, because a package sits
 * behind it.
 */
export function isStyleSheetSpecifier(specifier: string): boolean {
    return specifier.endsWith('.css');
}

function namedBindingsCarryAValue(
    namedBindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined,
): boolean {
    if (namedBindings === undefined) {
        return false;
    }
    if (ts.isNamespaceImport(namedBindings) || ts.isNamespaceExport(namedBindings)) {
        return true;
    }
    // A list is a value edge as soon as ONE binding is not inline-`type`. An
    // empty list is not: `import {} from 'x'` is elided with the rest.
    return namedBindings.elements.some((element) => !element.isTypeOnly);
}

/**
 * Every STATIC edge of `source` that survives type erasure, in source order.
 *
 * Static is the operative word: a dynamic `import()` is a call expression, not
 * an `ImportDeclaration`, so it never appears here — which is exactly what makes
 * the fix this census pins (moving `TextureLoader` behind `await import`) show
 * up as the edge disappearing.
 */
export function listStaticValueEdges(fileName: string, source: string): readonly StaticValueEdge[] {
    const sourceFile = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const edges: StaticValueEdge[] = [];
    const record = (moduleSpecifier: ts.Expression): void => {
        if (!ts.isStringLiteral(moduleSpecifier)) {
            return;
        }
        edges.push({
            specifier: moduleSpecifier.text,
            line:
                sourceFile.getLineAndCharacterOfPosition(moduleSpecifier.getStart(sourceFile))
                    .line + 1,
        });
    };

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const clause = statement.importClause;
            // No clause at all is a side-effect import — `import './x.css'` —
            // and tsc keeps it.
            if (clause === undefined) {
                record(statement.moduleSpecifier);
                continue;
            }
            if (clause.isTypeOnly) {
                continue;
            }
            if (clause.name !== undefined || namedBindingsCarryAValue(clause.namedBindings)) {
                record(statement.moduleSpecifier);
            }
            continue;
        }

        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
            if (statement.isTypeOnly) {
                continue;
            }
            // `export * from './x'` has no clause and re-exports the module's
            // values, so it is an edge.
            if (
                statement.exportClause === undefined ||
                namedBindingsCarryAValue(statement.exportClause)
            ) {
                record(statement.moduleSpecifier);
            }
        }
    }

    return edges;
}

/** The two reads the walk needs, injectable so the synthetic arm drives it. */
export interface GraphFileSystem {
    readonly isFile: (absolutePath: string) => boolean;
    readonly readFile: (absolutePath: string) => string;
}

export const nodeGraphFileSystem: GraphFileSystem = {
    isFile: (absolutePath) => existsSync(absolutePath) && statSync(absolutePath).isFile(),
    readFile: (absolutePath) => readFileSync(absolutePath, 'utf8'),
};

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/**
 * Resolves a RELATIVE specifier onto a file on disk, the way the bundler does.
 *
 * The `.js` suffix is stripped before the extension probe because this package
 * writes NodeNext-style specifiers (`'../assets/criticalAssetPreload.js'`)
 * against `.ts` sources.
 *
 * Returns `null` for a bare specifier — the walk stops at a package boundary
 * and classifies the specifier instead of following it.
 */
export function resolveRelativeEdge(
    specifier: string,
    fromFile: string,
    fileSystem: GraphFileSystem,
): string | null {
    if (!specifier.startsWith('.')) {
        return null;
    }

    const base = resolve(dirname(fromFile), specifier).replace(/\.js$/, '');
    // A specifier that already carries a MODULE extension resolves as written.
    // One naming a non-module file does not, and the exclusion is the point: a
    // stylesheet handed to the parser below is the wrong grammar read as
    // TypeScript, which yields no edges and puts a file that is not a module in
    // the walked set.
    if (
        MODULE_EXTENSIONS.some((extension) => base.endsWith(extension)) &&
        fileSystem.isFile(base)
    ) {
        return base;
    }
    for (const extension of MODULE_EXTENSIONS) {
        const candidate = `${base}${extension}`;
        if (fileSystem.isFile(candidate)) {
            return candidate;
        }
    }
    for (const extension of MODULE_EXTENSIONS) {
        const candidate = resolve(base, `index${extension}`);
        if (fileSystem.isFile(candidate)) {
            return candidate;
        }
    }
    return null;
}

export interface ShellLayoutGraph {
    /** Repo-relative POSIX paths of every module the walk visited, sorted. */
    readonly files: readonly string[];
    /** Every visited static value edge into the WebGL runtime, sorted by file. */
    readonly webglEdges: readonly WebglStaticEdge[];
    /**
     * Relative specifiers that resolved to nothing, excluding stylesheets.
     *
     * Reported rather than dropped: a resolver that silently loses an edge
     * SHRINKS the graph, and a shrunken graph passes the census for the wrong
     * reason.
     */
    readonly unresolved: readonly WebglStaticEdge[];
    /**
     * Bare specifiers the walk stopped at, de-duplicated and sorted — the
     * package boundaries of this graph.
     *
     * Reported for the same reason as {@link unresolved}, and it is the half
     * that matters more: a bare specifier a bundler ALIASES back onto in-repo
     * source (`chimera-game-registration`) or resolves through a package
     * `exports` map onto this repo's own modules (`@chimera-engine/renderer/*`)
     * carries the walk onward, and one dropped in silence would shrink the
     * graph by everything behind it. A caller asserting this set exactly is
     * what turns each stop into a deliberate one.
     */
    readonly unfollowed: readonly string[];
}

/**
 * Follows a BARE specifier, or declines it.
 *
 * Returns an absolute path when the specifier resolves back into this repo's
 * source — through a bundler alias or a package `exports` map — and `null`
 * when the walk should stop there and report the boundary.
 */
export type ResolveBareEdge = (specifier: string) => string | null;

export interface WalkOptions {
    readonly fileSystem?: GraphFileSystem;
    readonly resolveBare?: ResolveBareEdge;
}

/**
 * Walks every static value edge reachable from `entryFile`, following relative
 * specifiers and handing bare ones to `resolveBare`.
 *
 * Without a `resolveBare`, every bare specifier is a boundary and lands in
 * `unfollowed`; the walk then covers the relative graph only.
 *
 * `repoRoot` only shapes the reported paths; the walk itself is absolute.
 */
export function walkStaticValueGraph(
    entryFile: string,
    repoRoot: string,
    options: WalkOptions = {},
): ShellLayoutGraph {
    const fileSystem = options.fileSystem ?? nodeGraphFileSystem;
    const resolveBare = options.resolveBare;
    const toRepoPath = (absolutePath: string): string =>
        relative(repoRoot, absolutePath).split('\\').join('/');

    const seen = new Set<string>([entryFile]);
    const queue: string[] = [entryFile];
    const webglEdges: WebglStaticEdge[] = [];
    const unresolved: WebglStaticEdge[] = [];
    const unfollowed = new Set<string>();

    const visit = (resolved: string): void => {
        if (!seen.has(resolved)) {
            seen.add(resolved);
            queue.push(resolved);
        }
    };

    // Breadth-first over a growing array: the array iterator re-reads `length`
    // on every step, so a module discovered inside the body is visited by this
    // same loop. `seen` is what terminates it on a cycle.
    for (const file of queue) {
        for (const edge of listStaticValueEdges(file, fileSystem.readFile(file))) {
            const at = { file: toRepoPath(file), specifier: edge.specifier, line: edge.line };

            if (isWebglRuntimeSpecifier(edge.specifier)) {
                webglEdges.push(at);
                continue;
            }
            if (!edge.specifier.startsWith('.')) {
                const followed = resolveBare?.(edge.specifier) ?? null;
                if (followed === null) {
                    unfollowed.add(edge.specifier);
                } else {
                    visit(followed);
                }
                continue;
            }

            const resolved = resolveRelativeEdge(edge.specifier, file, fileSystem);
            if (resolved === null) {
                // The one edge dropped without a record. A relative stylesheet
                // resolves to no module and carries none onward, so nothing is
                // hidden behind it — unlike a bare specifier, which is reported
                // even when it names a stylesheet.
                if (!isStyleSheetSpecifier(edge.specifier)) {
                    unresolved.push(at);
                }
                continue;
            }
            visit(resolved);
        }
    }

    const byFile = (left: WebglStaticEdge, right: WebglStaticEdge): number =>
        left.file.localeCompare(right.file) || left.line - right.line;

    return {
        files: [...seen].map(toRepoPath).sort((left, right) => left.localeCompare(right)),
        webglEdges: [...webglEdges].sort(byFile),
        unresolved: [...unresolved].sort(byFile),
        unfollowed: [...unfollowed].sort((left, right) => left.localeCompare(right)),
    };
}

/**
 * The engine renderer package's own name — the specifier prefix a consumer app
 * uses for every engine module it re-exports.
 */
export const RENDERER_PACKAGE = `@chimera-${'engine'}/renderer`;

/**
 * The synthetic specifier the game-agnostic shell imports for its side effect,
 * and which each consumer app's Next config aliases onto that app's renderer
 * composition root. It resolves to no package on disk, so a walk that does not
 * follow it stops at `GameRegistrationBootstrap` and never sees the app half of
 * the layout chunk.
 */
export const GAME_REGISTRATION_SPECIFIER = `chimera-game-${'registration'}`;

/**
 * `{ "./game": { types: "./dist/game/index.d.ts", default: "./dist/game/index.js" }, … }`,
 * as published.
 *
 * `types` is named even though nothing here reads it: a conditional entry that
 * publishes types and no runtime target is a real shape, and an entry type
 * carrying only an optional `default` would be a WEAK type that such an entry
 * cannot be assigned to at all.
 */
export type PackageExports = Record<
    string,
    { readonly types?: string; readonly default?: string } | string
>;

function readPackageExports(repoRoot: string, fileSystem: GraphFileSystem): PackageExports {
    const manifest = JSON.parse(
        fileSystem.readFile(resolve(repoRoot, 'renderer/package.json')),
    ) as { readonly exports?: PackageExports };
    return manifest.exports ?? {};
}

/**
 * The published target a subpath resolves to, honouring one `*` pattern key.
 *
 * Exact keys win over patterns, which is Node's own precedence and is what
 * keeps `./game` off a `./game/*` entry if one is ever added.
 */
export function publishedTargetForSubpath(
    exportsMap: PackageExports,
    subpath: string,
): string | null {
    const targetOf = (entry: PackageExports[string]): string | null =>
        typeof entry === 'string' ? entry : (entry.default ?? null);

    const exact = exportsMap[subpath];
    if (exact !== undefined) {
        return targetOf(exact);
    }

    for (const [key, entry] of Object.entries(exportsMap)) {
        const star = key.indexOf('*');
        if (star === -1) {
            continue;
        }
        const prefix = key.slice(0, star);
        const suffix = key.slice(star + 1);
        if (
            !subpath.startsWith(prefix) ||
            !subpath.endsWith(suffix) ||
            // Strictly greater: a star that expands to nothing names no module,
            // so `./shell/` is not a match for `./shell/*`.
            subpath.length <= prefix.length + suffix.length
        ) {
            continue;
        }
        const target = targetOf(entry);
        if (target === null) {
            continue;
        }
        return target.replace('*', subpath.slice(prefix.length, subpath.length - suffix.length));
    }
    return null;
}

/**
 * The repo-relative SOURCE module a published `./dist/<stem>.js` target is
 * built from.
 *
 * The census walks source, and the package publishes `dist`. Mapping back is
 * the same step `next-alias-exports-agreement.test.ts` performs for its own
 * comparison, and it is exact rather than heuristic: `tsc -p
 * renderer/tsconfig.build.json` emits `dist/<stem>.js` from `renderer/<stem>`
 * and nothing else.
 */
export function sourceForDistTarget(
    distTarget: string,
    fileSystem: GraphFileSystem,
    repoRoot: string,
): string | null {
    const stem = distTarget.replace(/^\.\/dist\//, '').replace(/\.js$/, '');
    for (const extension of MODULE_EXTENSIONS) {
        const candidate = resolve(repoRoot, `renderer/${stem}${extension}`);
        if (fileSystem.isFile(candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * The `exports` subpath `specifier` names in the engine renderer package, or
 * `null` when it names a different package.
 *
 * Its own function because the two ends of the segment anchor are only visible
 * HERE: a package named `@chimera-engine/renderer-extras` shares every character
 * of the prefix, and the subpath a prefix-only match would build for it
 * (`.-extras/…`) resolves to nothing, so the resolver's ANSWER is `null` either
 * way and the anchor is unobservable downstream.
 */
export function enginePackageSubpath(specifier: string): string | null {
    if (specifier === RENDERER_PACKAGE) {
        return '.';
    }
    return specifier.startsWith(`${RENDERER_PACKAGE}/`)
        ? `.${specifier.slice(RENDERER_PACKAGE.length)}`
        : null;
}

export interface ConsumerResolverOptions {
    readonly repoRoot: string;
    /** Repo-relative POSIX path of the app's Next host, e.g. `apps/action/renderer`. */
    readonly appRendererDir: string;
    readonly fileSystem?: GraphFileSystem;
}

/**
 * The bare-specifier resolver for a CONSUMER app's layout graph.
 *
 * Two classes of bare specifier lead back into this repo's own source, and both
 * carry modules into the layout chunk:
 *
 *   * `@chimera-engine/renderer/<subpath>` — every engine module an app route or
 *     composition root names, resolved through the package's published
 *     `exports` map and mapped from `dist` back to source.
 *   * `chimera-game-registration` — the alias each app's Next config points at
 *     its own `renderer/register.ts`.
 *
 * Everything else is a real package boundary and is declined, so the walk
 * reports it in `unfollowed` rather than crossing into `node_modules`.
 */
export function createConsumerBareResolver(options: ConsumerResolverOptions): ResolveBareEdge {
    const fileSystem = options.fileSystem ?? nodeGraphFileSystem;
    const exportsMap = readPackageExports(options.repoRoot, fileSystem);

    return (specifier) => {
        if (specifier === GAME_REGISTRATION_SPECIFIER) {
            const base = resolve(options.repoRoot, options.appRendererDir, 'register');
            for (const extension of MODULE_EXTENSIONS) {
                const candidate = `${base}${extension}`;
                if (fileSystem.isFile(candidate)) {
                    return candidate;
                }
            }
            return null;
        }

        const subpath = enginePackageSubpath(specifier);
        if (subpath === null) {
            return null;
        }
        const target = publishedTargetForSubpath(exportsMap, subpath);
        return target === null ? null : sourceForDistTarget(target, fileSystem, options.repoRoot);
    };
}
