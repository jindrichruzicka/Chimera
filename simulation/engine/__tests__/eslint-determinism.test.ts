/**
 * simulation/engine/__tests__/eslint-determinism.test.ts
 *
 * ESLint smoke tests for the determinism rules in simulation/.
 *
 * Architecture reference: §4.2.1 — Invariant #43
 *   Math.random(), Date.now(), performance.now() must be blocked by ESLint
 *   inside simulation/ and ai/ — not just by convention.
 *
 * Task: F04 / T5 (issue #45)
 *
 * These tests run ESLint programmatically against known-bad and known-good
 * fixture files to confirm the `no-restricted-syntax` rule fires exactly
 * when expected.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    const result = spawnSync(eslintBin, ['--no-ignore', '--format', 'json', fixturePath], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    // ESLint exits 1 when there are lint errors — that is expected for bad fixtures.
    // We only fail if the spawn itself errors.
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

function getViolationRuleIds(messages: ESLintMessage[]): string[] {
    return messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ESLint determinism rules — bad fixtures', () => {
    it(
        'flags Math.random() in bad-random.fixture.ts with no-restricted-syntax',
        () => {
            const messages = runEslint('bad-random.fixture.ts');
            const ruleIds = getViolationRuleIds(messages);
            expect(ruleIds).toContain('no-restricted-syntax');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );

    it(
        'flags Date.now() in bad-date-now.fixture.ts with no-restricted-syntax',
        () => {
            const messages = runEslint('bad-date-now.fixture.ts');
            const ruleIds = getViolationRuleIds(messages);
            expect(ruleIds).toContain('no-restricted-syntax');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );

    it(
        'flags performance.now in bad-performance-now.fixture.ts with no-restricted-syntax',
        () => {
            const messages = runEslint('bad-performance-now.fixture.ts');
            const ruleIds = getViolationRuleIds(messages);
            expect(ruleIds).toContain('no-restricted-syntax');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );
});

describe('ESLint determinism rules — good fixture', () => {
    it(
        'produces zero violations for good-approved.fixture.ts',
        () => {
            const messages = runEslint('good-approved.fixture.ts');
            const violations = messages.filter((m) => m.severity >= 2);
            expect(violations).toHaveLength(0);
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );
});
