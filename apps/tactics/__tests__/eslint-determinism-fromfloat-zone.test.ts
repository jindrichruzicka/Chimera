/**
 * apps/tactics/__tests__/eslint-determinism-fromfloat-zone.test.ts
 *
 * ESLint smoke test proving the per-game gameplay lint zones cover code under
 * `apps/<game>/simulation/` and `apps/<game>/ai/` after the `games/` ->
 * `apps/<game>/` restructure: determinism (`no-restricted-syntax`, Invariant
 * #43), `chimera/no-fromfloat-in-simulation` (Invariant #76), and the module
 * boundary (`no-restricted-imports`, Invariant #1).
 *
 * Three checks, because each is defeatable without the others (mirrors
 * electron/main/__tests__/eslint-no-console.test.ts):
 *
 * 1. **Behaviour** — ESLint runs against fixtures under `apps/tactics/simulation`
 *    and `apps/tactics/ai`: each rule must fire on a bad fixture and stay silent
 *    on a good one. The `ai/bad-fromfloat` case is load-bearing: the rule has an
 *    internal path guard, so widening only the config `files` glob would resolve
 *    the rule for ai files yet never fire (dead config). This fixture is the only
 *    check that catches that.
 * 2. **Shape** — the fromFloat error zone must list exactly the engine + per-game
 *    simulation + per-game ai globs, and the determinism zone must include both
 *    per-game globs. A shape drift here silently narrows coverage.
 * 3. **Reach** — the config ESLint RESOLVES for a real file in every apps
 *    gameplay subtree must carry both rules at error severity; a game test file
 *    must resolve the fromFloat rule to off (the exemption). The probe list is
 *    derived from the filesystem so a subtree added later cannot fall out of
 *    coverage unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ESLINT_FIXTURE_TIMEOUT_MS = 20_000;
// The reach case spawns one `--print-config` per probe target. They run
// concurrently, but the ceiling has to cover a cold start of all at once.
const ESLINT_REACH_TIMEOUT_MS = 60_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/tactics/__tests__ -> repo root is three levels up.
const repoRoot = resolve(__dirname, '../../../');
const eslintBin = resolve(repoRoot, 'node_modules/.bin/eslint');

const FROMFLOAT_RULE = 'chimera/no-fromfloat-in-simulation';
const DETERMINISM_RULE = 'no-restricted-syntax';
const BOUNDARY_RULE = 'no-restricted-imports';

interface ESLintMessage {
    ruleId: string | null;
    severity: number;
    message: string;
    line: number;
}

interface ESLintResult {
    filePath: string;
    messages: ESLintMessage[];
}

/**
 * Lint one repo-relative fixture with `--no-ignore` (the fixtures live in the
 * config's GLOBAL ignores so they never break the project lint run; `--no-ignore`
 * bypasses those, while a config object's own `ignores` still applies).
 */
function runEslint(relPath: string): ESLintMessage[] {
    const result = spawnSync(
        eslintBin,
        ['--no-ignore', '--format', 'json', resolve(repoRoot, relPath)],
        { cwd: repoRoot, encoding: 'utf8' },
    );
    if (result.error) {
        throw result.error;
    }
    const output = result.stdout.trim();
    if (!output) {
        return [];
    }
    const parsed = JSON.parse(output) as ESLintResult[];
    return parsed[0]?.messages ?? [];
}

function ruleIdsOf(messages: ESLintMessage[]): string[] {
    return messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);
}

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
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`could not load eslint.config.mjs: ${result.stderr}`);
    }
    return JSON.parse(result.stdout) as Zone[];
}

/**
 * The `ruleId` entry the config ESLint actually resolves for `file`. A globally
 * ignored path makes `--print-config` print the literal `undefined`, so surface
 * that as a marker rather than throwing on the JSON parse.
 */
async function resolvedRule(file: string, ruleId: string): Promise<unknown> {
    const { stdout } = await execFileAsync(eslintBin, ['--print-config', file], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    if (stdout.trim() === 'undefined') {
        return 'FILE IS GLOBALLY IGNORED';
    }
    const config = JSON.parse(stdout) as { rules?: Record<string, unknown> };
    return config.rules?.[ruleId];
}

/** Normalised numeric severity of a resolved rule config, or undefined. */
function severityOf(rule: unknown): number | undefined {
    const value = Array.isArray(rule) ? rule[0] : rule;
    return typeof value === 'number' ? value : undefined;
}

/**
 * One production `.ts` file from `dir` and every directory beneath it, skipping
 * test scaffolding (`__tests__`, `fixtures`) and `*.test.ts`/`*.spec.ts`. These
 * are the hot gameplay paths the rules must reach.
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

    const own = entries.find((e) => e.isFile() && isProdSource(e.name));
    const found = own !== undefined ? [`${dir}/${own.name}`] : [];

    for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'fixtures') {
            found.push(...productionSourceFilePerSubtree(`${dir}/${entry.name}`));
        }
    }
    return found;
}

/**
 * One production file per gameplay subtree of every app, derived from the
 * filesystem so a game (or a nested gameplay dir) added later cannot silently
 * drop out of enforcement.
 */
function probeProductionTargets(): string[] {
    const targets: string[] = [];
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

// ── 1. Behaviour ────────────────────────────────────────────────────────────

describe('ESLint apps zone — behaviour (Invariants #76, #43, #1)', () => {
    const badCases: readonly [string, string, string][] = [
        [
            'fromFloat() in a per-game simulation path',
            'apps/tactics/simulation/__tests__/fixtures/bad-fromfloat.fixture.ts',
            FROMFLOAT_RULE,
        ],
        // Load-bearing: proves the rule's internal path guard fires on apps/*/ai,
        // not just that the config resolves the rule there (dead-config trap).
        [
            'fromFloat() in a per-game ai path',
            'apps/tactics/ai/__tests__/fixtures/bad-fromfloat.fixture.ts',
            FROMFLOAT_RULE,
        ],
        [
            'Math.random() in a per-game simulation path',
            'apps/tactics/simulation/__tests__/fixtures/bad-random.fixture.ts',
            DETERMINISM_RULE,
        ],
        [
            'Math.random() in a per-game ai path',
            'apps/tactics/ai/__tests__/fixtures/bad-random.fixture.ts',
            DETERMINISM_RULE,
        ],
        // Module boundary (Invariant #1): per-game AI must not import the
        // networking/renderer/electron layers. Fires only because apps/*/ai is
        // in the boundary zone — the global deep-relative ban would not catch it.
        [
            'a forbidden layer import in a per-game ai path',
            'apps/tactics/ai/__tests__/fixtures/bad-import.fixture.ts',
            BOUNDARY_RULE,
        ],
    ];

    for (const [label, fixture, ruleId] of badCases) {
        it(
            `flags ${label} with ${ruleId} at error severity`,
            () => {
                const messages = runEslint(fixture);
                expect(ruleIdsOf(messages)).toContain(ruleId);
                const hit = messages.find((m) => m.ruleId === ruleId);
                // Error, not warning: no package sets `--max-warnings`, so a
                // warning would leave the gate green and the ratchet inert.
                expect(hit?.severity).toBe(2);
            },
            ESLINT_FIXTURE_TIMEOUT_MS,
        );
    }

    const goodFixtures = [
        'apps/tactics/simulation/__tests__/fixtures/good-approved.fixture.ts',
        'apps/tactics/ai/__tests__/fixtures/good-approved.fixture.ts',
    ];

    for (const fixture of goodFixtures) {
        it(
            `produces zero violations for ${fixture}`,
            () => {
                const violations = runEslint(fixture).filter((m) => m.severity >= 2);
                expect(violations).toEqual([]);
            },
            ESLINT_FIXTURE_TIMEOUT_MS,
        );
    }
});

// ── 2. Shape ──────────────────────────────────────────────────────────────

describe('ESLint apps zone — shape', () => {
    it('scopes the fromFloat error zone to engine + per-game simulation + per-game ai', () => {
        const errorZones = zonesConfiguring(FROMFLOAT_RULE).filter((z) => z.rule === 'error');
        expect(errorZones).toHaveLength(1);
        expect(errorZones[0]!.files).toEqual([
            'simulation/**/*.{ts,tsx}',
            'apps/*/simulation/**/*.{ts,tsx}',
            'apps/*/ai/**/*.{ts,tsx}',
        ]);
    });

    it('extends the determinism zone to both per-game gameplay dirs', () => {
        const zones = zonesConfiguring(DETERMINISM_RULE);
        expect(zones).toHaveLength(1);
        const files = zones[0]!.files ?? [];
        expect(files).toContain('apps/*/simulation/**/*.{ts,tsx}');
        expect(files).toContain('apps/*/ai/**/*.{ts,tsx}');
    });
});

// ── 3. Reach ──────────────────────────────────────────────────────────────

describe('ESLint apps zone — reach', () => {
    it(
        'resolves both rules at error severity for a file in every apps gameplay subtree',
        async () => {
            const targets = probeProductionTargets();
            // Guards the derivation (one representative file per subtree): an
            // empty list, or one missing either gameplay dir, makes the case
            // vacuous. Assert coverage of both dirs without pinning the exact
            // representative, which is whichever file sorts first.
            expect(targets.length).toBeGreaterThan(2);
            expect(targets.some((f) => f.startsWith('apps/tactics/simulation/'))).toBe(true);
            expect(targets.some((f) => f.startsWith('apps/tactics/ai/'))).toBe(true);
            // Still recurses into nested gameplay dirs (e.g. simulation/commitment).
            expect(targets.some((f) => f.split('/').length > 4)).toBe(true);

            const resolved = await Promise.all(
                targets.map(async (file) => {
                    const [determinism, fromFloat] = await Promise.all([
                        resolvedRule(file, DETERMINISM_RULE),
                        resolvedRule(file, FROMFLOAT_RULE),
                    ]);
                    return [
                        file,
                        {
                            [DETERMINISM_RULE]: severityOf(determinism),
                            [FROMFLOAT_RULE]: severityOf(fromFloat),
                        },
                    ] as const;
                }),
            );

            // Asserted as one map so a failure names every file that lost a rule.
            expect(Object.fromEntries(resolved)).toEqual(
                Object.fromEntries(
                    targets.map((file) => [file, { [DETERMINISM_RULE]: 2, [FROMFLOAT_RULE]: 2 }]),
                ),
            );
        },
        ESLINT_REACH_TIMEOUT_MS,
    );

    it(
        'resolves the fromFloat rule to off for per-game test files (the exemption)',
        async () => {
            const testFiles = [
                'apps/tactics/simulation/actions.test.ts',
                'apps/tactics/ai/tacticsPolicy.test.ts',
            ];
            for (const file of testFiles) {
                expect(existsSync(resolve(repoRoot, file)), `${file} must exist`).toBe(true);
            }
            const resolved = await Promise.all(
                testFiles.map(
                    async (file) =>
                        [file, severityOf(await resolvedRule(file, FROMFLOAT_RULE))] as const,
                ),
            );
            expect(Object.fromEntries(resolved)).toEqual(
                Object.fromEntries(testFiles.map((file) => [file, 0])),
            );
        },
        ESLINT_REACH_TIMEOUT_MS,
    );
});
