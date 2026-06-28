/**
 * simulation/engine/__tests__/eslint-import-boundary.test.ts
 *
 * ESLint smoke test for the module-import boundary that makes
 * `@chimera-engine/simulation` the zero-dependency engine leaf (Invariant #1, issue #759).
 *
 * Runs ESLint programmatically against a fixture that imports a sibling
 * workspace package (`@chimera-engine/networking`) from simulation/ and asserts the
 * `no-restricted-imports` rule fires. This proves the boundary is enforced by
 * the linter, not merely by convention — the AC for issue #759:
 *   "Import-boundary ESLint rule fails on a forbidden cross-boundary import."
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESLINT_FIXTURE_TIMEOUT_MS = 20_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../');
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

describe('ESLint import-boundary — @chimera-engine/simulation zero-dependency leaf (Invariant #1)', () => {
    it(
        'flags a sibling-package import (@chimera-engine/networking) from simulation/ with no-restricted-imports',
        () => {
            const messages = runEslint('bad-cross-boundary-import.fixture.ts');
            const ruleIds = messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);
            expect(ruleIds).toContain('no-restricted-imports');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );
});
