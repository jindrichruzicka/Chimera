/**
 * tools/stale-ac-references.test.ts
 *
 * §16.4 guard: numbered acceptance-criterion references must not appear in
 * source files. The number points into a GitHub issue's AC list, which is
 * unreachable from the code, so the pointer goes stale the moment the issue
 * closes. Carry the criterion text inline instead — an unnumbered quoted
 * form stays true without the issue.
 *
 * Deliberately outside the ban: unnumbered `AC: "…"` quotes (self-contained)
 * and structural per-test labels such as an `AC1:` describe prefix, which
 * other tests reference by name.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/** This guard names the banned shapes in its own source, so it skips itself. */
const SELF = 'tools/stale-ac-references.test.ts';

/** Hash-numbered AC label: the `AC` token is case-sensitive on purpose. */
const AC_HASH_RE = /\bAC ?#\d/;
/** Spelled-out numbered criterion reference. */
const CRITERION_HASH_RE = /acceptance criteri(?:on|a) ?#\d/i;

function isBannedAcRef(line: string): boolean {
    return AC_HASH_RE.test(line) || CRITERION_HASH_RE.test(line);
}

function trackedSourceFiles(): string[] {
    const out = execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.mjs'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    return out.split('\n').filter((f) => f.length > 0 && f !== SELF);
}

describe('stale AC references (§16.4)', () => {
    it('matches the shapes it bans and spares the sanctioned ones (negative control)', () => {
        expect(isBannedAcRef('barrels are SIDE-EFFECT-FREE (AC #2):')).toBe(true);
        expect(isBannedAcRef('// ── AC #8b — Overlays section ──')).toBe(true);
        expect(isBannedAcRef('(AC#2) with no space')).toBe(true);
        expect(isBannedAcRef('satisfying acceptance criterion #2 ("both impls")')).toBe(true);
        expect(isBannedAcRef('// unique (acceptance criteria #1/#2)')).toBe(true);
        expect(isBannedAcRef('ACCEPTANCE CRITERIA #1 IN CAPS')).toBe(true);
        expect(isBannedAcRef('(AC: "importing the barrel is side-effect-free")')).toBe(false);
        expect(isBannedAcRef("describe('pipeline — AC2: canUndo transitions')")).toBe(false);
        expect(isBannedAcRef('// tested in autosave-wiring.integration.test.ts:AC4')).toBe(false);
    });

    it('finds no numbered AC reference in any tracked source file', () => {
        const files = trackedSourceFiles();
        // Anti-vacuity: the scan must cover the tree AND all three extensions.
        expect(files.length).toBeGreaterThan(300);
        expect(files).toContain('eslint.config.mjs');
        expect(files).toContain('simulation/engine/types.ts');
        expect(files).toContain('renderer/app/settings/page.test.tsx');

        const hits: string[] = [];
        for (const file of files) {
            const lines = readFileSync(resolve(repoRoot, file), 'utf8').split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]!;
                if (isBannedAcRef(line)) {
                    hits.push(`${file}:${i + 1}: ${line.trim()}`);
                }
            }
        }
        expect(hits, 'numbered AC references found — carry the criterion text instead').toEqual([]);
    });
});
