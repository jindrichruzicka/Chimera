/**
 * renderer/__tests__/eslint-import-boundary.test.ts
 *
 * ESLint smoke test for the module-import boundary that keeps `@chimera-engine/renderer`
 * depending on `@chimera-engine/simulation` contracts only (Invariant #1, issue #772).
 *
 * Runs ESLint programmatically against fixtures and asserts the
 * `no-restricted-imports` rule fires on a forbidden sibling-runtime import
 * (`@chimera-engine/ai`) but not on the allowed `@chimera-engine/simulation` contract import.
 * This proves the boundary is enforced by the linter, not merely by convention —
 * the AC for issue #772:
 *   "Import-boundary ESLint rule for @chimera-engine/renderer is wired and fails on a
 *    forbidden cross-boundary import."
 *
 * Mirrors `networking/__tests__/eslint-import-boundary.test.ts` (#768).
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESLINT_FIXTURE_TIMEOUT_MS = 20_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../');
const fixturesDir = resolve(__dirname, 'fixtures');

interface ESLintMessage {
    ruleId: string | null;
    severity: number;
    message: string;
    line: number;
}

interface _ESLintResult {
    filePath: string;
    messages: ESLintMessage[];
    errorCount: number;
    warningCount: number;
}

function runEslint(fixtureName: string): ESLintMessage[] {
    const fixturePath = resolve(fixturesDir, fixtureName);
    const eslintBin = resolve(repoRoot, 'node_modules/.bin/eslint');
    // `--no-ignore` is required: the fixtures dir is in eslint.config.mjs `ignores`
    // so it never breaks the project lint run, but the smoke test lints it directly.
    const result = spawnSync(eslintBin, ['--no-ignore', '--format', 'json', fixturePath], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    if (result.error) {
        throw result.error;
    }

    const output = result.stdout.trim();
    if (!output) {
        return [];
    }

    const parsed = JSON.parse(output) as _ESLintResult[];
    return parsed[0]?.messages ?? [];
}

describe('ESLint import-boundary — @chimera-engine/renderer depends on @chimera-engine/simulation contracts only (Invariant #1)', () => {
    it(
        'flags a sibling-runtime import (@chimera-engine/ai) from renderer/ with no-restricted-imports',
        () => {
            const messages = runEslint('bad-cross-boundary-import.fixture.ts');
            const ruleIds = messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);
            expect(ruleIds).toContain('no-restricted-imports');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );

    it(
        'does not flag the allowed @chimera-engine/simulation contract import from renderer/',
        () => {
            const messages = runEslint('good-contract-import.fixture.ts');
            const ruleIds = messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);
            expect(ruleIds).not.toContain('no-restricted-imports');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );
});

// ─── simulation/settings: a test-file-only allowance ─────────────────────────
// The §3 boundary table grants renderer/ `simulation/settings` for "cross-boundary
// compatibility guards" in test files. This guard reads "test file" as a
// `*.test.ts(x)` file or a `__test-support__` double one of them uses — both are
// test-only code that never ships. No ESLint zone expresses that split — the
// renderer `no-restricted-imports` patterns name ai/networking/apps and would let
// a production import through — so the scoping is pinned here by source scan.
//
// The scan has THREE axes, and the tree exercises only one shape of each today
// (three `.ts`/`.tsx` static `from` imports in `*.test.ts(x)` files). Each axis is
// a named predicate pinned below against synthetic inputs, so none of them can
// silently stop discriminating just because the tree stopped covering it.

const SETTINGS_SPECIFIER = /(?:from|import)\s*\(?\s*['"]@chimera-engine\/simulation\/settings/u;
const VENDOR_DIRS = new Set(['node_modules', 'dist', 'out', '.next']);

/** Assembled, never spelled out — see the fixture note below. */
const SETTINGS_SUBPATH = `@chimera-engine/simulation/${'settings'}/index.js`;

/** Axis 1 — which files the walk collects. */
function isSourceFile(name: string): boolean {
    return /\.tsx?$/u.test(name);
}

/** Axis 2 — whether a file's text names the guarded specifier, in any import form. */
function importsSettings(text: string): boolean {
    return SETTINGS_SPECIFIER.test(text);
}

/** Axis 3 — which renderer files the §3 allowance covers. */
function isAllowedImporter(relPath: string): boolean {
    return /\.test\.tsx?$/u.test(relPath) || relPath.includes('/__test-support__/');
}

function rendererSourceFiles(dir: string = resolve(repoRoot, 'renderer')): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            return VENDOR_DIRS.has(entry.name) ? [] : rendererSourceFiles(full);
        }
        return isSourceFile(entry.name) ? [full] : [];
    });
}

function settingsImporters(): string[] {
    return rendererSourceFiles()
        .filter((file) => importsSettings(readFileSync(file, 'utf8')))
        .map((file) => relative(repoRoot, file));
}

describe('renderer → simulation/settings is a test-file-only allowance (§3 boundary table)', () => {
    it.each([
        ['a.ts', true],
        ['a.tsx', true],
        ['a.d.ts', true],
        ['a.css', false],
        ['a.json', false],
        // The `$` anchor is load-bearing: `tsconfig.tsbuildinfo` and editor
        // backups live in the walked tree and must not be read as source.
        ['a.ts.bak', false],
        ['tsconfig.tsbuildinfo', false],
    ])('collects %s as renderer source: %s', (name, expected) => {
        expect(isSourceFile(name)).toBe(expected);
    });

    it.each([
        ['renderer/input/InputBindingSchema.test.ts', true],
        ['renderer/components/r3f/FrameRateLimiter.test.tsx', true],
        ['renderer/components/r3f/__test-support__/StandInComposer.tsx', true],
        ['renderer/input/InputBindingSchema.ts', false],
        ['renderer/components/r3f/FrameRateLimiter.tsx', false],
        // Both segment anchors on the doubles directory are load-bearing: a
        // directory whose name merely CONTAINS `__test-support__` is not it.
        ['renderer/components/x__test-support__/Helper.ts', false],
        ['renderer/components/__test-support__x/Helper.ts', false],
        // …as is the `$` anchor on the test-file suffix.
        ['renderer/utils/schema.test.fixtures.ts', false],
        ['renderer/utils/format.test-helpers.ts', false],
    ])('treats %s as covered by the §3 allowance: %s', (relPath, expected) => {
        expect(isAllowedImporter(relPath)).toBe(expected);
    });

    // Interpolated rather than written out, so this file's own text never
    // contains the guarded specifier contiguously and the scan below stays honest
    // (no self-exclusion needed — the guard is not its own importer).
    it.each([
        [`import { x } from '${SETTINGS_SUBPATH}';`, true],
        [`import type { x } from '${SETTINGS_SUBPATH}';`, true],
        [`import '${SETTINGS_SUBPATH}';`, true],
        [`const m = import('${SETTINGS_SUBPATH}');`, true],
        [`import {\n    x,\n} from '${SETTINGS_SUBPATH}';`, true],
        [`import { x } from "${SETTINGS_SUBPATH}";`, true],
        [`import { x } from '@chimera-engine/simulation/content/AssetRef.js';`, false],
        [`// mentions the settings subpath in prose only`, false],
    ])('detects the specifier in %j: %s', (text, expected) => {
        expect(importsSettings(text)).toBe(expected);
    });

    it('finds every renderer file that imports it, and they are all test files', () => {
        // Asserting the exact set (not just a count) keeps the scan from going
        // vacuously green if the walk ever stops seeing a whole file extension.
        expect([...settingsImporters()].sort()).toEqual([
            'renderer/components/r3f/FrameRateLimiter.test.tsx',
            'renderer/components/r3f/useEngineFrameloop.test.ts',
            'renderer/input/InputBindingSchema.test.ts',
        ]);
    });

    it('is imported by no production renderer module', () => {
        const production = settingsImporters().filter((file) => !isAllowedImporter(file));
        expect(production).toEqual([]);
    });
});
