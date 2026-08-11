// renderer/__tests__/logsBridgeReadCensus.ts
//
// Predicates behind the log-bridge read census (§4.27, Invariant #67). Under
// the roots `listCensusRoots` names, no production module narrows the preload
// bridge to its log namespace inline, by casting the global and reading that
// property off it. Inside the engine renderer package the way to the namespace
// is `readRendererLogsApi()`, and the two sites allowed to skip the accessor
// are listed below.
//
// It lives here because this package owns the bridge and that accessor, but the
// trees it walks are wider: a game app and a scaffold template each hold code
// that ships in the same renderer bundle under the same preload bridge.
// `listCensusRoots` names all three kinds of root.
//
// Split out of the test that consumes it so each predicate — root list, file
// filter, match pattern, allowance classifier — is a named function pinnable
// against synthetic inputs.
//
// It parses rather than greps. A grep cannot tell the read apart from the same
// text in a comment or a type position, and it cannot follow the split form —
// cast the global into a local, narrow the local one statement later — which is
// exactly what the one sanctioned exception below is written as. Missing that
// form would make the allowance list decorative. What the parse does and does
// not reach is the case list in `logs-bridge-read-shape.test.ts`.

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Assembled at runtime rather than written as literals, per the source-scan
// guard convention in the TDD skill's green-confirmation checklist.
const BRIDGE_GLOBAL = `__${'chimera'}`;
const LOGS_NAMESPACE = `lo${'gs'}`;

/** One inline narrowing of the preload bridge to its log namespace. */
export interface LogsBridgeRead {
    /** Repo-relative POSIX path of the module holding the read. */
    readonly file: string;
    /** 1-based line of the narrowing access. */
    readonly line: number;
    /**
     * The name `isAllowedSite` pairs with `file`, or `null` when the construct
     * holding the read has none — see `enclosingFunctionName`.
     */
    readonly enclosingFunction: string | null;
}

export interface CensusSourceFile {
    readonly file: string;
    readonly source: string;
}

interface AllowedSite {
    readonly file: string;
    readonly enclosingFunction: string;
}

/**
 * The two functions permitted to narrow the bridge inline. Both sit in the
 * engine renderer package; under every other root the allowance is empty.
 *
 * `readRendererLogsApi` is the accessor every other module in this package
 * calls. `LoggingBootstrap.resolveLogsApi` is a permanent exception rather than
 * a migration item: it reads `window` behind a `typeof window` guard (the
 * static-export prerender has no window), validates that both `emit` and
 * `readRecent` are present, and returns `LogsAPI | null` — a contract
 * `readRendererLogsApi`, which returns an unvalidated emitter or `undefined`,
 * does not offer.
 *
 * A game app and a scaffold template get no counterpart entry. `renderer/logging/`
 * sits behind none of the eight public barrels, so Invariant #96 puts the
 * accessor itself out of a game surface's reach; what carries a game's report to
 * the log file instead is `console.warn` / `console.error`, which
 * `installRendererLogger` patches and forwards over the bridge.
 */
const ALLOWED_SITES: readonly AllowedSite[] = [
    { file: 'renderer/logging/rendererLogger.ts', enclosingFunction: 'readRendererLogsApi' },
    { file: 'renderer/app/LoggingBootstrap.tsx', enclosingFunction: 'resolveLogsApi' },
];

/** Directory names whose contents are build output or vendored code, never source. */
const NON_SOURCE_DIRECTORIES = new Set(['node_modules', 'out', 'dist', 'build', '.next']);

/**
 * Path segments that mark a module as test scaffolding rather than production
 * code. `e2e` covers a Playwright suite whole — its specs read the bridge
 * through the browser on purpose, and so may the page objects beside them.
 */
const TEST_DIRECTORIES = new Set(['__tests__', '__test-support__', 'e2e']);

/** The engine renderer package, which is a root on its own. */
const ENGINE_RENDERER_ROOT = 'renderer';

/**
 * Directories under which each game app and each scaffold template sits: every
 * child directory of one is a census root, build output and vendored code aside.
 *
 * A game app is walked because part of it — the renderer composition root, the
 * screens, the components, the shell contributions — ships in the same renderer
 * bundle under the same preload bridge. It is walked WHOLE rather than by that
 * list of surfaces: the allowance is empty everywhere under the app, so no
 * subdirectory carries a policy of its own, and a directory list would have to
 * track a consumer's own layout to stay true. A template is walked for a
 * different reason: it is copied into a repository where this census does not
 * run, so its own tree is read here instead.
 */
const ROOT_PARENTS = ['apps', 'tools/create-chimera-game/templates'] as const;

/** Whether `relPath` sits under a census root — the start anchor of the filter. */
function isUnderCensusRoot(relPath: string): boolean {
    if (relPath.startsWith(`${ENGINE_RENDERER_ROOT}/`)) return true;

    return ROOT_PARENTS.some((parent) => {
        if (!relPath.startsWith(`${parent}/`)) return false;
        // A root is a CHILD of the parent, so a path that stops at the parent's
        // own level names no app and no template and is under neither.
        return relPath.slice(parent.length + 1).includes('/');
    });
}

/**
 * Whether `relPath` (repo-relative, POSIX) is a production module the census
 * reads.
 *
 * Declaration files are excluded because the bridge's own `Window`
 * augmentation lives in one, and tests because installing and reading the
 * bridge is what a test of it does.
 */
export function isProductionCensusSource(relPath: string): boolean {
    if (!isUnderCensusRoot(relPath)) return false;
    if (!relPath.endsWith('.ts') && !relPath.endsWith('.tsx')) return false;
    if (relPath.endsWith('.d.ts')) return false;
    if (relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')) return false;

    const segments = relPath.split('/');
    return !segments.some(
        (segment) => TEST_DIRECTORIES.has(segment) || NON_SOURCE_DIRECTORIES.has(segment),
    );
}

/** Whether a read sits at one of the two sanctioned sites. */
export function isAllowedSite(read: LogsBridgeRead): boolean {
    return ALLOWED_SITES.some(
        (site) => site.file === read.file && site.enclosingFunction === read.enclosingFunction,
    );
}

/**
 * The trees the census walks, repo-relative: the engine renderer package, then
 * each root parent's child directories in name order.
 *
 * Read off disk rather than listed, so an app or a template added later is
 * covered without this module changing.
 */
export function listCensusRoots(repoRoot: string): string[] {
    return [
        ENGINE_RENDERER_ROOT,
        ...ROOT_PARENTS.flatMap((parent) =>
            readdirSync(resolve(repoRoot, parent), { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && !NON_SOURCE_DIRECTORIES.has(entry.name))
                .map((entry) => `${parent}/${entry.name}`)
                .sort(),
        ),
    ];
}

/**
 * The `.ts`/`.tsx` files the walk reaches under `listCensusRoots`, repo-relative
 * and sorted. It does not descend into `NON_SOURCE_DIRECTORIES`.
 *
 * Returns test and declaration files too: the filter above is what drops them,
 * so handing it what the walk reaches is what makes the filter observable at
 * the real tree.
 */
export function listCensusSourceFiles(repoRoot: string): string[] {
    const found: string[] = [];

    const walk = (relDir: string): void => {
        for (const entry of readdirSync(resolve(repoRoot, relDir), { withFileTypes: true })) {
            const relPath = `${relDir}/${entry.name}`;
            if (entry.isDirectory()) {
                if (!NON_SOURCE_DIRECTORIES.has(entry.name)) walk(relPath);
            } else if (
                entry.isFile() &&
                (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
            ) {
                found.push(relPath);
            }
        }
    };

    for (const root of listCensusRoots(repoRoot)) walk(root);
    return found.sort();
}

/** The inline bridge narrowings matched in the production modules of `files`. */
export function censusLogsBridgeReads(files: readonly CensusSourceFile[]): LogsBridgeRead[] {
    return files
        .filter(({ file }) => isProductionCensusSource(file))
        .flatMap(({ file, source }) => scanLogsBridgeReads(file, source));
}

/** The inline bridge narrowings matched in one module's source, in source order. */
export function scanLogsBridgeReads(relPath: string, source: string): LogsBridgeRead[] {
    const sourceFile = ts.createSourceFile(
        relPath,
        source,
        ts.ScriptTarget.Latest,
        // Parent pointers: `enclosingFunctionName` walks upwards from the match.
        true,
        relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const scope = collectAliases(sourceFile);
    const reads: LogsBridgeRead[] = [];

    const record = (node: ts.Node): void => {
        reads.push({
            file: relPath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            enclosingFunction: enclosingFunctionName(node),
        });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            if (
                accessedName(node) === LOGS_NAMESPACE &&
                reachesBridge(node.expression, scope, new Set())
            ) {
                record(node);
            }
        } else if (
            ts.isBindingElement(node) &&
            boundName(node) === LOGS_NAMESPACE &&
            bindingSourceReachesBridge(node, scope)
        ) {
            record(node);
        }

        ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return reads;
}

// ── predicate internals ────────────────────────────────────────────────────────

/** What a local name in the file can be traced back to. */
interface AliasScope {
    /** The expressions bound to a plain identifier, keyed by that name. */
    readonly initialisers: Map<string, ts.Expression[]>;
    /** Locals a destructuring declaration bound straight to the bridge. */
    readonly bridgeLocals: Set<string>;
}

/**
 * The local names of a file, traced far enough to see the split form.
 *
 * Keyed by NAME, not by scope: the split cast-then-narrow form assigns the
 * bridge to a local one statement before narrowing it, and following that hop
 * is what makes the form visible at all. A shadowed name in another function
 * therefore over-matches rather than under-matches — the safe direction for a
 * guard, which fails loudly and is corrected by naming the local something else.
 *
 * Which constructs bind a local, and what each one has to hold for the hop to
 * be followed, is the case list in `logs-bridge-read-shape.test.ts`.
 */
function collectAliases(sourceFile: ts.SourceFile): AliasScope {
    const initialisers = new Map<string, ts.Expression[]>();
    const bridgeLocals = new Set<string>();

    const bind = (name: string, expression: ts.Expression): void => {
        const existing = initialisers.get(name);
        if (existing === undefined) initialisers.set(name, [expression]);
        else existing.push(expression);
    };

    const visit = (node: ts.Node): void => {
        // A parameter's default is a declaration initialiser in every sense
        // that matters here. The assignment arm covers the `let` spelling
        // `prefer-const` leaves alone: assigned inside a branch, the
        // declaration cannot become a `const`.
        if (
            (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
            ts.isIdentifier(node.name) &&
            node.initializer
        ) {
            bind(node.name.text, node.initializer);
        } else if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(node.left)
        ) {
            bind(node.left.text, node.right);
        }
        // A destructured bridge has no initialiser naming it, so the binding is
        // the only record that the local holds one — and under a renamed
        // binding the local's own name says nothing either.
        if (
            ts.isBindingElement(node) &&
            boundName(node) === BRIDGE_GLOBAL &&
            ts.isIdentifier(node.name)
        ) {
            bridgeLocals.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return { initialisers, bridgeLocals };
}

/** The property name a member access reads, for both dotted and string-keyed forms. */
function accessedName(
    node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | null {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    // `.text` is the unquoted value, so both quote styles and a
    // no-substitution template collapse to the same name here.
    return ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
}

/** The property a binding element pulls out, shorthand and renamed alike. */
function boundName(element: ts.BindingElement): string | null {
    if (element.propertyName !== undefined) {
        if (ts.isIdentifier(element.propertyName)) return element.propertyName.text;
        return ts.isStringLiteralLike(element.propertyName) ? element.propertyName.text : null;
    }
    return ts.isIdentifier(element.name) ? element.name.text : null;
}

/** Whether what a binding element destructures traces back to the bridge. */
function bindingSourceReachesBridge(element: ts.BindingElement, scope: AliasScope): boolean {
    const owner = element.parent.parent;

    if (ts.isVariableDeclaration(owner) || ts.isParameter(owner)) {
        return (
            owner.initializer !== undefined && reachesBridge(owner.initializer, scope, new Set())
        );
    }
    // A nested pattern, where the namespace is pulled straight out of a
    // destructured bridge. The bridge is never a member access there, so the
    // outer element's own name is the only place it appears.
    return ts.isBindingElement(owner) && boundName(owner) === BRIDGE_GLOBAL;
}

/**
 * Strip wrappers that stand between an expression and the value it yields.
 *
 * Which ones are stripped is the `follows the local alias through %s` case list
 * in `logs-bridge-read-shape.test.ts`.
 */
function unwrap(expression: ts.Expression): ts.Expression {
    let current = expression;
    for (;;) {
        if (
            ts.isParenthesizedExpression(current) ||
            ts.isAsExpression(current) ||
            ts.isSatisfiesExpression(current) ||
            ts.isNonNullExpression(current) ||
            ts.isTypeAssertionExpression(current)
        ) {
            current = current.expression;
            continue;
        }
        // `(0, chimera)` — a comma sequence yields its last operand.
        if (
            ts.isBinaryExpression(current) &&
            current.operatorToken.kind === ts.SyntaxKind.CommaToken
        ) {
            current = current.right;
            continue;
        }
        return current;
    }
}

/** Whether `expression` is one the scan traces back to the preload bridge. */
function reachesBridge(expression: ts.Expression, scope: AliasScope, seen: Set<string>): boolean {
    const target = unwrap(expression);

    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
        return accessedName(target) === BRIDGE_GLOBAL;
    }

    if (ts.isIdentifier(target)) {
        if (target.text === BRIDGE_GLOBAL || scope.bridgeLocals.has(target.text)) return true;
        if (seen.has(target.text)) return false;
        seen.add(target.text);
        return (scope.initialisers.get(target.text) ?? []).some((initialiser) =>
            reachesBridge(initialiser, scope, seen),
        );
    }

    return false;
}

/**
 * The name the allowance pair would have to carry for `node`, or `null`.
 *
 * `null` whenever the read sits somewhere the pair cannot name — module scope,
 * an anonymous callback, a constructor, a class static block, a class body.
 * Attributing such a read to whatever function it happens to sit inside is how
 * a read buried in an allowed function inherits that function's allowance.
 * `null` is refused by `isAllowedSite`, because every entry there names a
 * function.
 *
 * Which forms yield which name is the case list in
 * `logs-bridge-read-shape.test.ts`.
 */
function enclosingFunctionName(node: ts.Node): string | null {
    for (let current = node.parent; current !== undefined; current = current.parent) {
        if (ts.isFunctionDeclaration(current)) {
            return current.name?.text ?? null;
        }

        if (
            ts.isMethodDeclaration(current) ||
            ts.isGetAccessorDeclaration(current) ||
            ts.isSetAccessorDeclaration(current)
        ) {
            return ts.isIdentifier(current.name) ? current.name.text : null;
        }

        if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
            return declaredNameOf(current);
        }

        // A class body reached before any of the above means the read sits in a
        // constructor, a static block, or a property initialiser — none of
        // which the pair can name. Stopping at the class covers all three,
        // since none of them exists outside one.
        if (ts.isClassLike(current)) {
            return null;
        }
    }

    return null;
}

/** The name an anonymous function is bound to, so `const f = () => …` reads as `f`. */
function declaredNameOf(fn: ts.FunctionExpression | ts.ArrowFunction): string | null {
    const parent = fn.parent;

    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
    }
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
    }
    return ts.isFunctionExpression(fn) ? (fn.name?.text ?? null) : null;
}
