/**
 * electron/packaged-bundle/verify-packaged-bundle.ts
 *
 * The engine-owned verification for `verify:packaged-bundle` — asserts the
 * Runtime Debug Layer (§4.12, Invariant #27) is absent from the bundles a REAL
 * packaging run emits, and that the app's electron-builder `files:` allowlist
 * still names the shipped bundles individually.
 *
 * Why this lives in the ENGINE package. The debug graph the markers describe is
 * engine code, and the property must hold for every consumer app — the monorepo
 * reference app AND every scaffolded game, whose `build-main.ts` and
 * `electron-builder.yml` are adopter-editable. Each consumer therefore runs a
 * THIN driver (the monorepo's `tools/verify-packaged-bundle.ts`; the scaffold
 * template's `electron/verify-packaged-bundle.ts`) that wires real process/FS IO
 * into {@link verifyPackagedBundle} and points it at its own app. The drivers
 * own their paths and build commands; the checks live here, once. The engine
 * package imports nothing from `tools/` or any app (§3 dependency direction).
 *
 * Why a gate rather than another test. Any source-level guard of this property
 * must model the shipped build, and whatever it models, the call site one level
 * further out stays unmodelled — something always calls the innermost tested
 * function, and that caller is untested by construction. So this gate models
 * nothing about the build: `io.buildApp` runs the same `build:app` invocation
 * the packaging scripts run, and the checks read the bytes that command
 * emitted. No refactor of a consumer's `build-main.ts` — a wrapped `build:`
 * argument, a starved `env:`, a second esbuild import, a rewritten CLI block —
 * can satisfy it while the debug graph ships.
 *
 * EVERY RUN IS SELF-VALIDATING, per predicate. The dev rebuild that restores
 * the app's `dist/` afterwards doubles as the negative control: a dev bundle
 * carries the whole debug layer, so every predicate must reject it — each
 * marker, both channel checks, the emitted debug preload, the missing
 * folded-gate literal ({@link devRejectionGaps}). The allowlist predicates get
 * the same treatment against a synthetic widened config
 * ({@link electronBuilderControlGaps}). A gutted or rotted predicate therefore
 * fails the gate itself, on the same run, with no separate self-test to
 * remember to execute. (The dev control also catches a leaked
 * `CHIMERA_PACKAGED_BUILD` poisoning the dev environment: a packaged-shaped
 * "dev" build trips the folded-gate and missing-preload gaps.)
 *
 * The predicates and the orchestration are additionally unit-tested against
 * synthetic text and an in-memory IO in `verify-packaged-bundle.test.ts` — the
 * size floor, the inline-sourcemap detector, and the request-channel lookahead
 * have no real-build fixture. Only the drivers touch real builds and disk.
 */

import path from 'node:path';

import {
    ALL_DEBUG_GRAPH_MARKERS,
    DEBUG_BRIDGE_GLOBAL,
    DEBUG_PUSH_CHANNEL_LITERAL,
    DEBUG_REQUEST_CHANNEL_RE,
    FOLDED_GATE_LITERAL,
} from './debug-bundle-markers.js';

/**
 * The consumer app's bundle output paths — the same shape its `build-main.ts`
 * derives its plan from (`appBundleOutfiles`). Drivers pass the app's OWN map
 * so the gate tracks the plan rather than restating it; the path coupling fails
 * CLOSED, because outputs are deleted before each build and a diverged map
 * finds no file rather than reading a stale one.
 */
export interface PackagedBundleOutfiles {
    readonly main: string;
    readonly preload: string;
    readonly debugPreload: string;
}

export interface Failure {
    readonly bundle: string;
    /** Stable predicate id — what the negative controls' gap analyses key on. */
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

// ── electron-builder `files:` allowlist ─────────────────────────────────────

export interface ElectronBuilderCheckOptions {
    /** Absolute app dir the outfile paths are relative to. */
    readonly appDir: string;
    readonly outfiles: PackagedBundleOutfiles;
}

/** An outfile path as it appears in the app's `files:` allowlist (POSIX, app-relative). */
function distEntry(options: ElectronBuilderCheckOptions, file: string): string {
    return path.relative(options.appDir, file).split(path.sep).join('/');
}

/**
 * The allowlist predicates: the app's electron-builder `files:` list must name
 * the two shipped bundles individually and nothing else under `dist/`.
 *
 * "Not built" is the stronger guarantee for the debug preload — a packaged
 * `build:app` emits none — but the allowlist is the second, adopter-editable
 * layer: widening it to `dist/**` is an entirely natural edit, and it would
 * ship whatever an earlier dev build left behind, since `build:app` overwrites
 * but never cleans. These checks are text-level on purpose: the gate must not
 * depend on a YAML parser, and the entries it guards are exact list lines.
 */
export function electronBuilderDistFailures(
    ymlText: string,
    options: ElectronBuilderCheckOptions,
): Failure[] {
    const failures: Failure[] = [];
    const shipped = [
        distEntry(options, options.outfiles.main),
        distEntry(options, options.outfiles.preload),
    ];
    const debugPreload = distEntry(options, options.outfiles.debugPreload);

    // Any wildcard under dist/ re-opens the allowlist to unplanned artifacts —
    // `dist/**` is the canonical widening, but `dist/preload/*` ships the debug
    // preload just the same.
    if (/dist\/[^\n]*\*/.test(ymlText)) {
        failures.push({
            bundle: 'electron-builder.yml',
            check: 'files-dist-glob',
            problem: 'globs under dist/ instead of naming the shipped bundles individually',
        });
    }
    if (ymlText.includes(debugPreload) || ymlText.includes('debug-api')) {
        failures.push({
            bundle: 'electron-builder.yml',
            check: 'files-ships-debug-preload',
            problem: 'references the debug preload, which must never ship',
        });
    }

    const listedDistEntries = ymlText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- dist/'))
        .map((line) => line.slice('- '.length).trim());

    for (const entry of shipped) {
        if (!listedDistEntries.includes(entry)) {
            failures.push({
                bundle: 'electron-builder.yml',
                check: `files-missing:${entry}`,
                problem: `no longer names the shipped bundle ${entry} — an empty or renamed allowlist would otherwise pass every absence check`,
            });
        }
    }
    for (const entry of listedDistEntries) {
        if (!shipped.includes(entry)) {
            failures.push({
                bundle: 'electron-builder.yml',
                check: `files-unexpected:${entry}`,
                problem: `lists ${entry}, which is not part of the app's bundle plan`,
            });
        }
    }
    return failures;
}

/**
 * The allowlist predicates' own negative control, run inline on every gate run
 * (mirroring {@link devRejectionGaps} for the bundle predicates): a synthetic
 * WIDENED config — `dist/**` plus the debug preload by name, the two shipped
 * entries dropped — must be rejected by every allowlist check, per check. A
 * predicate rewritten to return nothing fails the gate on the same run.
 *
 * `check` is injectable so the control itself is testable with a gutted
 * predicate; every runtime caller uses the shipped default.
 */
export function electronBuilderControlGaps(
    options: ElectronBuilderCheckOptions,
    check: (
        ymlText: string,
        checkOptions: ElectronBuilderCheckOptions,
    ) => Failure[] = electronBuilderDistFailures,
): string[] {
    const widened = [
        'files:',
        '  - dist/**',
        `  - ${distEntry(options, options.outfiles.debugPreload)}`,
        '',
    ].join('\n');
    const fired = new Set(check(widened, options).map((f) => f.check));
    const required = [
        'files-dist-glob',
        'files-ships-debug-preload',
        `files-missing:${distEntry(options, options.outfiles.main)}`,
        `files-missing:${distEntry(options, options.outfiles.preload)}`,
    ];
    return required
        .filter((id) => !fired.has(id))
        .map((id) => `a widened files allowlist was not rejected by the ${id} check`);
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * The IO seam a driver wires up. `buildApp` must run the app's REAL `build:app`
 * script exactly as its packaging scripts do — same script, same env var —
 * because anything less specific reintroduces a restatement of the shipped
 * command. The FS operations are injected so the orchestration (order, fail
 * paths, the always-restore contract) is unit-testable without touching disk.
 */
export interface VerifyPackagedBundleIo {
    /** Run the app's `build:app`, with the packaging env var set iff `packaged`. */
    readonly buildApp: (packaged: boolean) => void;
    readonly readFile: (file: string) => string;
    readonly fileExists: (file: string) => boolean;
    /** Delete a file if present (`rmSync(file, { force: true })` semantics). */
    readonly removeFile: (file: string) => void;
    readonly log: (message: string) => void;
    readonly error: (message: string) => void;
}

export interface VerifyPackagedBundleOptions {
    /** Absolute app dir (owns `dist/` and `electron-builder.yml`). */
    readonly appDir: string;
    /** The app's own bundle plan output map — see {@link PackagedBundleOutfiles}. */
    readonly outfiles: PackagedBundleOutfiles;
    /** Override for the packaging config path; default `<appDir>/electron-builder.yml`. */
    readonly electronBuilderConfig?: string;
}

/**
 * Typed enumeration of the plan's outfiles. Keying off the real object keeps a
 * field added to the outfile map flowing through here automatically.
 */
function outfileEntries(
    outfiles: PackagedBundleOutfiles,
): readonly (readonly [keyof PackagedBundleOutfiles, string])[] {
    return (Object.keys(outfiles) as readonly (keyof PackagedBundleOutfiles)[]).map(
        (label) => [label, outfiles[label]] as const,
    );
}

/**
 * Delete every planned output before building, so each existence check
 * afterwards is a statement about THIS build. `build:app` overwrites but never
 * cleans, and an existence probe cannot tell "this build emitted it" from "a
 * previous dev build left it there". (In a distributable a stale file is
 * harmless — the `files` allowlist names the shipped files explicitly, and the
 * checks above keep it that way. It is only this gate's reasoning that
 * staleness corrupts.)
 */
function clearBundleOutputs(outfiles: PackagedBundleOutfiles, io: VerifyPackagedBundleIo): void {
    for (const [, file] of outfileEntries(outfiles)) {
        io.removeFile(file);
        io.removeFile(`${file}.map`);
    }
}

/** The packaged assertions, over every bundle the plan says a build emits. */
function checkPackagedOutput(
    options: VerifyPackagedBundleOptions,
    io: VerifyPackagedBundleIo,
): Failure[] {
    const failures: Failure[] = [];

    // Every planned outfile except the debug preload ships, so every one is
    // scanned — a bundle added to the plan later is covered here automatically.
    for (const [label, file] of outfileEntries(options.outfiles)) {
        if (label === 'debugPreload') {
            if (io.fileExists(file)) {
                failures.push({
                    bundle: label,
                    check: 'debug-preload-emitted',
                    problem: 'was emitted by a packaged build',
                });
            }
            continue;
        }
        if (!io.fileExists(file)) {
            failures.push({
                bundle: label,
                check: 'not-emitted',
                problem: `was not emitted at ${file}`,
            });
            continue;
        }
        failures.push(...checkBundleText(label, io.readFile(file)));
    }

    if (io.fileExists(options.outfiles.main)) {
        const folded = foldedGateFailure(io.readFile(options.outfiles.main));
        if (folded !== undefined) failures.push(folded);
    }

    // The adopter-editable second layer: the packaging config's `files:`
    // allowlist. Fails closed on a missing config — a gate that silently skips
    // this check on a renamed file is not guarding it.
    const configPath =
        options.electronBuilderConfig ?? path.join(options.appDir, 'electron-builder.yml');
    if (!io.fileExists(configPath)) {
        failures.push({
            bundle: 'electron-builder.yml',
            check: 'electron-builder-missing',
            problem: `no packaging config found at ${configPath}`,
        });
    } else {
        failures.push(
            ...electronBuilderDistFailures(io.readFile(configPath), {
                appDir: options.appDir,
                outfiles: options.outfiles,
            }),
        );
    }
    return failures;
}

/** Read the restored dev outputs and run the gap analysis over them. */
function checkDevControl(outfiles: PackagedBundleOutfiles, io: VerifyPackagedBundleIo): string[] {
    if (!io.fileExists(outfiles.main)) {
        return ['the dev restore build emitted no main bundle'];
    }
    return devRejectionGaps({
        mainCode: io.readFile(outfiles.main),
        debugPreloadCode: io.fileExists(outfiles.debugPreload)
            ? io.readFile(outfiles.debugPreload)
            : undefined,
    });
}

function report(failures: readonly Failure[], io: VerifyPackagedBundleIo): void {
    for (const failure of failures) {
        io.error(`  ✗ ${failure.bundle} bundle ${failure.problem}`);
    }
}

/**
 * The full gate: packaged build → content + allowlist checks → dev restore →
 * per-predicate negative controls. Returns `true` when everything held; the
 * driver owns the process exit code.
 *
 * ⚠️ SIDE EFFECT (via `io`): `buildApp` writes the same `dist/` path a dev
 * launch runs from, so a packaged build leaves the F9 Inspector dead until the
 * dev bundle is rebuilt. This runner ALWAYS rebuilds it before returning,
 * including on failure — do not run it concurrently with a dev launch.
 */
export function verifyPackagedBundle(
    options: VerifyPackagedBundleOptions,
    io: VerifyPackagedBundleIo,
): boolean {
    let failed = false;
    try {
        io.log('building the app exactly as the packaging scripts do…');
        clearBundleOutputs(options.outfiles, io);
        io.buildApp(true);

        const failures = checkPackagedOutput(options, io);
        if (failures.length > 0) {
            io.error('the packaged bundles still carry the debug layer:');
            report(failures, io);
            io.error(
                '\n  This gate reads the bytes the real build emitted. A green unit suite here means a\n' +
                    '  guard is describing the build instead of running it — fix the build, not the gate.',
            );
            failed = true;
        } else {
            io.log('the packaged bundles carry no debug layer.');
        }
    } finally {
        // ALWAYS restore the dev bundle — a packaged `dist/` left behind kills
        // the F9 Inspector with no error message — and use the restored build as
        // the negative control while it is here.
        io.log('restoring the dev bundle (doubles as the negative control)…');
        clearBundleOutputs(options.outfiles, io);
        io.buildApp(false);

        const gaps = [
            ...checkDevControl(options.outfiles, io),
            ...electronBuilderControlGaps({ appDir: options.appDir, outfiles: options.outfiles }),
        ];
        if (gaps.length > 0) {
            io.error('NEGATIVE CONTROL FAILED — a known-bad input was not rejected:');
            for (const gap of gaps) {
                io.error(`  ✗ ${gap}`);
            }
            io.error(
                '\n  A dev bundle carries the whole debug layer and a widened allowlist ships it; a\n' +
                    '  predicate that no longer rejects them proves nothing about a packaged build.\n' +
                    '  Fix the predicate or the marker set.',
            );
            failed = true;
        } else {
            io.log('negative control passed — every predicate rejects the known-bad inputs.');
        }
    }
    return !failed;
}
