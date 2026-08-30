/**
 * tools/eslint-app-root-import-zone.test.ts
 *
 * The resolved `no-restricted-imports` patterns at a game's app ROOT
 * (`apps/<game>/*.ts`, one level deep).
 *
 * Three zones can match a file there, and flat config resolves ONE value per
 * rule — last block wins, and a block re-declaring the rule WITH options
 * REPLACES the patterns rather than merging them. So a zone added for one file
 * silently rewrites the boundary for every sibling its glob
 * also happens to match, and nothing observable changes: `pnpm lint` stays green
 * because the imports that would now be legal are simply not written yet.
 *
 * That is not hypothetical. Adding the electron ban below cost this tree its
 * `../../../*` ban at the app root once, and then — one glob over — the entire
 * ai/game group on `settings-schema.ts`. Both were invisible to a lint run and
 * visible only to `--print-config`. Hence this file: the resolved
 * patterns are data, so they are asserted as data.
 *
 * What each probe stands for:
 *
 *   asset-manifest.ts   production at the root — MUST carry the electron ban.
 *                       It is imported by `renderer/loaders.ts`, so an electron
 *                       import here reaches the renderer bundle.
 *   manifest.ts         the same zone, a file the electron edge has nothing to
 *                       do with — so the ban is the zone's, not one file's.
 *   settings-schema.ts  matched by the ai/game zone FIRST. Its group already
 *                       bans electron, so this zone must leave it alone;
 *                       matching it would trade that group for this one.
 *   asset-manifest.test.ts  the file the electron edge exists for — the readers
 *                       at `@chimera-engine/electron/test-support` are dev-time
 *                       only, so a test must NOT carry the ban.
 *
 * Patterns are asserted by CONTAINMENT across the whole resolved set: a count
 * passes when one pattern is swapped for another, and equality over the set
 * would red on any ban added later for an unrelated reason. The electron group
 * is the exception — it is looked up and asserted whole, patterns AND message,
 * because that group is what this branch added and a specifier folded into a
 * neighbouring group is still banned, just under the wrong explanation.
 *
 * Severity is asserted separately, per probe. It is the half a pattern list
 * cannot see and the cheapest way to disarm everything else here — a `'warn'`
 * still resolves every pattern, still reports, and still exits 0, because no
 * package in this repo passes `--max-warnings`. Each probe's severity comes from
 * whichever block last set the rule for it, so `asset-manifest.test.ts` is the
 * only one here that notices a downgrade of the repo-wide BASE block.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ESLINT_REACH_TIMEOUT_MS = 60_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../');
const eslintBin = resolve(repoRoot, 'node_modules/.bin/eslint');

/** The deep-relative ban every zone here must keep — the repo-wide base group. */
const DEEP_RELATIVE = '../../../*';
const ELECTRON_BAN = ['@chimera-engine/electron', '@chimera-engine/electron/*'];
/** The ai/game zone's group, which `settings-schema.ts` must keep in full. */
const AI_GAME_GROUP = [
    '@chimera-engine/networking',
    '@chimera-engine/networking/*',
    '@chimera-engine/renderer',
    '@chimera-engine/renderer/*',
    '@chimera-engine/electron',
    '@chimera-engine/electron/*',
    '@chimera-engine/tactics',
    '@chimera-engine/tactics/*',
    '@chimera-engine/action',
    '@chimera-engine/action/*',
    'renderer/*',
    '**/renderer/*',
    'electron/*',
    '**/electron/*',
    'networking/*',
    '**/networking/*',
    'apps/*',
    '**/apps/*',
];

const PROBES = {
    productionRoot: 'apps/tactics/asset-manifest.ts',
    productionSibling: 'apps/tactics/manifest.ts',
    settingsSchema: 'apps/tactics/settings-schema.ts',
    rootTest: 'apps/tactics/asset-manifest.test.ts',
} as const;

interface ResolvedRestrictedImports {
    /** 0 off, 1 warn, 2 error — the half a pattern list cannot see. */
    readonly severity: number | undefined;
    /** Every restricted pattern, flattened and de-duplicated. */
    readonly patterns: readonly string[];
    /** The same patterns, still grouped and carrying the message each reports. */
    readonly groups: readonly { readonly group: readonly string[]; readonly message?: string }[];
}

/** One `--print-config` per file, memoised: the four probes are asked about repeatedly. */
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
            rules?: { 'no-restricted-imports'?: [number, { patterns?: { group: string[] }[] }] };
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

describe('app-root no-restricted-imports zones', () => {
    // `eslint --print-config <missing>` exits 0 and answers for the path the
    // globs WOULD match, so every assertion below would pass against a file that
    // no longer exists. This is the only check that says the probes are real.
    it('probes every file on disk', () => {
        expect(Object.values(PROBES).filter((rel) => !existsSync(resolve(repoRoot, rel)))).toEqual(
            [],
        );
    });

    it(
        'resolves the rule at ERROR severity on production files at the app root',
        async () => {
            // The half a pattern list cannot see, and the cheapest way to disarm
            // every other assertion here: at `'warn'` the banned import still
            // resolves every pattern below, still reports — and exits 0. No
            // package passes `--max-warnings`, so a warning is invisible in CI
            // and in the pre-commit gate alike.
            for (const file of [PROBES.productionRoot, PROBES.productionSibling]) {
                expect((await resolveRestrictedImports(file)).severity, file).toBe(2);
            }
        },
        ESLINT_REACH_TIMEOUT_MS,
    );

    it(
        'bans @chimera-engine/electron from production files at the app root',
        async () => {
            for (const file of [PROBES.productionRoot, PROBES.productionSibling]) {
                const { patterns, groups } = await resolveRestrictedImports(file);
                for (const banned of ELECTRON_BAN) {
                    expect(patterns, file).toContain(banned);
                }
                // As a GROUP, and with ITS OWN message: `no-restricted-imports`
                // reports the message of whichever group a specifier matched, so
                // an electron pattern folded into the deep-relative group would
                // still ban the import — under prose about relative paths, which
                // sends the reader to fix the wrong thing.
                const electronGroup = groups.find((entry) =>
                    entry.group.includes('@chimera-engine/electron'),
                );
                expect(electronGroup, file).toBeDefined();
                for (const banned of ELECTRON_BAN) {
                    expect(electronGroup?.group, file).toContain(banned);
                }
                expect(electronGroup?.message, file).toMatch(/main-process package/u);
                expect(electronGroup?.group, file).not.toContain(DEEP_RELATIVE);
            }
        },
        ESLINT_REACH_TIMEOUT_MS,
    );

    it(
        'keeps the base deep-relative ban on those same files',
        async () => {
            // The first regression this file exists for: naming the rule in a new
            // zone REPLACED the base block's group instead of adding to it.
            for (const file of [PROBES.productionRoot, PROBES.productionSibling]) {
                expect((await resolveRestrictedImports(file)).patterns, file).toContain(
                    DEEP_RELATIVE,
                );
            }
        },
        ESLINT_REACH_TIMEOUT_MS,
    );

    it(
        'leaves settings-schema.ts on the ai/game zone, with every pattern intact',
        async () => {
            // The second regression: `apps/*/settings-schema.{ts,tsx}` is also one
            // level deep, so an `apps/*/*.ts` zone matches it and would trade its
            // group for this zone's. Containment, not equality, so a ban ADDED to
            // that zone later does not red this.
            const { patterns, severity } = await resolveRestrictedImports(PROBES.settingsSchema);
            expect(severity).toBe(2);
            for (const banned of AI_GAME_GROUP) {
                expect(patterns, `settings-schema.ts lost ${banned}`).toContain(banned);
            }
        },
        ESLINT_REACH_TIMEOUT_MS,
    );

    it(
        'does NOT ban electron from a test file at the app root',
        async () => {
            // The edge the zone exists to permit. If this ever reds, the readers
            // at `@chimera-engine/electron/test-support` became unreachable from
            // the asset-manifest tests that are their only in-repo consumer.
            const { patterns, severity } = await resolveRestrictedImports(PROBES.rootTest);
            for (const banned of ELECTRON_BAN) {
                expect(patterns, PROBES.rootTest).not.toContain(banned);
            }
            // …and the base ban still reaches it, so "exempt from one group" has
            // not become "exempt from the rule". Severity too: this probe's only
            // source is the BASE block, so it is the one place here that notices
            // a downgrade there — the other three take theirs from a zone.
            expect(patterns).toContain(DEEP_RELATIVE);
            expect(severity, PROBES.rootTest).toBe(2);
        },
        ESLINT_REACH_TIMEOUT_MS,
    );
});
