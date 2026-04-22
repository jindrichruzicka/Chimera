/**
 * tools/dev-multiplayer.ts
 *
 * Development harness CLI: spawns one Electron host process and N-1
 * auto-joining client processes, each with its own Electron `userData`
 * directory and seed profile, so a multiplayer scenario can be launched
 * with a single command.
 *
 *   pnpm dev:mp 3                    # 1 host + 2 clients
 *   pnpm dev:mp 4 --game tactics
 *
 * Architecture reference: §4.32 — Development Multiplayer Harness
 * Issue: #84
 *
 * Invariants upheld:
 *   #2  — This module lives in `tools/`, not `simulation/`. It does not
 *          import from `renderer/`, `simulation/`, `ai/`, or any `games/`
 *          module; it only orchestrates child processes.
 *   #77 — Harness flags and the `CHIMERA_DEV_HARNESS=1` env variable
 *          refuse to activate in a production build (NODE_ENV=production).
 *   #78 — Each spawned instance uses an isolated `.dev-userdata/p<i>`
 *          directory so profiles, saves, and settings never cross over.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer, type AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Public types ─────────────────────────────────────────────────────────────

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export interface HarnessOptions {
    readonly players: number;
    readonly game?: string;
    readonly scenario?: string;
    readonly port?: number;
}

export interface SpawnConfig {
    /** Human label for log prefixing (e.g. "p1", "p2"). */
    readonly label: string;
    /** Argument vector to pass to the Electron binary. */
    readonly args: readonly string[];
    /** Environment variables for the spawned process. */
    readonly env: Readonly<Record<string, string>>;
    /** Relative path to the user-data dir; created before spawn. */
    readonly userDataDir: string;
}

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

// ─── parseArgs ────────────────────────────────────────────────────────────────

const KNOWN_FLAGS = new Set(['--game', '--scenario', '--port']);

/**
 * Parse the harness CLI argument vector. Expects the first positional arg to
 * be the player count; subsequent `--flag value` pairs in any order.
 */
export function parseArgs(argv: readonly string[]): HarnessOptions {
    if (argv.length === 0) {
        throw new HarnessArgsError(
            `Missing player count. Usage: pnpm dev:mp <N> [--game <id>] [--scenario <name>] [--port <n>]`,
        );
    }

    const [head, ...rest] = argv;
    const players = parsePositiveInt(head ?? '', 'player count');
    if (players < MIN_PLAYERS || players > MAX_PLAYERS) {
        throw new HarnessArgsError(
            `Player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}; got ${players}.`,
        );
    }

    let game: string | undefined;
    let scenario: string | undefined;
    let port: number | undefined;

    for (let i = 0; i < rest.length; i++) {
        const flag = rest[i] ?? '';
        if (!KNOWN_FLAGS.has(flag)) {
            throw new HarnessArgsError(
                `Unknown flag: ${flag}. Known flags: ${[...KNOWN_FLAGS].join(', ')}.`,
            );
        }
        const value = rest[i + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new HarnessArgsError(`Flag ${flag} is missing its value.`);
        }
        i += 1;
        switch (flag) {
            case '--game':
                game = value;
                break;
            case '--scenario':
                scenario = value;
                break;
            case '--port': {
                const n = parsePositiveInt(value, 'port');
                if (n < 1 || n > 65_535) {
                    throw new HarnessArgsError(
                        `--port must be an integer in [1, 65535]; got ${n}.`,
                    );
                }
                port = n;
                break;
            }
        }
    }

    const opts: { players: number; game?: string; scenario?: string; port?: number } = { players };
    if (game !== undefined) opts.game = game;
    if (scenario !== undefined) opts.scenario = scenario;
    if (port !== undefined) opts.port = port;
    return opts;
}

function parsePositiveInt(raw: string, label: string): number {
    if (!/^[0-9]+$/.test(raw)) {
        throw new HarnessArgsError(`${label} must be a positive integer; got "${raw}".`);
    }
    return Number.parseInt(raw, 10);
}

// ─── assertHarnessEnv ─────────────────────────────────────────────────────────

/**
 * Invariant #77: the harness is a development-only tool.
 *
 * Refuse to run unless `CHIMERA_DEV_HARNESS=1`, and refuse outright in a
 * production build. Called once from `main()` before any child is spawned.
 */
export function assertHarnessEnv(env: Readonly<Record<string, string | undefined>>): void {
    if (env['CHIMERA_DEV_HARNESS'] !== '1') {
        throw new HarnessGuardError(
            `CHIMERA_DEV_HARNESS must be set to "1" to run the dev multiplayer harness. ` +
                `The pnpm dev:mp script sets this for you; invoking tools/dev-multiplayer.ts ` +
                `directly requires CHIMERA_DEV_HARNESS=1 in the environment.`,
        );
    }
    if (env['NODE_ENV'] === 'production') {
        throw new HarnessGuardError(
            `Refusing to start: CHIMERA_DEV_HARNESS=1 with NODE_ENV=production. ` +
                `The dev multiplayer harness is a development-only tool (invariant #77).`,
        );
    }
}

// ─── Spawn-config builders ────────────────────────────────────────────────────

const USER_DATA_ROOT = '.dev-userdata';

function instanceEnv(): Record<string, string> {
    return { CHIMERA_DEV_HARNESS: '1' };
}

export function buildHostSpawnConfig(opts: HarnessOptions, port: number): SpawnConfig {
    const userDataDir = `${USER_DATA_ROOT}/p1`;
    const args: string[] = [
        `--user-data-dir=${userDataDir}`,
        '--dev-auto-host',
        `--dev-port=${port}`,
        `--dev-profile-id=dev-p1`,
    ];
    if (opts.game !== undefined) args.push(`--dev-game=${opts.game}`);
    if (opts.scenario !== undefined) args.push(`--dev-scenario=${opts.scenario}`);
    return { label: 'p1', args, env: instanceEnv(), userDataDir };
}

export function buildClientSpawnConfig(
    opts: HarnessOptions,
    port: number,
    index: number,
): SpawnConfig {
    if (!Number.isInteger(index) || index < 2 || index > opts.players) {
        throw new HarnessArgsError(
            `Client index must be an integer in [2, ${opts.players}]; got ${index}.`,
        );
    }
    const userDataDir = `${USER_DATA_ROOT}/p${index}`;
    const args: string[] = [
        `--user-data-dir=${userDataDir}`,
        `--dev-auto-join=127.0.0.1:${port}`,
        `--dev-profile-id=dev-p${index}`,
    ];
    return { label: `p${index}`, args, env: instanceEnv(), userDataDir };
}

// ─── Runtime helpers ──────────────────────────────────────────────────────────

/** Resolve the Electron executable path via the `electron` npm package. */
function resolveElectronBinary(): string {
    const require = createRequire(import.meta.url);
    const electronPath: unknown = require('electron');
    if (typeof electronPath !== 'string') {
        throw new Error(
            'Could not resolve the Electron binary. Is the "electron" devDependency installed?',
        );
    }
    return electronPath;
}

/** Ask the OS for a free TCP port by binding to port 0. */
async function findFreePort(): Promise<number> {
    return new Promise((resolvePort, rejectPort) => {
        const server = createServer();
        server.once('error', rejectPort);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as AddressInfo | null;
            if (addr === null) {
                server.close();
                rejectPort(new Error('Failed to acquire a free port.'));
                return;
            }
            const { port } = addr;
            server.close(() => resolvePort(port));
        });
    });
}

/**
 * Poll `host:port` with short TCP connect attempts until one succeeds, or
 * reject with `HarnessTimeoutError` once `timeoutMs` has elapsed. Used between
 * host-spawn and client-spawn so auto-joining clients never race a cold host.
 */
export async function waitForPortListening(
    host: string,
    port: number,
    timeoutMs: number,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const retryMs = 50;

    const tryOnce = (): Promise<boolean> =>
        new Promise((resolveProbe) => {
            const socket = createConnection({ host, port });
            const done = (ok: boolean): void => {
                socket.removeAllListeners();
                socket.destroy();
                resolveProbe(ok);
            };
            socket.once('connect', () => done(true));
            socket.once('error', () => done(false));
        });

    while (true) {
        if (await tryOnce()) return;
        if (Date.now() >= deadline) {
            throw new HarnessTimeoutError(
                `Timed out after ${timeoutMs}ms waiting for a TCP listener on ${host}:${port}.`,
            );
        }
        await new Promise<void>((r) => setTimeout(r, retryMs));
    }
}

async function resetDevUserDataDirs(players: number): Promise<void> {
    await rm(USER_DATA_ROOT, { recursive: true, force: true });
    for (let i = 1; i <= players; i++) {
        await mkdir(resolve(USER_DATA_ROOT, `p${i}`), { recursive: true });
    }
}

function spawnInstance(binary: string, cfg: SpawnConfig): ChildProcess {
    const electronArgs = [resolve('electron/main/index.js'), ...cfg.args];
    const child = spawn(binary, electronArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...cfg.env },
    });
    const prefix = `[${cfg.label}] `;
    child.stdout?.on('data', (chunk: Buffer) => {
        process.stdout.write(prefixLines(prefix, chunk.toString('utf8')));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(prefixLines(prefix, chunk.toString('utf8')));
    });
    return child;
}

function prefixLines(prefix: string, text: string): string {
    return text.replace(/^(?!$)/gm, prefix);
}

/**
 * Register SIGINT/SIGTERM forwarders that relay the signal to every live
 * child. Returns a disposer that removes both listeners; calling it more than
 * once is safe (the second call is a no-op). Callers should invoke the
 * disposer in a `finally` block so listener counts do not accumulate when
 * `main()` is driven by tests in-process.
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
 * Wait until the first child exits, then tear down the rest.
 *
 * Per §4.32 the harness is a "one-out, all-out" orchestrator: if any process
 * (host or client) exits, the remaining siblings are signalled so the user
 * gets a clean shutdown instead of orphan ECONNREFUSED loops.
 *
 *  1. Wait for the first `exit` event from any child.
 *  2. Send `SIGTERM` to every still-alive sibling.
 *  3. Wait up to `graceMs` for siblings to exit; escalate survivors to `SIGKILL`.
 *  4. Resolve with the highest non-null exit code observed.
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

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
    assertHarnessEnv(process.env);
    const opts = parseArgs(process.argv.slice(2));
    const port = opts.port ?? (await findFreePort());
    const binary = resolveElectronBinary();

    await resetDevUserDataDirs(opts.players);

    const children: ChildProcess[] = [];
    children.push(spawnInstance(binary, buildHostSpawnConfig(opts, port)));
    await waitForPortListening('127.0.0.1', port, 10_000);
    for (let i = 2; i <= opts.players; i++) {
        children.push(spawnInstance(binary, buildClientSpawnConfig(opts, port, i)));
    }

    const disposeSignals = installSignalForwarding(children);
    try {
        return await waitForAnyChildExit(children, 5_000);
    } finally {
        disposeSignals();
    }
}

// Execute when invoked as a script (not when imported by the test suite).
const invokedDirectly = isDirectInvocation(import.meta.url, process.argv[1]);
if (invokedDirectly) {
    main()
        .then((exitCode) => process.exit(exitCode))
        .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[dev-multiplayer] ${message}\n`);
            process.exit(1);
        });
}

/**
 * True when this module was launched directly as a CLI (e.g. `node foo.ts`)
 * rather than imported by another module (test runner, REPL).
 *
 * Compares canonical absolute paths: `fileURLToPath(importMetaUrl)` against
 * the resolved `argv[1]`. This replaces the old `endsWith` substring match,
 * which could falsely match whenever two repos contained same-named files.
 */
export function isDirectInvocation(importMetaUrl: string, argv1: string | undefined): boolean {
    if (argv1 === undefined) return false;
    if (!importMetaUrl.startsWith('file://')) return false;
    try {
        return fileURLToPath(importMetaUrl) === resolve(argv1);
    } catch {
        return false;
    }
}
