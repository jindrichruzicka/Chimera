/**
 * electron/dev-harness/harness.ts
 *
 * Dev multiplayer harness library (§4.32): everything the `chimera-dev-mp`
 * CLI needs to plan and orchestrate N Electron instances of a Chimera app —
 * argument parsing, fixture-driven plan resolution (`<appRoot>/dev/`),
 * per-instance spawn configs, the announce-file handshake that relays the
 * host's `host:port:token` lobby code to auto-joining clients, and the
 * one-out-all-out teardown helpers.
 *
 * Ships inside `@chimera-engine/electron` so a standalone scaffolded game
 * (create-chimera-game) gets the same tool the monorepo uses — the app dir is
 * the harness root in both worlds (entry from the app's package.json `main`,
 * fixtures from `<appRoot>/dev/`). No monorepo path appears anywhere here.
 *
 * Dev-only-in-tarball follows the debug-api precedent: presence in dist is
 * not the gate — the runtime env is (Invariant #77: `CHIMERA_DEV_HARNESS=1`
 * required, production refused; each spawned instance re-asserts this).
 *
 * Invariants upheld:
 *   #77 — `assertHarnessEnv` refuses to run without CHIMERA_DEV_HARNESS=1 or
 *          with NODE_ENV=production.
 *   #78 — every instance gets an isolated `.dev-userdata/p<i>` dir; the
 *          announce file lives inside the HOST's own dir and only the
 *          orchestrator (never a sibling instance) reads it.
 */

import type { ChildProcess } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
    DEV_SCENARIO_MAX_SEATS,
    DevAnnounceSchema,
    DevScenarioSchema,
    devScenarioHumanSeats,
    generatedDevProfileId,
    type DevAnnounce,
    type DevScenario,
} from '@chimera-engine/simulation/foundation/dev-fixture-contract.js';
import { EngineProfileSchema } from '@chimera-engine/simulation/profile/ProfileSchema.js';

// ─── Public constants ─────────────────────────────────────────────────────────

export const MIN_PLAYERS = 2;
/** One instance per human seat — the cap IS the scenario seat cap (one source of truth). */
export const MAX_PLAYERS = DEV_SCENARIO_MAX_SEATS;

/** Basename of the host's announce file inside its own userData dir. */
export const ANNOUNCE_FILE_NAME = 'dev-harness-announce.json';

/** How long the orchestrator waits for the host's announce (cold boot + content load). */
export const ANNOUNCE_TIMEOUT_MS = 15_000;

// ─── Error classes ────────────────────────────────────────────────────────────

export class HarnessArgsError extends Error {
    readonly code = 'HARNESS_ARGS' as const;
    constructor(message: string) {
        super(message);
        this.name = 'HarnessArgsError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class HarnessGuardError extends Error {
    readonly code = 'HARNESS_GUARD' as const;
    constructor(message: string) {
        super(message);
        this.name = 'HarnessGuardError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class HarnessTimeoutError extends Error {
    readonly code = 'HARNESS_TIMEOUT' as const;
    constructor(message: string) {
        super(message);
        this.name = 'HarnessTimeoutError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── IO port ──────────────────────────────────────────────────────────────────

/** Minimal read-only filesystem port; tests inject an in-memory double. */
export interface HarnessIo {
    readFile(path: string): Promise<string>;
}

// ─── parseArgs ────────────────────────────────────────────────────────────────

export interface HarnessCliOptions {
    /** Human seat count; optional when --scenario provides it. */
    readonly players?: number;
    /** Scenario name under `<appRoot>/dev/scenarios/` (with or without .json). */
    readonly scenario?: string;
    /** App dir, resolved against cwd. Default: cwd. */
    readonly app?: string;
    /** Entry-file override, resolved against the app dir. Default: package.json `main`. */
    readonly entry?: string;
    /** Expected gameId, cross-checked by the host instance. */
    readonly game?: string;
    /** Launch instances with the F9 Debug Inspector enabled (CHIMERA_DEBUG=1). */
    readonly debug: boolean;
    /** Resolve + validate + print the spawn plan as JSON; spawn nothing. */
    readonly dryRun: boolean;
}

const VALUE_FLAGS = new Set(['--scenario', '--app', '--entry', '--game']);
const BOOL_FLAGS = new Set(['--debug', '--dry-run']);

/**
 * Parse the harness CLI argument vector: an optional positional player count
 * followed by `--flag value` pairs and boolean flags in any order.
 */
export function parseArgs(argv: readonly string[]): HarnessCliOptions {
    let players: number | undefined;
    let scenario: string | undefined;
    let app: string | undefined;
    let entry: string | undefined;
    let game: string | undefined;
    let debug = false;
    let dryRun = false;

    let i = 0;
    if (argv.length > 0 && !argv[0]!.startsWith('--')) {
        players = parsePlayers(argv[0]!);
        i = 1;
    }

    for (; i < argv.length; i++) {
        const flag = argv[i] ?? '';
        if (BOOL_FLAGS.has(flag)) {
            if (flag === '--debug') debug = true;
            else dryRun = true;
            continue;
        }
        if (!VALUE_FLAGS.has(flag)) {
            throw new HarnessArgsError(
                `Unknown flag: ${flag}. Known flags: ${[...VALUE_FLAGS, ...BOOL_FLAGS].join(', ')}.`,
            );
        }
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new HarnessArgsError(`Flag ${flag} is missing its value.`);
        }
        i += 1;
        switch (flag) {
            case '--scenario':
                scenario = value;
                break;
            case '--app':
                app = value;
                break;
            case '--entry':
                entry = value;
                break;
            case '--game':
                game = value;
                break;
        }
    }

    return {
        ...(players !== undefined ? { players } : {}),
        ...(scenario !== undefined ? { scenario } : {}),
        ...(app !== undefined ? { app } : {}),
        ...(entry !== undefined ? { entry } : {}),
        ...(game !== undefined ? { game } : {}),
        debug,
        dryRun,
    };
}

function parsePlayers(raw: string): number {
    if (!/^[0-9]+$/.test(raw)) {
        throw new HarnessArgsError(`Player count must be a positive integer; got "${raw}".`);
    }
    const players = Number.parseInt(raw, 10);
    if (players < MIN_PLAYERS || players > MAX_PLAYERS) {
        throw new HarnessArgsError(
            `Player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}; got ${players}.`,
        );
    }
    return players;
}

// ─── assertHarnessEnv ─────────────────────────────────────────────────────────

/**
 * Invariant #77: the harness is a development-only tool. Refuse to run unless
 * `CHIMERA_DEV_HARNESS=1`, and refuse outright in a production build.
 */
export function assertHarnessEnv(env: Readonly<Record<string, string | undefined>>): void {
    if (env['CHIMERA_DEV_HARNESS'] !== '1') {
        throw new HarnessGuardError(
            `CHIMERA_DEV_HARNESS must be set to "1" to run the dev multiplayer harness. ` +
                `The app's dev:mp script sets this for you.`,
        );
    }
    if (env['NODE_ENV'] === 'production') {
        throw new HarnessGuardError(
            `Refusing to start: CHIMERA_DEV_HARNESS=1 with NODE_ENV=production. ` +
                `The dev multiplayer harness is a development-only tool (invariant #77).`,
        );
    }
}

// ─── resolveHarnessPlan ───────────────────────────────────────────────────────

/** Fully resolved, pre-validated spawn plan — everything checked before any spawn. */
export interface HarnessPlan {
    readonly appDir: string;
    readonly appName: string;
    /** Built Electron main entry (`<appDir>/<package.json main>` or --entry). */
    readonly entryFile: string;
    /** Human seat count = Electron instances to spawn. */
    readonly players: number;
    readonly scenarioFile: string | undefined;
    readonly scenario: DevScenario | undefined;
    /** Per-seat absolute profile-file paths; `undefined` ⇒ `--dev-profile-id=dev-p<i>` fallback. */
    readonly profileFiles: readonly (string | undefined)[];
    readonly userDataRoot: string;
    readonly announceFile: string;
    readonly gameId: string | undefined;
    readonly debug: boolean;
}

/**
 * Resolve + validate the whole run before anything is spawned: app dir and
 * entry, scenario (zod), every referenced profile file (zod + distinct ids),
 * seat-count consistency. Fail-fast — a broken fixture must stop the run
 * before the first Electron window, not after N of them.
 */
export async function resolveHarnessPlan(
    opts: HarnessCliOptions,
    io: HarnessIo,
    cwd: string,
): Promise<HarnessPlan> {
    const appDir = resolve(cwd, opts.app ?? '.');

    let pkgRaw: string;
    try {
        pkgRaw = await io.readFile(join(appDir, 'package.json'));
    } catch {
        throw new HarnessArgsError(
            `No package.json found in ${appDir} — run from a Chimera app dir or pass --app <dir>.`,
        );
    }
    let pkg: { name?: unknown; main?: unknown };
    try {
        pkg = JSON.parse(pkgRaw) as { name?: unknown; main?: unknown };
    } catch {
        throw new HarnessArgsError(`${join(appDir, 'package.json')} is not valid JSON.`);
    }
    const appName = typeof pkg.name === 'string' ? pkg.name : appDir;
    if (typeof pkg.main !== 'string' && opts.entry === undefined) {
        throw new HarnessArgsError(
            `${join(appDir, 'package.json')} has no "main" entry — pass --entry <path> ` +
                `to point the harness at the built Electron main bundle.`,
        );
    }
    const entryFile = resolve(appDir, opts.entry ?? (pkg.main as string));

    // Scenario resolution + validation.
    let scenarioFile: string | undefined;
    let scenario: DevScenario | undefined;
    if (opts.scenario !== undefined) {
        const fileName = opts.scenario.endsWith('.json') ? opts.scenario : `${opts.scenario}.json`;
        scenarioFile = join(appDir, 'dev', 'scenarios', fileName);
        scenario = await loadScenarioFile(scenarioFile, io);
    }

    // Seat-count consistency.
    let players: number;
    if (scenario !== undefined) {
        players = devScenarioHumanSeats(scenario);
        if (opts.players !== undefined && opts.players !== players) {
            throw new HarnessArgsError(
                `Player count ${opts.players} contradicts the scenario's ${players} seat(s) — ` +
                    `drop the positional count or fix the scenario.`,
            );
        }
    } else {
        if (opts.players === undefined) {
            throw new HarnessArgsError(
                `Missing player count. Usage: chimera-dev-mp <N> [--scenario <name>] ` +
                    `[--app <dir>] — the count may only be omitted when --scenario provides it.`,
            );
        }
        players = opts.players;
    }

    // Per-seat profile files: resolve, validate, and reject duplicate ids —
    // two instances joining under one localProfileId collide at the join gate.
    const profileFiles: (string | undefined)[] = [];
    const seenProfileIds = new Map<string, string>();
    for (let seatIndex = 0; seatIndex < players; seatIndex++) {
        const ref = scenario?.seats[seatIndex]?.profile;
        if (ref === undefined) {
            profileFiles.push(undefined);
            continue;
        }
        const profilePath = join(appDir, 'dev', 'profiles', ref);
        const profileId = await validateProfileFile(profilePath, io);
        const priorFile = seenProfileIds.get(profileId);
        if (priorFile !== undefined) {
            throw new HarnessArgsError(
                `Seats reference duplicate localProfileId "${profileId}" (${priorFile} and ` +
                    `${profilePath}) — every seat needs a distinct profile id or the host's ` +
                    `join gate rejects the second joiner.`,
            );
        }
        seenProfileIds.set(profileId, profilePath);
        profileFiles.push(profilePath);
    }

    const userDataRoot = join(appDir, '.dev-userdata');
    return {
        appDir,
        appName,
        entryFile,
        players,
        scenarioFile,
        scenario,
        profileFiles,
        userDataRoot,
        announceFile: join(userDataRoot, 'p1', ANNOUNCE_FILE_NAME),
        gameId: scenario?.gameId ?? opts.game,
        debug: opts.debug,
    };
}

async function loadScenarioFile(path: string, io: HarnessIo): Promise<DevScenario> {
    let raw: string;
    try {
        raw = await io.readFile(path);
    } catch {
        throw new HarnessArgsError(`Cannot read scenario ${path} — does the file exist?`);
    }
    let json: unknown;
    try {
        json = JSON.parse(raw) as unknown;
    } catch {
        throw new HarnessArgsError(`Scenario ${path} is not valid JSON.`);
    }
    const parsed = DevScenarioSchema.safeParse(json);
    if (!parsed.success) {
        throw new HarnessArgsError(`Scenario ${path} is invalid: ${formatIssues(parsed.error)}`);
    }
    return parsed.data;
}

async function validateProfileFile(path: string, io: HarnessIo): Promise<string> {
    let raw: string;
    try {
        raw = await io.readFile(path);
    } catch {
        throw new HarnessArgsError(`Cannot read profile ${path} — does the file exist?`);
    }
    let json: unknown;
    try {
        json = JSON.parse(raw) as unknown;
    } catch {
        throw new HarnessArgsError(`Profile ${path} is not valid JSON.`);
    }
    const parsed = EngineProfileSchema.safeParse(json);
    if (!parsed.success) {
        throw new HarnessArgsError(`Profile ${path} is invalid: ${formatIssues(parsed.error)}`);
    }
    return parsed.data.localProfileId;
}

function formatIssues(error: z.ZodError): string {
    return z.prettifyError(error);
}

// ─── Spawn-config builders ────────────────────────────────────────────────────

export interface SpawnConfig {
    /** Human label for log prefixing (e.g. "p1", "p2"). */
    readonly label: string;
    /** Argument vector to pass to the Electron binary after the entry. */
    readonly args: readonly string[];
    /** Environment overrides for the spawned process. */
    readonly env: Readonly<Record<string, string>>;
    /** Absolute userData dir; created before spawn (Invariant #78). */
    readonly userDataDir: string;
}

function instanceEnv(debug: boolean): Record<string, string> {
    return {
        CHIMERA_DEV_HARNESS: '1',
        // Windowed developer mode — env==='production' would force fullscreen.
        NODE_ENV: 'development',
        CHIMERA_ENV: 'development',
        ...(debug ? { CHIMERA_DEBUG: '1' } : {}),
    };
}

export function buildHostSpawnConfig(plan: HarnessPlan): SpawnConfig {
    const userDataDir = join(plan.userDataRoot, 'p1');
    const args: string[] = [
        `--user-data-dir=${userDataDir}`,
        '--dev-auto-host',
        '--dev-seat=1',
        `--dev-announce-file=${plan.announceFile}`,
    ];
    if (plan.scenarioFile !== undefined) {
        // The scenario is the single seat-count authority when present —
        // emitting --dev-players too would only create a disagreement channel.
        args.push(`--dev-scenario-file=${plan.scenarioFile}`);
    } else {
        args.push(`--dev-players=${plan.players}`);
    }
    const hostProfile = plan.profileFiles[0];
    args.push(
        hostProfile !== undefined
            ? `--dev-profile-file=${hostProfile}`
            : `--dev-profile-id=${generatedDevProfileId(1)}`,
    );
    if (plan.gameId !== undefined) args.push(`--dev-game=${plan.gameId}`);
    return { label: 'p1', args, env: instanceEnv(plan.debug), userDataDir };
}

export function buildClientSpawnConfig(
    plan: HarnessPlan,
    index: number,
    lobbyCode: string,
): SpawnConfig {
    if (!Number.isInteger(index) || index < 2 || index > plan.players) {
        throw new HarnessArgsError(
            `Client index must be an integer in [2, ${plan.players}]; got ${index}.`,
        );
    }
    const userDataDir = join(plan.userDataRoot, `p${index}`);
    const args: string[] = [
        `--user-data-dir=${userDataDir}`,
        `--dev-auto-join=${lobbyCode}`,
        `--dev-seat=${index}`,
    ];
    if (plan.scenarioFile !== undefined) args.push(`--dev-scenario-file=${plan.scenarioFile}`);
    const profile = plan.profileFiles[index - 1];
    args.push(
        profile !== undefined
            ? `--dev-profile-file=${profile}`
            : `--dev-profile-id=${generatedDevProfileId(index)}`,
    );
    return { label: `p${index}`, args, env: instanceEnv(plan.debug), userDataDir };
}

/**
 * Merge a spawn config's env over the parent env, always deleting
 * `ELECTRON_RUN_AS_NODE` — a leaked value makes the child run Electron as
 * plain Node and crash at host module-load (the launch.mjs lesson).
 */
export function buildChildEnv(
    parentEnv: Readonly<Record<string, string | undefined>>,
    configEnv: Readonly<Record<string, string>>,
): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...parentEnv, ...configEnv };
    delete env['ELECTRON_RUN_AS_NODE'];
    return env;
}

// ─── Dry-run report + entry preflight ─────────────────────────────────────────

/** Placeholder for the join code clients only learn from the runtime announce. */
const LOBBY_CODE_PLACEHOLDER = '<announce>';

export interface DryRunReport {
    readonly appDir: string;
    readonly entry: string;
    readonly players: number;
    readonly scenarioFile: string | undefined;
    readonly gameId: string | undefined;
    readonly instances: readonly {
        readonly label: string;
        readonly args: readonly string[];
        readonly userDataDir: string;
    }[];
}

/**
 * The `--dry-run` payload: the fully resolved plan plus every instance's
 * spawn config, JSON-serialisable and side-effect free. Client join codes are
 * only knowable at runtime, so they carry {@link LOBBY_CODE_PLACEHOLDER}.
 */
export function buildDryRunReport(plan: HarnessPlan): DryRunReport {
    const host = buildHostSpawnConfig(plan);
    const clients = Array.from({ length: Math.max(0, plan.players - 1) }, (_, i) =>
        buildClientSpawnConfig(plan, i + 2, LOBBY_CODE_PLACEHOLDER),
    );
    return {
        appDir: plan.appDir,
        entry: plan.entryFile,
        players: plan.players,
        scenarioFile: plan.scenarioFile,
        gameId: plan.gameId,
        instances: [host, ...clients].map((cfg) => ({
            label: cfg.label,
            args: cfg.args,
            userDataDir: cfg.userDataDir,
        })),
    };
}

/**
 * Preflight: the built Electron main entry must exist before spawning (or
 * dry-run-approving) anything. Deliberately an error, not an auto-build — a
 * multi-minute renderer build must never hide behind "spawn N windows".
 */
export async function assertEntryBuilt(plan: HarnessPlan, io: HarnessIo): Promise<void> {
    try {
        await io.readFile(plan.entryFile);
    } catch {
        throw new HarnessArgsError(
            `Built entry not found: ${plan.entryFile}. Build the app first — ` +
                `run \`pnpm build:app\` (and the renderer build) in ${plan.appDir}.`,
        );
    }
}

// ─── waitForAnnounceFile ──────────────────────────────────────────────────────

/**
 * Poll for the host's announce file until it parses as a valid
 * {@link DevAnnounce}, or reject with {@link HarnessTimeoutError} after
 * `timeoutMs`. A missing file, torn write, or invalid payload keeps polling —
 * the atomic `.tmp` + rename on the writer side makes a torn read transient.
 * Replaces the old TCP port-wait, which could never work: the hosting
 * provider binds an OS-assigned port and requires a session token, both of
 * which only the announce can carry.
 */
export async function waitForAnnounceFile(
    path: string,
    timeoutMs: number,
    io: HarnessIo,
): Promise<DevAnnounce> {
    const deadline = Date.now() + timeoutMs;
    const retryMs = 50;

    while (true) {
        const announce = await tryReadAnnounce(path, io);
        if (announce !== null) return announce;
        if (Date.now() >= deadline) {
            throw new HarnessTimeoutError(
                `Timed out after ${timeoutMs}ms waiting for the host announce file at ${path} — ` +
                    `did the host instance fail to boot? Check its [p1] log output.`,
            );
        }
        await new Promise<void>((r) => setTimeout(r, retryMs));
    }
}

async function tryReadAnnounce(path: string, io: HarnessIo): Promise<DevAnnounce | null> {
    let raw: string;
    try {
        raw = await io.readFile(path);
    } catch {
        return null;
    }
    try {
        const parsed = DevAnnounceSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

// ─── Signal forwarding + one-out-all-out teardown (ported unchanged) ──────────

/**
 * Register SIGINT/SIGTERM forwarders that relay the signal to every live
 * child. Returns an idempotent disposer that removes both listeners.
 */
export function installSignalForwarding(children: readonly ChildProcess[]): () => void {
    const onSigint = (): void => forwardSignal(children, 'SIGINT');
    const onSigterm = (): void => forwardSignal(children, 'SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    let disposed = false;
    return (): void => {
        if (disposed) return;
        disposed = true;
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
    };
}

function forwardSignal(children: readonly ChildProcess[], signal: NodeJS.Signals): void {
    for (const child of children) {
        if (!child.killed) child.kill(signal);
    }
}

/**
 * Wait until the first child exits, then tear down the rest ("one-out,
 * all-out", §4.32): SIGTERM every still-alive sibling, escalate survivors to
 * SIGKILL after `graceMs`, resolve with the highest non-null exit code.
 */
export async function waitForAnyChildExit(
    children: readonly ChildProcess[],
    graceMs: number,
): Promise<number> {
    let highestExit = 0;
    const exited = children.map(() => false);
    const exitPromises = children.map((child, i) =>
        onExit(child).then((code) => {
            exited[i] = true;
            if (code !== null && code > highestExit) highestExit = code;
            return code;
        }),
    );

    await Promise.race(exitPromises);

    for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        if (!exited[i] && !child.killed) child.kill('SIGTERM');
    }

    const gracePromise = new Promise<'grace'>((r) => setTimeout(() => r('grace'), graceMs));
    const allExited = Promise.all(exitPromises).then(() => 'all' as const);
    const outcome = await Promise.race([allExited, gracePromise]);

    if (outcome === 'grace') {
        for (let i = 0; i < children.length; i++) {
            if (!exited[i]) children[i]!.kill('SIGKILL');
        }
        await Promise.all(exitPromises);
    }

    return highestExit;
}

function onExit(child: ChildProcess): Promise<number | null> {
    return new Promise((resolveExit) => {
        child.once('exit', (code) => resolveExit(code));
    });
}

/**
 * True when this module was launched directly as a CLI rather than imported
 * (test runner, REPL). Compares canonical absolute paths — a substring match
 * would falsely fire across same-named files in different roots. Both sides
 * are realpath'd: the pnpm bin shim execs node with the SYMLINKED
 * `node_modules/@chimera-engine/electron/...` path while node's ESM loader
 * reports the real workspace path in `import.meta.url`, and only the
 * canonical forms match.
 */
export function isDirectInvocation(importMetaUrl: string, argv1: string | undefined): boolean {
    if (argv1 === undefined) return false;
    if (!importMetaUrl.startsWith('file://')) return false;
    try {
        return canonicalPath(fileURLToPath(importMetaUrl)) === canonicalPath(resolve(argv1));
    } catch {
        return false;
    }
}

/** Realpath when the file exists; the normalized path itself otherwise. */
function canonicalPath(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return path;
    }
}
