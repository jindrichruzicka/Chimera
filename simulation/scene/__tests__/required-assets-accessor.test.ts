/**
 * simulation/scene/__tests__/required-assets-accessor.test.ts
 *
 * Census of the production call sites of `SceneRegistry`'s required-asset
 * accessor (§4.10, §4.18, Invariant #52).
 *
 * The accessor and `markRequiredAssetsCritical` on the renderer side were both
 * shipped with no production caller at all, which is how a whole preload arm
 * could sit in the tree, pass its own unit tests and never execute a load. What
 * makes an accessor reachable is a module that CALLS it, so the census asserts
 * the calling set exactly — see `EXPECTED_CALLERS`. A lower bound would let a
 * second, undocumented caller appear without a word.
 *
 * The census walks every source package rather than this one. The accessor is
 * exported through `@chimera-engine/simulation/scene`, so a call could be
 * written from the main process (where the registry is constructed), from a
 * game app, or from a scaffold template that ships into somebody else's
 * repository — and none of those trees would be read by a package-scoped walk.
 * Which trees exactly is `listCensusRoots`.
 *
 * It parses rather than greps. `requiredAssets` is also a `SceneDescriptor`
 * FIELD, spelled identically at every declaration site and in the validate
 * -assets source that scans for it; only the AST tells a call apart from a
 * field read, an object-literal key, or the same text inside a comment or a
 * string. What the parse does and does not reach is the synthetic case list
 * below.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
// simulation/scene/__tests__ -> repo root is three levels up.
const REPO_ROOT = resolve(__dirname, '../../../');

/**
 * The accessor's name, assembled at runtime so this module never becomes its
 * own match — the census reads the repository it lives in.
 */
const ACCESSOR = `required${'Assets'}`;

/**
 * The production modules allowed to call the accessor.
 *
 * `SceneManager` is the one: it reads the target scene's declaration in
 * `engine:scene_prepare` and puts it on the pending transition.
 */
const EXPECTED_CALLERS: readonly string[] = ['simulation/scene/SceneManager.ts'];

/** Directory names holding build output, vendored code or test artifacts. */
const NON_SOURCE_DIRECTORIES = new Set([
    'node_modules',
    'dist',
    'out',
    'build',
    '.next',
    'coverage',
    'test-results',
]);

/** Path segments marking a module as test scaffolding rather than production code. */
const TEST_DIRECTORIES = new Set(['__tests__', '__test-support__', 'e2e']);

/**
 * The trees the census walks: every top-level directory of the repository that
 * is not build output, vendored code or a dot-directory.
 *
 * Read off disk rather than listed, so a package added later is covered
 * without this module changing.
 */
function listCensusRoots(repoRoot: string): string[] {
    return readdirSync(repoRoot, { withFileTypes: true })
        .filter(
            (entry) =>
                entry.isDirectory() &&
                !entry.name.startsWith('.') &&
                !NON_SOURCE_DIRECTORIES.has(entry.name),
        )
        .map((entry) => entry.name)
        .sort();
}

/**
 * Whether `relPath` (repo-relative, POSIX) is a production module the census
 * reads. Declaration files are excluded because they carry no call, and tests
 * because calling the accessor is what a test of it does.
 */
function isProductionCensusSource(relPath: string): boolean {
    if (!relPath.endsWith('.ts') && !relPath.endsWith('.tsx')) return false;
    if (relPath.endsWith('.d.ts')) return false;
    if (relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')) return false;

    const segments = relPath.split('/');
    return !segments.some(
        (segment) => TEST_DIRECTORIES.has(segment) || NON_SOURCE_DIRECTORIES.has(segment),
    );
}

/**
 * The `.ts`/`.tsx` files the walk reaches under `listCensusRoots`,
 * repo-relative and sorted.
 *
 * Returns test and declaration files too: the filter above is what drops them,
 * so handing it what the walk reaches is what makes the filter observable at
 * the real tree.
 */
function listCensusSourceFiles(repoRoot: string): string[] {
    const found: string[] = [];

    const walk = (relDir: string): void => {
        for (const entry of readdirSync(resolve(repoRoot, relDir), { withFileTypes: true })) {
            const relPath = `${relDir}/${entry.name}`;
            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.') && !NON_SOURCE_DIRECTORIES.has(entry.name)) {
                    walk(relPath);
                }
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

/** Strip the parentheses around a callee: `(registry.f)(x)` calls `f` too. */
function unwrapParentheses(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    return current;
}

/**
 * The property name a call goes through, or `null` when the callee is not a
 * property access.
 *
 * A method on a class is only ever reached off an instance, so a bare
 * `requiredAssets(...)` identifier call is some other function and no match. A
 * private-name access (`this.#requiredAssets()`) is a different member in a
 * different namespace and is excluded for the same reason.
 */
function calleePropertyName(callee: ts.Expression): string | null {
    const expression = unwrapParentheses(callee);
    if (ts.isPropertyAccessExpression(expression)) {
        return ts.isIdentifier(expression.name) ? expression.name.text : null;
    }
    if (ts.isElementAccessExpression(expression)) {
        const argument = expression.argumentExpression;
        return ts.isStringLiteralLike(argument) ? argument.text : null;
    }
    return null;
}

/** The 1-based lines of `source` where the accessor is CALLED, in source order. */
function scanAccessorCalls(relPath: string, source: string): number[] {
    const sourceFile = ts.createSourceFile(
        relPath,
        source,
        ts.ScriptTarget.Latest,
        true,
        relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const lines: number[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && calleePropertyName(node.expression) === ACCESSOR) {
            lines.push(
                sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            );
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return lines;
}

/** The production modules of the repository that call the accessor, sorted. */
function censusAccessorCallers(repoRoot: string): string[] {
    return listCensusSourceFiles(repoRoot)
        .filter(isProductionCensusSource)
        .filter(
            (relPath) =>
                scanAccessorCalls(relPath, readFileSync(resolve(repoRoot, relPath), 'utf8'))
                    .length > 0,
        );
}

describe('accessor-call scan', () => {
    it('matches a call through an instance, a private field and a string index', () => {
        const source = [
            `const a = registry.${ACCESSOR}(id);`,
            `const b = this.#registry.${ACCESSOR}(id);`,
            `const c = registry['${ACCESSOR}'](id);`,
            `const d = (registry.${ACCESSOR})(id);`,
            `const e = registry?.${ACCESSOR}(id);`,
        ].join('\n');

        expect(scanAccessorCalls('probe.ts', source)).toEqual([1, 2, 3, 4, 5]);
    });

    it('does not match the descriptor field, an object key, a type, a comment or a string', () => {
        const source = [
            `const declared = descriptor.${ACCESSOR};`,
            `const scene = { ${ACCESSOR}: [] };`,
            `interface D { readonly ${ACCESSOR}: readonly string[] }`,
            `// registry.${ACCESSOR}(id)`,
            `const name = '${ACCESSOR}';`,
            `isPropertyName(node, '${ACCESSOR}');`,
            `function ${ACCESSOR}(id) { return []; }`,
            `const local = ${ACCESSOR}(id);`,
            `const other = this.#${ACCESSOR}(id);`,
        ].join('\n');

        expect(scanAccessorCalls('probe.ts', source)).toEqual([]);
    });

    it('parses TSX by its own syntax rather than as TypeScript', () => {
        // `<Cover />` is a type assertion in a `.ts` parse and an element in a
        // `.tsx` one, so a file scanned under the wrong ScriptKind can fail to
        // parse and silently report nothing.
        const source = `const view = <Cover refs={registry.${ACCESSOR}(id)} />;`;

        expect(scanAccessorCalls('probe.tsx', source)).toEqual([1]);
    });
});

describe('census file filter', () => {
    it('accepts a production module and rejects every non-production form', () => {
        expect(isProductionCensusSource('simulation/scene/SceneManager.ts')).toBe(true);
        expect(isProductionCensusSource('renderer/components/scene/SceneRouter.tsx')).toBe(true);

        expect(isProductionCensusSource('simulation/scene/SceneManager.test.ts')).toBe(false);
        expect(isProductionCensusSource('renderer/components/scene/SceneRouter.test.tsx')).toBe(
            false,
        );
        expect(isProductionCensusSource('simulation/scene/__tests__/census.ts')).toBe(false);
        expect(isProductionCensusSource('simulation/engine/__test-support__/stubs.ts')).toBe(false);
        expect(isProductionCensusSource('apps/tactics/e2e/pages/ScenePage.ts')).toBe(false);
        expect(isProductionCensusSource('simulation/dist/scene/SceneRegistry.d.ts')).toBe(false);
        expect(isProductionCensusSource('simulation/dist/scene/SceneRegistry.js')).toBe(false);
        expect(isProductionCensusSource('docs/architecture-overview.md')).toBe(false);

        // Reaches the build-output segment check and nothing before it: a plain
        // `.ts` under `dist` clears the extension, `.d.ts` and `.test.ts`
        // anchors, so this is the only fixture that conjunct decides.
        expect(isProductionCensusSource('apps/tactics/dist/electron/main.ts')).toBe(false);
    });
});

describe('census walk', () => {
    it('roots cover every source package and no build output', () => {
        const roots = listCensusRoots(REPO_ROOT);

        expect(roots).toEqual(expect.arrayContaining(['simulation', 'electron', 'renderer']));
        expect(roots).toEqual(expect.arrayContaining(['ai', 'networking', 'apps', 'tools']));
        expect(roots).not.toContain('node_modules');
    });

    it('reaches modules under every root the accessor could be called from', () => {
        const files = listCensusSourceFiles(REPO_ROOT);

        // Positive control per root: a zero census is only evidence when the
        // walk is known to arrive. Each of these is a real module that exists
        // at this tree, so a root silently dropped from the walk reds here
        // rather than passing as "no callers found".
        expect(files).toContain('simulation/scene/SceneManager.ts');
        expect(files).toContain('electron/main/runtime/SceneActionWiring.ts');
        expect(files).toContain('renderer/assets/AssetPreloader.ts');
        expect(files).toContain('apps/tactics/renderer/register.ts');
        expect(files).toContain('tools/create-chimera-game/templates/blank/renderer/register.ts');
        expect(files).toContain('ai/engine/AIBrain.ts');
        expect(files).toContain('networking/provider/MultiplayerProvider.ts');

        // A `.tsx` control, separately: a React component is the likeliest
        // second caller of a preload accessor, and dropping the extension from
        // the walk leaves the exact-set guard reporting one caller while seeing
        // no component at all.
        expect(files).toContain('renderer/components/scene/SceneRouter.tsx');

        // The walk returns tests too — the filter is what drops them.
        expect(files).toContain('simulation/scene/SceneRegistry.test.ts');
        expect(files.filter(isProductionCensusSource)).not.toContain(
            'simulation/scene/SceneRegistry.test.ts',
        );
    });
});

describe('required-asset accessor call sites', () => {
    it('is called from exactly one production module in the repository', () => {
        expect(censusAccessorCallers(REPO_ROOT)).toEqual(EXPECTED_CALLERS);
    });
});
