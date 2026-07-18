/**
 * electron/dev-harness/harness.test.ts
 *
 * Unit tests for the dev multiplayer harness library (§4.32), ported from
 * tools/dev-multiplayer.test.ts when the harness moved into
 * `@chimera-engine/electron` and extended for the fixture-driven plan
 * resolution, announce-file handshake, and dry-run report. All filesystem
 * access goes through the injected {@link HarnessIo} double — no real FS.
 */

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { describe, it, expect } from 'vitest';

import {
    MIN_PLAYERS,
    MAX_PLAYERS,
    ANNOUNCE_FILE_NAME,
    parseArgs,
    assertHarnessEnv,
    resolveHarnessPlan,
    buildHostSpawnConfig,
    buildClientSpawnConfig,
    buildChildEnv,
    buildDryRunReport,
    assertEntryBuilt,
    waitForAnnounceFile,
    waitForAnyChildExit,
    installSignalForwarding,
    isDirectInvocation,
    HarnessArgsError,
    HarnessGuardError,
    HarnessTimeoutError,
    type HarnessIo,
    type HarnessPlan,
} from './harness.js';

// ─── IO double ───────────────────────────────────────────────────────────────

function makeIo(files: Record<string, string> = {}): HarnessIo & {
    readonly store: Record<string, string>;
} {
    const store: Record<string, string> = { ...files };
    return {
        store,
        readFile(path: string): Promise<string> {
            const content = store[path];
            if (content === undefined) {
                const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
                err.code = 'ENOENT';
                return Promise.reject(err);
            }
            return Promise.resolve(content);
        },
    };
}

const APP_DIR = '/work/my-game';
const PKG = JSON.stringify({ name: '@chimera-engine/my-game', main: 'dist/electron/main.js' });

const PROFILE = (id: string): string =>
    JSON.stringify({
        localProfileId: id,
        displayName: id,
        avatar: { kind: 'builtin', ref: 'avatars/red.png' },
        locale: 'en-US',
    });

const SCENARIO = JSON.stringify({
    gameId: 'my-game',
    seats: [{ profile: 'alice.json', attributes: { deck: '["strike"]' } }, { profile: 'bob.json' }],
    aiSeats: 1,
    matchSettings: { arena: 'lava-pit' },
});

function appFiles(extra: Record<string, string> = {}): Record<string, string> {
    return {
        [`${APP_DIR}/package.json`]: PKG,
        [`${APP_DIR}/dev/scenarios/skirmish.json`]: SCENARIO,
        [`${APP_DIR}/dev/profiles/alice.json`]: PROFILE('alice'),
        [`${APP_DIR}/dev/profiles/bob.json`]: PROFILE('bob'),
        ...extra,
    };
}

async function planFor(
    argv: readonly string[],
    files: Record<string, string> = appFiles(),
    cwd = '/work',
): Promise<HarnessPlan> {
    return resolveHarnessPlan(parseArgs(argv), makeIo(files), cwd);
}

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe('parseArgs()', () => {
    it('parses the player count as the first positional arg', () => {
        expect(parseArgs(['3']).players).toBe(3);
    });

    it('allows omitting the player count (a scenario will provide the seat count)', () => {
        expect(parseArgs(['--scenario', 'skirmish']).players).toBeUndefined();
    });

    it('parses --scenario / --app / --entry / --game values', () => {
        const opts = parseArgs([
            '2',
            '--scenario',
            'skirmish',
            '--app',
            'apps/tactics',
            '--entry',
            'dist/main.js',
            '--game',
            'tactics',
        ]);
        expect(opts.scenario).toBe('skirmish');
        expect(opts.app).toBe('apps/tactics');
        expect(opts.entry).toBe('dist/main.js');
        expect(opts.game).toBe('tactics');
    });

    it('parses the boolean --debug and --dry-run flags', () => {
        const opts = parseArgs(['2', '--debug', '--dry-run']);
        expect(opts.debug).toBe(true);
        expect(opts.dryRun).toBe(true);
        expect(parseArgs(['2']).debug).toBe(false);
        expect(parseArgs(['2']).dryRun).toBe(false);
    });

    it('accepts MIN_PLAYERS and MAX_PLAYERS at the boundaries', () => {
        expect(parseArgs([String(MIN_PLAYERS)]).players).toBe(MIN_PLAYERS);
        expect(parseArgs([String(MAX_PLAYERS)]).players).toBe(MAX_PLAYERS);
    });

    it('throws HarnessArgsError when the player count is outside [MIN, MAX]', () => {
        expect(() => parseArgs([String(MIN_PLAYERS - 1)])).toThrow(HarnessArgsError);
        expect(() => parseArgs([String(MAX_PLAYERS + 1)])).toThrow(HarnessArgsError);
    });

    it('throws HarnessArgsError when the player count is not an integer', () => {
        expect(() => parseArgs(['two'])).toThrow(HarnessArgsError);
        expect(() => parseArgs(['2.5'])).toThrow(HarnessArgsError);
    });

    it('throws HarnessArgsError on unknown flags', () => {
        expect(() => parseArgs(['2', '--port', '7777'])).toThrow(HarnessArgsError);
    });

    it('throws HarnessArgsError when a value flag is missing its value', () => {
        expect(() => parseArgs(['2', '--scenario'])).toThrow(HarnessArgsError);
        expect(() => parseArgs(['2', '--app', '--debug'])).toThrow(HarnessArgsError);
    });
});

// ─── assertHarnessEnv ────────────────────────────────────────────────────────

describe('assertHarnessEnv()', () => {
    it('throws HarnessGuardError when CHIMERA_DEV_HARNESS is unset or not "1"', () => {
        expect(() => assertHarnessEnv({})).toThrow(HarnessGuardError);
        expect(() => assertHarnessEnv({ CHIMERA_DEV_HARNESS: 'true' })).toThrow(HarnessGuardError);
    });

    it('throws HarnessGuardError when NODE_ENV is production (Invariant #77)', () => {
        expect(() =>
            assertHarnessEnv({ CHIMERA_DEV_HARNESS: '1', NODE_ENV: 'production' }),
        ).toThrow(HarnessGuardError);
    });

    it('does not throw for CHIMERA_DEV_HARNESS=1 outside production', () => {
        expect(() => assertHarnessEnv({ CHIMERA_DEV_HARNESS: '1' })).not.toThrow();
        expect(() =>
            assertHarnessEnv({ CHIMERA_DEV_HARNESS: '1', NODE_ENV: 'development' }),
        ).not.toThrow();
    });
});

// ─── resolveHarnessPlan ──────────────────────────────────────────────────────

describe('resolveHarnessPlan()', () => {
    it('resolves the app dir from --app against cwd and the entry from package.json main', async () => {
        const plan = await planFor(['2', '--app', 'my-game']);
        expect(plan.appDir).toBe(APP_DIR);
        expect(plan.entryFile).toBe(`${APP_DIR}/dist/electron/main.js`);
        expect(plan.players).toBe(2);
        expect(plan.scenario).toBeUndefined();
        expect(plan.profileFiles).toEqual([undefined, undefined]);
    });

    it('defaults the app dir to cwd', async () => {
        const plan = await planFor(['2'], appFiles(), APP_DIR);
        expect(plan.appDir).toBe(APP_DIR);
    });

    it('honours an --entry override resolved against the app dir', async () => {
        const plan = await planFor(['2', '--app', 'my-game', '--entry', 'out/main.js']);
        expect(plan.entryFile).toBe(`${APP_DIR}/out/main.js`);
    });

    it('loads the scenario, derives the seat count, and resolves per-seat profile files', async () => {
        const plan = await planFor(['--app', 'my-game', '--scenario', 'skirmish']);
        expect(plan.players).toBe(2);
        expect(plan.scenarioFile).toBe(`${APP_DIR}/dev/scenarios/skirmish.json`);
        expect(plan.scenario?.aiSeats).toBe(1);
        expect(plan.profileFiles).toEqual([
            `${APP_DIR}/dev/profiles/alice.json`,
            `${APP_DIR}/dev/profiles/bob.json`,
        ]);
        expect(plan.gameId).toBe('my-game');
    });

    it('accepts a scenario name already carrying the .json extension', async () => {
        const plan = await planFor(['--app', 'my-game', '--scenario', 'skirmish.json']);
        expect(plan.scenarioFile).toBe(`${APP_DIR}/dev/scenarios/skirmish.json`);
    });

    it('places the announce file inside the HOST instance userData dir (Invariant #78)', async () => {
        const plan = await planFor(['2', '--app', 'my-game']);
        expect(plan.userDataRoot).toBe(`${APP_DIR}/.dev-userdata`);
        expect(plan.announceFile).toBe(`${APP_DIR}/.dev-userdata/p1/${ANNOUNCE_FILE_NAME}`);
    });

    it('rejects an explicit player count that contradicts the scenario seat count', async () => {
        await expect(planFor(['3', '--app', 'my-game', '--scenario', 'skirmish'])).rejects.toThrow(
            /3 .*2|2 .*3/,
        );
    });

    it('requires a player count when there is no scenario', async () => {
        await expect(planFor(['--app', 'my-game'])).rejects.toThrow(HarnessArgsError);
    });

    it('rejects a missing app package.json with a pointer to --app', async () => {
        await expect(planFor(['2', '--app', 'nowhere'])).rejects.toThrow(/--app/);
    });

    it('rejects a package.json without a main entry', async () => {
        const files = appFiles({ [`${APP_DIR}/package.json`]: JSON.stringify({ name: 'x' }) });
        await expect(planFor(['2', '--app', 'my-game'], files)).rejects.toThrow(/main/);
    });

    it('fails fast on a scenario referencing a missing profile file', async () => {
        const files = appFiles();
        delete files[`${APP_DIR}/dev/profiles/bob.json`];
        await expect(
            planFor(['--app', 'my-game', '--scenario', 'skirmish'], files),
        ).rejects.toThrow(/bob\.json/);
    });

    it('fails fast on a schema-invalid profile file (missing locale)', async () => {
        const files = appFiles({
            [`${APP_DIR}/dev/profiles/bob.json`]: JSON.stringify({
                localProfileId: 'bob',
                displayName: 'Bob',
                avatar: { kind: 'builtin', ref: 'avatars/blue.png' },
            }),
        });
        await expect(
            planFor(['--app', 'my-game', '--scenario', 'skirmish'], files),
        ).rejects.toThrow(/bob\.json/);
    });

    it('rejects two seats sharing one localProfileId — the join gate would collide', async () => {
        const files = appFiles({
            [`${APP_DIR}/dev/profiles/bob.json`]: PROFILE('alice'),
        });
        await expect(
            planFor(['--app', 'my-game', '--scenario', 'skirmish'], files),
        ).rejects.toThrow(/alice/);
    });

    it('fails fast on a schema-invalid scenario (typo key)', async () => {
        const files = appFiles({
            [`${APP_DIR}/dev/scenarios/skirmish.json`]: JSON.stringify({
                seats: [{}],
                autostart: true,
            }),
        });
        await expect(
            planFor(['--app', 'my-game', '--scenario', 'skirmish'], files),
        ).rejects.toThrow(/autostart/);
    });
});

// ─── spawn-config builders ───────────────────────────────────────────────────

describe('buildHostSpawnConfig()', () => {
    async function hostPlan(): Promise<HarnessPlan> {
        return planFor(['--app', 'my-game', '--scenario', 'skirmish']);
    }

    it('isolates userData under .dev-userdata/p1 and auto-hosts with seat 1', async () => {
        const cfg = buildHostSpawnConfig(await hostPlan());
        expect(cfg.userDataDir).toBe(`${APP_DIR}/.dev-userdata/p1`);
        expect(cfg.args).toContain(`--user-data-dir=${APP_DIR}/.dev-userdata/p1`);
        expect(cfg.args).toContain('--dev-auto-host');
        expect(cfg.args).toContain('--dev-seat=1');
        expect(cfg.label).toBe('p1');
    });

    it('forwards the scenario, seat-1 profile file, game and announce path — the scenario is the sole seat-count authority', async () => {
        const cfg = buildHostSpawnConfig(await hostPlan());
        expect(cfg.args).toContain(`--dev-scenario-file=${APP_DIR}/dev/scenarios/skirmish.json`);
        expect(cfg.args).toContain(`--dev-profile-file=${APP_DIR}/dev/profiles/alice.json`);
        // No parallel --dev-players channel that could disagree with seats.length.
        expect(cfg.args.some((a) => a.startsWith('--dev-players='))).toBe(false);
        expect(cfg.args).toContain('--dev-game=my-game');
        expect(cfg.args).toContain(
            `--dev-announce-file=${APP_DIR}/.dev-userdata/p1/${ANNOUNCE_FILE_NAME}`,
        );
    });

    it('passes --dev-players for a scenario-less run so the host can gate its auto-start', async () => {
        const cfg = buildHostSpawnConfig(await planFor(['3', '--app', 'my-game']));
        expect(cfg.args).toContain('--dev-players=3');
    });

    it('falls back to --dev-profile-id=dev-p1 when the plan has no seat-1 profile file', async () => {
        const cfg = buildHostSpawnConfig(await planFor(['2', '--app', 'my-game']));
        expect(cfg.args).toContain('--dev-profile-id=dev-p1');
        expect(cfg.args.some((a) => a.startsWith('--dev-profile-file='))).toBe(false);
    });

    it('sets the development harness env for the child', async () => {
        const cfg = buildHostSpawnConfig(await hostPlan());
        expect(cfg.env['CHIMERA_DEV_HARNESS']).toBe('1');
        expect(cfg.env['NODE_ENV']).toBe('development');
        expect(cfg.env['CHIMERA_ENV']).toBe('development');
        expect(cfg.env['CHIMERA_DEBUG']).toBeUndefined();
    });

    it('adds CHIMERA_DEBUG=1 under --debug', async () => {
        const plan = await resolveHarnessPlan(
            parseArgs(['--app', 'my-game', '--scenario', 'skirmish', '--debug']),
            makeIo(appFiles()),
            '/work',
        );
        expect(buildHostSpawnConfig(plan).env['CHIMERA_DEBUG']).toBe('1');
    });
});

describe('buildClientSpawnConfig()', () => {
    const LOBBY_CODE = '127.0.0.1:52110:tok3n';

    async function clientCfg(index: number): Promise<ReturnType<typeof buildClientSpawnConfig>> {
        const plan = await planFor(['--app', 'my-game', '--scenario', 'skirmish']);
        return buildClientSpawnConfig(plan, index, LOBBY_CODE);
    }

    it('isolates userData under .dev-userdata/p<i> and joins with the full lobby code', async () => {
        const cfg = await clientCfg(2);
        expect(cfg.userDataDir).toBe(`${APP_DIR}/.dev-userdata/p2`);
        expect(cfg.args).toContain(`--dev-auto-join=${LOBBY_CODE}`);
        expect(cfg.args).toContain('--dev-seat=2');
        expect(cfg.label).toBe('p2');
    });

    it('forwards the scenario and the seat-matched profile file', async () => {
        const cfg = await clientCfg(2);
        expect(cfg.args).toContain(`--dev-scenario-file=${APP_DIR}/dev/scenarios/skirmish.json`);
        expect(cfg.args).toContain(`--dev-profile-file=${APP_DIR}/dev/profiles/bob.json`);
    });

    it('falls back to --dev-profile-id=dev-p<i> without a seat profile', async () => {
        const plan = await planFor(['3', '--app', 'my-game']);
        const cfg = buildClientSpawnConfig(plan, 3, LOBBY_CODE);
        expect(cfg.args).toContain('--dev-profile-id=dev-p3');
    });

    it('rejects an index equal to the host (1) or outside the player range', async () => {
        const plan = await planFor(['--app', 'my-game', '--scenario', 'skirmish']);
        expect(() => buildClientSpawnConfig(plan, 1, LOBBY_CODE)).toThrow(HarnessArgsError);
        expect(() => buildClientSpawnConfig(plan, 3, LOBBY_CODE)).toThrow(HarnessArgsError);
    });
});

// ─── buildChildEnv ───────────────────────────────────────────────────────────

describe('buildChildEnv()', () => {
    it('merges the config env over the parent env', () => {
        const env = buildChildEnv(
            { PATH: '/usr/bin', NODE_ENV: 'test' },
            { NODE_ENV: 'development' },
        );
        expect(env['PATH']).toBe('/usr/bin');
        expect(env['NODE_ENV']).toBe('development');
    });

    it('strips ELECTRON_RUN_AS_NODE so the child boots as Electron, not Node', () => {
        const env = buildChildEnv(
            { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin' },
            { CHIMERA_DEV_HARNESS: '1' },
        );
        expect('ELECTRON_RUN_AS_NODE' in env).toBe(false);
    });
});

// ─── dry-run report + entry preflight ────────────────────────────────────────

describe('buildDryRunReport()', () => {
    it('reports the resolved plan and every instance spawn config without touching anything', async () => {
        const plan = await planFor(['--app', 'my-game', '--scenario', 'skirmish']);
        const report = buildDryRunReport(plan);

        expect(report.appDir).toBe(APP_DIR);
        expect(report.entry).toBe(`${APP_DIR}/dist/electron/main.js`);
        expect(report.players).toBe(2);
        expect(report.scenarioFile).toBe(`${APP_DIR}/dev/scenarios/skirmish.json`);
        expect(report.instances).toHaveLength(2);
        expect(report.instances[0]?.label).toBe('p1');
        expect(report.instances[0]?.args).toContain('--dev-auto-host');
        // Client join codes are only knowable at runtime (announce handshake).
        expect(report.instances[1]?.args.some((a) => a.includes('<announce>'))).toBe(true);
        expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    });
});

describe('assertEntryBuilt()', () => {
    it('passes when the entry file is readable', async () => {
        const plan = await planFor(['2', '--app', 'my-game']);
        const io = makeIo({ [`${APP_DIR}/dist/electron/main.js`]: '// bundle' });
        await expect(assertEntryBuilt(plan, io)).resolves.toBeUndefined();
    });

    it('fails with the build instruction when the entry is missing', async () => {
        const plan = await planFor(['2', '--app', 'my-game']);
        await expect(assertEntryBuilt(plan, makeIo())).rejects.toThrow(/build:app/);
    });
});

// ─── waitForAnnounceFile ─────────────────────────────────────────────────────

describe('waitForAnnounceFile()', () => {
    const ANNOUNCE = JSON.stringify({ lobbyCode: '127.0.0.1:52110:tok3n', gameId: 'my-game' });

    it('resolves with the parsed announce once the file appears', async () => {
        const io = makeIo();
        const waiter = waitForAnnounceFile('/ud/p1/announce.json', 2_000, io);
        setTimeout(() => {
            io.store['/ud/p1/announce.json'] = ANNOUNCE;
        }, 60);
        await expect(waiter).resolves.toEqual({
            lobbyCode: '127.0.0.1:52110:tok3n',
            gameId: 'my-game',
        });
    });

    it('keeps polling over a torn/invalid intermediate state', async () => {
        const io = makeIo({ '/ud/p1/announce.json': '{ "lobbyCode": ' });
        const waiter = waitForAnnounceFile('/ud/p1/announce.json', 2_000, io);
        setTimeout(() => {
            io.store['/ud/p1/announce.json'] = ANNOUNCE;
        }, 60);
        await expect(waiter).resolves.toMatchObject({ gameId: 'my-game' });
    });

    it('rejects with HarnessTimeoutError naming the path when nothing appears', async () => {
        const io = makeIo();
        const err = await waitForAnnounceFile('/ud/p1/announce.json', 150, io).catch(
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(HarnessTimeoutError);
        expect((err as Error).message).toContain('/ud/p1/announce.json');
        expect((err as Error).message).toContain('150');
    });
});

// ─── waitForAnyChildExit (ported) ────────────────────────────────────────────

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

// ─── isDirectInvocation (ported) ─────────────────────────────────────────────

describe('isDirectInvocation()', () => {
    it('returns true when argv[1] is the absolute path of the module URL', () => {
        const url = 'file:///repo/electron/dev-harness/cli.ts';
        expect(isDirectInvocation(url, '/repo/electron/dev-harness/cli.ts')).toBe(true);
    });

    it('returns false when argv[1] is undefined (import via REPL, test runner)', () => {
        expect(isDirectInvocation('file:///repo/cli.ts', undefined)).toBe(false);
    });

    it('does not treat a suffix-match as a direct invocation', () => {
        const url = 'file:///home/alice/project/electron/dev-harness/cli.ts';
        expect(isDirectInvocation(url, '/different/root/electron/dev-harness/cli.ts')).toBe(false);
    });

    it('returns false when the URL is not a file:// URL', () => {
        expect(isDirectInvocation('data:text/plain,foo', '/repo/cli.ts')).toBe(false);
    });
});

// ─── installSignalForwarding (ported) ────────────────────────────────────────

describe('installSignalForwarding()', () => {
    it('returns a disposer that removes the registered listeners', () => {
        const before = {
            sigint: process.listenerCount('SIGINT'),
            sigterm: process.listenerCount('SIGTERM'),
        };

        const dispose = installSignalForwarding([]);

        expect(process.listenerCount('SIGINT')).toBe(before.sigint + 1);
        expect(process.listenerCount('SIGTERM')).toBe(before.sigterm + 1);

        dispose();

        expect(process.listenerCount('SIGINT')).toBe(before.sigint);
        expect(process.listenerCount('SIGTERM')).toBe(before.sigterm);
    });

    it('forwards the received signal to every live child', () => {
        const a = makeFakeChild();
        const b = makeFakeChild();
        const dispose = installSignalForwarding(asChildren([a, b]));
        try {
            process.emit('SIGINT');
            expect(a.kills).toEqual(['SIGINT']);
            expect(b.kills).toEqual(['SIGINT']);
        } finally {
            dispose();
        }
    });

    it('skips children that are already killed', () => {
        const a = makeFakeChild();
        a.killed = true;
        const b = makeFakeChild();
        const dispose = installSignalForwarding(asChildren([a, b]));
        try {
            process.emit('SIGTERM');
            expect(a.kills).toEqual([]);
            expect(b.kills).toEqual(['SIGTERM']);
        } finally {
            dispose();
        }
    });

    it('calling dispose() multiple times is safe (idempotent)', () => {
        const before = process.listenerCount('SIGINT');
        const dispose = installSignalForwarding([]);
        dispose();
        dispose();
        expect(process.listenerCount('SIGINT')).toBe(before);
    });
});
