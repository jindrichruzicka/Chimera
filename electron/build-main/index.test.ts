/**
 * electron/build-main/index.test.ts
 *
 * Pins the exported NAME SET of `@chimera-engine/electron/build-main`.
 *
 * `package-exports-contract.test.ts` pins the subpath — that the key exists and
 * resolves — but nothing pins what comes out of it, and a dropped `export`
 * inside this barrel is invisible to every other check: `tsc` sees a consistent
 * program (nothing in this repo imports every symbol), the drivers re-export
 * only what they use, and `verify:pack` resolves the module rather than reading
 * it. A published surface can therefore shrink silently between releases.
 *
 * It also props up a ratchet that would otherwise narrow with it:
 * `tools/packaged-build-flag.test.ts` derives "no driver may declare a name the
 * engine barrel exports" FROM this list, so a name dropped here stops being
 * guarded there — the two failures cancel, and both go green.
 *
 * Names are read from the source rather than imported, because half of them are
 * types and erase at runtime; a `Object.keys(await import(…))` check would pin
 * only the value half and call it the surface.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const BARREL = path.join(import.meta.dirname, 'index.ts');
const PLAN = path.join(import.meta.dirname, 'bundle-plan.ts');

/** The public surface, spelled out. An addition here is a deliberate edit. */
const EXPECTED_EXPORTS = [
    'AliasOptions',
    'AppBundlePlanOverrides',
    'BuildAppBundlesDeps',
    'BuildFn',
    'BundleLabel',
    'BundleOutfiles',
    'BundleSpec',
    'EsbuildBundleOptions',
    'PACKAGED_BUILD_ENV',
    'PlanBundlesOptions',
    'PlannedBundleLabel',
    'VERIFY_PACK_NODE_MODULES_ENV',
    'appBundleOutfiles',
    'buildAppBundles',
    'computeEsbuildAlias',
    'computeNodePaths',
    'computePackagedDefine',
    'createEsbuildBuild',
    'esbuildBundleOptions',
    'isPackagedBuild',
    'planBundles',
    'resolveDevDebugPreloadEntry',
    'resolveInstalledDebugPreloadEntry',
] as const;

function parse(file: string): ts.SourceFile {
    return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** Names an `export { … }` clause forwards. */
function reexportedNames(file: string): string[] {
    const names: string[] = [];
    const visit = (node: ts.Node): void => {
        if (
            ts.isExportDeclaration(node) &&
            node.exportClause !== undefined &&
            ts.isNamedExports(node.exportClause)
        ) {
            for (const element of node.exportClause.elements) names.push(element.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(parse(file));
    return names;
}

/** Names a module declares with an `export` modifier of its own. */
function declaredExports(file: string): Set<string> {
    const names = new Set<string>();
    for (const statement of parse(file).statements) {
        const exported =
            ts.canHaveModifiers(statement) &&
            ts
                .getModifiers(statement)
                ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
        if (!exported) continue;
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
            }
            continue;
        }
        if (
            (ts.isFunctionDeclaration(statement) ||
                ts.isClassDeclaration(statement) ||
                ts.isInterfaceDeclaration(statement) ||
                ts.isTypeAliasDeclaration(statement) ||
                ts.isEnumDeclaration(statement)) &&
            statement.name !== undefined
        ) {
            names.add(statement.name.text);
        }
    }
    return names;
}

describe('@chimera-engine/electron/build-main barrel', () => {
    it('exports exactly the pinned name set', () => {
        expect([...reexportedNames(BARREL)].sort()).toEqual([...EXPECTED_EXPORTS].sort());
    });

    it('forwards no name the plan does not export (a barrel cannot invent surface)', () => {
        const declared = declaredExports(PLAN);
        // Floor: a parse that found nothing would make the filter below empty.
        expect(declared.size).toBeGreaterThanOrEqual(EXPECTED_EXPORTS.length);
        expect(reexportedNames(BARREL).filter((name) => !declared.has(name))).toEqual([]);
    });

    it('re-exports every symbol the plan makes public, so nothing is stranded', () => {
        // The other direction: a helper exported from `bundle-plan.ts` but absent
        // from the barrel is unreachable by any consumer, which is either a
        // forgotten line here or an `export` that should not be there.
        const missing = [...declaredExports(PLAN)].filter(
            (name) => !reexportedNames(BARREL).includes(name),
        );
        expect(missing).toEqual([]);
    });
});
