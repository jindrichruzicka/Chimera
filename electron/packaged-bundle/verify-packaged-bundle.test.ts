/**
 * electron/packaged-bundle/verify-packaged-bundle.test.ts
 *
 * Pins the engine-exported `verify:packaged-bundle` PREDICATES against synthetic
 * bundle text, and the `verifyPackagedBundle` orchestration against an injected
 * in-memory IO — the helper every consumer gate (the monorepo driver and every
 * scaffolded game's `verify:packaged-bundle` script) drives.
 *
 * Division of labour with the gates themselves: each gate's own run validates
 * the predicates end-to-end against a REAL dev bundle (the negative control —
 * every predicate must reject it), which covers the wiring. What the real
 * fixtures cannot reach is covered here instead: the size floor, the
 * inline-sourcemap detector (a dev bundle never carries one), the
 * request-channel regex's negative lookahead (the sanctioned
 * `chimera:debug:toggle-*` sends must NOT fire it), each `devRejectionGaps`
 * failure mode in isolation, the electron-builder `files:` allowlist predicates
 * (a real gate run only ever sees the clean config), and the orchestration's
 * failure paths (a packaged bundle that still carries the layer, a dev restore
 * that stopped tripping a predicate, a gutted allowlist predicate).
 */

import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
    checkBundleText,
    devRejectionGaps,
    electronBuilderControlGaps,
    electronBuilderDistFailures,
    foldedGateFailure,
    verifyPackagedBundle,
    type PackagedBundleOutfiles,
    type VerifyPackagedBundleIo,
} from './verify-packaged-bundle.js';
import {
    ALL_DEBUG_GRAPH_MARKERS,
    DEBUG_BRIDGE_GLOBAL,
    DEBUG_PUSH_CHANNEL_LITERAL,
    FOLDED_GATE_LITERAL,
} from './debug-bundle-markers.js';

/** Clears the size floor without tripping any content predicate. */
const PAD = 'const x = 1;\n'.repeat(200);

/** A synthetic DEV-shaped main bundle: every content predicate must fire on it. */
const DEV_SHAPED_MAIN = [
    PAD,
    ...ALL_DEBUG_GRAPH_MARKERS,
    // A bare request-channel occurrence (word boundary after), plus the push channel.
    "'chimera:debug' ",
    DEBUG_PUSH_CHANNEL_LITERAL,
].join('\n');

/** A synthetic PACKAGED-shaped main bundle: no debug layer, folded gate present. */
const PACKAGED_SHAPED_MAIN = PAD + FOLDED_GATE_LITERAL;

const checkIds = (code: string): string[] => checkBundleText('main', code).map((f) => f.check);

describe('checkBundleText', () => {
    it('passes clean text that clears the size floor', () => {
        expect(checkBundleText('main', PAD)).toEqual([]);
    });

    it('fails a truncated bundle on the size floor alone', () => {
        // Every content predicate is an absence check, so an empty file would
        // satisfy all of them — the floor is what keeps them falsifiable.
        expect(checkIds('const x = 1;')).toEqual(['size-floor']);
    });

    it.each(ALL_DEBUG_GRAPH_MARKERS.map((marker) => [marker]))(
        'fires marker check for %s',
        (marker) => {
            expect(checkIds(PAD + marker)).toEqual([`marker:${marker}`]);
        },
    );

    it('fires the request-channel check on a bare chimera:debug occurrence', () => {
        expect(checkIds(`${PAD}'chimera:debug' `)).toEqual(['request-channel']);
    });

    it('does NOT fire the request-channel check on the sanctioned toggle sends', () => {
        // `chimera:debug:toggle-inspector` / `:toggle-i18n-token-mode` are the
        // data-free sends Invariant #28 permits in a packaged preload; the
        // negative lookahead exists exactly so they pass.
        expect(checkIds(`${PAD}'chimera:debug:toggle-inspector'`)).toEqual([]);
        expect(checkIds(`${PAD}'chimera:debug:toggle-i18n-token-mode'`)).toEqual([]);
    });

    it('fires only the push-channel check on the push channel literal', () => {
        // The literal starts with `chimera:debug` followed by `:`, which the
        // request-channel lookahead rejects — the two checks stay independent.
        expect(checkIds(PAD + DEBUG_PUSH_CHANNEL_LITERAL)).toEqual(['push-channel']);
    });

    it('fires the bridge-global check', () => {
        expect(checkIds(PAD + DEBUG_BRIDGE_GLOBAL)).toEqual(['bridge-global']);
    });

    it('fires the inline-sourcemap check', () => {
        // Base64 hides every marker string, so an inline map ships the debug
        // sources while all absence checks stay green — it needs its own check,
        // and no real fixture exercises it (dev bundles emit external maps).
        expect(checkIds(`${PAD}//# sourceMappingURL=data:application/json;base64,AAAA`)).toEqual([
            'inline-sourcemap',
        ]);
    });
});

describe('foldedGateFailure', () => {
    it('fails a main bundle without the folded gate literal', () => {
        expect(foldedGateFailure(PAD)?.check).toBe('folded-gate-missing');
    });

    it('passes a main bundle carrying it', () => {
        expect(foldedGateFailure(PAD + FOLDED_GATE_LITERAL)).toBeUndefined();
    });
});

describe('devRejectionGaps (the negative control run against every dev build)', () => {
    const LIVE_PRELOAD = PAD + DEBUG_BRIDGE_GLOBAL;

    it('reports no gaps for a fully dev-shaped build', () => {
        expect(
            devRejectionGaps({ mainCode: DEV_SHAPED_MAIN, debugPreloadCode: LIVE_PRELOAD }),
        ).toEqual([]);
    });

    it('reports each marker whose check no longer fires', () => {
        // A gutted or rotted marker predicate must fail the GATE, not silently
        // narrow it — this is the per-predicate teeth of the control.
        const [dropped, ...kept] = ALL_DEBUG_GRAPH_MARKERS;
        const main = [PAD, ...kept, "'chimera:debug' ", DEBUG_PUSH_CHANNEL_LITERAL].join('\n');

        const gaps = devRejectionGaps({ mainCode: main, debugPreloadCode: LIVE_PRELOAD });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain(dropped);
    });

    it('reports a missing request-channel rejection', () => {
        const main = [PAD, ...ALL_DEBUG_GRAPH_MARKERS, DEBUG_PUSH_CHANNEL_LITERAL].join('\n');
        const gaps = devRejectionGaps({ mainCode: main, debugPreloadCode: LIVE_PRELOAD });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('request channel');
    });

    it('reports a missing push-channel rejection', () => {
        const main = [PAD, ...ALL_DEBUG_GRAPH_MARKERS, "'chimera:debug' "].join('\n');
        const gaps = devRejectionGaps({ mainCode: main, debugPreloadCode: LIVE_PRELOAD });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain(DEBUG_PUSH_CHANNEL_LITERAL);
    });

    it('reports a dev main that already carries the folded gate (packaged-shaped dev build)', () => {
        // The strongest wrong-environment signal: if the restore build emits
        // `IS_DEBUG_MODE = false`, the packaged flag leaked into the dev
        // environment and F9 is silently dead.
        const gaps = devRejectionGaps({
            mainCode: DEV_SHAPED_MAIN + FOLDED_GATE_LITERAL,
            debugPreloadCode: LIVE_PRELOAD,
        });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain(FOLDED_GATE_LITERAL);
    });

    it('reports a dev build that emitted no debug preload', () => {
        const gaps = devRejectionGaps({ mainCode: DEV_SHAPED_MAIN, debugPreloadCode: undefined });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('debug preload');
    });

    it('reports a debug preload without the bridge global', () => {
        // Proves the string the packaged absence check looks for is still the
        // string a live bridge actually carries.
        const gaps = devRejectionGaps({ mainCode: DEV_SHAPED_MAIN, debugPreloadCode: PAD });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain(DEBUG_BRIDGE_GLOBAL);
    });
});

// ── electron-builder `files:` allowlist predicates ───────────────────────────

const APP_DIR = path.join(path.sep, 'app');
const OUTFILES: PackagedBundleOutfiles = {
    main: path.join(APP_DIR, 'dist/electron/main.js'),
    preload: path.join(APP_DIR, 'dist/preload/api.js'),
    debugPreload: path.join(APP_DIR, 'dist/preload/debug-api.js'),
};
const YML_OPTIONS = { appDir: APP_DIR, outfiles: OUTFILES };

/** The clean, template-shaped allowlist: the two shipped bundles by name. */
const CLEAN_YML = [
    'files:',
    '  - dist/electron/main.js',
    '  - dist/preload/api.js',
    '  - from: renderer/out',
    '    to: renderer/out',
    '',
].join('\n');

const ymlChecks = (yml: string): string[] =>
    electronBuilderDistFailures(yml, YML_OPTIONS).map((f) => f.check);

describe('electronBuilderDistFailures', () => {
    it('passes a files allowlist naming exactly the two shipped bundles', () => {
        expect(electronBuilderDistFailures(CLEAN_YML, YML_OPTIONS)).toEqual([]);
    });

    it('fails a dist/** glob — the widened-allowlist edit this gate exists to catch', () => {
        const yml = CLEAN_YML.replace(
            '  - dist/electron/main.js\n  - dist/preload/api.js',
            '  - dist/**',
        );
        expect(ymlChecks(yml)).toContain('files-dist-glob');
    });

    it('fails any wildcard under dist, not only the ** form', () => {
        const yml = `${CLEAN_YML}  - dist/preload/*\n`;
        expect(ymlChecks(yml)).toContain('files-dist-glob');
    });

    it('fails an allowlist that ships the debug preload by name', () => {
        const yml = `${CLEAN_YML}  - dist/preload/debug-api.js\n`;
        expect(ymlChecks(yml)).toContain('files-ships-debug-preload');
    });

    it('fails when a shipped bundle is no longer named (anti-vacuity for renames/emptying)', () => {
        const yml = CLEAN_YML.replace('  - dist/electron/main.js\n', '');
        expect(ymlChecks(yml)).toContain('files-missing:dist/electron/main.js');
    });

    it('fails an unknown dist entry that is not part of the bundle plan', () => {
        const yml = `${CLEAN_YML}  - dist/extra.js\n`;
        expect(ymlChecks(yml)).toContain('files-unexpected:dist/extra.js');
    });
});

describe('electronBuilderControlGaps (the allowlist predicates’ own negative control)', () => {
    it('reports no gaps with the real predicate — every check fires on the widened config', () => {
        expect(electronBuilderControlGaps(YML_OPTIONS)).toEqual([]);
    });

    it('reports every silenced check when the predicate is gutted', () => {
        // A predicate rewritten to return [] must fail the GATE on the same
        // run, not silently stop guarding the allowlist.
        const gaps = electronBuilderControlGaps(YML_OPTIONS, () => []);
        expect(gaps.join('\n')).toContain('files-dist-glob');
        expect(gaps.join('\n')).toContain('files-ships-debug-preload');
        expect(gaps.join('\n')).toContain('files-missing:dist/electron/main.js');
        expect(gaps.join('\n')).toContain('files-missing:dist/preload/api.js');
    });
});

// ── verifyPackagedBundle orchestration (injected IO — no real builds/FS) ─────

interface World {
    readonly io: VerifyPackagedBundleIo;
    readonly files: Map<string, string>;
    readonly calls: string[];
    readonly errors: string[];
}

interface WorldOverrides {
    /** Mutate the world after a packaged build (default: clean packaged shape). */
    readonly onPackagedBuild?: (files: Map<string, string>) => void;
    /** Mutate the world after a dev build (default: full dev shape). */
    readonly onDevBuild?: (files: Map<string, string>) => void;
    /** electron-builder.yml text; `undefined` = no config file on disk. */
    readonly yml?: string | undefined;
}

function makeWorld(overrides: WorldOverrides = {}): World {
    const files = new Map<string, string>();
    const calls: string[] = [];
    const errors: string[] = [];

    if (!('yml' in overrides) || overrides.yml !== undefined) {
        files.set(path.join(APP_DIR, 'electron-builder.yml'), overrides.yml ?? CLEAN_YML);
    }

    const packagedBuild =
        overrides.onPackagedBuild ??
        ((f: Map<string, string>): void => {
            f.set(OUTFILES.main, PACKAGED_SHAPED_MAIN);
            f.set(OUTFILES.preload, PAD);
        });
    const devBuild =
        overrides.onDevBuild ??
        ((f: Map<string, string>): void => {
            f.set(OUTFILES.main, DEV_SHAPED_MAIN);
            f.set(OUTFILES.preload, PAD);
            f.set(OUTFILES.debugPreload, PAD + DEBUG_BRIDGE_GLOBAL);
        });

    const io: VerifyPackagedBundleIo = {
        buildApp: (packaged) => {
            calls.push(packaged ? 'build:packaged' : 'build:dev');
            (packaged ? packagedBuild : devBuild)(files);
        },
        readFile: (file) => {
            const text = files.get(file);
            if (text === undefined) throw new Error(`ENOENT: ${file}`);
            return text;
        },
        fileExists: (file) => files.has(file),
        removeFile: (file) => {
            calls.push(`rm:${file}`);
            files.delete(file);
        },
        log: () => {},
        error: (message) => errors.push(message),
    };
    return { io, files, calls, errors };
}

const run = (world: World): boolean =>
    verifyPackagedBundle({ appDir: APP_DIR, outfiles: OUTFILES }, world.io);

describe('verifyPackagedBundle', () => {
    it('passes a clean packaged build with a clean dev restore and allowlist', () => {
        const world = makeWorld();
        expect(run(world)).toBe(true);
        expect(world.errors).toEqual([]);
    });

    it('builds packaged first, then always restores the dev bundle', () => {
        const world = makeWorld();
        run(world);
        const builds = world.calls.filter((c) => c.startsWith('build:'));
        expect(builds).toEqual(['build:packaged', 'build:dev']);
        // The dev shape is what remains on disk afterwards — F9 must survive a gate run.
        expect(world.files.get(OUTFILES.debugPreload)).toContain(DEBUG_BRIDGE_GLOBAL);
    });

    it('deletes every planned output (and its map) before each build', () => {
        // `existsSync` cannot tell "this build emitted it" from "a previous dev
        // build left it there" — each existence check must be about THIS build.
        const world = makeWorld();
        run(world);
        for (const file of [OUTFILES.main, OUTFILES.preload, OUTFILES.debugPreload]) {
            expect(world.calls.filter((c) => c === `rm:${file}`)).toHaveLength(2);
            expect(world.calls.filter((c) => c === `rm:${file}.map`)).toHaveLength(2);
        }
        expect(world.calls.indexOf(`rm:${OUTFILES.main}`)).toBeLessThan(
            world.calls.indexOf('build:packaged'),
        );
    });

    it('fails when a packaged bundle still carries a debug-graph marker', () => {
        const marker = ALL_DEBUG_GRAPH_MARKERS[0] ?? '';
        const world = makeWorld({
            onPackagedBuild: (files) => {
                files.set(OUTFILES.main, PACKAGED_SHAPED_MAIN + marker);
                files.set(OUTFILES.preload, PAD);
            },
        });
        expect(run(world)).toBe(false);
        expect(world.errors.join('\n')).toContain(marker);
    });

    it('fails when a packaged build emits the debug preload', () => {
        const world = makeWorld({
            onPackagedBuild: (files) => {
                files.set(OUTFILES.main, PACKAGED_SHAPED_MAIN);
                files.set(OUTFILES.preload, PAD);
                files.set(OUTFILES.debugPreload, PAD);
            },
        });
        expect(run(world)).toBe(false);
    });

    it('fails when a planned bundle was not emitted (the outfile map diverged — fail closed)', () => {
        const world = makeWorld({
            onPackagedBuild: (files) => {
                files.set(OUTFILES.main, PACKAGED_SHAPED_MAIN);
            },
        });
        expect(run(world)).toBe(false);
        expect(world.errors.join('\n')).toContain('not emitted');
    });

    it('fails when the packaged main bundle is missing the folded gate literal', () => {
        // Marker absence alone is satisfiable by a build that never reached the
        // debug graph; the folded literal proves the define actually landed.
        const world = makeWorld({
            onPackagedBuild: (files) => {
                files.set(OUTFILES.main, PAD);
                files.set(OUTFILES.preload, PAD);
            },
        });
        expect(run(world)).toBe(false);
        expect(world.errors.join('\n')).toContain(FOLDED_GATE_LITERAL);
    });

    it('fails via the negative control when the dev restore stops tripping a predicate', () => {
        const world = makeWorld({
            onDevBuild: (files) => {
                // A "dev" build with no debug layer at all: every rejection is a gap.
                files.set(OUTFILES.main, PAD);
                files.set(OUTFILES.preload, PAD);
            },
        });
        expect(run(world)).toBe(false);
        expect(world.errors.join('\n')).toContain('NEGATIVE CONTROL');
    });

    it('still restores the dev bundle (and runs the control) when the packaged check fails', () => {
        const world = makeWorld({
            onPackagedBuild: (files) => {
                files.set(OUTFILES.main, PAD);
                files.set(OUTFILES.preload, PAD);
            },
        });
        run(world);
        expect(world.calls.filter((c) => c.startsWith('build:'))).toEqual([
            'build:packaged',
            'build:dev',
        ]);
    });

    it('fails when the electron-builder files allowlist is widened to dist/**', () => {
        const world = makeWorld({
            yml: CLEAN_YML.replace(
                '  - dist/electron/main.js\n  - dist/preload/api.js',
                '  - dist/**',
            ),
        });
        expect(run(world)).toBe(false);
        expect(world.errors.join('\n')).toContain('dist');
    });

    it('fails closed when the electron-builder config is missing entirely', () => {
        const world = makeWorld({ yml: undefined });
        expect(run(world)).toBe(false);
        expect(world.errors.join('\n')).toContain('electron-builder');
    });
});
