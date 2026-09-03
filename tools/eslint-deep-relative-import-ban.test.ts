/**
 * tools/eslint-deep-relative-import-ban.test.ts
 *
 * The deep-relative import ban — `../../../*`, declared as a repo-wide rule in
 * `eslint.config.mjs` and repeated per zone — as it RESOLVES in the
 * per-package zones that name `no-restricted-imports` themselves.
 *
 * Why a zone that re-declares the rule has to repeat the group is at
 * `eslint.config.mjs`, base block. Five zones had dropped it; the group is now
 * repeated inside four of them, and this file pins that it stays repeated in
 * those four — and classifies every block that sets the rule, which is why the
 * first describe is a CENSUS of the config rather than a list of the zones
 * someone remembered.
 *
 * `renderer/**` is the fifth zone and is EXEMPT; the argument for that is at
 * the zone itself in `eslint.config.mjs`. The last describe stands in for the
 * missing rule: it resolves every deep-relative specifier in renderer source
 * OUTSIDE the globally lint-ignored `__tests__/fixtures`, which holds a
 * deliberate escape, and asserts none of the rest leaves the package — the
 * property the ban would have held. It also asserts at least one intra-package
 * reach still exists, so the exemption reds once it stops being load-bearing.
 *
 * How the assertions are shaped, and why:
 *
 *   Probes must EXIST. `eslint --print-config <missing-path>` exits 0 and
 *   answers for the path the globs WOULD match, so every check below passes
 *   against a deleted probe. One check says the probes are real; another says
 *   the probe list has not drifted from the census.
 *
 *   Every block is covered by the census disposition check, which reads what
 *   each one DECLARES. The probes add per-file `--print-config` resolution on
 *   top, for the blocks that have one.
 *
 *   Severity is asserted SEPARATELY. `'error'` → `'warn'` still resolves every
 *   pattern, still reports, and still exits 0 — no package in this repo passes
 *   `--max-warnings` — so a downgrade disarms every pattern assertion here
 *   while leaving them all green.
 *
 *   Patterns are asserted by CONTAINMENT, so a ban added later for an unrelated
 *   reason does not red this file. Messages are asserted WHOLE — every copy of
 *   the deep-relative message against one string, and each zone's own message
 *   against itself. A group looked up by a signature phrase leaves everything
 *   outside that phrase free to be deleted in silence.
 *
 *   Each zone's own group must still hold its own patterns and must NOT hold
 *   `../../../*`. A deep-relative pattern folded into the boundary group still
 *   bans the import — under prose about the wrong boundary, which sends the
 *   reader to fix the wrong thing.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ESLINT_PRINT_CONFIG_TIMEOUT_MS = 60_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../');
const eslintBin = resolve(repoRoot, 'node_modules/.bin/eslint');

/** The repo-wide base group, declared once at `eslint.config.mjs` and repeated per zone. */
const DEEP_RELATIVE = '../../../*';
const DEEP_RELATIVE_MESSAGE =
    'Do not reach across package boundaries with deep relative paths. Use @chimera-engine/* aliases.';

interface ZoneGroup {
    /**
     * The group's message, WHOLE. It is how the group is found in the resolved
     * set and, at the same time, the assertion that it still reads as it did:
     * a signature phrase would leave everything outside the phrase — the
     * invariant references, the §3 pointers — free to be deleted in silence.
     */
    readonly message: string;
    /** The patterns the zone declares. Asserted by containment, not equality. */
    readonly patterns: readonly string[];
}

interface Zone {
    readonly name: string;
    /** A real source file the zone matches, and the last block to set the rule for it. */
    readonly probe: string;
    readonly ownGroups: readonly ZoneGroup[];
    /** Whether the zone must repeat the repo-wide deep-relative group. */
    readonly carriesDeepRelative: boolean;
}

const AI_AND_GAME_GAMEPLAY_GROUP: ZoneGroup = {
    message:
        'ai/ and per-game code must not import from networking, renderer, electron, or game-app aliases. See coding-standards.md §3.',
    patterns: [
        '@chimera-engine/networking',
        '@chimera-engine/networking/*',
        '@chimera-engine/renderer',
        '@chimera-engine/renderer/*',
        '@chimera-engine/electron',
        '@chimera-engine/electron/*',
        '@chimera-engine/tactics',
        '@chimera-engine/tactics/*',
        'renderer/*',
        '**/renderer/*',
        'electron/*',
        '**/electron/*',
        'networking/*',
        '**/networking/*',
        'apps/*',
        '**/apps/*',
    ],
};

const ZONES: readonly Zone[] = [
    {
        // The zone's `ai/**` arm.
        name: 'ai/**',
        probe: 'ai/engine/AIBrain.ts',
        ownGroups: [AI_AND_GAME_GAMEPLAY_GROUP],
        carriesDeepRelative: true,
    },
    {
        // The SAME config block, reached through its per-game arm. One block,
        // two very differently-shaped globs — a zone can be split later and
        // only a probe on each arm notices.
        name: 'apps/*/ai/** (same block)',
        probe: 'apps/tactics/ai/tacticsPolicy.ts',
        ownGroups: [AI_AND_GAME_GAMEPLAY_GROUP],
        carriesDeepRelative: true,
    },
    {
        name: 'networking/**',
        probe: 'networking/index.ts',
        ownGroups: [
            {
                message:
                    'networking/ must not import from ai, renderer, electron, or game apps (apps/*) — @chimera-engine/simulation is its only @chimera-engine/* dependency. The barrel exposes provider/transport interfaces only; concrete providers stay internal (Invariant #47). See coding-standards.md §3.',
                patterns: [
                    '@chimera-engine/ai',
                    '@chimera-engine/ai/*',
                    '@chimera-engine/renderer',
                    '@chimera-engine/renderer/*',
                    '@chimera-engine/electron',
                    '@chimera-engine/electron/*',
                    '@chimera-engine/tactics',
                    '@chimera-engine/tactics/*',
                    'ai/*',
                    '**/ai/*',
                    'renderer/*',
                    '**/renderer/*',
                    'electron/*',
                    '**/electron/*',
                    'apps/*',
                    '**/apps/*',
                ],
            },
        ],
        carriesDeepRelative: true,
    },
    {
        name: 'simulation/**',
        probe: 'simulation/engine/ActionPipeline.ts',
        ownGroups: [
            {
                message:
                    '@chimera-engine/simulation is the zero-dependency engine leaf — it must not import from ai, networking, renderer, electron, or game apps (apps/*). Keep contracts in @chimera-engine/simulation/foundation; only the reserved engine: namespace crosses cuts (Invariant #107).',
                patterns: [
                    '@chimera-engine/ai',
                    '@chimera-engine/ai/*',
                    '@chimera-engine/networking',
                    '@chimera-engine/networking/*',
                    '@chimera-engine/renderer',
                    '@chimera-engine/renderer/*',
                    '@chimera-engine/electron',
                    '@chimera-engine/electron/*',
                    'ai/*',
                    '**/ai/*',
                    'networking/*',
                    '**/networking/*',
                    'renderer/*',
                    '**/renderer/*',
                    'electron/*',
                    '**/electron/*',
                    'apps/*',
                    '**/apps/*',
                ],
            },
        ],
        carriesDeepRelative: true,
    },
    {
        name: 'electron/preload/**',
        probe: 'electron/preload/api.ts',
        ownGroups: [
            {
                message:
                    'electron/preload is the sole renderer-facing surface and depends on @chimera-engine/simulation contracts only. It must not import the ai/networking runtime, the renderer UI library, a game package, or electron/main internals. See coding-standards.md §3.',
                patterns: [
                    '@chimera-engine/ai',
                    '@chimera-engine/ai/*',
                    '@chimera-engine/networking',
                    '@chimera-engine/networking/*',
                    '@chimera-engine/renderer',
                    '@chimera-engine/renderer/*',
                    '@chimera-engine/tactics',
                    '@chimera-engine/tactics/*',
                    '@chimera-engine/electron/main',
                    '@chimera-engine/electron/main/*',
                    'ai/*',
                    '**/ai/*',
                    'networking/*',
                    '**/networking/*',
                    'renderer/*',
                    '**/renderer/*',
                    'apps/*',
                    '**/apps/*',
                    '../main/*',
                    '../../main/*',
                    '**/electron/main/*',
                ],
            },
        ],
        carriesDeepRelative: true,
    },
    {
        // The exempt fifth zone — see the docblock. Its own groups are pinned
        // here for the same reason as everyone else's; only the deep-relative
        // group is absent, and that absence is asserted rather than assumed.
        name: 'renderer/**',
        probe: 'renderer/state/cameraStore.ts',
        ownGroups: [
            {
                message:
                    'renderer/ must not import the @chimera-engine/ai or @chimera-engine/networking runtime — the renderer depends on @chimera-engine/simulation contracts only (Invariant #1). Game-facing renderer code is exposed through the surfaces chimera/no-game-renderer-internals permits (Invariant #96). See coding-standards.md §3.',
                patterns: [
                    '@chimera-engine/ai',
                    '@chimera-engine/ai/*',
                    '@chimera-engine/networking',
                    '@chimera-engine/networking/*',
                    'ai/*',
                    '**/ai/*',
                    'networking/*',
                    '**/networking/*',
                ],
            },
            {
                message:
                    'renderer/ must name no game (Invariants #80, #94). The renderer host is a runtime injection seam; a game enters only at its own consumer-app renderer composition root (apps/<game>/renderer/register.ts), selected by the chimera-game-registration build alias — never by a renderer source import. See coding-standards.md §3.',
                patterns: [
                    '@chimera-engine/tactics',
                    '@chimera-engine/tactics/*',
                    'apps/*',
                    'apps/**',
                    '**/apps/*',
                    '**/apps/**',
                    'games/*',
                    'games/**',
                    '**/games/*',
                    '**/games/**',
                ],
            },
        ],
        carriesDeepRelative: false,
    },
];

/** The deliberate `'off'` — each app's e2e suite reaches electron source on purpose. */
const E2E_PROBES = ['apps/tactics/e2e/global-setup.ts', 'apps/action/e2e/global-setup.ts'];

/**
 * What a config block that sets `no-restricted-imports` is allowed to be.
 *
 *   carries          declares the rule at `'error'` and repeats the base group.
 *   renderer-exempt  `'error'` without the group — see the zone in
 *                    `eslint.config.mjs` for why it is the only one.
 *   off              disables the rule wholesale.
 */
type Disposition = 'carries' | 'renderer-exempt' | 'off';

interface CensusRow {
    /** The block's `files` array — its identity in the config, order-insensitive. */
    readonly files: readonly string[];
    readonly disposition: Disposition;
    /** The probes this suite resolves for the block, if any. */
    readonly probes: readonly string[];
}

/**
 * EVERY flat-config object that sets `no-restricted-imports`, and what each one
 * is. The reason this is a census and not a list of the interesting ones: the
 * defect it guards against is a NEW zone that names the rule and forgets the
 * group, which is exactly how the defect arrived — the app-root block added for
 * the electron ban. A per-zone probe list cannot see a zone nobody added to it;
 * a census reds until the new block is classified here.
 */
const CENSUS: readonly CensusRow[] = [
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        disposition: 'carries',
        probes: [],
    },
    {
        files: [
            'ai/**/*.{ts,tsx}',
            'apps/*/actions/**/*.{ts,tsx}',
            'apps/*/simulation/**/*.{ts,tsx}',
            'apps/*/ai/**/*.{ts,tsx}',
            'apps/*/content/**/*.{ts,tsx}',
            'apps/*/settings-schema.{ts,tsx}',
        ],
        disposition: 'carries',
        probes: ['ai/engine/AIBrain.ts', 'apps/tactics/ai/tacticsPolicy.ts'],
    },
    {
        files: ['apps/*/*.{ts,tsx}'],
        disposition: 'carries',
        probes: [],
    },
    {
        files: ['networking/**/*.{ts,tsx}'],
        disposition: 'carries',
        probes: ['networking/index.ts'],
    },
    {
        files: ['simulation/**/*.{ts,tsx}'],
        disposition: 'carries',
        probes: ['simulation/engine/ActionPipeline.ts'],
    },
    {
        files: ['renderer/**/*.{ts,tsx}'],
        disposition: 'renderer-exempt',
        probes: ['renderer/state/cameraStore.ts'],
    },
    {
        files: ['electron/preload/**/*.{ts,tsx}'],
        disposition: 'carries',
        probes: ['electron/preload/api.ts'],
    },
    { files: ['apps/*/e2e/**/*.{ts,tsx}'], disposition: 'off', probes: E2E_PROBES },
    {
        files: ['electron/main/**/*.{ts,tsx}'],
        disposition: 'carries',
        probes: [],
    },
];

/** One config block, reduced to the facts the census compares. */
interface DeclaringBlock {
    readonly files: readonly string[];
    /** The severity as DECLARED — `'error'`, `'warn'` or `'off'`, not the numeric form. */
    readonly severity: unknown;
    readonly patterns: readonly string[];
    /** The message on whichever group carries `../../../*`, if any. */
    readonly deepRelativeMessage: string | null;
}

/**
 * Config children this file has actually started. The memoisation test reads
 * it: promise identity would pass a cache that still fires a child and throws
 * the result away, and the count is what the property is about.
 */
let configChildRuns = 0;

/**
 * Every config object that sets the rule, read out of a CHILD process:
 * `eslint.config.mjs` imports the compiled plugin, which a Vitest worker would
 * resolve through its own transform pipeline. Mirrors `probeConfig()` in
 * tools/eslint-dynamic-games-import-zone.test.ts.
 *
 * Asynchronous for the same reason that sibling is: a Vitest worker answers the
 * pool's `onTaskUpdate` RPC only while its own event loop is free, and birpc's
 * window is a fixed 60 s. A synchronous child holds the loop for as long as it
 * runs, and it holds vitest's per-test timer with it — so under full-suite load
 * the run ended with this file's slowest test recorded well past a timeout it
 * could not be interrupted at, plus one unhandled `[vitest-worker]: Timeout
 * calling "onTaskUpdate"`. With `execFile` the loop is idle while the child
 * runs. Kept separate from the memoised accessor below so the test that pins
 * that property always spawns, whatever order the file's tests run in.
 */
async function loadDeclaringBlocks(): Promise<readonly DeclaringBlock[]> {
    configChildRuns++;
    const script = `
        const config = (await import('./eslint.config.mjs')).default;
        const blocks = [];
        for (const entry of config) {
            const option = entry?.rules?.['no-restricted-imports'];
            if (option === undefined) continue;
            const normalized = Array.isArray(option) ? option : [option];
            const patterns = [];
            let deepRelativeMessage = null;
            for (const element of normalized.slice(1)) {
                for (const group of element?.patterns ?? []) {
                    for (const glob of group.group ?? []) patterns.push(glob);
                    if ((group.group ?? []).includes('../../../*')) {
                        deepRelativeMessage = group.message ?? null;
                    }
                }
            }
            blocks.push({
                files: entry.files ?? [],
                severity: normalized[0],
                patterns,
                deepRelativeMessage,
            });
        }
        process.stdout.write(JSON.stringify(blocks));
    `;
    return JSON.parse(
        await runConfigChild(process.execPath, ['--input-type=module', '-e', script]),
    ) as DeclaringBlock[];
}

/** The rejection `execFile` produces for a child that ran and exited non-zero. */
interface ExitRejection {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

/**
 * Whether a rejection is a child that RAN and exited non-zero, as opposed to
 * one that never ran or was cut short. Mirrors `isExitRejection()` in
 * tools/eslint-dynamic-games-import-zone.test.ts.
 *
 * `code` is the discriminator, and it has to be: node attaches `stdout` and
 * `stderr` to every `execFile` rejection, so a stderr check cannot separate the
 * classes. A child that exited carries a numeric `code`; a missing binary
 * carries `'ENOENT'`, output past `maxBuffer` carries
 * `'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'`, and a signal kill carries none.
 */
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
 * Run a child and return its stdout, reporting a config that failed to load
 * under the message this file's callers expect.
 *
 * Only a child that ran and exited non-zero is that failure. Everything else —
 * a missing binary, a signal kill, output past `maxBuffer` — is rethrown as it
 * arrived, so it keeps its own message and cause instead of being flattened
 * into a `could not load` line with an empty stderr behind it.
 */
async function runConfigChild(bin: string, args: readonly string[]): Promise<string> {
    try {
        const { stdout } = await execFileAsync(bin, [...args], {
            cwd: repoRoot,
            encoding: 'utf8',
        });
        return stdout;
    } catch (error) {
        if (!isExitRejection(error)) {
            throw error;
        }
        throw new Error(`could not load eslint.config.mjs: ${error.stderr}`);
    }
}

/**
 * The census, memoised: every call site below asks for the same answer, and
 * each miss is another child process competing with the rest of the suite.
 * Mirrors `resolutionCache` for the `--print-config` probes.
 */
let declaringBlocksCache: Promise<readonly DeclaringBlock[]> | undefined;

function declaringBlocks(): Promise<readonly DeclaringBlock[]> {
    declaringBlocksCache ??= loadDeclaringBlocks();
    return declaringBlocksCache;
}

/**
 * A block's identity. Sorted first, because a flat-config `files` array is a
 * list of alternatives — reordering it changes nothing, and an identity that
 * noticed would fail as "absent from the config", sending the reader to look
 * for a block nobody deleted.
 */
const signatureOf = (files: readonly string[]): string => JSON.stringify([...files].sort());

/**
 * Whether a block as DECLARED matches the disposition the census assigns it.
 * Pure, and probed against synthetic blocks below: with either conjunct
 * dropped this returns true for a block that lost the group or was downgraded
 * to `'warn'`, which is the whole defect the census exists to catch.
 */
function matchesDisposition(disposition: Disposition, block: DeclaringBlock): boolean {
    const carriesGroup = block.patterns.includes(DEEP_RELATIVE);
    switch (disposition) {
        case 'carries':
            return carriesGroup && block.severity === 'error';
        case 'renderer-exempt':
            return !carriesGroup && block.severity === 'error';
        case 'off':
            return block.severity === 'off';
    }
}

interface ResolvedRestrictedImports {
    /** 0 off, 1 warn, 2 error — the half a pattern list cannot see. */
    readonly severity: number | undefined;
    /** Every restricted pattern, flattened and de-duplicated. */
    readonly patterns: readonly string[];
    /** The same patterns, still grouped and carrying the message each reports. */
    readonly groups: readonly { readonly group: readonly string[]; readonly message?: string }[];
}

/** One `--print-config` per file, memoised: each probe is asked about repeatedly. */
const resolutionCache = new Map<string, Promise<ResolvedRestrictedImports>>();

function resolveRestrictedImports(file: string): Promise<ResolvedRestrictedImports> {
    const cached = resolutionCache.get(file);
    if (cached !== undefined) return cached;

    const pending = execFileAsync(eslintBin, ['--print-config', file], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    }).then(({ stdout }) => {
        const config = JSON.parse(stdout) as {
            rules?: {
                'no-restricted-imports'?: [number, { patterns?: { group: string[] }[] }?];
            };
        };
        const rule = config.rules?.['no-restricted-imports'];
        const groups = rule?.[1]?.patterns ?? [];
        return {
            severity: rule?.[0],
            patterns: [...new Set(groups.flatMap((entry) => entry.group))].sort(),
            groups,
        };
    });
    resolutionCache.set(file, pending);
    return pending;
}

function findGroup(resolved: ResolvedRestrictedImports, message: string) {
    return resolved.groups.find((entry) => entry.message === message);
}

describe('deep-relative import ban — every block that sets the rule', () => {
    it('leaves the worker event loop free while the config child runs', async () => {
        // The defect class, not its spelling. A source-text check for
        // `spawnSync` passes on any rename and says nothing about the loop.
        //
        // A Vitest worker answers the pool's `onTaskUpdate` RPC only while its
        // own event loop is free, and birpc's window is a fixed 60 s. A
        // synchronous child here holds the loop for as long as it runs, so
        // under full-suite load the run ends with `[vitest-worker]: Timeout
        // calling "onTaskUpdate"` — and vitest's per-test timer is blocked with
        // it, which is why such a run overshoots the timeout it violated rather
        // than landing on it.
        //
        // A macrotask is what separates the two: a `setTimeout` scheduled here
        // cannot fire until a synchronous child returns, and does fire while an
        // asynchronous one runs.
        let macrotaskRan = false;
        const timer = setTimeout(() => {
            macrotaskRan = true;
        }, 0);

        const blocks = await loadDeclaringBlocks();
        clearTimeout(timer);

        expect(macrotaskRan).toBe(true);
        // …and the load was not a no-op that returned before the loop could
        // have been blocked in the first place.
        expect(blocks.length).toBeGreaterThan(0);
    });

    it('runs no further config child once the census has been loaded', async () => {
        // Every call site below asks for the same census. Each miss is another
        // child process competing with the rest of the suite for the machine,
        // which is the half of this file's flake that spawning asynchronously
        // does not address.
        //
        // The floor first: a counter that never moved would satisfy the
        // equality below exactly as well as a working cache does, so the
        // equality alone cannot tell a live gauge from a dead one. Read through
        // the loader rather than the accessor, so this holds whatever order the
        // file's tests run in and whether or not the cache is already warm.
        const runsBeforeLoad = configChildRuns;
        await loadDeclaringBlocks();
        expect(configChildRuns).toBeGreaterThan(runsBeforeLoad);

        await declaringBlocks();
        const runsAfterCensus = configChildRuns;

        await declaringBlocks();
        await declaringBlocks();

        expect(configChildRuns).toBe(runsAfterCensus);
    });

    it('classifies every config object that sets no-restricted-imports, and no other', async () => {
        // The completeness check. A sixth zone added later — naming the rule
        // for its own boundary and, like all five before it, silently
        // replacing the base group — is invisible to a lint run and to every
        // per-zone probe below, which only ask about zones someone remembered
        // to list. This reds until the new block is classified above.
        const declared = (await declaringBlocks()).map((block) => signatureOf(block.files));

        expect(declared.sort()).toEqual(CENSUS.map((row) => signatureOf(row.files)).sort());
    });

    it('identifies a block by its files regardless of glob order', () => {
        // `signatureOf` sorts, because a flat-config `files` array is a list of
        // alternatives. Nothing reorders one today, so this is the only thing
        // holding the sort — and without it a reordered array reports as a
        // block absent from the config.
        expect(signatureOf(['b/**', 'a/**'])).toBe(signatureOf(['a/**', 'b/**']));
    });

    it('rejects a block that lost the group or was downgraded — negative control', () => {
        // The disposition check below is only as strong as
        // `matchesDisposition`. Drop either conjunct of any arm and the check
        // still passes on the tree while accepting exactly the defect it exists
        // to catch, so the predicate meets synthetic blocks first.
        // `warnedWithoutGroup` is the row that matters: it is the only input
        // that separates the two conjuncts of the `renderer-exempt` arm.
        const block = (severity: string, patterns: readonly string[]): DeclaringBlock => ({
            files: ['x'],
            severity,
            patterns,
            deepRelativeMessage: patterns.includes(DEEP_RELATIVE) ? DEEP_RELATIVE_MESSAGE : null,
        });
        const withGroup = block('error', [DEEP_RELATIVE]);
        const withoutGroup = block('error', ['other/*']);
        const warned = block('warn', [DEEP_RELATIVE]);
        const warnedWithoutGroup = block('warn', ['other/*']);
        const off = block('off', []);

        expect(matchesDisposition('carries', withGroup)).toBe(true);
        expect(matchesDisposition('carries', withoutGroup)).toBe(false);
        expect(matchesDisposition('carries', warned)).toBe(false);
        expect(matchesDisposition('renderer-exempt', withoutGroup)).toBe(true);
        expect(matchesDisposition('renderer-exempt', withGroup)).toBe(false);
        expect(matchesDisposition('renderer-exempt', warned)).toBe(false);
        expect(matchesDisposition('renderer-exempt', warnedWithoutGroup)).toBe(false);
        expect(matchesDisposition('off', off)).toBe(true);
        expect(matchesDisposition('off', withGroup)).toBe(false);
        expect(matchesDisposition('off', warnedWithoutGroup)).toBe(false);
    });

    it('grants the two non-carrying dispositions to those two blocks and no others', () => {
        // Otherwise the census waves a new zone through on one word: declare
        // the rule without the group, write `renderer-exempt` beside it, and
        // every check here stays green — the exact defect class the census
        // exists for, re-entered through the classification instead of around
        // it. `renderer/**` is argued at the zone; the e2e `'off'` likewise.
        expect(
            CENSUS.filter((row) => row.disposition !== 'carries').map((row) => ({
                files: signatureOf(row.files),
                disposition: row.disposition,
            })),
        ).toEqual([
            { files: signatureOf(['renderer/**/*.{ts,tsx}']), disposition: 'renderer-exempt' },
            { files: signatureOf(['apps/*/e2e/**/*.{ts,tsx}']), disposition: 'off' },
        ]);
    });

    it('matches each block to its disposition in the config source', async () => {
        // Read from the config module rather than `--print-config`, so this
        // sees what each block DECLARES rather than what wins for some file.
        // A zone whose group went missing resolves fine for any file a later
        // zone also matches; only the declaration says which block dropped it.
        // This is what covers every block, probe or no probe.
        const bySignature = new Map(
            (await declaringBlocks()).map((block) => [signatureOf(block.files), block]),
        );
        const wrong = CENSUS.flatMap((row) => {
            const block = bySignature.get(signatureOf(row.files));
            if (block === undefined) {
                return [`${signatureOf(row.files)}: no block in the config declares these files`];
            }
            return matchesDisposition(row.disposition, block)
                ? []
                : [
                      `${signatureOf(row.files)}: declared ${JSON.stringify(block.severity)} / ` +
                          `deep-relative ${String(block.patterns.includes(DEEP_RELATIVE))}, ` +
                          `which is not "${row.disposition}"`,
                  ];
        });

        expect(wrong).toEqual([]);
    });

    it('gives every copy of the group the base block’s message, verbatim', async () => {
        // Every copy, not just the four the zone probes reach: the base
        // block, the four this branch restored, and the app-root and
        // electron/main blocks that already had one. A copy reporting under
        // reworded prose stops the ban reading as one repo-wide rule, and
        // `--print-config` can only see the copy that wins for a given file.
        const drifted = (await declaringBlocks())
            .filter((block) => block.patterns.includes(DEEP_RELATIVE))
            .filter((block) => block.deepRelativeMessage !== DEEP_RELATIVE_MESSAGE)
            .map((block) => signatureOf(block.files));

        expect(drifted).toEqual([]);
        // …and the filter above is not vacuous. Derived from the census rather
        // than hardcoded, so it is also the cross-check the two lists otherwise
        // lack: the config's own count of blocks carrying the group against the
        // number the census classifies as carrying it.
        expect(
            (await declaringBlocks()).filter((block) => block.patterns.includes(DEEP_RELATIVE))
                .length,
        ).toBe(CENSUS.filter((row) => row.disposition === 'carries').length);
    });

    it('resolves exactly the probes the census names, and no others', () => {
        // Both directions, so neither list can drift: a `ZONES` entry deleted
        // stops a zone being probed while every remaining assertion passes,
        // and a census probe nothing resolves is a claim of coverage with no
        // check under it.
        const resolvedHere = [...ZONES.map((zone) => zone.probe), ...E2E_PROBES].sort();

        expect(resolvedHere).toEqual(CENSUS.flatMap((row) => [...row.probes]).sort());
    });
});

describe('deep-relative import ban — a config child that fails', () => {
    it('reports a child that ran and exited non-zero under its own stderr', () => {
        // A child that genuinely fails to import a config module, so the
        // message the wrapper adds is true of this fixture as well as of the
        // caller it was written for.
        return expect(
            runConfigChild(process.execPath, [
                '--input-type=module',
                '-e',
                "await import('./chimera-no-such-config.mjs');",
            ]),
        ).rejects.toThrow(/^could not load eslint\.config\.mjs: [\s\S]*ERR_MODULE_NOT_FOUND/);
    });

    it('rethrows a child that never ran, rather than flattening it to an empty message', () => {
        // node attaches `stderr` to EVERY execFile rejection, so wrapping on a
        // stderr check alone turns a missing binary into
        // `could not load eslint.config.mjs: ` with the cause discarded — the
        // one shape a reader cannot act on.
        return expect(
            runConfigChild(resolve(repoRoot, 'node_modules/.bin/chimera-no-such-binary'), []),
        ).rejects.toThrow(/ENOENT/);
    });

    it('classifies only a numeric exit code as a child that ran and failed', () => {
        expect(isExitRejection({ code: 1, stdout: '', stderr: 'SyntaxError' })).toBe(true);
        // The three rejection shapes node produces for a child that did not
        // run, or did not finish. All carry stdout and stderr, so `code` is the
        // only discriminator.
        expect(isExitRejection({ code: 'ENOENT', stdout: '', stderr: '' })).toBe(false);
        expect(
            isExitRejection({
                code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
                stdout: '',
                stderr: '',
            }),
        ).toBe(false);
        expect(
            isExitRejection({ code: null, signal: 'SIGKILL', stdout: '', stderr: 'partial' }),
        ).toBe(false);
        expect(isExitRejection(new Error('boom'))).toBe(false);
        expect(isExitRejection(null)).toBe(false);
    });
});

describe('deep-relative import ban — per-zone resolution', () => {
    it('probes every zone with a file that exists', () => {
        // `eslint --print-config <missing>` exits 0 and answers for the path the
        // globs WOULD match, so every assertion below would pass against a file
        // that no longer exists. This is the only check that says otherwise.
        const missing = [...ZONES.map((zone) => zone.probe), ...E2E_PROBES].filter(
            (rel) => !existsSync(resolve(repoRoot, rel)),
        );

        expect(missing).toEqual([]);
    });

    it(
        'resolves the rule at ERROR severity in every zone',
        async () => {
            // The cheapest way to disarm every pattern assertion in this file at
            // exit 0: at `'warn'` each banned import still resolves every
            // pattern and still reports, and no package here passes
            // `--max-warnings`, so nothing fails.
            for (const zone of ZONES) {
                expect((await resolveRestrictedImports(zone.probe)).severity, zone.name).toBe(2);
            }
        },
        ESLINT_PRINT_CONFIG_TIMEOUT_MS,
    );

    it(
        'restores the repo-wide deep-relative ban in the four zones that dropped it',
        async () => {
            // The regression this file exists for: naming
            // `no-restricted-imports` in a zone REPLACED the base block's group
            // rather than adding to it, so each of these zones lost the
            // `../../../*` ban for every file it matches.
            for (const zone of ZONES.filter((candidate) => candidate.carriesDeepRelative)) {
                expect((await resolveRestrictedImports(zone.probe)).patterns, zone.name).toContain(
                    DEEP_RELATIVE,
                );
            }
        },
        ESLINT_PRINT_CONFIG_TIMEOUT_MS,
    );

    it(
        'reports it under the base message, in its own group, identically in each zone',
        async () => {
            // Four copies of one repo-wide rule. Folding `../../../*` into a
            // zone's boundary group would still ban the import — under prose
            // about package aliases or game paths, which sends the reader to fix
            // the wrong thing — and prose that drifts between the copies stops
            // the ban reading as one rule.
            for (const zone of ZONES.filter((candidate) => candidate.carriesDeepRelative)) {
                const resolved = await resolveRestrictedImports(zone.probe);
                const deepGroup = resolved.groups.find((entry) =>
                    entry.group.includes(DEEP_RELATIVE),
                );

                expect(deepGroup, zone.name).toBeDefined();
                expect(deepGroup?.message, zone.name).toBe(DEEP_RELATIVE_MESSAGE);
                // Its own group, carrying nothing of the zone's boundary ban.
                for (const own of zone.ownGroups) {
                    for (const pattern of own.patterns) {
                        expect(deepGroup?.group, `${zone.name} — ${pattern}`).not.toContain(
                            pattern,
                        );
                    }
                }
            }
        },
        ESLINT_PRINT_CONFIG_TIMEOUT_MS,
    );

    it(
        "leaves every zone's own boundary group whole, message included",
        async () => {
            // The other half of the change: the group added to each zone must
            // not have edited, absorbed or displaced what was already there.
            // The message is matched WHOLE — looking the group up by a phrase
            // would leave the rest of it, invariant references included, free
            // to be truncated with every assertion here still green. Patterns
            // stay containment, so an unrelated ban added later does not red.
            for (const zone of ZONES) {
                const resolved = await resolveRestrictedImports(zone.probe);
                for (const own of zone.ownGroups) {
                    const group = findGroup(resolved, own.message);

                    expect(
                        group,
                        `${zone.name} — no group carries this message verbatim`,
                    ).toBeDefined();
                    for (const pattern of own.patterns) {
                        expect(group?.group, `${zone.name} lost ${pattern}`).toContain(pattern);
                    }
                    expect(
                        group?.group,
                        `${zone.name} absorbed the deep-relative ban`,
                    ).not.toContain(DEEP_RELATIVE);
                }
            }
        },
        ESLINT_PRINT_CONFIG_TIMEOUT_MS,
    );

    it(
        'keeps renderer/** exempt from the deep-relative group',
        async () => {
            // Not an oversight, and asserted so it cannot become one: the same
            // three-level specifier is an intra-package reach from a file three
            // deep and an escape from a file two deep, and the rule sees only
            // the string. The two checks below hold the property instead.
            expect(
                (await resolveRestrictedImports('renderer/state/cameraStore.ts')).patterns,
            ).not.toContain(DEEP_RELATIVE);
        },
        ESLINT_PRINT_CONFIG_TIMEOUT_MS,
    );

    it.each(E2E_PROBES)(
        'keeps the rule OFF for %s',
        async (probe) => {
            // Deliberate, and argued at the zone in eslint.config.mjs. BOTH apps
            // are probed because the zone is an `apps/*/e2e/**` glob: a widening
            // that reached only the app it was written for would leave the other
            // suite's electron-source reaches banned, and only `--print-config`
            // says which files a glob actually reaches.
            const { severity, patterns } = await resolveRestrictedImports(probe);

            expect(severity, probe).toBe(0);
            // The block supplies severity ONLY, and that is the one case flat
            // config does not replace the options: the base group is still
            // resolved here, switched off rather than dropped. Which is the
            // exception the base-block comment claims, so it is pinned where a
            // reader would look for it — and it says the `'off'` is doing the
            // exempting, not an absent pattern.
            expect(patterns, probe).toContain(DEEP_RELATIVE);
        },
        ESLINT_PRINT_CONFIG_TIMEOUT_MS,
    );
});

// ── The renderer exemption, held by measurement instead of by the rule ───────

const RENDERER_ROOT = resolve(repoRoot, 'renderer');
/** The build-output directory names the config also ignores. */
const RENDERER_SCAN_SKIP = new Set(['node_modules', 'dist', 'out', '.next']);
const RENDERER_FIXTURES = resolve(RENDERER_ROOT, '__tests__', 'fixtures');

/**
 * A module specifier three or more levels up, in every position
 * `no-restricted-imports` visits, plus two it does not.
 *
 * MEASURED on eslint 9.39.4 with `new Linter().verify()`: the rule reports on
 * `import a from '…'`, on `export … from '…'`, and on the BARE side-effect
 * `import '…'` — the form that carries no bindings and so has no `from` to
 * anchor on. It stays silent on `import('…')` and on `require('…')`.
 *
 * `SPECIFIER_POSITIONS` below pins that list against this regex. Matching the
 * two positions the rule ignores is deliberate: every extra match can only add
 * to the escape check, never subtract from it.
 */
const DEEP_RELATIVE_SPECIFIER =
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]((?:\.\.\/){3,}[^'"]*)['"]/gu;

/**
 * One line per position, and the specifier the regex must pull out of it.
 */
const SPECIFIER_POSITIONS: readonly (readonly [string, string])[] = [
    ["import a from '../../../a/mod.js';", '../../../a/mod.js'],
    ["import type { B } from '../../../b/mod.js';", '../../../b/mod.js'],
    ["export * from '../../../c/mod.js';", '../../../c/mod.js'],
    ["import '../../../d/mod.js';", '../../../d/mod.js'],
    ["const p = import('../../../e/mod.js');", '../../../e/mod.js'],
    ["const r = require('../../../f/mod.js');", '../../../f/mod.js'],
];

function collectRendererSources(dir: string = RENDERER_ROOT): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            if (RENDERER_SCAN_SKIP.has(entry.name) || abs === RENDERER_FIXTURES) continue;
            found.push(...collectRendererSources(abs));
            continue;
        }
        if (!/\.tsx?$/u.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
        found.push(abs);
    }
    return found;
}

interface RendererReach {
    readonly file: string;
    readonly specifier: string;
}

/**
 * Whether `specifier`, read from `fromFile`, lands inside the renderer package.
 * Pure and separately probed, because the separator in the prefix test is the
 * whole guard against a sibling whose name merely STARTS with `renderer`.
 */
function landsInsideRenderer(fromFile: string, specifier: string): boolean {
    return resolve(dirname(fromFile), specifier).startsWith(`${RENDERER_ROOT}${sep}`);
}

function classifyRendererDeepRelatives(): {
    intraPackage: RendererReach[];
    escaping: RendererReach[];
} {
    const intraPackage: RendererReach[] = [];
    const escaping: RendererReach[] = [];
    for (const abs of collectRendererSources()) {
        const code = readFileSync(abs, 'utf8');
        for (const match of code.matchAll(DEEP_RELATIVE_SPECIFIER)) {
            const specifier = match[1] ?? '';
            const reach: RendererReach = { file: relative(repoRoot, abs), specifier };
            if (landsInsideRenderer(abs, specifier)) intraPackage.push(reach);
            else escaping.push(reach);
        }
    }
    return { intraPackage, escaping };
}

describe('deep-relative reaches inside renderer/**', () => {
    it('extracts the specifier from every import position, bare one included', () => {
        // The scan is only as wide as this regex. The bare `import '…'` row is
        // the one that matters: it is a position eslint DOES report on, it has
        // no `from` to anchor a match, and — because `renderer/**` is exempt
        // from the group — an escape written that way is invisible to eslint
        // too, so this suite is the only thing standing under it.
        const extracted = SPECIFIER_POSITIONS.map(([line]) =>
            [...line.matchAll(DEEP_RELATIVE_SPECIFIER)].map((match) => match[1]),
        );

        expect(extracted).toEqual(SPECIFIER_POSITIONS.map(([, specifier]) => [specifier]));
    });

    it('reads a sibling whose name merely starts with "renderer" as OUTSIDE the package', () => {
        // The separator in `landsInsideRenderer`. Drop it and `renderer-tools/`
        // at the repo root reads as renderer's own tree, which is how a real
        // escape gets filed as an intra-package reach. Nothing at the repo root
        // is named that today, which is exactly why only a synthetic probe can
        // hold it.
        const deepFile = resolve(RENDERER_ROOT, 'app/replays/player/page.tsx');

        expect(landsInsideRenderer(deepFile, '../../../i18n/useTranslate')).toBe(true);
        expect(landsInsideRenderer(deepFile, '../../../../renderer-tools/x.js')).toBe(false);
        expect(landsInsideRenderer(deepFile, '../../../../tools/x.js')).toBe(false);
    });

    it('scans renderer source rather than an empty or pruned tree', () => {
        // The anti-vacuity floor under both checks below: a walk that silently
        // returned nothing — a renamed directory, a skip entry that grew too
        // greedy — makes "no escape found" and "nothing was read" the same
        // result. Calibrated against the 463 files the walk finds today, with a
        // margin for ordinary churn. Not a census — but tight enough that the
        // directory carrying most of renderer (`components`, 207 files) cannot
        // fall out of the walk unnoticed, which a floor of 100 let happen.
        expect(collectRendererSources().length).toBeGreaterThan(400);
    });

    it('lets no deep-relative specifier leave the renderer package', () => {
        // What the missing `../../../*` group would have caught, held directly:
        // the ban exists to stop a package reaching build tooling, docs or a
        // sibling package by relative path, and here that is measured on the
        // resolved target rather than guessed from the specifier's shape.
        expect(classifyRendererDeepRelatives().escaping).toEqual([]);
    });

    it('keeps the exemption load-bearing — renderer still reaches three levels up internally', () => {
        // The ratchet. The exemption is justified only while renderer HAS
        // intra-package reaches the pattern cannot distinguish from an escape;
        // once the last one is gone, `renderer/**` should take the group like
        // its four neighbours, and this is what says so.
        expect(classifyRendererDeepRelatives().intraPackage.length).toBeGreaterThan(0);
    });
});
