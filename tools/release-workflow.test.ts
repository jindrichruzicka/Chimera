import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

// Asserts the structure/contract of the F66 release workflow (issue #806). Like
// e2e-workflow.test.ts, it reads the YAML as text and checks shape + step ordering;
// CI Actions billing is blocked on this account, so this is the executable record of
// the release pipeline and the guard that the gating + provenance contract holds.
const workspaceRoot = path.resolve(import.meta.dirname, '..');
const workflowPath = path.join(workspaceRoot, '.github', 'workflows', 'release.yml');

describe('release.yml CI release workflow', () => {
    let content: string;

    beforeAll(() => {
        content = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf-8') : '';
    });

    it('file exists at .github/workflows/release.yml', () => {
        expect(existsSync(workflowPath)).toBe(true);
    });

    it('triggers on a version-tag push (v*.*.* and @chimera-engine/* scoped tags)', () => {
        expect(content).toMatch(/on:/);
        expect(content).toMatch(/push:/);
        expect(content).toMatch(/tags:/);
        expect(content).toMatch(/v\*\.\*\.\*/);
        expect(content).toMatch(/@chimera-engine\/\*/);
    });

    it('runs on ubuntu-latest', () => {
        expect(content).toMatch(/runs-on:\s*ubuntu-latest/);
    });

    // AC1 — build -> verify:pack -> publish, in that order. indexOf ordering rather than
    // YAML parsing keeps this in lockstep with the e2e-workflow.test.ts convention.
    it('runs build -> verify:pack -> publish in order (AC1)', () => {
        // Anchor on the `run:` step commands, not bare substrings: the header comment
        // mentions `verify:pack` and `changeset publish` in prose, which would otherwise
        // be matched ahead of the real steps and corrupt the ordering check.
        const idxBuild = content.search(/run:\s*pnpm build:packages/);
        const idxVerifyPack = content.search(/run:\s*pnpm verify:pack\b/);
        const idxPublish = content.search(/run:\s*pnpm release\b/);
        expect(idxBuild).toBeGreaterThanOrEqual(0);
        expect(idxVerifyPack).toBeGreaterThan(idxBuild);
        expect(idxPublish).toBeGreaterThan(idxVerifyPack);
    });

    // F66 PR5 — the create-chimera-game initializer bin is an esbuild bundle (not the engine
    // `tsc -b`), so it is built explicitly before publish; `changeset publish` then publishes it
    // alongside the engine packages (it is a non-private workspace member).
    it('builds the create-chimera-game initializer before publish', () => {
        const idxInitBuild = content.search(/run:\s*pnpm --filter create-chimera-game build/);
        const idxPublish = content.search(/run:\s*pnpm release\b/);
        expect(idxInitBuild).toBeGreaterThanOrEqual(0);
        expect(idxPublish).toBeGreaterThan(idxInitBuild);
    });

    // AC2 — publish is gated behind verify:pack (it precedes publish; a failed step
    // fails the job before publish runs). Skip-unchanged is delegated to `changeset
    // publish`, which only publishes versions not already on the registry.
    it('gates publish behind verify:pack via the publish command path (AC2)', () => {
        expect(content).toMatch(/pnpm verify:pack/);
        expect(content).toMatch(/pnpm release|changeset publish/);
    });

    // AC3 — the publish-readiness gate (depcheck + publint + `pnpm publish --dry-run`
    // per package) runs IN the workflow, before publish, proving the publish command
    // path is correct without a real release.
    it('runs verify:publish before publish (AC3 dry-run gate in-workflow)', () => {
        const idxVerifyPublish = content.search(/run:\s*pnpm verify:publish\b/);
        const idxPublish = content.search(/run:\s*pnpm release\b/);
        expect(idxVerifyPublish).toBeGreaterThanOrEqual(0);
        expect(idxPublish).toBeGreaterThan(idxVerifyPublish);
    });

    // AC4 — npm provenance requires the OIDC token permission.
    it('grants id-token: write for npm provenance (AC4)', () => {
        expect(content).toMatch(/permissions:/);
        expect(content).toMatch(/id-token:\s*write/);
    });

    // AC4 — provenance is enabled on the publish step (CI-only via NPM_CONFIG_PROVENANCE,
    // not publishConfig, so the local verify:publish dry-run keeps working without OIDC).
    it('enables provenance on the publish step via NPM_CONFIG_PROVENANCE (AC4)', () => {
        expect(content).toMatch(/NPM_CONFIG_PROVENANCE:\s*true/);
    });

    // AC4 — scoped @chimera-engine/* publishes to the public npm registry.
    it('targets the public npm registry (AC4)', () => {
        expect(content).toMatch(/registry-url:\s*['"]?https:\/\/registry\.npmjs\.org['"]?/);
    });

    // AC4 — auth comes from the NPM_TOKEN secret; no token is hardcoded.
    it('authenticates via the NPM_TOKEN secret with no hardcoded token (AC4)', () => {
        expect(content).toMatch(/NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
        // A hardcoded token would appear as an inline _authToken= or an npm_ literal.
        expect(content).not.toMatch(/_authToken\s*=/);
        expect(content).not.toMatch(/npm_[A-Za-z0-9]{36}/);
    });
});
