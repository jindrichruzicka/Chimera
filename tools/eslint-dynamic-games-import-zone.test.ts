/**
 * tools/eslint-dynamic-games-import-zone.test.ts
 *
 * The dynamic-import half of the module boundary: every engine zone that bans a
 * game statically must ban it lazily too.
 *
 * Stock `no-restricted-imports` returns visitors for `ImportDeclaration`,
 * `ExportNamedDeclaration`, `ExportAllDeclaration` and
 * `TSImportEqualsDeclaration` (measured on eslint 9.39.4). It never visits
 * `ImportExpression` — check 3 below is where an assertion falsifies that out
 * loud on a version bump.
 *
 * Describing another guard's scope in prose means re-deriving it, and a
 * re-derivation is wrong the moment that guard's zone moves. So where this
 * suite has something to say about another guard it asks the tool: check 4 puts
 * the question to `--print-config`, and check 3 to `eslint` itself.
 *
 * One relation IS asserted, because a reader who assumes the wrong one deletes
 * a guard: this rule and the `no-restricted-imports` group beside it do not
 * subsume each other in EITHER direction. Check 3 pins both halves on one zone.
 *
 * Five checks, because each is defeatable without the others (mirrors
 * apps/tactics/__tests__/eslint-determinism-fromfloat-zone.test.ts, which runs
 * the same shape over three):
 *
 * 0. **Probes are real** — every path the checks below hand to eslint is a file
 *    on disk, and the two helpers that could swallow a wrong one throw instead.
 *
 * 1. **Parity** — DERIVED, not enumerated. Every config object whose
 *    `no-restricted-imports` group names a game must also declare
 *    `chimera/no-dynamic-games-import`. A sixth zone added later is covered by
 *    this test the day it is written; a hardcoded list would not be. "Names a
 *    game" is decided by the rule's OWN `isGamesImport`, so the derivation and
 *    the rule cannot disagree about which of the two spellings — an
 *    `apps/`/`games/` segment, or a non-engine `@chimera-engine/*` package —
 *    counts. `GLOB_CLASSIFICATION` pins that; `OPTION_SHAPES` pins which
 *    `no-restricted-imports` option shapes the derivation reads a ban out of,
 *    and which one it does not.
 * 2. **Behaviour** — the rule fires on a lazy game load in each of those zones
 *    and stays silent on a lazy load of a non-game. Both halves: a rule that
 *    reported nothing would pass a bad-only suite by being switched off, and a
 *    rule that reported everything would pass it by being useless.
 * 3. **Both positions live** — on the same zone, the static form reports
 *    `no-restricted-imports` and the dynamic form reports
 *    `chimera/no-dynamic-games-import`. This is the check that fails on the
 *    mutation the guard exists for: delete the rule from the simulation zone and
 *    the static half stays green while a `simulation/` module lazily loading a
 *    game goes unreported.
 * 4. **Reach** — the config ESLint RESOLVES for a production file in each zone
 *    carries the rule at error severity, and a file outside every zone resolves
 *    it to nothing. A rule can be declared on a glob narrowed until it no longer
 *    covers the code it was written for, and only `--print-config` shows that.
 *    "Real" is not free: `--print-config` answers for a path that does not
 *    exist, so check 0 asserts every probe path is a file on disk first.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// A ceiling that is live now that the fixtures spawn asynchronously: under
// `spawnSync` the loop was blocked, so vitest's per-test timer could not fire
// mid-test. A fixture case ran under ten seconds on the CI runs read; the
// ceiling matches the reach cases' rather than sitting a slow day away.
const ESLINT_FIXTURE_TIMEOUT_MS = 60_000;
const ESLINT_REACH_TIMEOUT_MS = 60_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../');

function resolveFromRepo(relative: string): string {
    return resolve(repoRoot, relative);
}

const eslintBin = resolveFromRepo('node_modules/.bin/eslint');

const DYNAMIC_RULE = 'chimera/no-dynamic-games-import';
const STATIC_RULE = 'no-restricted-imports';

/**
 * The compiled classifier the rule itself uses, loaded from `dist` in the same
 * child process that reads the config. Group globs are specifier-shaped
 * (`apps/*`, `**\/apps/*`, `@chimera-engine/tactics`), so the rule's own
 * `isGamesImport` answers "does this glob name a game" for exactly the
 * spellings the rule classifies — and nothing else can drift.
 */
const GAME_PATH_MODULE = resolveFromRepo('electron/dist/dev-tools/eslint/game-path.js');

/**
 * Group globs the derivation must classify, and the answer. These are the
 * shapes `eslint.config.mjs` actually uses; a classifier that lost the package
 * arm would still pass a probe list made only of path globs.
 */
const GLOB_CLASSIFICATION: readonly (readonly [string, boolean])[] = [
    ['apps/*', true],
    ['apps/**', true],
    ['**/apps/*', true],
    ['games/**', true],
    ['@chimera-engine/tactics', true],
    ['@chimera-engine/tactics/*', true],
    ['@chimera-engine/ai', false],
    ['@chimera-engine/networking/*', false],
    ['renderer/*', false],
    ['**/electron/*', false],
    ['../../../*', false],
];

/**
 * `no-restricted-imports` option shapes, each carrying the SAME game specifier,
 * and what the derivation makes of it. MEASURED on eslint 9.39.4: every shape
 * below is a live ban — `new Linter().verify()` reports on all of them — so a
 * shape the derivation cannot read is a zone the parity check skips in silence.
 * Only `patterns`-of-groups is used in the tree today, so an arm that stopped
 * being read changes no config object's verdict and every other check here
 * stays green; these rows are the only thing that reds.
 *
 * The last `true` row and the row after it are the honest edge. A `regex` entry
 * is classified through its SOURCE text, which works when the source names the
 * game and does not when it reaches one by construction. That limit is pinned
 * rather than argued away: a zone written as a computed regex is skipped, and
 * the row below is what says so.
 */
const OPTION_SHAPES: readonly (readonly [string, unknown, boolean])[] = [
    ['top-level string list', ['error', '@chimera-engine/tactics'], true],
    ['top-level object list', ['error', { name: '@chimera-engine/tactics' }], true],
    // A top-level list is the ONE shape that can carry more than one element
    // (the schema rejects two object-config elements), so it is the one shape
    // where reading only the first would lose a ban.
    [
        'top-level list, game not first',
        ['error', '@chimera-engine/renderer', '@chimera-engine/tactics'],
        true,
    ],
    ['patterns of groups', ['error', { patterns: [{ group: ['@chimera-engine/tactics'] }] }], true],
    ['patterns of strings', ['error', { patterns: ['**/apps/*'] }], true],
    ['paths of objects', ['error', { paths: [{ name: '@chimera-engine/tactics' }] }], true],
    ['paths of strings', ['error', { paths: ['@chimera-engine/tactics'] }], true],
    [
        'patterns by literal regex',
        ['error', { patterns: [{ regex: '@chimera-engine/tactics' }] }],
        true,
    ],
    // The measured limit: a regex whose SOURCE names no game but whose matches
    // are games. Skipped, and the row records it.
    [
        'patterns by constructed regex (NOT read)',
        ['error', { patterns: [{ regex: '^@chimera-engine/(?!simulation|ai)' }] }],
        false,
    ],
    // Negative controls: the same shapes with no game named. Without them an arm
    // that returned `true` unconditionally would pass every row above.
    [
        'patterns naming no game',
        ['error', { patterns: [{ group: ['@chimera-engine/ai'] }] }],
        false,
    ],
    ['paths naming no game', ['error', { paths: [{ name: '@chimera-engine/networking' }] }], false],
    ['top-level list naming no game', ['error', '@chimera-engine/renderer'], false],
];

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

interface ChildOutput {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

/** The rejection `execFile` produces for a child that ran and exited non-zero. */
interface ExitRejection {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

function isExitRejection(error: unknown): error is ExitRejection {
    if (typeof error !== 'object' || error === null) {
        return false;
    }
    const candidate = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return (
        typeof candidate.code === 'number' &&
        typeof candidate.stdout === 'string' &&
        typeof candidate.stderr === 'string'
    );
}

/**
 * Run `file` from the repo root and collect its output, whatever its exit code.
 *
 * Asynchronous, and the reason is the test runner rather than the tool. A
 * Vitest worker reports each test's progress to the main process over an RPC
 * whose reply it must read within birpc's fixed 60 s window, and it reads that
 * reply only when its event loop is free. A `spawnSync` chain across the cases
 * below held the loop for as long as the chain ran, and on the CI runner the
 * chain crossed the minute: the run then ended with every test green and one
 * unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"`, which failed the
 * job. With `execFile` the loop is idle while the child runs, so the reply is
 * read as it arrives.
 *
 * A non-zero exit is an OUTPUT here, not a failure: eslint exits 1 whenever it
 * reports a violation, which is what most cases below ask it to do. A
 * rejection whose `code` is not a number — a missing binary, a child killed by
 * a signal, output past `execFile`'s `maxBuffer` — is rethrown as a failure.
 */
async function runChild(file: string, args: readonly string[]): Promise<ChildOutput> {
    try {
        const { stdout, stderr } = await execFileAsync(file, [...args], {
            cwd: repoRoot,
            encoding: 'utf8',
        });
        return { status: 0, stdout, stderr };
    } catch (error) {
        if (isExitRejection(error)) {
            return { status: error.code, stdout: error.stdout, stderr: error.stderr };
        }
        throw error;
    }
}

/**
 * Lint one repo-relative fixture with `--no-ignore` (the fixtures live in the
 * config's GLOBAL ignores so they never break the project lint run; `--no-ignore`
 * bypasses those, while a config object's own `ignores` still applies).
 */
async function runEslint(relPath: string): Promise<ESLintMessage[]> {
    const result = await runChild(eslintBin, [
        '--no-ignore',
        '--format',
        'json',
        resolve(repoRoot, relPath),
    ]);
    // Empty stdout means eslint never linted anything — a missing path, a config
    // crash. Returning `[]` there would let "no rule reported" and "nothing was
    // measured" look identical, which is how a probe pointed at a file that does
    // not exist reads as a clean pass.
    const output = result.stdout.trim();
    if (!output) {
        throw new Error(
            `eslint produced no JSON for ${relPath} (exit ${String(result.status)}): ${result.stderr.trim()}`,
        );
    }
    const parsed = JSON.parse(output) as ESLintResult[];
    return parsed[0]?.messages ?? [];
}

function ruleIdsOf(messages: ESLintMessage[]): string[] {
    return messages.flatMap((message) => (message.ruleId === null ? [] : [message.ruleId]));
}

interface ConfigObject {
    readonly files?: readonly string[];
    readonly bansGameStatically: boolean;
    readonly dynamicRule: unknown;
}

interface ConfigProbe {
    readonly objects: readonly ConfigObject[];
    /** `isGamesImport` applied to each glob in `GLOB_CLASSIFICATION`, in order. */
    readonly globVerdicts: readonly boolean[];
    /** `namesGame` applied to each option in `OPTION_SHAPES`, in order. */
    readonly optionShapeVerdicts: readonly boolean[];
}

/**
 * Every flat-config object, reduced to the two facts this suite compares — does
 * its `no-restricted-imports` option name a game, and does it declare the
 * dynamic rule — plus the classifier's verdict on the probe globs.
 *
 * Read out of a child process because `eslint.config.mjs` imports the COMPILED
 * plugin, which a Vitest worker would resolve through its own transform
 * pipeline. That child loads the compiled `isGamesImport` too, so the
 * derivation and the rule share one implementation rather than two that agree
 * today.
 */
async function probeConfig(): Promise<ConfigProbe> {
    const script = `
        const config = (await import('./eslint.config.mjs')).default;
        const { isGamesImport } = await import(${JSON.stringify(GAME_PATH_MODULE)});
        // Every specifier-shaped string reachable from a no-restricted-imports
        // option, across the shapes OPTION_SHAPES pins.
        const specifiersIn = (option) => {
            if (!Array.isArray(option)) return [];
            const found = [];
            const pushEntry = (entry) => {
                if (typeof entry === 'string') { found.push(entry); return; }
                if (entry === null || typeof entry !== 'object') return;
                if (typeof entry.name === 'string') found.push(entry.name);
                if (typeof entry.regex === 'string') found.push(entry.regex);
                for (const glob of entry.group ?? []) {
                    if (typeof glob === 'string') found.push(glob);
                }
            };
            // Everything after the severity. An element carrying \`paths\` or
            // \`patterns\` is the object-config form; anything else is an entry of
            // the top-level list form.
            for (const element of option.slice(1)) {
                const isObjectConfig =
                    element !== null &&
                    typeof element === 'object' &&
                    !Array.isArray(element) &&
                    (element.paths !== undefined || element.patterns !== undefined);
                if (isObjectConfig) {
                    for (const entry of element.paths ?? []) pushEntry(entry);
                    for (const entry of element.patterns ?? []) pushEntry(entry);
                } else {
                    pushEntry(element);
                }
            }
            return found;
        };
        const namesGame = (option) =>
            specifiersIn(option).some((s) => typeof s === 'string' && isGamesImport(s));
        process.stdout.write(JSON.stringify({
            objects: config.map((entry) => ({
                files: entry?.files,
                bansGameStatically: namesGame(entry?.rules?.[${JSON.stringify(STATIC_RULE)}]),
                dynamicRule: entry?.rules?.[${JSON.stringify(DYNAMIC_RULE)}] ?? null,
            })),
            globVerdicts: ${JSON.stringify(GLOB_CLASSIFICATION.map(([glob]) => glob))}
                .map((glob) => isGamesImport(glob)),
            optionShapeVerdicts: ${JSON.stringify(OPTION_SHAPES.map(([, option]) => option))}
                .map((option) => namesGame(option)),

        }));
    `;
    const result = await runChild(process.execPath, ['--input-type=module', '-e', script]);
    if (result.status !== 0) {
        throw new Error(`could not load eslint.config.mjs: ${result.stderr}`);
    }
    return JSON.parse(result.stdout) as ConfigProbe;
}

/**
 * Whether a config object declares the dynamic rule. Both parity filters read
 * it, so the two directions cannot drift apart, and the sentinel it compares
 * against is pinned by the first check in the parity block.
 */
function declaresDynamicRule(entry: ConfigObject): boolean {
    return entry.dynamicRule !== null;
}

async function configObjects(): Promise<readonly ConfigObject[]> {
    return (await probeConfig()).objects;
}

/** The `ruleId` entry the config ESLint actually resolves for `file`. */
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

function severityOf(rule: unknown): number | undefined {
    const value = Array.isArray(rule) ? rule[0] : rule;
    return typeof value === 'number' ? value : undefined;
}

/**
 * The module `code` names, from whichever specifier position it uses —
 * `from '…'` or `import('…')`. Comment lines are stripped first, because a
 * fixture header may quote a specifier in prose and a scan that cannot tell an
 * expression from a sentence would read the wrong one.
 *
 * Pure, and taking source text rather than a path, so all three of its
 * behaviours are reachable from a test: the two positions, the comment strip,
 * and the throw. The throw is the anti-vacuity guard for check 3 — a helper
 * that returned a shared sentinel when the regex stopped matching would make
 * that check's equality assertion pass while measuring nothing.
 */
function specifierIn(code: string): string {
    const statements = code
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');

    const specifier = /(?:from|import\s*\()\s*'([^']+)'/u.exec(statements)?.[1];
    if (specifier === undefined) {
        throw new Error('no import specifier found');
    }
    return specifier;
}

function specifierOf(relPath: string): string {
    // The read error propagates as itself: a missing or unreadable fixture is a
    // different defect from one that names no module, and relabelling it here
    // would report the wrong one.
    const code = readFileSync(resolve(repoRoot, relPath), 'utf8');
    try {
        return specifierIn(code);
    } catch (cause) {
        throw new Error(`no import specifier found in ${relPath}`, { cause });
    }
}

/**
 * One bad fixture per guarded GLOB, plus a real production file behind the same
 * glob for the reach case. Per glob rather than per config object, because
 * check 4 answers per PATH: a glob standing in for a sibling would leave that
 * sibling untested. The gameplay object carries four globs, of which three are
 * probed here — the fourth is the legacy per-game `actions` directory, which no
 * app ships, so there is no production file to point at.
 */
const ZONES: readonly {
    readonly name: string;
    readonly badFixture: string;
    readonly productionFile: string;
}[] = [
    {
        name: 'simulation/**',
        badFixture: 'simulation/engine/__tests__/fixtures/bad-dynamic-game-import.fixture.ts',
        productionFile: 'simulation/engine/StateReducer.ts',
    },
    {
        name: 'ai/**',
        badFixture: 'ai/engine/__tests__/fixtures/bad-dynamic-game-import.fixture.ts',
        productionFile: 'ai/engine/index.ts',
    },
    {
        name: 'networking/**',
        badFixture: 'networking/__tests__/fixtures/bad-dynamic-game-import.fixture.ts',
        productionFile: 'networking/index.ts',
    },
    {
        // Both probes below sit outside every `chimera/no-shell-games-import`
        // glob. The zone itself is not narrowed — the config declares it on all
        // of `renderer/**` — and the overlap where one exists is measured by
        // `resolves BOTH game-import rules on a shell page` below.
        name: 'renderer/**',
        badFixture: 'renderer/__tests__/fixtures/bad-dynamic-game-import.fixture.ts',
        productionFile: 'renderer/game/rendererGameRegistry.ts',
    },
    {
        name: 'electron/preload/**',
        badFixture: 'electron/preload/__tests__/fixtures/bad-dynamic-game-import.fixture.ts',
        productionFile: 'electron/preload/api.ts',
    },
    {
        name: 'apps/*/ai/**',
        badFixture: 'apps/tactics/ai/__tests__/fixtures/bad-dynamic-game-import.fixture.ts',
        productionFile: 'apps/tactics/ai/tacticsPolicy.ts',
    },
    {
        name: 'apps/*/simulation/**',
        badFixture: 'apps/tactics/simulation/__tests__/fixtures/bad-dynamic-game-import.fixture.ts',
        productionFile: 'apps/tactics/simulation/constants.ts',
    },
];

/** A file outside every declaring zone — the reach check's negative control. */
const OUTSIDE_ZONE_FILE = 'electron/main/index.ts';

/** A shell page, where this rule and `chimera/no-shell-games-import` overlap. */
const SHELL_PAGE_FILE = 'renderer/app/main-menu/page.tsx';

/** The lazy load of a NON-game, which must draw no report. */
const GOOD_FIXTURE = 'simulation/engine/__tests__/fixtures/good-dynamic-import.fixture.ts';

/** Check 3's pair: one specifier, two positions. */
const STATIC_FIXTURE = 'simulation/engine/__tests__/fixtures/bad-static-game-import.fixture.ts';
const DYNAMIC_FIXTURE = 'simulation/engine/__tests__/fixtures/bad-dynamic-game-import.fixture.ts';

// ── 0. The probes are real files ─────────────────────────────────────────────

describe('dynamic-import zone probes', () => {
    it('point at files that exist', () => {
        // Load-bearing for every check below, because neither tool fails loudly
        // on a phantom path: `eslint --print-config <missing>` exits 0 and prints
        // the config the globs WOULD resolve, so reach passes on a zone whose
        // last real source file was deleted. (`runEslint` throws on a missing path;
        // only this check says the path was meant to exist.)
        const missing = [
            ...ZONES.flatMap((zone) => [zone.badFixture, zone.productionFile]),
            OUTSIDE_ZONE_FILE,
            SHELL_PAGE_FILE,
            GOOD_FIXTURE,
            STATIC_FIXTURE,
            DYNAMIC_FIXTURE,
        ].filter((relPath) => !existsSync(resolve(repoRoot, relPath)));

        expect(missing).toEqual([]);
    });

    it('keep the negative control a LAZY load of a non-game', () => {
        // The one probe whose content nothing else holds. Rewrite the good
        // fixture's `import()` as a static import and it stops exercising the
        // rule at all, while "stays silent on a lazy load of a non-game module"
        // keeps passing — the useless-rule half of check 2 measuring nothing.
        // Its bad twins are held by the behaviour checks that expect a report.
        const code = readFileSync(resolve(repoRoot, GOOD_FIXTURE), 'utf8');

        expect(specifierIn(code)).toBe('../../ActionPipeline.js');
        expect(code).toContain(`import('../../ActionPipeline.js')`);
    });

    it(
        'fail loudly rather than measuring nothing when a probe path is wrong',
        async () => {
            // The two anti-vacuity guards behind every NEGATIVE assertion in this
            // suite. `runEslint` returning `[]` on a path eslint never linted, or
            // `specifierOf` relabelling an unreadable file as one that names no
            // module, would make "no rule reported" and "nothing was measured"
            // indistinguishable — which is how a phantom path reads as a pass.
            await expect(runEslint('simulation/engine/does-not-exist.ts')).rejects.toThrow(
                /produced no JSON/u,
            );
            expect(() => specifierOf('simulation/engine/does-not-exist.ts')).toThrow(/ENOENT/u);
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );
});

// ── 1. Parity ───────────────────────────────────────────────────────────────

describe('dynamic-import zone parity (Invariant #1)', () => {
    it('reads "declares the rule" off the sentinel probeConfig actually produces', async () => {
        // `probeConfig()` normalises an absent rule to `null`, and both filters
        // below turn on that agreement. Nothing else asserts the producer and
        // the consumer mean the same thing, so a comparator that drifted (say to
        // `=== undefined`) would classify EVERY object as "declares it" — the
        // gaps filter would then find no gaps in a config that was all gap, and
        // the subset check would pass while measuring nothing.
        const entries = await configObjects();

        expect(entries.filter((entry) => declaresDynamicRule(entry)).length).toBeGreaterThan(0);
        expect(entries.filter((entry) => !declaresDynamicRule(entry)).length).toBeGreaterThan(0);
        expect(
            entries.every((entry) => entry.dynamicRule === null || entry.dynamicRule === 'error'),
        ).toBe(true);
    });

    it('declares the dynamic rule in every config object that bans a game statically', async () => {
        const gaps = (await configObjects())
            .filter((entry) => entry.bansGameStatically && !declaresDynamicRule(entry))
            .map((entry) => entry.files?.join(', ') ?? '(no files glob)');

        expect(gaps).toEqual([]);
    });

    it('declares the dynamic rule in no config object that bans no game statically', async () => {
        // The converse direction. The rule's own report message tells the reader
        // "this zone bans the static form through no-restricted-imports"; a zone
        // that declared the rule without such a ban would emit a message that
        // lies about its own config, and the subset check above cannot see it.
        const orphans = (await configObjects())
            .filter((entry) => declaresDynamicRule(entry) && !entry.bansGameStatically)
            .map((entry) => entry.files?.join(', ') ?? '(no files glob)');

        expect(orphans).toEqual([]);
    });

    it('finds the static game bans it is comparing against', async () => {
        // Without this, a change that renamed the option shape out from under
        // `namesGame()` would make the parity check above vacuously green: zero
        // zones ban a game statically, so zero of them are missing the arm.
        //
        // A literal, not an offset off `ZONES`. `ZONES` counts PROBES and this
        // counts CONFIG OBJECTS; adding a probe for an object already covered
        // must not move this number. The relation between the two is stated
        // once, below, where the literal names pin it.
        const banning = (await configObjects()).filter((entry) => entry.bansGameStatically);

        expect(banning.map((entry) => entry.files?.join(', '))).toHaveLength(5);

        // The probe list gets its own literal, here rather than in the checks
        // that iterate it: checks 2 and 4 map their expectation off `ZONES`, so
        // deleting an entry drops that glob's behaviour AND reach probe while
        // both stay green. Parity would still cover the config object — but the
        // thing check 4 exists to catch — a glob narrowed until it no longer
        // covers that code — is exactly what would stop being tested. Seven
        // probes over five config objects; the gameplay object owns three.
        expect(ZONES.map((zone) => zone.name)).toEqual([
            'simulation/**',
            'ai/**',
            'networking/**',
            'renderer/**',
            'electron/preload/**',
            'apps/*/ai/**',
            'apps/*/simulation/**',
        ]);
    });

    it('classifies a group glob the way the rule classifies a specifier', async () => {
        // The derivation above asks `isGamesImport` whether a glob names a game.
        // A classifier that lost the package arm would still find every zone
        // that spells the ban as `apps/*` and miss one that bans a game only as
        // `@chimera-engine/<game>`. Both arms are pinned, plus the near misses.
        //
        // Literal length, for the same reason as `OPTION_SHAPES`: both sides map
        // off this array, so only the count sees a deleted row.
        expect(GLOB_CLASSIFICATION).toHaveLength(11);

        const { globVerdicts } = await probeConfig();

        expect(
            GLOB_CLASSIFICATION.map(([glob], index) => [glob, globVerdicts[index]] as const),
        ).toEqual(GLOB_CLASSIFICATION.map(([glob, expected]) => [glob, expected]));
    });

    it('reads a game ban out of the option shapes OPTION_SHAPES pins, and not the one it does not', async () => {
        // Both directions in one table: the shapes the derivation reads a ban
        // out of, the shape it cannot (a constructed regex), and the controls
        // that stop an always-true arm passing the lot.
        //
        // The literal length is load-bearing. Expectation and actual are both
        // mapped off this one array, so a deleted row shrinks them together and
        // removes its own coverage with the suite green — the length is the only
        // thing that notices.
        expect(OPTION_SHAPES).toHaveLength(12);

        const { optionShapeVerdicts } = await probeConfig();

        expect(
            OPTION_SHAPES.map(([label], index) => [label, optionShapeVerdicts[index]] as const),
        ).toEqual(OPTION_SHAPES.map(([label, , expected]) => [label, expected]));
    });

    it('enables the dynamic rule at error severity wherever it is declared', async () => {
        const declared = (await configObjects()).filter((entry) => declaresDynamicRule(entry));

        expect(declared.length).toBeGreaterThan(0);
        for (const entry of declared) {
            expect(entry.dynamicRule, entry.files?.join(', ')).toBe('error');
        }
    });
});

// ── 2. Behaviour ────────────────────────────────────────────────────────────

describe('dynamic-import zone behaviour', () => {
    for (const zone of ZONES) {
        it(
            `flags a lazy game load in ${zone.name}`,
            async () => {
                expect(ruleIdsOf(await runEslint(zone.badFixture))).toContain(DYNAMIC_RULE);
            },
            ESLINT_FIXTURE_TIMEOUT_MS,
        );
    }

    it(
        'stays silent on a lazy load of a non-game module',
        async () => {
            const ruleIds = ruleIdsOf(await runEslint(GOOD_FIXTURE));
            expect(ruleIds).not.toContain(DYNAMIC_RULE);
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );
});

// ── The helper check 3 rests on ──────────────────────────────────────────────

describe('specifierIn', () => {
    it('reads the module from either specifier position', () => {
        expect(specifierIn(`import { x } from '../../apps/tactics/rules.js';`)).toBe(
            '../../apps/tactics/rules.js',
        );
        expect(specifierIn(`export const f = () => import('@chimera-engine/tactics');`)).toBe(
            '@chimera-engine/tactics',
        );
    });

    it('reads the code, not the prose above it', () => {
        // A fixture header may name a specifier while explaining itself. Without
        // the comment strip this returns the sentence's module and check 3
        // compares the wrong pair — invisibly, because both fixtures would still
        // parse to *something*.
        expect(
            specifierIn(
                [
                    `// Its twin lazily loads import('@chimera-engine/other-game/x.js') instead.`,
                    `import { x } from '../../apps/tactics/rules.js';`,
                ].join('\n'),
            ),
        ).toBe('../../apps/tactics/rules.js');
    });

    it('throws when there is no specifier to read', () => {
        // The anti-vacuity guard. A sentinel return here would make check 3's
        // equality assertion pass on two files that name nothing at all.
        expect(() => specifierIn('export const x = 1;')).toThrow(/no import specifier/u);
    });
});

// ── 3. Both positions live ──────────────────────────────────────────────────

describe('dynamic-import zone — static and dynamic positions both covered', () => {
    it(
        'reports the static form under no-restricted-imports and the lazy one under the chimera rule',
        async () => {
            // The two fixtures name the SAME specifier and differ only in the
            // position it sits in — asserted, not arranged. Without this, a
            // one-line edit to either file makes the two `not.toContain`
            // assertions below hold because the specifiers differ rather than
            // because the positions do, and the suite stays green either way.
            expect(specifierOf(STATIC_FIXTURE)).toBe(specifierOf(DYNAMIC_FIXTURE));

            const staticMessages = await runEslint(STATIC_FIXTURE);
            const staticIds = ruleIdsOf(staticMessages);
            const dynamicIds = ruleIdsOf(await runEslint(DYNAMIC_FIXTURE));

            expect(staticIds).toContain(STATIC_RULE);
            // …reported by the group that names a GAME, which the rule id alone
            // no longer shows. The fixture's specifier is four levels up, and
            // the simulation zone now also repeats the repo-wide `../../../*`
            // group, so this file draws two `no-restricted-imports` reports and
            // the id would still be here with every game pattern deleted.
            expect(
                staticMessages
                    .filter((message) => message.ruleId === STATIC_RULE)
                    .map((message) => message.message),
            ).toContainEqual(expect.stringContaining('game apps (apps/*)'));
            expect(dynamicIds).toContain(DYNAMIC_RULE);
            // Neither guard subsumes the other, asserted in both directions —
            // the docblock's one claim about their relation, and the pair that
            // makes deleting either one visible. Both hold on one specifier:
            // the static rule does not reach the lazy position, and the dynamic
            // rule does not reach the static one. Deleting the rule from the
            // simulation zone leaves the first pair green and reds the second.
            expect(dynamicIds).not.toContain(STATIC_RULE);
            expect(staticIds).not.toContain(DYNAMIC_RULE);
        },
        ESLINT_FIXTURE_TIMEOUT_MS,
    );
});

// ── 4. Reach ────────────────────────────────────────────────────────────────

describe('dynamic-import zone reach', () => {
    it(
        'resolves the rule at error severity for a real production file in every zone',
        async () => {
            const resolved = await Promise.all(
                ZONES.map(async (zone) => [
                    zone.productionFile,
                    severityOf(await resolvedRule(zone.productionFile, DYNAMIC_RULE)),
                ]),
            );

            expect(Object.fromEntries(resolved)).toEqual(
                Object.fromEntries(ZONES.map((zone) => [zone.productionFile, 2])),
            );
        },
        ESLINT_REACH_TIMEOUT_MS,
    );

    it(
        'resolves the rule to nothing outside every declaring zone',
        async () => {
            // The negative control this check would otherwise lack: a
            // `resolvedRule` that read the wrong key leaves reach asserting
            // nothing, and reach is the only check here that catches a zone glob
            // narrowed past the code it was written for.
            //
            // Read through `severityOf`, deliberately: every other reach
            // assertion expects 2, so a `severityOf` that returned 2 whatever it
            // was handed would leave all of them green. This is the one call
            // whose answer is not 2.
            const outside = await resolvedRule(OUTSIDE_ZONE_FILE, DYNAMIC_RULE);

            expect(outside).toBeUndefined();
            expect(severityOf(outside)).toBeUndefined();

            // Why the absence is deliberate rather than a gap — asked of
            // `--print-config` rather than asserted in a comment, which is what
            // this suite does with any claim about another guard's scope.
            expect(
                severityOf(await resolvedRule(OUTSIDE_ZONE_FILE, 'chimera/no-main-games-import')),
            ).toBe(2);
        },
        ESLINT_REACH_TIMEOUT_MS,
    );

    it(
        'resolves BOTH game-import rules on a shell page, as the renderer zone comment claims',
        async () => {
            // `eslint.config.mjs` states that on the shell pages this rule
            // overlaps `chimera/no-shell-games-import` and that the overlap is
            // deliberate rather than an oversight. Unpinned, that sentence rots
            // silently the day the shell globs are carved out of the renderer
            // zone — the carve-out would be invisible and the comment wrong.
            expect([
                severityOf(await resolvedRule(SHELL_PAGE_FILE, DYNAMIC_RULE)),
                severityOf(await resolvedRule(SHELL_PAGE_FILE, 'chimera/no-shell-games-import')),
            ]).toEqual([2, 2]);
        },
        ESLINT_REACH_TIMEOUT_MS,
    );
});
