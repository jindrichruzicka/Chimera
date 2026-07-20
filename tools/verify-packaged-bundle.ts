/**
 * tools/verify-packaged-bundle.ts
 *
 * `verify:packaged-bundle` — asserts the Runtime Debug Layer (§4.12, Invariant #27)
 * is absent from the bundles a REAL packaging run emits.
 *
 * Why a gate rather than another test. Any source-level guard of this property
 * must model the shipped build, and whatever it models, the call site one level
 * further out stays unmodelled — something always calls the innermost tested
 * function, and that caller is untested by construction. So this gate models
 * nothing about the build: it runs the same `build:app` invocation the
 * `package:<game>` scripts run, then reads the bytes that command emitted. No
 * refactor of `build-main.ts` — a wrapped `build:` argument, a starved `env:`,
 * a second esbuild import, a rewritten CLI block — can satisfy it while the
 * debug graph ships.
 *
 * What it deliberately DOES import is data, not bundling logic: the marker set
 * (shared with the in-memory bundle test, so there is exactly one copy) and
 * `appBundleOutfiles`, the same output-path map the build plan derives its
 * outfiles from. The path import fails CLOSED: outputs are deleted before each
 * build, so if the map ever diverged from where the build actually writes, the
 * checks would find no file and fail loudly rather than read a stale one.
 *
 * EVERY RUN IS SELF-VALIDATING. The dev rebuild that restores `apps/<game>/dist`
 * afterwards doubles as the negative control: a dev bundle carries the whole
 * debug layer, so every predicate must reject it — each marker, both channel
 * checks, the emitted debug preload, the missing folded-gate literal. A gutted
 * or rotted predicate therefore fails the gate itself, on the same run, with no
 * separate self-test to remember to execute. (The control also catches a leaked
 * `CHIMERA_PACKAGED_BUILD` poisoning the dev environment: a packaged-shaped
 * "dev" build trips the folded-gate and missing-preload gaps.)
 *
 * The predicates themselves are additionally unit-tested against synthetic text
 * in `verify-packaged-bundle.test.ts` — the size floor, the inline-sourcemap
 * detector, and the request-channel lookahead have no real-build fixture. The
 * orchestration (real builds, real bytes) is exactly the part that must NOT run
 * under vitest: `pnpm test` stays hermetic, and this writes the app's real
 * `dist/`.
 *
 * ⚠️ SIDE EFFECT: `build:app` writes the same `apps/<game>/dist` path a dev
 * launch runs from, so a packaged build leaves the F9 Inspector dead until the
 * dev bundle is rebuilt. This driver ALWAYS rebuilds it before exiting,
 * including on failure. Do not run it concurrently with a dev launch.
 *
 * Usage:
 *   tsx tools/verify-packaged-bundle.ts
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ALL_DEBUG_GRAPH_MARKERS,
    DEBUG_BRIDGE_GLOBAL,
    DEBUG_PUSH_CHANNEL_LITERAL,
    DEBUG_REQUEST_CHANNEL_RE,
    FOLDED_GATE_LITERAL,
} from '../apps/tactics/electron/debug-bundle-markers.js';
import { appBundleOutfiles, type BundleOutfiles } from '../apps/tactics/electron/build-main.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(ROOT, 'apps/tactics');
const APP_PACKAGE = '@chimera-engine/tactics';

/** Mirrors the `CHIMERA_PACKAGED_BUILD=1 … build:app` segment of `package:tactics`. */
const PACKAGED_BUILD_ENV = 'CHIMERA_PACKAGED_BUILD';

/** The build plan's own outfile map — the gate tracks the plan, never restates it. */
const OUTFILES: BundleOutfiles = appBundleOutfiles(APP_DIR);

/**
 * Typed enumeration of the plan's outfiles. `Object.entries` on an interface
 * falls back to the `any` overload; keying off the real object keeps a field
 * added to {@link BundleOutfiles} flowing through here automatically.
 */
function outfileEntries(): readonly (readonly [keyof BundleOutfiles, string])[] {
    return (Object.keys(OUTFILES) as readonly (keyof BundleOutfiles)[]).map(
        (label) => [label, OUTFILES[label]] as const,
    );
}

function log(message: string): void {
    console.log(`[verify:packaged-bundle] ${message}`);
}

/**
 * Run the app's real bundler exactly as the packaging scripts do — same script,
 * same package filter, same env var. Anything less specific (calling `tsx
 * electron/build-main.ts` directly, say) would reintroduce a restatement of the
 * shipped command.
 */
function runBuildApp(packaged: boolean): void {
    execFileSync('pnpm', ['--filter', APP_PACKAGE, 'build:app'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: packaged ? { ...process.env, [PACKAGED_BUILD_ENV]: '1' } : process.env,
    });
}

/**
 * Delete every planned output before building, so each existence check
 * afterwards is a statement about THIS build. `build:app` overwrites but never
 * cleans, and `existsSync` cannot tell "this build emitted it" from "a previous
 * dev build left it there". (In a distributable a stale file is harmless —
 * `electron-builder.yml` names the shipped files explicitly. It is only this
 * gate's reasoning that staleness corrupts.)
 */
function clearBundleOutputs(): void {
    for (const [, file] of outfileEntries()) {
        rmSync(file, { force: true });
        rmSync(`${file}.map`, { force: true });
    }
}

export interface Failure {
    readonly bundle: string;
    /** Stable predicate id — what the negative control's gap analysis keys on. */
    readonly check: string;
    readonly problem: string;
}

/** Every debug-layer content predicate, applied to one emitted bundle's text. */
export function checkBundleText(label: string, code: string): Failure[] {
    const failures: Failure[] = [];

    // An empty or truncated bundle satisfies every absence check below, so the
    // size floor is what keeps them falsifiable.
    if (code.length < 1000) {
        failures.push({
            bundle: label,
            check: 'size-floor',
            problem: `emitted only ${code.length} bytes`,
        });
        return failures;
    }

    for (const marker of ALL_DEBUG_GRAPH_MARKERS) {
        if (code.includes(marker)) {
            failures.push({
                bundle: label,
                check: `marker:${marker}`,
                problem: `contains debug-graph marker "${marker}"`,
            });
        }
    }
    if (DEBUG_REQUEST_CHANNEL_RE.test(code)) {
        failures.push({
            bundle: label,
            check: 'request-channel',
            problem: 'references the chimera:debug request channel',
        });
    }
    if (code.includes(DEBUG_PUSH_CHANNEL_LITERAL)) {
        failures.push({
            bundle: label,
            check: 'push-channel',
            problem: `references ${DEBUG_PUSH_CHANNEL_LITERAL}`,
        });
    }
    if (code.includes(DEBUG_BRIDGE_GLOBAL)) {
        failures.push({
            bundle: label,
            check: 'bridge-global',
            problem: `carries the ${DEBUG_BRIDGE_GLOBAL} surface`,
        });
    }
    // An inline sourcemap would embed the original TypeScript — debug sources
    // included — inside a bundle that DOES ship, where the external `.map` files
    // never travel. Base64 hides every marker above, so this needs its own check.
    if (code.includes('sourceMappingURL=data:')) {
        failures.push({
            bundle: label,
            check: 'inline-sourcemap',
            problem: 'embeds an inline sourcemap',
        });
    }
    return failures;
}

/**
 * The POSITIVE half of the packaged check. Marker absence alone is satisfiable
 * by a build that simply failed to reach the debug graph; the folded literal
 * proves the packaging define actually landed in the emitted bytes.
 */
export function foldedGateFailure(mainCode: string): Failure | undefined {
    return mainCode.includes(FOLDED_GATE_LITERAL)
        ? undefined
        : {
              bundle: 'main',
              check: 'folded-gate-missing',
              problem: `does not contain "${FOLDED_GATE_LITERAL}" — the packaging define did not fold the gate`,
          };
}

/** The packaged assertions, over every bundle the plan says a build emits. */
function checkPackagedOutput(): Failure[] {
    const failures: Failure[] = [];

    // Every planned outfile except the debug preload ships, so every one is
    // scanned — a bundle added to the plan later is covered here automatically.
    for (const [label, file] of outfileEntries()) {
        if (label === 'debugPreload') {
            if (existsSync(file)) {
                failures.push({
                    bundle: label,
                    check: 'debug-preload-emitted',
                    problem: 'was emitted by a packaged build',
                });
            }
            continue;
        }
        if (!existsSync(file)) {
            failures.push({
                bundle: label,
                check: 'not-emitted',
                problem: `was not emitted at ${file}`,
            });
            continue;
        }
        failures.push(...checkBundleText(label, readFileSync(file, 'utf8')));
    }

    if (existsSync(OUTFILES.main)) {
        const folded = foldedGateFailure(readFileSync(OUTFILES.main, 'utf8'));
        if (folded !== undefined) failures.push(folded);
    }
    return failures;
}

/**
 * The negative control's gap analysis: which predicates FAILED to reject a
 * dev-shaped build. A dev bundle carries the whole debug layer, so a non-empty
 * result means a predicate has been gutted or its marker has rotted — the gate
 * can no longer prove anything about a packaged bundle and must fail itself.
 */
export function devRejectionGaps(dev: {
    readonly mainCode: string;
    /** `undefined` = the dev build emitted no debug preload at all. */
    readonly debugPreloadCode: string | undefined;
}): string[] {
    const gaps: string[] = [];
    const fired = new Set(checkBundleText('main', dev.mainCode).map((f) => f.check));

    for (const marker of ALL_DEBUG_GRAPH_MARKERS) {
        if (!fired.has(`marker:${marker}`)) {
            gaps.push(`the dev main bundle was not rejected for marker "${marker}"`);
        }
    }
    if (!fired.has('request-channel')) {
        gaps.push('the dev main bundle was not rejected for the chimera:debug request channel');
    }
    if (!fired.has('push-channel')) {
        gaps.push(`the dev main bundle was not rejected for ${DEBUG_PUSH_CHANNEL_LITERAL}`);
    }
    if (foldedGateFailure(dev.mainCode) === undefined) {
        gaps.push(
            `the dev main bundle carries "${FOLDED_GATE_LITERAL}" — the packaged define leaked ` +
                'into this environment and F9 is silently dead (unset CHIMERA_PACKAGED_BUILD)',
        );
    }
    if (dev.debugPreloadCode === undefined) {
        gaps.push(
            'the dev build emitted no debug preload — F9 would be dead in dev ' +
                '(is CHIMERA_PACKAGED_BUILD leaking into this environment?)',
        );
    } else if (!dev.debugPreloadCode.includes(DEBUG_BRIDGE_GLOBAL)) {
        gaps.push(
            `the dev debug preload does not carry ${DEBUG_BRIDGE_GLOBAL} — the packaged ` +
                'absence check for it no longer matches what a live bridge ships',
        );
    }
    return gaps;
}

/** Read the restored dev outputs and run the gap analysis over them. */
function checkDevControl(): string[] {
    if (!existsSync(OUTFILES.main)) {
        return ['the dev restore build emitted no main bundle'];
    }
    return devRejectionGaps({
        mainCode: readFileSync(OUTFILES.main, 'utf8'),
        debugPreloadCode: existsSync(OUTFILES.debugPreload)
            ? readFileSync(OUTFILES.debugPreload, 'utf8')
            : undefined,
    });
}

function report(failures: readonly Failure[]): void {
    for (const failure of failures) {
        console.error(`  ✗ ${failure.bundle} bundle ${failure.problem}`);
    }
}

function main(): void {
    let failed = false;
    try {
        log('building the app exactly as the packaging scripts do…');
        clearBundleOutputs();
        runBuildApp(true);

        const failures = checkPackagedOutput();
        if (failures.length > 0) {
            console.error(
                '[verify:packaged-bundle] the packaged bundles still carry the debug layer:',
            );
            report(failures);
            console.error(
                '\n  This gate reads the bytes the real build emitted. A green unit suite here means a\n' +
                    '  guard is describing the build instead of running it — fix the build, not the gate.',
            );
            failed = true;
        } else {
            log('the packaged bundles carry no debug layer.');
        }
    } finally {
        // ALWAYS restore the dev bundle — a packaged `dist/` left behind kills
        // the F9 Inspector with no error message — and use the restored build as
        // the negative control while it is here.
        log('restoring the dev bundle (doubles as the negative control)…');
        clearBundleOutputs();
        runBuildApp(false);

        const gaps = checkDevControl();
        if (gaps.length > 0) {
            console.error(
                '[verify:packaged-bundle] NEGATIVE CONTROL FAILED — a dev bundle was not rejected:',
            );
            for (const gap of gaps) {
                console.error(`  ✗ ${gap}`);
            }
            console.error(
                '\n  A dev bundle carries the whole debug layer; a predicate that no longer rejects\n' +
                    '  it proves nothing about a packaged one. Fix the predicate or the marker set.',
            );
            failed = true;
        } else {
            log('negative control passed — the dev bundle trips every predicate.');
        }

        if (failed) {
            process.exitCode = 1;
        } else {
            log('verify:packaged-bundle — the real packaged bundles carry no debug layer.');
        }
    }
}

// Direct-run guard, mirroring build-main.ts: vitest imports this module for the
// predicate exports and must never trigger real builds.
function isDirectRun(): boolean {
    const entry = process.argv[1];
    if (entry === undefined) return false;
    try {
        return path.resolve(entry) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
}

if (process.env['VITEST'] === undefined && isDirectRun()) {
    main();
}
