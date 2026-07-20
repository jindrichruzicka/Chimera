/**
 * tools/merge-gate.test.ts
 *
 * Pins the pre-merge gate steps in the `merge` skill's `check-and-merge.sh`, the
 * same way `ci-workflow.test.ts` pins the CI gate job. Invariant #27's artifact
 * gate (`pnpm verify:packaged-bundle`) has two enforcement points — the CI step
 * and this pre-merge gate — and both must be ratcheted, or a claim of "enforced
 * pre-merge" outruns what a test actually holds.
 *
 * The gate step invocation is matched as a real `run_gate_step` line, not a bare
 * substring: a commented-out or `echo`-stubbed step would leave the literal
 * `pnpm verify:packaged-bundle` in the file (it appears in the banner and the
 * `info` line) while running nothing.
 *
 * The `.github` copy is a mirror surface, kept in sync as a pure
 * `sed 's|\.claude|.github|g'` image. Asserting that here means pinning the
 * canonical `.claude` copy also pins the mirror — neither the gate step nor the
 * surrounding script can drift on one side only.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const claudeScript = path.join(
    workspaceRoot,
    '.claude/skills/git/merge/scripts/check-and-merge.sh',
);
const githubScript = path.join(
    workspaceRoot,
    '.github/skills/git/merge/scripts/check-and-merge.sh',
);

/** A real `run_gate_step "pnpm <name>" pnpm <name>` invocation, not a comment. */
function runsGateStep(content: string, command: string): boolean {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^run_gate_step\\s+"${escaped}"\\s+${escaped}\\b`, 'm').test(content);
}

describe('merge skill pre-merge gate (check-and-merge.sh)', () => {
    let content: string;

    beforeAll(() => {
        content = readFileSync(claudeScript, 'utf-8');
    });

    it('runs the full gate as real run_gate_step invocations', () => {
        for (const command of [
            'pnpm format:check',
            'pnpm lint',
            'pnpm typecheck',
            'pnpm test',
            'pnpm verify:packaged-bundle',
        ]) {
            expect(runsGateStep(content, command), `pre-merge gate must run ${command}`).toBe(true);
        }
    });

    it('runs the Invariant #27 artifact gate after the unit tests', () => {
        // The gate rebuilds apps/tactics/dist in place (restoring the dev bundle
        // afterwards), so it must not interleave with the test step that reads
        // that dist — the same ordering the CI step is pinned to.
        const testIndex = content.indexOf('run_gate_step "pnpm test"');
        const gateIndex = content.indexOf('run_gate_step "pnpm verify:packaged-bundle"');
        expect(testIndex).toBeGreaterThan(-1);
        expect(gateIndex).toBeGreaterThan(testIndex);
    });

    it('keeps the .github mirror a pure sed image of the .claude copy', () => {
        // Pinning the canonical copy only enforces the property on both surfaces
        // if the mirror cannot drift independently.
        const githubContent = readFileSync(githubScript, 'utf-8');
        expect(content.replace(/\.claude/g, '.github')).toBe(githubContent);
    });
});
