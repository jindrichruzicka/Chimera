/**
 * electron/main/__tests__/eslint-no-console.test.ts
 *
 * ESLint smoke test for Invariant #67's `console.*` ban in the main process.
 *
 * Three checks, because each is defeatable without the others:
 *
 * 1. **Behaviour** — ESLint runs against two fixtures: `no-console` must fire on
 *    a raw `console.log` from an electron/main module and must not fire on the
 *    same reporting done through an injected `Logger`. This says the rule
 *    discriminates; it says nothing about where the rule applies.
 * 2. **Shape** — the zone object must configure the rule at `error` over the
 *    expected globs, declare NO `ignores`, and be the only entry configuring
 *    `no-console`. An `ignores` here disables the rule on production modules
 *    while every fixture still passes, and `pnpm lint` stays green either way,
 *    because the orphaned `eslint-disable` is only a WARNING and no package sets
 *    `--max-warnings`.
 * 3. **Reach** — the config ESLint RESOLVES for a file from every subtree must
 *    carry the rule at severity 2. The config's global `ignores` sit outside the
 *    zone object, so exempting a subtree there leaves the zone reading exactly
 *    as documented and the shape check green. The probe list is derived from the
 *    filesystem, because a hand-written one silently stops covering a subtree
 *    added later.
 *
 * Without this test the zone is not a ratchet at all — deleting it from
 * `eslint.config.mjs` leaves `pnpm lint` green, which is how a guard becomes a
 * no-op without anyone noticing.
 *
 * Mirrors `eslint-import-boundary.test.ts` (Invariant #47) in this directory.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ESLINT_FIXTURE_TIMEOUT_MS = 20_000;
// The reach case spawns one `--print-config` per subtree. They run concurrently,
// but the ceiling has to cover a cold start of all of them at once.
const ESLINT_REACH_TIMEOUT_MS = 60_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../');
const fixturesDir = resolve(__dirname, 'fixtures');

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
 * The `no-console` entry of the config ESLint actually resolves for `file`.
 *
 * A globally-ignored path is reported as such rather than thrown on: for those
 * `--print-config` prints the literal `undefined` and exits 0, so a bare
 * `JSON.parse` would fail with a parse error that says nothing about the
 * evasion it just caught.
 */
async function resolvedNoConsoleRule(file: string): Promise<unknown> {
    const eslintBin = resolve(repoRoot, 'node_modules/.bin/eslint');
    const { stdout } = await execFileAsync(eslintBin, ['--print-config', file], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    if (stdout.trim() === 'undefined') {
        return 'FILE IS GLOBALLY IGNORED';
    }

    const config = JSON.parse(stdout) as { rules?: Record<string, unknown> };
    return config.rules?.['no-console'];
}

interface NoConsoleZone {
    readonly files?: readonly string[];
    readonly ignores?: readonly string[];
    readonly rule: unknown;
}

/** Every flat-config entry that configures `no-console`, in declaration order. */
function noConsoleZones(): NoConsoleZone[] {
    const script = `
        const config = (await import('./eslint.config.mjs')).default;
        const zones = config
            .filter((entry) => entry?.rules && Object.hasOwn(entry.rules, 'no-console'))
            .map((entry) => ({
                files: entry.files,
                ignores: entry.ignores,
                rule: entry.rules['no-console'],
            }));
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

    return JSON.parse(result.stdout) as NoConsoleZone[];
}

/**
 * One repo-relative `.ts` file from `dir` and from every directory beneath it.
 *
 * Recursive on purpose: a depth-1 walk leaves nested subtrees (`session/
 * __test-support__`) unprobed, and adding one of those to the config's global
 * `ignores` then passes every assertion here.
 */
function sourceFilePerSubtree(dir: string): string[] {
    const entries = readdirSync(resolve(repoRoot, dir), { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
    );

    const own = entries.find((e) => e.isFile() && e.name.endsWith('.ts'));
    const found = own !== undefined ? [`${dir}/${own.name}`] : [];

    for (const entry of entries) {
        // `__tests__/fixtures/` is in the config's GLOBAL ignores on purpose —
        // the fixtures above are linted explicitly with `--no-ignore` — so it is
        // the one subtree that must NOT be probed for coverage. Matched by name
        // at any depth, since that is where the ignore pattern puts it.
        if (entry.isDirectory() && entry.name !== 'fixtures') {
            found.push(...sourceFilePerSubtree(`${dir}/${entry.name}`));
        }
    }

    return found;
}

/**
 * One file from every subtree the zone claims, derived rather than listed:
 * `electron/main` and everything beneath it (test-support and `__tests__`
 * included — the zone declares no `ignores`, and the docs say so), plus every
 * consumer composition root under `apps/*`.
 */
function probeTargets(): string[] {
    // The composition root by name, not by luck: the derivation takes whichever
    // file sorts first in a directory, and `index.ts` is the module that owns
    // the one sanctioned `eslint-disable` the whole zone exists to isolate.
    const targets = ['electron/main/index.ts', ...sourceFilePerSubtree('electron/main')];

    for (const app of readdirSync(resolve(repoRoot, 'apps'), { withFileTypes: true })) {
        // A game need not ship an Electron entry point; only probe what exists,
        // so a future app without one does not fail as if the rule had been lost.
        if (
            app.isDirectory() &&
            existsSync(resolve(repoRoot, `apps/${app.name}/electron/main.ts`))
        ) {
            targets.push(`apps/${app.name}/electron/main.ts`);
        }
    }

    return [...new Set(targets)].sort();
}

function runEslint(fixtureName: string): ESLintMessage[] {
    const fixturePath = resolve(fixturesDir, fixtureName);
    const eslintBin = resolve(repoRoot, 'node_modules/.bin/eslint');
    // `--no-ignore` is required: the fixtures dir is in eslint.config.mjs's
    // GLOBAL ignores so it never breaks the project lint run. It bypasses those
    // only — a config object's own `ignores` still applies, which is why the
    // no-console zone deliberately declares none.
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

    const parsed = JSON.parse(output) as ESLintResult[];
    return parsed[0]?.messages ?? [];
}

describe('ESLint no-console — electron/main logs only through the injected Logger (Invariant #67)', () => {
    it(
        'flags a raw console.* call from an electron/main module',
        () => {
            const messages = runEslint('bad-console-log.fixture.ts');
            const ruleIds = messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);

            expect(ruleIds).toContain('no-console');
            // An error, not a warning: `pnpm lint` sets no `--max-warnings`, so a
            // warning would leave the gate green and the ratchet inert.
            const noConsole = messages.find((m) => m.ruleId === 'no-console');
            expect(noConsole?.severity).toBe(2);
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );

    it(
        'does not flag the same reporting done through an injected Logger',
        () => {
            const messages = runEslint('good-injected-logger.fixture.ts');
            const ruleIds = messages.filter((m) => m.ruleId !== null).map((m) => m.ruleId!);

            expect(ruleIds).not.toContain('no-console');
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );

    it('is configured in exactly one place, at error, with no ignores', () => {
        // Loaded through node rather than imported: the flat config is untyped
        // ESM whose entries carry plugin objects, so this both keeps the test
        // typed and evaluates the config exactly as ESLint itself resolves it.
        const zones = noConsoleZones();

        // More than one would mean a later entry can turn the rule off for a
        // subset without touching the zone the docs point at.
        expect(zones).toHaveLength(1);
        const zone = zones[0]!;
        expect(zone.rule).toBe('error');
        // The claim Invariant #67 and eslint.config.mjs both make in prose. An
        // `ignores` here applies even under `--no-ignore`, so it would neuter
        // the fixture cases above as well as the rule itself.
        expect(zone.ignores).toBeUndefined();
        expect(zone.files).toEqual(['electron/main/**/*.{ts,tsx}', 'apps/*/electron/main.ts']);
    });

    // The fixtures prove the rule WORKS and the shape test proves the zone SAYS
    // the right thing; this proves ESLint RESOLVES it that way for real files.
    // The three are independent: the global ignores at the top of the config can
    // exempt a subtree without the zone changing at all.
    it(
        'resolves no-console at error severity for a file in every subtree it covers',
        async () => {
            const targets = probeTargets();
            // Guards the derivation itself: a `probeTargets` that silently
            // returned [] or one entry would make this whole case vacuous.
            expect(targets.length).toBeGreaterThan(10);
            expect(targets).toContain('electron/main/index.ts');
            expect(targets).toContain('apps/tactics/electron/main.ts');
            // And that it still recurses. A depth-1 walk covers every path above
            // while leaving nested subtrees — `session/__test-support__` — free
            // to be dropped into the global `ignores` unnoticed.
            expect(targets.some((file) => file.split('/').length > 4)).toBe(true);

            const resolved = await Promise.all(
                targets.map(async (file) => [file, await resolvedNoConsoleRule(file)] as const),
            );

            // Asserted as one map so a failure names every file that lost the
            // rule, not just the first.
            expect(Object.fromEntries(resolved)).toEqual(
                Object.fromEntries(targets.map((file) => [file, [2, {}]])),
            );
        },
        ESLINT_REACH_TIMEOUT_MS,
    );
});
