/**
 * tools/ci-workflow.test.ts
 *
 * Locks the .github/workflows/ci.yml gate job to the workspace's build-first
 * contract. Since the F59–F62 package extraction, every root gate script
 * (lint/typecheck/test) starts with `pnpm build:packages` because typed ESLint
 * and cross-package imports resolve against the @chimera-engine/* dists. The
 * CI workflow invokes the raw sub-commands (`pnpm -r lint`, …), so it must
 * build the packages itself before the first dist-dependent step — without
 * this, typed lint reports every cross-package import as an unresolved
 * "error type" (run 29052602262).
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const workflowPath = path.join(workspaceRoot, '.github', 'workflows', 'ci.yml');

describe('ci.yml CI workflow', () => {
    let content: string;

    beforeAll(() => {
        content = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf-8') : '';
    });

    it('file exists at .github/workflows/ci.yml', () => {
        expect(existsSync(workflowPath)).toBe(true);
    });

    it('builds the workspace packages with pnpm build:packages', () => {
        expect(content).toMatch(/pnpm build:packages/);
    });

    it('installs the Electron binary before the test steps (pnpm ignores its postinstall)', () => {
        // pnpm skips electron's install script on CI ("Ignored build scripts"),
        // and require('electron') throws without the downloaded binary —
        // apps/tactics electron/main.test.ts fails at collection. Mirrors the
        // e2e.yml "Install Electron binary" step.
        const installIndex = content.indexOf('node node_modules/electron/install.js');
        const testIndex = content.indexOf('pnpm -r test');
        expect(installIndex).toBeGreaterThan(-1);
        expect(testIndex).toBeGreaterThan(-1);
        expect(installIndex).toBeLessThan(testIndex);
    });

    it('builds packages before the workspace lint step (typed lint resolves against dists)', () => {
        const buildIndex = content.indexOf('pnpm build:packages');
        const lintIndex = content.indexOf('pnpm -r lint');
        expect(buildIndex).toBeGreaterThan(-1);
        expect(lintIndex).toBeGreaterThan(-1);
        expect(buildIndex).toBeLessThan(lintIndex);
    });

    it('still runs the full gate: format, lint, typecheck, assets, tests, invariants', () => {
        expect(content).toMatch(/pnpm format:check/);
        expect(content).toMatch(/pnpm -r lint/);
        expect(content).toMatch(/pnpm typecheck/);
        expect(content).toMatch(/pnpm validate:assets/);
        expect(content).toMatch(/pnpm -r test/);
        // The mechanical invariant checks need a gate of their own: unrun, they
        // rot silently — a check pinned to a removed path skipped on every run
        // while still reporting success.
        expect(content).toMatch(/pnpm verify:invariants/);
    });

    it('does not reference the removed root e2e/ directory (suite lives in apps/tactics/e2e since F63)', () => {
        // `eslint … e2e …` and `vitest run --dir e2e` fail outright on the
        // missing path; the apps/tactics package lints/tests its own e2e dir
        // through the recursive steps.
        expect(content).not.toMatch(/eslint tools e2e/);
        expect(content).not.toMatch(/--dir e2e/);
    });
});
