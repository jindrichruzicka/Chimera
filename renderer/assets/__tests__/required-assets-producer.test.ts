/**
 * renderer/assets/__tests__/required-assets-producer.test.ts
 *
 * Census of the modules that import `markRequiredAssetsCritical`.
 *
 * The helper promotes a scene's declared `requiredAssets` to `critical` in a
 * copy of the manifest, and two production surfaces call it: the scene preload
 * run (a transition into a scene) and the route-entry gate (a route entered on
 * an already-committed scene, reading the same refs off the snapshot). This
 * asserts the EXACT importer set, in both directions:
 *
 *   - the set shrinking means the arm lost its producer again, silently;
 *   - the set growing means a second surface promotes refs into a manager whose
 *     lifetime it may not own (Invariant #21), which is a review question, not
 *     something to discover from a cache that emptied mid-match.
 *
 * A `count > 0` control would be half a pin — it reads only the first
 * direction.
 *
 * The scan is over SOURCE, not over a bundle: the reverse-direction question
 * ("who imports this?") is not one an entry-point bundle answers, and a
 * type-only import erases before any bundler sees it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Assembled at runtime, following the convention the sibling censuses use. */
const PROBED_NAME = `markRequiredAssets${'Critical'}`;

const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
    'node_modules',
    'dist',
    'out',
    'build',
    '.next',
    'test-results',
    'playwright-report',
]);

/**
 * The source roots, read off disk rather than listed, so a package added later
 * is covered without this module changing — the same reason the sibling census
 * in `simulation/scene/__tests__/` reads its own.
 */
function scanRoots(): readonly string[] {
    return readdirSync(REPO_ROOT, { withFileTypes: true })
        .filter(
            (item) =>
                item.isDirectory() &&
                !SKIP_DIRECTORIES.has(item.name) &&
                !item.name.startsWith('.'),
        )
        .map((item) => item.name)
        .sort();
}

/**
 * Which files the walk reads — `.ts`/`.tsx` that are not themselves a spec.
 *
 * Over-inclusive by design: test-support and fixture modules are read too. An
 * extra module can only ADD an importer to the census, never hide one, and the
 * two control cases below are what keep the walk honest.
 */
function isScannedSource(path: string): boolean {
    if (!path.endsWith('.ts') && !path.endsWith('.tsx')) {
        return false;
    }
    return !/\.(?:test|spec)\.tsx?$/u.test(path);
}

function walk(directory: string, found: string[]): void {
    for (const name of readdirSync(directory)) {
        if (SKIP_DIRECTORIES.has(name)) {
            continue;
        }
        const path = join(directory, name);
        if (statSync(path).isDirectory()) {
            walk(path, found);
            continue;
        }
        if (isScannedSource(path)) {
            found.push(path);
        }
    }
}

/**
 * Whether `source` imports `name` from anywhere.
 *
 * Read off the AST, not with a regex: the identifier also occurs in prose, in
 * its own declaration, and at call sites, and only the IMPORT position answers
 * "which modules depend on this". An `as` rename is matched on the imported
 * name, which is the one that identifies the binding.
 */
function importsName(source: string, name: string): boolean {
    const parsed = ts.createSourceFile('module.ts', source, ts.ScriptTarget.ESNext, true);

    for (const statement of parsed.statements) {
        if (!ts.isImportDeclaration(statement)) {
            continue;
        }
        const bindings = statement.importClause?.namedBindings;
        if (bindings === undefined || !ts.isNamedImports(bindings)) {
            continue;
        }
        for (const element of bindings.elements) {
            if ((element.propertyName ?? element.name).text === name) {
                return true;
            }
        }
    }

    return false;
}

function importersOf(name: string): readonly string[] {
    const files: string[] = [];
    for (const root of scanRoots()) {
        walk(resolve(REPO_ROOT, root), files);
    }

    return files
        .filter((path) => importsName(readFileSync(path, 'utf8'), name))
        .map((path) => relative(REPO_ROOT, path).split(sep).join('/'))
        .sort();
}

// ─── The scanner ──────────────────────────────────────────────────────────────

describe('importsName', () => {
    it('matches a named import', () => {
        expect(importsName(`import { alpha } from './x.js';`, 'alpha')).toBe(true);
    });

    it('matches on the IMPORTED name of a renamed import, not the local one', () => {
        expect(importsName(`import { alpha as beta } from './x.js';`, 'alpha')).toBe(true);
        expect(importsName(`import { alpha as beta } from './x.js';`, 'beta')).toBe(false);
    });

    it('matches a type-only import, which erases before any bundler sees it', () => {
        expect(importsName(`import type { alpha } from './x.js';`, 'alpha')).toBe(true);
    });

    it('matches one name among several, across lines', () => {
        expect(importsName(`import {\n    gamma,\n    alpha,\n} from './x.js';`, 'alpha')).toBe(
            true,
        );
    });

    it('does not match a call site, a declaration, or a comment', () => {
        expect(importsName(`export function alpha(): void {}\nalpha();`, 'alpha')).toBe(false);
        expect(importsName(`// alpha is the helper\nconst x = 1;`, 'alpha')).toBe(false);
    });

    it('does not match a namespace import that could reach the name', () => {
        // A deliberate limit, stated rather than left to be discovered: a
        // namespace import does not name its members, so the census cannot see
        // `ns.alpha`. Nothing in the repo reaches the helper that way, and this
        // case is what would have to change if something did.
        expect(importsName(`import * as ns from './x.js';`, 'alpha')).toBe(false);
    });

    it('does not match a same-named import from an unrelated module by accident', () => {
        // Positive control for the predicate being about the NAME: a different
        // name in the same position does not match.
        expect(importsName(`import { alphaOther } from './x.js';`, 'alpha')).toBe(false);
    });
});

// ─── The census ───────────────────────────────────────────────────────────────

describe('markRequiredAssetsCritical importers', () => {
    it('is imported by the two preload runs and nothing else', () => {
        // Both entries promote into a manager they were HANDED, never one they
        // built: the scene run borrows the match manager for a transition, and
        // the route gate warms the manager its route is about to hand to
        // `GameShell`, the unique disposer of it (Invariant #21).
        expect(importersOf(PROBED_NAME)).toEqual([
            'renderer/assets/criticalAssetPreload.ts',
            'renderer/components/scene/scenePreload.ts',
        ]);
    });

    it('scans a tree that actually contains the declaring module', () => {
        // Positive control for the walk: if the roots or the skip list stopped
        // reaching `renderer/assets`, the census above would read as "nothing
        // imports it" — which is indistinguishable from the regression it is
        // there to catch.
        const files: string[] = [];
        for (const root of scanRoots()) {
            walk(resolve(REPO_ROOT, root), files);
        }
        const scanned = files.map((path) => relative(REPO_ROOT, path).split(sep).join('/'));

        expect(scanned).toContain('renderer/assets/AssetPreloader.ts');
        expect(scanned).toContain('renderer/components/scene/scenePreload.ts');
        expect(scanned).not.toContain('renderer/components/scene/scenePreload.test.ts');
    });
});
