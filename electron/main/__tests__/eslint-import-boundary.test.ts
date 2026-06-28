/**
 * electron/main/__tests__/eslint-import-boundary.test.ts
 *
 * ESLint smoke test for the provider-internal containment boundary that keeps
 * main-process orchestration depending on the `@chimera-engine/networking` public barrel
 * interfaces only (Invariant #47, issue #769).
 *
 * Runs ESLint programmatically against two fixtures and asserts the
 * `chimera/no-main-provider-internals` rule fires on a provider-internal import
 * (provider/local/*) but NOT on the public barrel import. This proves the
 * boundary is enforced by the linter and wired into eslint.config.mjs for
 * electron/main — not merely correct in the rule's own unit test (RuleTester).
 *
 * Mirrors `networking/__tests__/eslint-import-boundary.test.ts` (#768) and the
 * ai/ + simulation/ boundary smoke tests.
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

describe('ESLint import-boundary — electron/main orchestration imports the @chimera-engine/networking barrel only (Invariant #47)', () => {
    it(
        'flags a provider-internal import (provider/local/*) from electron/main with chimera/no-main-provider-internals',
        () => {
            const messages = runEslint('bad-provider-internal-import.fixture.ts');
            const ruleIds = messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);
            expect(ruleIds).toContain('chimera/no-main-provider-internals');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );

    it(
        'does not flag the public barrel import (@chimera-engine/networking) from electron/main',
        () => {
            const messages = runEslint('good-barrel-import.fixture.ts');
            const ruleIds = messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);
            expect(ruleIds).not.toContain('chimera/no-main-provider-internals');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );
});
