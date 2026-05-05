import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const workflowPath = path.join(workspaceRoot, '.github', 'workflows', 'e2e.yml');

describe('e2e.yml CI workflow', () => {
    let content: string;

    beforeAll(() => {
        if (existsSync(workflowPath)) {
            content = readFileSync(workflowPath, 'utf-8');
        } else {
            content = '';
        }
    });

    it('file exists at .github/workflows/e2e.yml', () => {
        expect(existsSync(workflowPath)).toBe(true);
    });

    it('triggers on push to main', () => {
        expect(content).toMatch(/on:/);
        expect(content).toMatch(/push:/);
        expect(content).toMatch(/branches:.*main|main.*branches:/s);
    });

    it('triggers on pull_request', () => {
        expect(content).toMatch(/pull_request:/);
    });

    it('runs on ubuntu-latest', () => {
        expect(content).toMatch(/runs-on:\s*ubuntu-latest/);
    });

    it('installs Playwright with chromium', () => {
        expect(content).toMatch(
            /playwright install.*chromium|playwright install --with-deps chromium/,
        );
    });

    it('starts Xvfb on display :99 before tests', () => {
        expect(content).toMatch(/Xvfb :99/);
    });

    it('sets DISPLAY env to :99 in test step', () => {
        expect(content).toMatch(/DISPLAY.*:99|:99.*DISPLAY/);
    });

    it('runs playwright test with electron-e2e project', () => {
        expect(content).toMatch(/playwright test.*--project=electron-e2e|--project=electron-e2e/);
    });

    it('uploads playwright-report artifact on every run', () => {
        expect(content).toMatch(/upload-artifact/);
        expect(content).toMatch(/playwright-report/);
        expect(content).toMatch(/if:\s*always\(\)/);
    });

    it('uses actions/upload-artifact@v4', () => {
        expect(content).toMatch(/upload-artifact@v4/);
    });

    it('does NOT set CHIMERA_E2E in workflow env block — Invariant 27', () => {
        // CHIMERA_E2E must only be set by fixtures, never in CI env block
        const envBlockPattern = /^env:\s*\n((?:[ \t]+\S.*\n)*)/gm;
        const matches = [...content.matchAll(envBlockPattern)];
        for (const match of matches) {
            expect(match[0]).not.toMatch(/CHIMERA_E2E/);
        }
        // Also a direct check: if CHIMERA_E2E appears in the file it must not be in an env: assignment
        if (content.includes('CHIMERA_E2E')) {
            // The only acceptable occurrence would be in a comment explaining why it's absent
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.includes('CHIMERA_E2E') && !line.trimStart().startsWith('#')) {
                    expect.fail(
                        `CHIMERA_E2E must not appear as a non-comment line in e2e.yml (Invariant 27): "${line}"`,
                    );
                }
            }
        }
    });

    it('sets CI: true in test step env', () => {
        expect(content).toMatch(/CI:\s*true/);
    });

    it('does NOT have a standalone "build:renderer" step — global-setup.ts handles renderer compilation', () => {
        // global-setup.ts runs `pnpm build:renderer` as part of Playwright globalSetup,
        // so a separate CI step would double-build the renderer unnecessarily.
        expect(content).not.toMatch(/run:\s*pnpm(?:\s+run)?\s+build:renderer/);
    });

    it('does NOT have a standalone "build:electron" step — global-setup.ts esbuild handles main compilation into .e2e-build/', () => {
        // global-setup.ts uses esbuild to compile electron/main/index.ts → .e2e-build/electron/main/index.js.
        // pnpm build:electron writes to a different path (electron/main/index.js) not used by e2e,
        // so the step is dead work.
        expect(content).not.toMatch(/run:\s*pnpm(?:\s+run)?\s+build:electron/);
    });
});
