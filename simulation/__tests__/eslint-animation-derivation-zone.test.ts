/**
 * simulation/__tests__/eslint-animation-derivation-zone.test.ts
 *
 * Zone contract for `chimera/no-animation-derivation-in-reduce`: WHERE the rule
 * is switched on, as opposed to WHAT it reports.
 *
 * The rule's own behaviour is covered by its RuleTester suite beside the rule.
 * That suite cannot see this, and the gap is the whole reason for this file: a
 * rule can be correct, resolvable and registered while guarding zero files —
 * a mistyped glob, a subtree swallowed by a global `ignores`, an `off` block
 * emitted over a zone it was meant to sit beside. All three leave `pnpm lint`
 * green.
 *
 * So two independent checks:
 *
 * 1. **Shape** — the flat-config blocks that configure the rule, read out of
 *    `eslint.config.mjs` itself: one `error` block over the three gameplay
 *    globs, and the two `off` blocks after it. Order is load-bearing, because a
 *    flat config resolves a rule from the LAST matching block.
 * 2. **Reach** — the config ESLint RESOLVES for REAL files. A fixture proves a
 *    rule works; only `--print-config` proves it arrives. The probe list is
 *    derived from the filesystem so a subtree added later cannot silently fall
 *    out, and every probe is asserted to exist first: `--print-config` on a
 *    path that is not there exits 0 and prints a config, so a probe list full
 *    of typos would read as a clean pass.
 *
 * Mirrors `apps/tactics/__tests__/eslint-determinism-fromfloat-zone.test.ts`,
 * which holds the same two checks for this rule's sibling.
 */

import { describe, it, expect } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// The reach cases spawn one `--print-config` per probe target. They run
// concurrently, but the ceiling has to cover a cold start of all of them.
const ESLINT_REACH_TIMEOUT_MS = 60_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
// simulation/__tests__ -> repo root is two levels up.
const repoRoot = resolve(__dirname, '../../');
const eslintBin = resolve(repoRoot, 'node_modules/.bin/eslint');

const ANIMATION_RULE = 'chimera/no-animation-derivation-in-reduce';

/**
 * The one directory the `off` arm names that does not exist in this repo. The
 * arm mirrors its fromFloat sibling's, so it is declared for the same reason
 * and cannot be probed for the same reason — see the shape suite.
 */
const LOADERS_DIR = 'simulation/content/loaders';

interface Zone {
    readonly files?: readonly string[];
    readonly ignores?: readonly string[];
    readonly rule: unknown;
}

/** Every flat-config entry that configures `ruleId`, in declaration order. */
function zonesConfiguring(ruleId: string): Zone[] {
    const script = `
        const config = (await import('./eslint.config.mjs')).default;
        const zones = config
            .filter((e) => e?.rules && Object.hasOwn(e.rules, ${JSON.stringify(ruleId)}))
            .map((e) => ({ files: e.files, ignores: e.ignores, rule: e.rules[${JSON.stringify(ruleId)}] }));
        process.stdout.write(JSON.stringify(zones));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`could not load eslint.config.mjs: ${result.stderr}`);
    }
    return JSON.parse(result.stdout) as Zone[];
}

/**
 * The `ruleId` entry the config ESLint actually resolves for `file`. A globally
 * ignored path makes `--print-config` print the literal `undefined`, so surface
 * that as a marker rather than throwing on the JSON parse — the evasion this
 * suite exists to catch would otherwise arrive as a syntax error.
 */
async function resolvedRule(file: string, ruleId: string): Promise<unknown> {
    const { stdout } = await execFileAsync(eslintBin, ['--print-config', file], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    if (stdout.trim() === 'undefined') return 'FILE IS GLOBALLY IGNORED';

    const config = JSON.parse(stdout) as { rules?: Record<string, unknown> };
    return config.rules?.[ruleId];
}

/** Normalised numeric severity of a resolved rule config, or undefined. */
function severityOf(rule: unknown): number | undefined {
    const value = Array.isArray(rule) ? rule[0] : rule;
    return typeof value === 'number' ? value : undefined;
}

/**
 * One production `.ts` file from `dir` and from every directory beneath it,
 * skipping test scaffolding and build output. These are the reduce-time paths
 * the rule has to reach.
 */
function productionSourceFilePerSubtree(dir: string): string[] {
    const entries = readdirSync(resolve(repoRoot, dir), { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
    );
    const isProdSource = (name: string): boolean =>
        name.endsWith('.ts') &&
        !name.endsWith('.test.ts') &&
        !name.endsWith('.spec.ts') &&
        !name.endsWith('.d.ts');
    const skipped = new Set(['__tests__', '__test-support__', 'fixtures', 'dist', 'node_modules']);

    const own = entries.find((entry) => entry.isFile() && isProdSource(entry.name));
    const found = own !== undefined ? [`${dir}/${own.name}`] : [];

    for (const entry of entries) {
        if (entry.isDirectory() && !skipped.has(entry.name)) {
            found.push(...productionSourceFilePerSubtree(`${dir}/${entry.name}`));
        }
    }
    return found;
}

/**
 * One production file per reduce-time subtree: the engine's own `simulation/`,
 * and every game's `simulation/` and `ai/`. Derived from the filesystem, so a
 * game — or a nested gameplay directory — added later is covered by default
 * rather than by remembering to list it.
 */
function probeProductionTargets(): string[] {
    const targets = [...productionSourceFilePerSubtree('simulation')];

    for (const app of readdirSync(resolve(repoRoot, 'apps'), { withFileTypes: true })) {
        if (!app.isDirectory()) continue;
        for (const zone of ['simulation', 'ai']) {
            const zoneDir = `apps/${app.name}/${zone}`;
            if (existsSync(resolve(repoRoot, zoneDir))) {
                targets.push(...productionSourceFilePerSubtree(zoneDir));
            }
        }
    }
    return [...new Set(targets)].sort();
}

// ── 1. Shape ────────────────────────────────────────────────────────────────

describe('animation-derivation zone — shape', () => {
    it('switches the rule on over the three gameplay globs, in exactly one block', () => {
        const errorZones = zonesConfiguring(ANIMATION_RULE).filter((zone) => zone.rule === 'error');

        expect(errorZones).toHaveLength(1);
        expect(errorZones[0]!.files).toEqual([
            'simulation/**/*.{ts,tsx}',
            'apps/*/simulation/**/*.{ts,tsx}',
            'apps/*/ai/**/*.{ts,tsx}',
        ]);
        // No `ignores` on the zone itself: an exemption written there would
        // leave the glob list reading exactly as documented while quietly
        // dropping a subtree, and every reach probe below would still pass for
        // the files that remained.
        expect(errorZones[0]!.ignores).toBeUndefined();
    });

    it('emits both OFF blocks AFTER the block they relax', () => {
        // The mechanism, not a style point: a flat config resolves a rule from
        // the LAST matching block, so an exemption emitted first exempts
        // nothing and the test-file arm below would resolve to error.
        const zones = zonesConfiguring(ANIMATION_RULE);
        const offZones = zones.filter((zone) => zone.rule === 'off');

        expect(zones.map((zone) => zone.rule)).toEqual(['error', 'off', 'off']);
        expect(offZones[0]!.files).toEqual([`${LOADERS_DIR}/**/*.{ts,tsx}`]);
        expect(offZones[1]!.files).toEqual([
            'simulation/**/*.test.{ts,tsx}',
            'simulation/**/*.spec.{ts,tsx}',
            'apps/*/simulation/**/*.test.{ts,tsx}',
            'apps/*/simulation/**/*.spec.{ts,tsx}',
            'apps/*/ai/**/*.test.{ts,tsx}',
            'apps/*/ai/**/*.spec.{ts,tsx}',
        ]);
    });

    it('is the ONLY proof available for the loaders arm, because that path is not real', () => {
        // Stated rather than quietly skipped. The arm mirrors the one its
        // fromFloat sibling declares, and neither can be proved by
        // `--print-config`: on a path that does not exist ESLint exits 0 and
        // prints a config, so a probe there would be green whatever the config
        // said. The day the directory is created this reds and the reach suite
        // below is where the real probe belongs.
        expect(existsSync(resolve(repoRoot, LOADERS_DIR))).toBe(false);
    });
});

// ── 2. Reach ────────────────────────────────────────────────────────────────

describe('animation-derivation zone — reach', () => {
    it(
        'resolves at error severity for a file in every engine and per-game reduce-time subtree',
        async () => {
            const targets = probeProductionTargets();

            // Guards the derivation itself: an empty or one-sided list makes
            // the map assertion below vacuous. The exact representative is not
            // pinned — it is whichever file sorts first in each subtree.
            expect(targets.length).toBeGreaterThan(2);
            expect(targets.some((file) => file.startsWith('simulation/'))).toBe(true);
            expect(targets.some((file) => file.startsWith('apps/tactics/simulation/'))).toBe(true);
            expect(targets.some((file) => file.startsWith('apps/tactics/ai/'))).toBe(true);
            for (const file of targets) {
                expect(existsSync(resolve(repoRoot, file)), `${file} must exist`).toBe(true);
            }

            const resolved = await Promise.all(
                targets.map(
                    async (file) =>
                        [file, severityOf(await resolvedRule(file, ANIMATION_RULE))] as const,
                ),
            );

            // Asserted as one map so a failure names every file that lost the rule.
            expect(Object.fromEntries(resolved)).toEqual(
                Object.fromEntries(targets.map((file) => [file, 2])),
            );
        },
        ESLINT_REACH_TIMEOUT_MS,
    );

    it(
        'resolves to off for engine and per-game test files (the exemption)',
        async () => {
            // One per OFF glob family that has a real file: the engine
            // `simulation/` arm and both per-game arms. Compiling a window is
            // what a test of the verifier does, so without these the first such
            // test reds on the function under test.
            const testFiles = [
                'simulation/content/animationWindows.test.ts',
                'apps/tactics/simulation/actions.test.ts',
                'apps/tactics/ai/tacticsPolicy.test.ts',
            ];
            for (const file of testFiles) {
                expect(existsSync(resolve(repoRoot, file)), `${file} must exist`).toBe(true);
            }

            const resolved = await Promise.all(
                testFiles.map(
                    async (file) =>
                        [file, severityOf(await resolvedRule(file, ANIMATION_RULE))] as const,
                ),
            );

            expect(Object.fromEntries(resolved)).toEqual(
                Object.fromEntries(testFiles.map((file) => [file, 0])),
            );
        },
        ESLINT_REACH_TIMEOUT_MS,
    );

    it(
        'does NOT reach a renderer module — the zone is reduce-time code, not the whole repo',
        async () => {
            // The negative control the two cases above cannot give. A glob
            // widened to `**/*.{ts,tsx}` resolves the rule at error everywhere
            // and passes both of them.
            const file = 'renderer/animation/ClipTimeline.ts';
            expect(existsSync(resolve(repoRoot, file)), `${file} must exist`).toBe(true);

            expect(await resolvedRule(file, ANIMATION_RULE)).toBeUndefined();
        },
        ESLINT_REACH_TIMEOUT_MS,
    );
});
