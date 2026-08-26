// renderer/shell/__tests__/routeClassificationCensus.ts
//
// Predicates behind the route-classification census (§4.37.18). Across
// `renderer/`, exactly ONE production module turns a pathname into a
// `ShellSurface`: `ShellStateBridge`. Everything else — the background mount,
// the snapshot navigation gate, a game's own page — reads the answer off the
// shell-state store.
//
// A second derivation would agree with the first by review rather than by
// construction, and the surface a background mounts on and the surface a
// navigation gate admits have to be the same answer. This census is what keeps
// there being one.
//
// What counts as classifying is the VERB list below: the helpers in
// `shellRoutes.ts` that consume a pathname. Reading `ShellSurface` (a type) or
// `SHELL_BACKGROUND_SURFACES` (a set of already-classified surfaces) is
// deliberately NOT classification — by the time anything consults those, the
// pathname is gone.
//
// The WRITER question is a different one, and not implied by the first: a
// module that called `setShellRoute` with a literal surface would import no
// vocabulary verb at all and pass the classifier census. So the store's route
// and transition writers get their own importer sets, and §4.37.18's "written
// by enumerated engine sites only" is held by both together rather than by
// either alone.
//
// It parses rather than greps: a grep cannot tell an import from the same word
// in a comment, in a JSDoc `{@link}`, or in a string, and every one of those
// spellings appears in this package. Split out of the test that consumes it so
// each predicate is a named function pinnable against synthetic inputs.

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * The workspace root, which every path in this module is relative to. Derived
 * from this file's own location rather than from the CWD: vitest runs from the
 * repo root for a single-file run and from the package directory under
 * `pnpm -r test`, and a relative walk root would silently find nothing in one
 * of them. (The same trap `renderer/audio/__tests__/audioGraph.ts` pins with
 * esbuild's `absWorkingDir`.)
 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The pathname-consuming helpers `shellRoutes.ts` exports. Importing any of
 * them is what this census counts as classifying a route.
 *
 * Assembled from parts rather than written as literals, per the source-scan
 * guard convention in the TDD skill's green-confirmation checklist: this file
 * is itself under a root the walk covers in the synthetic arm, and a literal
 * here would make the census find itself.
 */
export const CLASSIFICATION_VERBS: readonly string[] = [
    `classify${'ShellSurface'}`,
    `normalize${'RoutePath'}`,
    `isEngine${'OwnedRoute'}`,
    `matchesDeclared${'ShellRoute'}`,
    `ENGINE_ROUTE${'_SURFACES'}`,
    `ENGINE_OWNED${'_ROUTES'}`,
];

/** The module those verbs live in, as the tail of an import specifier. */
const ROUTE_VOCABULARY_MODULE = `shell${'Routes'}`;

/** The shell-state store module, as the tail of an import specifier. */
const SHELL_STATE_MODULE = `shell${'StateStore'}`;

/**
 * The store writer that publishes the classified route. One caller by contract:
 * a second would be a second answer to "what surface is this", reached without
 * touching the vocabulary the census above counts.
 */
export const ROUTE_WRITERS: readonly string[] = [`setShell${'Route'}`];

/**
 * The store writers behind the match-entry transition. Their callers are the
 * enumerated match-entry flows — the snapshot gate and the shared entry verbs —
 * and nothing else; a game reaches neither.
 */
export const TRANSITION_WRITERS: readonly string[] = [
    `armShell${'Transition'}`,
    `clearShell${'Transition'}`,
];

/** The one module allowed to import them, as a repo-relative POSIX path. */
export const SOLE_CLASSIFIER = 'renderer/components/shell/ShellStateBridge.tsx';

/** The modules allowed to arm or clear the transition. */
export const TRANSITION_WRITER_SITES: readonly string[] = [
    'renderer/app/GameStoreBootstrap.tsx',
    'renderer/shell/matchEntryVerbs.ts',
];

/**
 * The modules that DEFINE these names. Each names its own exports, so neither is
 * a consumer; excluding them is not an allowance.
 */
export const ROUTE_VOCABULARY_FILE = `renderer/shell/${ROUTE_VOCABULARY_MODULE}.ts`;
export const SHELL_STATE_FILE = `renderer/shell/${SHELL_STATE_MODULE}.ts`;

/** Directory names whose contents are build output or vendored code, never source. */
const NON_SOURCE_DIRECTORIES = new Set(['node_modules', 'out', 'dist', 'build', '.next']);

/** Path segments that mark a module as test scaffolding rather than production code. */
const TEST_DIRECTORIES = new Set(['__tests__', '__test-support__', 'fixtures']);

/** One directory entry, as the walk needs it. Injectable so a synthetic tree can drive it. */
export interface CensusDirectoryEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/**
 * Reads one directory, named by a REPO-RELATIVE path. The production reader is
 * `readCensusDirectory` below; a fixture reader lets the walk be driven over a
 * hand-written tree.
 */
export type ReadCensusDirectory = (path: string) => readonly CensusDirectoryEntry[];

export const readCensusDirectory: ReadCensusDirectory = (path) =>
    readdirSync(resolve(REPO_ROOT, path), { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
    }));

/** Whether a file name is a production TypeScript module (not a test, not a declaration). */
export function isCensusSourceFile(name: string): boolean {
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return false;
    if (name.endsWith('.d.ts')) return false;
    return !/\.test\.tsx?$/u.test(name);
}

/**
 * Every production module under `root`, repo-relative and POSIX-separated.
 * Build output, vendored code and test scaffolding are skipped by DIRECTORY, so
 * a helper beside a test is skipped for the same reason the test is.
 */
export function listCensusFiles(
    root: string,
    readDirectory: ReadCensusDirectory = readCensusDirectory,
): readonly string[] {
    const files: string[] = [];

    const walk = (directory: string): void => {
        for (const entry of readDirectory(directory)) {
            if (entry.isDirectory) {
                if (NON_SOURCE_DIRECTORIES.has(entry.name) || TEST_DIRECTORIES.has(entry.name)) {
                    continue;
                }
                walk(`${directory}/${entry.name}`);
                continue;
            }
            if (isCensusSourceFile(entry.name)) {
                files.push(`${directory}/${entry.name}`);
            }
        }
    };

    walk(root);
    return files.sort();
}

/** Whether a specifier names `moduleName`, in any of its spellings. */
export function namesModule(specifier: string, moduleName: string): boolean {
    const withoutExtension = specifier.replace(/\.(?:ts|tsx|js|jsx)$/u, '');
    return withoutExtension === moduleName || withoutExtension.endsWith(`/${moduleName}`);
}

/** Whether a specifier names the route-vocabulary module. */
export function namesRouteVocabulary(specifier: string): boolean {
    return namesModule(specifier, ROUTE_VOCABULARY_MODULE);
}

/** Whether a specifier names the shell-state store module. */
export function namesShellStateStore(specifier: string): boolean {
    return namesModule(specifier, SHELL_STATE_MODULE);
}

/** One import of a named verb from a named module. */
export interface VerbImport {
    readonly file: string;
    readonly verb: string;
}

function importedNames(
    clause: ts.NamedImportBindings | undefined,
    verbs: readonly string[],
): readonly string[] {
    if (clause === undefined || !ts.isNamedImports(clause)) {
        // A namespace import (`import * as routes`) names no member here, so the
        // member check below cannot see through it. Reported as EVERY verb, so a
        // namespace reach is a census failure rather than a blind spot.
        return clause === undefined ? [] : verbs;
    }
    return clause.elements.map((element) => (element.propertyName ?? element.name).text);
}

function exportedNames(
    clause: ts.NamedExportBindings | undefined,
    verbs: readonly string[],
): readonly string[] {
    if (clause === undefined) return verbs; // `export * from` re-exports everything.
    if (!ts.isNamedExports(clause)) return verbs;
    return clause.elements.map((element) => (element.propertyName ?? element.name).text);
}

/**
 * Every one of `verbs` that `source` imports (or re-exports) from the module
 * `namesTarget` accepts. Four specifier positions carry the same weight —
 * `import`, `import type`, `export … from` and dynamic `import()` — because
 * each one lands the verb in the module's graph.
 *
 * A dynamic `import()` names no members at all, so it is reported as EVERY
 * verb: a lazy reach for the module is a call site whether or not the
 * destructuring is statically visible.
 */
export function findVerbImports(
    file: string,
    source: string,
    namesTarget: (specifier: string) => boolean,
    verbs: readonly string[],
): readonly VerbImport[] {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const found: VerbImport[] = [];

    const record = (names: readonly string[]): void => {
        for (const name of names) {
            if (verbs.includes(name)) {
                found.push({ file, verb: name });
            }
        }
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            if (namesTarget(node.moduleSpecifier.text)) {
                record(importedNames(node.importClause?.namedBindings, verbs));
            }
        } else if (
            ts.isExportDeclaration(node) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            if (namesTarget(node.moduleSpecifier.text)) {
                record(exportedNames(node.exportClause, verbs));
            }
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] !== undefined &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            if (namesTarget(node.arguments[0].text)) {
                record(verbs);
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(parsed);
    return found;
}

/** The classifier arm: pathname-consuming helpers reached from the vocabulary. */
export function findClassificationImports(file: string, source: string): readonly VerbImport[] {
    return findVerbImports(file, source, namesRouteVocabulary, CLASSIFICATION_VERBS);
}

/** The writer arm: store writers reached from the shell-state store. */
export function findShellStateWriterImports(
    file: string,
    source: string,
    verbs: readonly string[],
): readonly VerbImport[] {
    return findVerbImports(file, source, namesShellStateStore, verbs);
}
