/**
 * electron/__tests__/no-esbuild-dependency.test.ts
 *
 * `@chimera-engine/electron` owns the Electron bundle PLAN
 * (`build-main/bundle-plan.ts`) but must never name `esbuild`. The plan INJECTS
 * the bundler — `EsbuildBundleOptions` is a hand-written structural interface —
 * so moving the plan into the engine changed nothing about the published
 * dependency surface.
 *
 * That neutrality is fragile in a way no other gate catches. `verify:publish`'s
 * depcheck scans the emitted runtime `.js` and correctly ignores type-only
 * imports, because they erase. So the obvious tidy-up —
 *
 *     -export interface EsbuildBundleOptions { … }
 *     +import type { BuildOptions } from 'esbuild';
 *
 * — compiles, emits no `esbuild` specifier, and passes depcheck, publint,
 * `pnpm pack` and every unit suite. This package declares `esbuild` in no
 * dependency section, which the last case here measures.
 *
 * Both halves are needed and neither subsumes the other: the SOURCE scan is the
 * only thing that sees a type-only import, and the ARTIFACT scan is the only
 * thing that sees a specifier reaching the emitted bytes by some route the AST
 * walk below does not model.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Build output and installed deps — generated trees, not this package's source. */
const SKIP_DIRS = new Set(['node_modules', 'dist']);

const FORBIDDEN = /^esbuild(\/|$)/;

/** Every checked-in `.ts` under `dir`, package-relative. */
function walkSources(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) files.push(...walkSources(path.join(dir, entry.name)));
            continue;
        }
        if (entry.name.endsWith('.ts')) {
            files.push(path.relative(PACKAGE_DIR, path.join(dir, entry.name)));
        }
    }
    return files;
}

/**
 * Every module specifier `source` names, in any position a bundler or a
 * type-checker would follow: a static `import`/`export … from`, a bare
 * side-effect `import '…'`, a dynamic `import('…')`, and a `require('…')` (the
 * shape an emitted CJS build would carry).
 *
 * `import type` is INCLUDED on purpose — it is the whole point of this guard.
 * The AST is what makes that possible, in both directions: the type-only
 * modifier is a node property, and a specifier is not a comment. A text scan
 * gets both wrong — this very file says `esbuild` a dozen times and imports it
 * never, and so does the bundle plan's own doc comment, which is what the
 * emitted `.js` carries verbatim.
 */
function moduleSpecifiers(fileName: string, source: string): string[] {
    const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteralLike(node.moduleSpecifier)
        ) {
            found.push(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node)) {
            const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const isRequireCall =
                ts.isIdentifier(node.expression) && node.expression.text === 'require';
            const arg = node.arguments[0];
            if (
                (isImportCall || isRequireCall) &&
                arg !== undefined &&
                ts.isStringLiteralLike(arg)
            ) {
                found.push(arg.text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(parsed);
    return found;
}

/** The forbidden specifiers `source` names, prefixed with `label` for reporting. */
function esbuildSpecifiers(label: string, source: string): string[] {
    return moduleSpecifiers(label, source)
        .filter((specifier) => FORBIDDEN.test(specifier))
        .map((specifier) => `${label}: ${specifier}`);
}

describe('the engine package names no esbuild specifier', () => {
    // The negative control comes FIRST: this suite would otherwise be green on
    // the day the detector stopped detecting, and green is its normal state.
    it.each([
        ['static value import', `import { buildSync } from 'esbuild';`],
        [
            'TYPE-ONLY import — the erasing form no .js scan can see',
            `import type { BuildOptions } from 'esbuild';`,
        ],
        ['type-only named binding', `import { type BuildOptions } from 'esbuild';`],
        ['namespace import', `import * as esbuild from 'esbuild';`],
        ['side-effect import', `import 'esbuild';`],
        ['re-export', `export { buildSync } from 'esbuild';`],
        ['dynamic import', `const m = await import('esbuild');`],
        ['CJS require, the shape an emitted build carries', `const b = require('esbuild');`],
        ['a subpath, not just the bare name', `import x from 'esbuild/lib/main';`],
    ])('the detector rejects a %s', (_label, code) => {
        expect(esbuildSpecifiers('probe.ts', code)).not.toEqual([]);
    });

    it('the detector does NOT fire on prose or on an unrelated specifier', () => {
        // This file is itself the proof that a text scan cannot do this job: it
        // says "esbuild" a dozen times and imports it never — and so does the
        // bundle plan's doc comment, which tsc copies straight into the dist.
        const code = [
            `// esbuild is injected, never imported — see EsbuildBundleOptions.`,
            `import path from 'node:path';`,
            `const label = 'esbuild';`,
            `import { x } from 'esbuild-register-lookalike';`,
        ].join('\n');
        expect(esbuildSpecifiers('probe.ts', code)).toEqual([]);
    });

    it('no source file under electron/ imports esbuild in any position', () => {
        const files = walkSources(PACKAGE_DIR);
        // Floor, STRUCTURAL rather than magnitude: `electron/` holds hundreds of
        // sources, so a walk narrowed to one subtree clears any count generous
        // enough to survive a refactor — and the subtree that matters is the one
        // a `BuildOptions` import would land in. Name it instead.
        for (const governed of ['build-main/bundle-plan.ts', 'main/index.ts', 'preload/api.ts']) {
            expect(files, `the walk no longer reaches ${governed}`).toContain(governed);
        }

        const offenders = files.flatMap((file) =>
            esbuildSpecifiers(file, readFileSync(path.join(PACKAGE_DIR, file), 'utf8')),
        );
        expect(
            offenders,
            'esbuild is a devDependency of the engine REPO and of nothing that ships. A published ' +
                'module naming it — including through `import type`, which erases before ' +
                "verify:publish's depcheck looks — breaks every adopter's install. The bundle plan " +
                'declares its own structural EsbuildBundleOptions for exactly this reason.',
        ).toEqual([]);
    });

    it('names it nowhere in the emitted build-main dist either', () => {
        // The artifact half: whatever route a specifier took, this is the file an
        // adopter actually installs.
        const distDir = path.join(PACKAGE_DIR, 'dist/build-main');
        expect(
            existsSync(distDir),
            'electron/dist/build-main is missing — build the package first (`pnpm build:packages`)',
        ).toBe(true);

        const emitted = readdirSync(distDir).filter((name) => name.endsWith('.js'));
        expect(emitted.length).toBeGreaterThan(0);
        const offenders = emitted.flatMap((name) =>
            esbuildSpecifiers(name, readFileSync(path.join(distDir, name), 'utf8')),
        );
        expect(offenders).toEqual([]);
    });

    it('declares esbuild in no dependency section of its manifest', () => {
        const manifest = JSON.parse(
            readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'),
        ) as Record<string, unknown>;
        for (const section of [
            'dependencies',
            'devDependencies',
            'optionalDependencies',
            'peerDependencies',
        ]) {
            const names = Object.keys(manifest[section] ?? {});
            expect(names, `${section}`).not.toContain('esbuild');
        }
    });
});
