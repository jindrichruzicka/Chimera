/**
 * tools/dev-multiplayer.test.ts
 *
 * Unit tests for the pure pieces of `dev-multiplayer.ts`:
 *   - CLI argument parsing and validation
 *   - Environment-variable guards (CHIMERA_DEV_HARNESS / NODE_ENV)
 *   - Spawn-config builders (Electron CLI vector per instance)
 *
 * Process-spawning and port-listening are exercised manually via `pnpm dev:mp`
 * and by the future Playwright E2E suite (§13); they are not unit-tested here.
 *
 * Architecture reference: §4.32 — Development Multiplayer Harness
 * Issue: #84
 */

import { createServer, type Server } from 'node:net';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import {
    MIN_PLAYERS,
    MAX_PLAYERS,
    parseArgs,
    assertHarnessEnv,
    buildHostSpawnConfig,
    buildClientSpawnConfig,
    waitForPortListening,
    waitForAnyChildExit,
    isDirectInvocation,
    HarnessArgsError,
    HarnessGuardError,
    HarnessTimeoutError,
    type HarnessOptions,
} from './dev-multiplayer.js';

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe('parseArgs()', () => {
    it('parses the player count as the first positional arg', () => {
        expect(parseArgs(['3'])).toMatchObject({ players: 3 });
    });

    it('defaults game/scenario/port to undefined when not provided', () => {
        const opts = parseArgs(['2']);
        expect(opts.game).toBeUndefined();
        expect(opts.scenario).toBeUndefined();
        expect(opts.port).toBeUndefined();
    });

    it('parses --game <id>', () => {
        expect(parseArgs(['3', '--game', 'tactics'])).toMatchObject({
            players: 3,
            game: 'tactics',
        });
    });

    it('parses --scenario <name>', () => {
        expect(parseArgs(['3', '--scenario', 'skirmish'])).toMatchObject({
            scenario: 'skirmish',
        });
    });

    it('parses --port <n> as an integer', () => {
        expect(parseArgs(['2', '--port', '7777'])).toMatchObject({ port: 7777 });
    });

    it('accepts flags in any order after the player count', () => {
        expect(parseArgs(['4', '--scenario', 's', '--port', '9000', '--game', 'g'])).toMatchObject({
            players: 4,
            game: 'g',
            scenario: 's',
            port: 9000,
        });
    });

    it('throws HarnessArgsError when no player count is given', () => {
        expect(() => parseArgs([])).toThrow(HarnessArgsError);
    });

    it('throws HarnessArgsError when player count is below MIN_PLAYERS', () => {
        expect(() => parseArgs(['1'])).toThrow(HarnessArgsError);
        expect(() => parseArgs(['0'])).toThrow(HarnessArgsError);
    });

    it('throws HarnessArgsError when player count is above MAX_PLAYERS', () => {
        expect(() => parseArgs([String(MAX_PLAYERS + 1)])).toThrow(HarnessArgsError);
    });

    it('throws HarnessArgsError when player count is not an integer', () => {
        expect(() => parseArgs(['abc'])).toThrow(HarnessArgsError);
        expect(() => parseArgs(['2.5'])).toThrow(HarnessArgsError);
    });

    it('throws HarnessArgsError when --port is not an integer in [1, 65535]', () => {
        expect(() => parseArgs(['2', '--port', 'abc'])).toThrow(HarnessArgsError);
        expect(() => parseArgs(['2', '--port', '0'])).toThrow(HarnessArgsError);
        expect(() => parseArgs(['2', '--port', '70000'])).toThrow(HarnessArgsError);
    });

    it('throws HarnessArgsError on unknown flags', () => {
        expect(() => parseArgs(['2', '--wat'])).toThrow(HarnessArgsError);
    });

    it('throws HarnessArgsError when a flag is missing its value', () => {
        expect(() => parseArgs(['2', '--game'])).toThrow(HarnessArgsError);
        expect(() => parseArgs(['2', '--port'])).toThrow(HarnessArgsError);
    });

    it('accepts MIN_PLAYERS and MAX_PLAYERS at the boundaries', () => {
        expect(parseArgs([String(MIN_PLAYERS)]).players).toBe(MIN_PLAYERS);
        expect(parseArgs([String(MAX_PLAYERS)]).players).toBe(MAX_PLAYERS);
    });
});

// ─── assertHarnessEnv ────────────────────────────────────────────────────────

describe('assertHarnessEnv()', () => {
    it('throws HarnessGuardError when CHIMERA_DEV_HARNESS is unset', () => {
        expect(() => assertHarnessEnv({})).toThrow(HarnessGuardError);
    });

    it('throws HarnessGuardError when CHIMERA_DEV_HARNESS is not exactly "1"', () => {
        expect(() => assertHarnessEnv({ CHIMERA_DEV_HARNESS: 'true' })).toThrow(HarnessGuardError);
        expect(() => assertHarnessEnv({ CHIMERA_DEV_HARNESS: '' })).toThrow(HarnessGuardError);
        expect(() => assertHarnessEnv({ CHIMERA_DEV_HARNESS: '0' })).toThrow(HarnessGuardError);
    });

    it('throws HarnessGuardError when NODE_ENV is production', () => {
        expect(() =>
            assertHarnessEnv({ CHIMERA_DEV_HARNESS: '1', NODE_ENV: 'production' }),
        ).toThrow(HarnessGuardError);
    });

    it('does not throw when CHIMERA_DEV_HARNESS=1 and NODE_ENV is undefined', () => {
        expect(() => assertHarnessEnv({ CHIMERA_DEV_HARNESS: '1' })).not.toThrow();
    });

    it('does not throw when CHIMERA_DEV_HARNESS=1 and NODE_ENV=development', () => {
        expect(() =>
            assertHarnessEnv({ CHIMERA_DEV_HARNESS: '1', NODE_ENV: 'development' }),
        ).not.toThrow();
    });
});

// ─── buildHostSpawnConfig ────────────────────────────────────────────────────

describe('buildHostSpawnConfig()', () => {
    const baseOpts: HarnessOptions = { players: 2 };

    it('includes --user-data-dir pointing at .dev-userdata/p1', () => {
        const cfg = buildHostSpawnConfig(baseOpts, 7812);
        expect(cfg.args).toContain('--user-data-dir=.dev-userdata/p1');
    });

    it('includes --dev-auto-host flag', () => {
        const cfg = buildHostSpawnConfig(baseOpts, 7812);
        expect(cfg.args).toContain('--dev-auto-host');
    });

    it('includes --dev-profile-id=dev-p1', () => {
        const cfg = buildHostSpawnConfig(baseOpts, 7812);
        expect(cfg.args).toContain('--dev-profile-id=dev-p1');
    });

    it('includes --dev-port=<port>', () => {
        const cfg = buildHostSpawnConfig(baseOpts, 7812);
        expect(cfg.args).toContain('--dev-port=7812');
    });

    it('forwards --game when provided', () => {
        const cfg = buildHostSpawnConfig({ players: 2, game: 'tactics' }, 7812);
        expect(cfg.args).toContain('--dev-game=tactics');
    });

    it('forwards --scenario when provided', () => {
        const cfg = buildHostSpawnConfig({ players: 2, scenario: 'skirmish' }, 7812);
        expect(cfg.args).toContain('--dev-scenario=skirmish');
    });

    it('sets CHIMERA_DEV_HARNESS=1 in the child env', () => {
        const cfg = buildHostSpawnConfig(baseOpts, 7812);
        expect(cfg.env['CHIMERA_DEV_HARNESS']).toBe('1');
    });

    it('exposes a human label for log prefixes', () => {
        const cfg = buildHostSpawnConfig(baseOpts, 7812);
        expect(cfg.label).toBe('p1');
    });
});

// ─── buildClientSpawnConfig ──────────────────────────────────────────────────

describe('buildClientSpawnConfig()', () => {
    const baseOpts: HarnessOptions = { players: 3 };

    it('includes --user-data-dir pointing at .dev-userdata/p<index>', () => {
        expect(buildClientSpawnConfig(baseOpts, 7812, 2).args).toContain(
            '--user-data-dir=.dev-userdata/p2',
        );
        expect(buildClientSpawnConfig(baseOpts, 7812, 3).args).toContain(
            '--user-data-dir=.dev-userdata/p3',
        );
    });

    it('includes --dev-auto-join=<host:port>', () => {
        expect(buildClientSpawnConfig(baseOpts, 7812, 2).args).toContain(
            '--dev-auto-join=127.0.0.1:7812',
        );
    });

    it('includes --dev-profile-id=dev-p<index>', () => {
        expect(buildClientSpawnConfig(baseOpts, 7812, 2).args).toContain('--dev-profile-id=dev-p2');
        expect(buildClientSpawnConfig(baseOpts, 7812, 3).args).toContain('--dev-profile-id=dev-p3');
    });

    it('rejects an index equal to the host (1)', () => {
        expect(() => buildClientSpawnConfig(baseOpts, 7812, 1)).toThrow(HarnessArgsError);
    });

    it('rejects an index outside the player range', () => {
        expect(() => buildClientSpawnConfig(baseOpts, 7812, 4)).toThrow(HarnessArgsError);
        expect(() => buildClientSpawnConfig(baseOpts, 7812, 0)).toThrow(HarnessArgsError);
    });

    it('sets CHIMERA_DEV_HARNESS=1 in the child env', () => {
        expect(buildClientSpawnConfig(baseOpts, 7812, 2).env['CHIMERA_DEV_HARNESS']).toBe('1');
    });

    it('exposes a human label for log prefixes', () => {
        expect(buildClientSpawnConfig(baseOpts, 7812, 2).label).toBe('p2');
    });
});

// ─── waitForPortListening ────────────────────────────────────────────────────

async function listenOn(port: number): Promise<Server> {
    return new Promise((resolveServer, rejectServer) => {
        const server = createServer();
        server.once('error', rejectServer);
        server.listen(port, '127.0.0.1', () => resolveServer(server));
    });
}

async function reserveFreePort(): Promise<number> {
    const server = await listenOn(0);
    const addr = server.address();
    if (addr === null || typeof addr === 'string') {
        throw new Error('no address');
    }
    const { port } = addr;
    await new Promise<void>((done) => server.close(() => done()));
    return port;
}

describe('waitForPortListening()', () => {
    it('resolves once a listener is accepting connections on the port', async () => {
        const port = await reserveFreePort();
        const server = await listenOn(port);
        try {
            await expect(waitForPortListening('127.0.0.1', port, 1_000)).resolves.toBeUndefined();
        } finally {
            await new Promise<void>((done) => server.close(() => done()));
        }
    });

    it('resolves when a listener appears before the timeout elapses', async () => {
        const port = await reserveFreePort();
        const waiter = waitForPortListening('127.0.0.1', port, 2_000);
        const server = await new Promise<Server>((resolveSrv, rejectSrv) => {
            setTimeout(() => {
                listenOn(port).then(resolveSrv, rejectSrv);
            }, 50);
        });
        try {
            await expect(waiter).resolves.toBeUndefined();
        } finally {
            await new Promise<void>((done) => server.close(() => done()));
        }
    });

    it('rejects with HarnessTimeoutError when no listener appears within the timeout', async () => {
        const port = await reserveFreePort();
        await expect(waitForPortListening('127.0.0.1', port, 150)).rejects.toBeInstanceOf(
            HarnessTimeoutError,
        );
    });

    it('includes the host, port, and timeout in the timeout error message', async () => {
        const port = await reserveFreePort();
        const err = await waitForPortListening('127.0.0.1', port, 150).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(HarnessTimeoutError);
        const msg = (err as Error).message;
        expect(msg).toContain('127.0.0.1');
        expect(msg).toContain(String(port));
        expect(msg).toContain('150');
    });
});

// ─── waitForAnyChildExit ─────────────────────────────────────────────────────

interface FakeChild extends EventEmitter {
    killed: boolean;
    readonly kills: NodeJS.Signals[];
    kill(signal?: NodeJS.Signals): boolean;
    emitExit(code: number | null, signal?: NodeJS.Signals | null): void;
}

function makeFakeChild(): FakeChild {
    const emitter = new EventEmitter() as FakeChild;
    emitter.killed = false;
    (emitter as { kills: NodeJS.Signals[] }).kills = [];
    emitter.kill = (signal: NodeJS.Signals = 'SIGTERM'): boolean => {
        emitter.kills.push(signal);
        emitter.killed = true;
        return true;
    };
    emitter.emitExit = (code, signal = null): void => {
        emitter.killed = true;
        emitter.emit('exit', code, signal);
    };
    return emitter;
}

function asChildren(fakes: readonly FakeChild[]): readonly ChildProcess[] {
    return fakes as unknown as readonly ChildProcess[];
}

describe('waitForAnyChildExit()', () => {
    it('returns the exit code of the first child to exit when no siblings remain', async () => {
        const a = makeFakeChild();
        const promise = waitForAnyChildExit(asChildren([a]), 100);
        a.emitExit(0);
        expect(await promise).toBe(0);
    });

    it('sends SIGTERM to remaining alive children when one exits', async () => {
        const a = makeFakeChild();
        const b = makeFakeChild();
        const c = makeFakeChild();
        const promise = waitForAnyChildExit(asChildren([a, b, c]), 200);
        a.emitExit(0);
        // Allow microtasks to flush so siblings are signalled.
        await new Promise((r) => setImmediate(r));
        expect(b.kills).toEqual(['SIGTERM']);
        expect(c.kills).toEqual(['SIGTERM']);
        b.emitExit(0);
        c.emitExit(0);
        await promise;
    });

    it('escalates to SIGKILL for children that do not exit within graceMs', async () => {
        const a = makeFakeChild();
        const b = makeFakeChild();
        const promise = waitForAnyChildExit(asChildren([a, b]), 50);
        a.emitExit(0);
        await new Promise((r) => setTimeout(r, 120));
        expect(b.kills).toEqual(['SIGTERM', 'SIGKILL']);
        b.emitExit(null, 'SIGKILL');
        await promise;
    });

    it('returns the highest exit code across all children', async () => {
        const a = makeFakeChild();
        const b = makeFakeChild();
        const c = makeFakeChild();
        const promise = waitForAnyChildExit(asChildren([a, b, c]), 200);
        a.emitExit(1);
        b.emitExit(7);
        c.emitExit(3);
        expect(await promise).toBe(7);
    });

    it('does not signal a child that is already killed', async () => {
        const a = makeFakeChild();
        const b = makeFakeChild();
        b.killed = true;
        const promise = waitForAnyChildExit(asChildren([a, b]), 50);
        a.emitExit(0);
        await new Promise((r) => setImmediate(r));
        expect(b.kills).toEqual([]);
        b.emitExit(0);
        await promise;
    });

    it('treats a null exit code as zero when computing the highest code', async () => {
        const a = makeFakeChild();
        const b = makeFakeChild();
        const promise = waitForAnyChildExit(asChildren([a, b]), 50);
        a.emitExit(null, 'SIGTERM');
        b.emitExit(0);
        expect(await promise).toBe(0);
    });
});

// ─── isDirectInvocation ──────────────────────────────────────────────────────

describe('isDirectInvocation()', () => {
    it('returns true when argv[1] is the absolute path of the module URL', () => {
        const url = 'file:///repo/tools/dev-multiplayer.ts';
        expect(isDirectInvocation(url, '/repo/tools/dev-multiplayer.ts')).toBe(true);
    });

    it('returns false when argv[1] is undefined (import via REPL, test runner)', () => {
        const url = 'file:///repo/tools/dev-multiplayer.ts';
        expect(isDirectInvocation(url, undefined)).toBe(false);
    });

    it('returns false when argv[1] points at a different file', () => {
        const url = 'file:///repo/tools/dev-multiplayer.ts';
        expect(isDirectInvocation(url, '/repo/tools/other.ts')).toBe(false);
    });

    it('does not treat a suffix-match as a direct invocation', () => {
        // This is the bug the ticket fixes: the old guard used endsWith(),
        // which would falsely return true for "/a/dev-multiplayer.ts" when
        // the script URL was "file:///b/dev-multiplayer.ts".
        const url = 'file:///home/alice/project/tools/dev-multiplayer.ts';
        const argv1 = '/different/root/tools/dev-multiplayer.ts';
        expect(isDirectInvocation(url, argv1)).toBe(false);
    });

    it('returns false when the URL is not a file:// URL', () => {
        expect(isDirectInvocation('data:text/plain,foo', '/repo/tools/dev-multiplayer.ts')).toBe(
            false,
        );
    });
});
