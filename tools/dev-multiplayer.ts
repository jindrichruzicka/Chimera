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
import { createServer, type AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

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

function installSignalForwarding(children: readonly ChildProcess[]): void {
    const forward = (signal: NodeJS.Signals): void => {
        for (const child of children) {
            if (!child.killed) child.kill(signal);
        }
    };
    process.on('SIGINT', () => forward('SIGINT'));
    process.on('SIGTERM', () => forward('SIGTERM'));
}

async function waitForAllChildExit(children: readonly ChildProcess[]): Promise<number> {
    let highestExit = 0;
    await Promise.all(
        children.map(
            (child) =>
                new Promise<void>((done) => {
                    child.on('exit', (code) => {
                        if (code !== null && code > highestExit) highestExit = code;
                        done();
                    });
                }),
        ),
    );
    return highestExit;
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
    for (let i = 2; i <= opts.players; i++) {
        children.push(spawnInstance(binary, buildClientSpawnConfig(opts, port, i)));
    }

    installSignalForwarding(children);
    return waitForAllChildExit(children);
}

// Execute when invoked as a script (not when imported by the test suite).
const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1]);
if (invokedDirectly) {
    main()
        .then((exitCode) => process.exit(exitCode))
        .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[dev-multiplayer] ${message}\n`);
            process.exit(1);
        });
}
