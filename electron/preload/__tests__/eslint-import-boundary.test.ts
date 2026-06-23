/**
 * electron/preload/__tests__/eslint-import-boundary.test.ts
 *
 * ESLint smoke test for the preload import boundary added in F62 (#777).
 *
 * The preload bridge is the sole renderer-facing surface (Invariant #5) and
 * depends on the `@chimera/simulation` contract surface ONLY (Invariant #1): it
 * must not import the renderer UI library, the ai/networking runtime, a game
 * package, or the electron main-process internals. The `electron/preload/**`
 * `no-restricted-imports` zone in eslint.config.mjs enforces this.
 *
 * Runs ESLint programmatically against two fixtures and asserts the
 * `no-restricted-imports` rule fires on a forbidden cross-boundary import
 * (the @chimera/renderer component barrel) but NOT on the sanctioned
 * @chimera/simulation contract import. Mirrors
 * `electron/main/__tests__/eslint-import-boundary.test.ts` (#769) and the
 * ai/ + networking/ + renderer/ boundary smoke tests.
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

describe('ESLint import-boundary — electron/preload imports the @chimera/simulation contract surface only (Invariants #1/#5)', () => {
    it(
        'flags a renderer/ai/networking/game/host-internal import from electron/preload with no-restricted-imports',
        () => {
            const messages = runEslint('bad-cross-boundary-import.fixture.ts');
            const ruleIds = messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);
            expect(ruleIds).toContain('no-restricted-imports');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );

    it(
        'does not flag the sanctioned @chimera/simulation contract import from electron/preload',
        () => {
            const messages = runEslint('good-contract-import.fixture.ts');
            const ruleIds = messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);
            expect(ruleIds).not.toContain('no-restricted-imports');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );
});
