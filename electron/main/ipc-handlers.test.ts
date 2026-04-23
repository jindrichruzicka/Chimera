import { describe, expect, it, vi } from 'vitest';
import {
    GAME_ACTION_REJECTED_CHANNEL,
    GAME_SEND_ACTION_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_SWITCH_SEAT_CHANNEL,
    LOBBY_HOST_CHANNEL,
    LOBBY_JOIN_CHANNEL,
    LOBBY_LEAVE_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
    SAVES_DELETE_CHANNEL,
    SAVES_LIST_CHANNEL,
    SAVES_LOAD_CHANNEL,
    SAVES_SAVE_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
    SETTINGS_CHANGE_CHANNEL,
    SETTINGS_GET_CHANNEL,
    SETTINGS_RESET_CHANNEL,
    SETTINGS_UPDATE_CHANNEL,
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    SYSTEM_RELAUNCH_CHANNEL,
    mapPlatform,
    registerGameHandlers,
    registerLobbyHandlers,
    registerSavesHandlers,
    registerSettingsHandlers,
    registerSystemHandlers,
    type GameHandlersIpcMain,
    type GameHandlerEvent,
    type GameHandlerListener,
    type GameInvokeHandler,
    type LobbyHandlerListener,
    type LobbyHandlersIpcMain,
    type LobbyInvokeHandler,
    type SavesHandlersIpcMain,
    type SavesInvokeHandler,
    type SettingsHandlersIpcMain,
    type SettingsInvokeHandler,
    type SystemHandlersAppHost,
    type SystemHandlersIpcMain,
} from './ipc-handlers.js';
import { IpcRequestValidationError } from './ipc-schemas.js';
import { createLogger, createMemorySink } from './logger.js';
import type {
    ActionRejection,
    EngineAction,
    HostLobbyParams,
    JoinLobbyParams,
    SaveRequest,
    UserSettings,
} from '../preload/api-types.js';

/**
 * Recording stub for the narrow `SystemHandlersIpcMain` slice used by the
 * registration helper. Captures every `handle` and `on` registration so the
 * test can assert the exact channel list and invoke the registered handlers.
 */
function makeIpcMainStub(): {
    readonly ipcMain: SystemHandlersIpcMain;
    readonly handled: Map<string, () => unknown>;
    readonly listeners: Map<string, () => void>;
} {
    const handled = new Map<string, () => unknown>();
    const listeners = new Map<string, () => void>();

    const ipcMain: SystemHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
        on: (channel, handler) => {
            listeners.set(channel, handler);
        },
    };

    return { ipcMain, handled, listeners };
}

describe('mapPlatform', () => {
    it.each([
        ['darwin', 'macos'],
        ['win32', 'windows'],
        ['linux', 'linux'],
    ] as const)('maps %s to %s', (input, expected) => {
        expect(mapPlatform(input)).toBe(expected);
    });

    it('falls back to linux for unknown platforms (freebsd, aix, …)', () => {
        // NodeJS reports platforms such as 'freebsd' / 'aix' / 'openbsd' that
        // Chimera does not explicitly support. Returning 'linux' keeps the
        // renderer's type contract strict while avoiding a runtime throw that
        // would brick the boot path on an unusual dev machine.
        expect(mapPlatform('freebsd')).toBe('linux');
        expect(mapPlatform('openbsd')).toBe('linux');
    });
});

describe('registerSystemHandlers', () => {
    it('registers chimera:system:platform as an invoke handler returning { os, version }', async () => {
        const stub = makeIpcMainStub();
        const app: SystemHandlersAppHost = { quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() };
        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app,
            platform: 'darwin',
            electronVersion: '33.4.11',
        });

        const handler = stub.handled.get(SYSTEM_PLATFORM_CHANNEL);
        expect(handler).toBeDefined();
        // `ipcMain.handle` accepts either a sync or async handler; we return
        // the value synchronously — Electron auto-wraps into a Promise.
        expect(await handler?.()).toEqual({ os: 'macos', version: '33.4.11' });
    });

    it('registers chimera:system:quit as a send listener that calls app.quit()', () => {
        const stub = makeIpcMainStub();
        const quit = vi.fn();
        const app: SystemHandlersAppHost = { quit, relaunch: vi.fn(), exit: vi.fn() };
        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app,
            platform: 'linux',
            electronVersion: '33.4.11',
        });

        const handler = stub.listeners.get(SYSTEM_QUIT_CHANNEL);
        expect(handler).toBeDefined();
        handler?.();

        expect(quit).toHaveBeenCalledOnce();
    });

    it('registers chimera:system:relaunch as a send listener that calls app.relaunch() then app.exit(0)', () => {
        const stub = makeIpcMainStub();
        const quit = vi.fn();
        const relaunch = vi.fn();
        const exit = vi.fn();
        const app: SystemHandlersAppHost = { quit, relaunch, exit };
        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app,
            platform: 'darwin',
            electronVersion: '33.4.11',
        });

        const handler = stub.listeners.get(SYSTEM_RELAUNCH_CHANNEL);
        expect(handler).toBeDefined();
        handler?.();

        expect(relaunch).toHaveBeenCalledOnce();
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('registers exactly the three system channels (no cross-namespace leakage)', () => {
        const stub = makeIpcMainStub();
        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app: { quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() },
            platform: 'linux',
            electronVersion: '33.4.11',
        });

        expect([...stub.handled.keys()]).toEqual([SYSTEM_PLATFORM_CHANNEL]);
        expect([...stub.listeners.keys()]).toEqual([SYSTEM_QUIT_CHANNEL, SYSTEM_RELAUNCH_CHANNEL]);
    });
});

/**
 * Recording stub for the narrow `GameHandlersIpcMain` slice. Unlike the
 * system stub, `handle` and `on` callbacks receive payload arguments, so the
 * stub captures the full handler signature.
 */
function makeGameIpcMainStub(): {
    readonly ipcMain: GameHandlersIpcMain;
    readonly handled: Map<string, GameInvokeHandler>;
    readonly listeners: Map<string, GameHandlerListener>;
} {
    const handled = new Map<string, GameInvokeHandler>();
    const listeners = new Map<string, GameHandlerListener>();

    const ipcMain: GameHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
        on: (channel, handler) => {
            listeners.set(channel, handler);
        },
    };

    return { ipcMain, handled, listeners };
}

/**
 * Build a fake `GameHandlerEvent` whose `sender.send` captures every REJECT
 * push the handler emits. Mirrors the real `Electron.IpcMainEvent.sender`
 * surface narrowly enough to satisfy {@link GameHandlerEvent} without
 * pulling in Electron types.
 */
function makeGameEvent(): {
    readonly event: GameHandlerEvent;
    readonly sends: { channel: string; args: unknown[] }[];
} {
    const sends: { channel: string; args: unknown[] }[] = [];
    const event: GameHandlerEvent = {
        sender: {
            send: (channel, ...args) => {
                sends.push({ channel, args });
            },
        },
    };
    return { event, sends };
}

describe('registerGameHandlers', () => {
    it('registers chimera:game:send-action as a send listener (stub: no-op)', () => {
        const stub = makeGameIpcMainStub();
        registerGameHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.listeners.get(GAME_SEND_ACTION_CHANNEL);
        expect(handler).toBeDefined();

        const action: EngineAction = {
            type: 'noop',
            playerId: 'p1',
            tick: 0,
            payload: {},
        };
        // Actual reducer wiring lands in F03–F15; this task only proves the
        // channel is registered and the stub accepts the payload without
        // throwing.
        const { event, sends } = makeGameEvent();
        expect(() => handler?.(event, action)).not.toThrow();
        // Happy path: no REJECT push is emitted when the envelope is valid.
        expect(sends).toEqual([]);
    });

    it('registers chimera:game:switch-seat as an invoke handler resolving to undefined (stub)', async () => {
        const stub = makeGameIpcMainStub();
        registerGameHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(GAME_SWITCH_SEAT_CHANNEL);
        expect(handler).toBeDefined();
        // `ipcMain.handle` auto-wraps a sync return into a Promise in real
        // Electron. At the registration level the handler may return either
        // `undefined` or `Promise<undefined>`; both satisfy the declared
        // `Promise<void>` contract on `GameAPI.switchActiveSeat`.
        await expect(Promise.resolve(handler?.({}, 'p2'))).resolves.toBeUndefined();
    });

    it('registers exactly the game request channels (snapshot is push-only, not registered here)', () => {
        const stub = makeGameIpcMainStub();
        registerGameHandlers({ ipcMain: stub.ipcMain });

        // `chimera:game:snapshot` is a one-way push from main → renderer via
        // `webContents.send`. It must NOT appear as a main-side listener or
        // invoke handler.
        expect([...stub.handled.keys()]).toEqual([GAME_SWITCH_SEAT_CHANNEL]);
        expect([...stub.listeners.keys()]).toEqual([GAME_SEND_ACTION_CHANNEL]);
        expect(stub.handled.has(GAME_SNAPSHOT_CHANNEL)).toBe(false);
        expect(stub.listeners.has(GAME_SNAPSHOT_CHANNEL)).toBe(false);
    });
});

/**
 * Recording stub for the narrow `LobbyHandlersIpcMain` slice. Mirrors the
 * game stub — `handle` captures invoke handlers, `on` captures fire-and-
 * forget listeners.
 */
function makeLobbyIpcMainStub(): {
    readonly ipcMain: LobbyHandlersIpcMain;
    readonly handled: Map<string, LobbyInvokeHandler>;
    readonly listeners: Map<string, LobbyHandlerListener>;
} {
    const handled = new Map<string, LobbyInvokeHandler>();
    const listeners = new Map<string, LobbyHandlerListener>();

    const ipcMain: LobbyHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
        on: (channel, handler) => {
            listeners.set(channel, handler);
        },
    };

    return { ipcMain, handled, listeners };
}

describe('registerLobbyHandlers', () => {
    it('registers chimera:lobby:host as an invoke handler accepting HostLobbyParams (stub: resolves to a LobbyInfo-shaped value)', async () => {
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(LOBBY_HOST_CHANNEL);
        expect(handler).toBeDefined();

        const params: HostLobbyParams = { gameId: 'sample-game', maxPlayers: 4 };
        const result = await Promise.resolve(handler?.({}, params));
        // Stub contract (F11 replaces with real logic): resolves to any
        // object so the preload's `Promise<LobbyInfo>` signature is
        // satisfied without throwing. We only assert the handler does not
        // reject and returns something defined.
        expect(result).toBeDefined();
    });

    it('registers chimera:lobby:join as an invoke handler accepting JoinLobbyParams (stub)', async () => {
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(LOBBY_JOIN_CHANNEL);
        expect(handler).toBeDefined();

        const params: JoinLobbyParams = { address: 'ws://127.0.0.1:7777' };
        const result = await Promise.resolve(handler?.({}, params));
        expect(result).toBeDefined();
    });

    it('registers chimera:lobby:leave as a send listener (stub: no-op)', () => {
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.listeners.get(LOBBY_LEAVE_CHANNEL);
        expect(handler).toBeDefined();
        expect(() => handler?.({})).not.toThrow();
    });

    it('registers exactly the lobby request channels (update is push-only, not registered here)', () => {
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain });

        // `chimera:lobby:update` is a one-way push from main → renderer via
        // `webContents.send`. It must NOT appear as a main-side listener or
        // invoke handler.
        expect([...stub.handled.keys()].sort()).toEqual(
            [LOBBY_HOST_CHANNEL, LOBBY_JOIN_CHANNEL].sort(),
        );
        expect([...stub.listeners.keys()]).toEqual([LOBBY_LEAVE_CHANNEL]);
        expect(stub.handled.has(LOBBY_UPDATE_CHANNEL)).toBe(false);
        expect(stub.listeners.has(LOBBY_UPDATE_CHANNEL)).toBe(false);
    });
});

/**
 * Recording stub for the narrow `SavesHandlersIpcMain` slice. The saves
 * namespace uses `handle` exclusively — every request/response is an
 * invoke-style round-trip.
 */
function makeSavesIpcMainStub(): {
    readonly ipcMain: SavesHandlersIpcMain;
    readonly handled: Map<string, SavesInvokeHandler>;
} {
    const handled = new Map<string, SavesInvokeHandler>();

    const ipcMain: SavesHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
    };

    return { ipcMain, handled };
}

describe('registerSavesHandlers', () => {
    it('registers chimera:saves:list as an invoke handler resolving to an empty array (stub)', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(SAVES_LIST_CHANNEL);
        expect(handler).toBeDefined();

        // Stub contract (F06/F18 replaces with real persistence): an empty
        // array preserves the preload's `Promise<SaveSlotMeta[]>` shape
        // without claiming slots that do not exist.
        await expect(Promise.resolve(handler?.({}, 'sample-game'))).resolves.toEqual([]);
    });

    it('registers chimera:saves:save as an invoke handler accepting a SaveRequest (stub)', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(SAVES_SAVE_CHANNEL);
        expect(handler).toBeDefined();

        const request: SaveRequest = { gameId: 'sample-game', label: 'autosave' };
        // Stub must resolve (not reject) so the preload's `Promise<SaveSlotMeta>`
        // signature is satisfied. Exact shape is asserted at the
        // implementation boundary; here we only prove the handler accepts
        // the payload without throwing.
        const result = await Promise.resolve(handler?.({}, request));
        expect(result).toBeDefined();
    });

    it('registers chimera:saves:load as an invoke handler resolving to undefined (stub)', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(SAVES_LOAD_CHANNEL);
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.({}, 'slot-a'))).resolves.toBeUndefined();
    });

    it('registers chimera:saves:delete as an invoke handler resolving to undefined (stub)', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(SAVES_DELETE_CHANNEL);
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.({}, 'slot-a'))).resolves.toBeUndefined();
    });

    it('registers exactly the saves request channels (slot-update is push-only, not registered here)', () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain });

        // `chimera:saves:slot-update` is a one-way push from main → renderer
        // via `webContents.send`. It must NOT appear as an invoke handler.
        expect([...stub.handled.keys()].sort()).toEqual(
            [
                SAVES_DELETE_CHANNEL,
                SAVES_LIST_CHANNEL,
                SAVES_LOAD_CHANNEL,
                SAVES_SAVE_CHANNEL,
            ].sort(),
        );
        expect(stub.handled.has(SAVES_SLOT_UPDATE_CHANNEL)).toBe(false);
    });
});

/**
 * Recording stub for the narrow `SettingsHandlersIpcMain` slice. The settings
 * namespace uses `handle` exclusively — every read/mutation is an
 * invoke-style round-trip.
 */
function makeSettingsIpcMainStub(): {
    readonly ipcMain: SettingsHandlersIpcMain;
    readonly handled: Map<string, SettingsInvokeHandler>;
} {
    const handled = new Map<string, SettingsInvokeHandler>();

    const ipcMain: SettingsHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
    };

    return { ipcMain, handled };
}

describe('registerSettingsHandlers', () => {
    it('registers chimera:settings:get as an invoke handler resolving to ResolvedSettings (stub)', async () => {
        const stub = makeSettingsIpcMainStub();
        registerSettingsHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(SETTINGS_GET_CHANNEL);
        expect(handler).toBeDefined();

        // Stub contract (F07/F19 replaces with real three-layer merge):
        // resolves to an object so the preload's `Promise<ResolvedSettings>`
        // signature is satisfied without claiming any particular default.
        const result = await Promise.resolve(handler?.({}, 'sample-game'));
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
    });

    it('registers chimera:settings:update as an invoke handler accepting (gameId, patch) (stub)', async () => {
        const stub = makeSettingsIpcMainStub();
        registerSettingsHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(SETTINGS_UPDATE_CHANNEL);
        expect(handler).toBeDefined();

        const patch: Partial<UserSettings> = { masterVolume: 0.5 };
        const result = await Promise.resolve(handler?.({}, 'sample-game', patch));
        expect(result).toBeDefined();
    });

    it('registers chimera:settings:reset as an invoke handler accepting a gameId (stub)', async () => {
        const stub = makeSettingsIpcMainStub();
        registerSettingsHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(SETTINGS_RESET_CHANNEL);
        expect(handler).toBeDefined();
        const result = await Promise.resolve(handler?.({}, 'sample-game'));
        expect(result).toBeDefined();
    });

    it('registers exactly the settings request channels (change is push-only, not registered here)', () => {
        const stub = makeSettingsIpcMainStub();
        registerSettingsHandlers({ ipcMain: stub.ipcMain });

        // `chimera:settings:change` is a one-way push from main → renderer
        // via `webContents.send`. It must NOT appear as an invoke handler.
        expect([...stub.handled.keys()].sort()).toEqual(
            [SETTINGS_GET_CHANNEL, SETTINGS_RESET_CHANNEL, SETTINGS_UPDATE_CHANNEL].sort(),
        );
        expect(stub.handled.has(SETTINGS_CHANGE_CHANNEL)).toBe(false);
    });
});

describe('registerSettingsHandlers — with real SettingsManager', () => {
    it('get handler returns merged defaults from registered schema', async () => {
        const stub = makeSettingsIpcMainStub();
        const { SettingsManager } = await import('./SettingsManager.js');
        const { InMemorySettingsRepository, ENGINE_DEFAULTS } =
            await import('@chimera/simulation/settings/index.js');
        const { z } = await import('zod');

        const engineSchema = z.object({
            audio: z.object({
                masterVolume: z.number(),
                sfxVolume: z.number(),
                musicVolume: z.number(),
                muted: z.boolean(),
            }),
            display: z.object({
                fullscreen: z.boolean(),
                vsync: z.boolean(),
                targetFps: z.literal(30).or(z.literal(60)).or(z.literal(120)).or(z.literal(0)),
                uiScale: z.number(),
            }),
            gameplay: z.object({
                language: z.string(),
                autoSave: z.boolean(),
                autoSaveIntervalTurns: z.number().int(),
                showHints: z.boolean(),
                showPerfHud: z.boolean(),
            }),
            controls: z.object({
                keyBindings: z.record(z.string(), z.string()),
            }),
        });

        const mgr = new SettingsManager(new InMemorySettingsRepository());
        mgr.registerSchema({
            gameId: 'wired-game',
            defaults: ENGINE_DEFAULTS,
            zodSchema: engineSchema,
        });

        registerSettingsHandlers({ ipcMain: stub.ipcMain, settingsManager: mgr });

        const handler = stub.handled.get(SETTINGS_GET_CHANNEL)!;
        const result = await Promise.resolve(handler({}, 'wired-game'));
        expect(result).toMatchObject({
            audio: { masterVolume: ENGINE_DEFAULTS.audio.masterVolume },
        });
    });

    it('update handler persists patch and returns merged settings', async () => {
        const stub = makeSettingsIpcMainStub();
        const { SettingsManager } = await import('./SettingsManager.js');
        const { InMemorySettingsRepository, ENGINE_DEFAULTS } =
            await import('@chimera/simulation/settings/index.js');
        const { z } = await import('zod');

        const engineSchema = z.object({
            audio: z.object({
                masterVolume: z.number(),
                sfxVolume: z.number(),
                musicVolume: z.number(),
                muted: z.boolean(),
            }),
            display: z.object({
                fullscreen: z.boolean(),
                vsync: z.boolean(),
                targetFps: z.literal(30).or(z.literal(60)).or(z.literal(120)).or(z.literal(0)),
                uiScale: z.number(),
            }),
            gameplay: z.object({
                language: z.string(),
                autoSave: z.boolean(),
                autoSaveIntervalTurns: z.number().int(),
                showHints: z.boolean(),
                showPerfHud: z.boolean(),
            }),
            controls: z.object({
                keyBindings: z.record(z.string(), z.string()),
            }),
        });

        const mgr = new SettingsManager(new InMemorySettingsRepository());
        mgr.registerSchema({
            gameId: 'wired-game',
            defaults: ENGINE_DEFAULTS,
            zodSchema: engineSchema,
        });

        registerSettingsHandlers({ ipcMain: stub.ipcMain, settingsManager: mgr });

        const handler = stub.handled.get(SETTINGS_UPDATE_CHANNEL)!;
        const result = (await Promise.resolve(
            handler({}, 'wired-game', { audio: { masterVolume: 0.1 } }),
        )) as { audio: { masterVolume: number } };
        expect(result.audio.masterVolume).toBe(0.1);
    });

    it('reset handler returns engine defaults after clearing overrides', async () => {
        const stub = makeSettingsIpcMainStub();
        const { SettingsManager } = await import('./SettingsManager.js');
        const { InMemorySettingsRepository, ENGINE_DEFAULTS } =
            await import('@chimera/simulation/settings/index.js');
        const { z } = await import('zod');

        const engineSchema = z.object({
            audio: z.object({
                masterVolume: z.number(),
                sfxVolume: z.number(),
                musicVolume: z.number(),
                muted: z.boolean(),
            }),
            display: z.object({
                fullscreen: z.boolean(),
                vsync: z.boolean(),
                targetFps: z.literal(30).or(z.literal(60)).or(z.literal(120)).or(z.literal(0)),
                uiScale: z.number(),
            }),
            gameplay: z.object({
                language: z.string(),
                autoSave: z.boolean(),
                autoSaveIntervalTurns: z.number().int(),
                showHints: z.boolean(),
                showPerfHud: z.boolean(),
            }),
            controls: z.object({
                keyBindings: z.record(z.string(), z.string()),
            }),
        });

        const repo = new InMemorySettingsRepository();
        await repo.save('wired-game', { audio: { masterVolume: 0.1 } });
        const mgr = new SettingsManager(repo);
        mgr.registerSchema({
            gameId: 'wired-game',
            defaults: ENGINE_DEFAULTS,
            zodSchema: engineSchema,
        });

        registerSettingsHandlers({ ipcMain: stub.ipcMain, settingsManager: mgr });

        const handler = stub.handled.get(SETTINGS_RESET_CHANNEL)!;
        const result = (await Promise.resolve(handler({}, 'wired-game'))) as {
            audio: { masterVolume: number };
        };
        expect(result.audio.masterVolume).toBe(ENGINE_DEFAULTS.audio.masterVolume);
    });
});

/**
 * Negative-path tests: every handler that accepts a structured payload must
 * reject malformed input with {@link IpcRequestValidationError} BEFORE any
 * stub side effect. Electron surfaces a thrown error inside an
 * `ipcMain.handle` callback as a rejected promise on the renderer side, and
 * inside an `ipcMain.on` callback as a synchronous throw — both behaviours
 * are tested here.
 */
describe('inbound IPC request validation', () => {
    it('chimera:game:send-action does NOT throw on a malformed envelope — it pushes REJECT to the sender', () => {
        const stub = makeGameIpcMainStub();
        registerGameHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.listeners.get(GAME_SEND_ACTION_CHANNEL);
        const { event, sends } = makeGameEvent();

        // `chimera:game:send-action` is an `ipcMain.on` send. Throwing out of
        // the callback is silently dropped by Electron, so the renderer would
        // never learn the action was rejected. The handler must instead
        // emit a REJECT push on `chimera:game:action-rejected` (wire-shape
        // mirror of the §4.3 WebSocket REJECT frame).
        expect(() => handler?.(event, { type: 'noop' })).not.toThrow();
        expect(() => handler?.(event, null)).not.toThrow();
        expect(() =>
            handler?.(event, { type: '', playerId: 'p1', tick: 0, payload: {} }),
        ).not.toThrow();

        // Exactly one REJECT push per invocation, each on the dedicated
        // channel; each payload carries the originating channel in the reason.
        expect(sends.length).toBe(3);
        for (const { channel, args } of sends) {
            expect(channel).toBe(GAME_ACTION_REJECTED_CHANNEL);
            const payload = args[0] as ActionRejection;
            expect(payload.reason.startsWith(`ipc-validation:${GAME_SEND_ACTION_CHANNEL}`)).toBe(
                true,
            );
        }
    });

    it('chimera:game:send-action REJECT payload recovers tick + actionType when the envelope carries them', () => {
        const stub = makeGameIpcMainStub();
        registerGameHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.listeners.get(GAME_SEND_ACTION_CHANNEL);
        const { event, sends } = makeGameEvent();

        // Envelope has a usable `type` and `tick` but a broken `payload`
        // (must be a plain object). Reconstruction should carry both fields
        // into the REJECT so the renderer can correlate.
        handler?.(event, { type: 'noop', playerId: 'p1', tick: 7, payload: 'not-an-object' });

        expect(sends.length).toBe(1);
        const payload = sends[0]?.args[0] as ActionRejection;
        expect(payload.tick).toBe(7);
        expect(payload.actionType).toBe('noop');
    });

    it('chimera:game:send-action REJECT uses tick:-1 when the envelope is unrecoverable', () => {
        const stub = makeGameIpcMainStub();
        registerGameHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.listeners.get(GAME_SEND_ACTION_CHANNEL);
        const { event, sends } = makeGameEvent();

        handler?.(event, null);
        handler?.(event, 'not-an-object');

        expect(sends.length).toBe(2);
        for (const { args } of sends) {
            const payload = args[0] as ActionRejection;
            expect(payload.tick).toBe(-1);
            expect(payload.actionType).toBeUndefined();
        }
    });

    it('chimera:game:switch-seat rejects a non-string or empty playerId', async () => {
        const stub = makeGameIpcMainStub();
        registerGameHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.handled.get(GAME_SWITCH_SEAT_CHANNEL);

        await expect(Promise.resolve().then(() => handler?.({}, ''))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
        await expect(Promise.resolve().then(() => handler?.({}, 42))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
    });

    it('chimera:lobby:host rejects a malformed HostLobbyParams', async () => {
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.handled.get(LOBBY_HOST_CHANNEL);

        await expect(
            Promise.resolve().then(() => handler?.({}, { gameId: 'x' })),
        ).rejects.toBeInstanceOf(IpcRequestValidationError);
        await expect(
            Promise.resolve().then(() => handler?.({}, { gameId: 'x', maxPlayers: 0 })),
        ).rejects.toBeInstanceOf(IpcRequestValidationError);
    });

    it('chimera:lobby:join rejects a malformed JoinLobbyParams', async () => {
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.handled.get(LOBBY_JOIN_CHANNEL);

        await expect(Promise.resolve().then(() => handler?.({}, {}))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
        await expect(
            Promise.resolve().then(() => handler?.({}, { address: '' })),
        ).rejects.toBeInstanceOf(IpcRequestValidationError);
    });

    it('chimera:saves:list rejects a non-string or empty gameId', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.handled.get(SAVES_LIST_CHANNEL);

        await expect(Promise.resolve().then(() => handler?.({}, ''))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
        await expect(Promise.resolve().then(() => handler?.({}, undefined))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
    });

    it('chimera:saves:save rejects a malformed SaveRequest', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.handled.get(SAVES_SAVE_CHANNEL);

        await expect(Promise.resolve().then(() => handler?.({}, {}))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
        await expect(
            Promise.resolve().then(() => handler?.({}, { gameId: 'x', label: 42 })),
        ).rejects.toBeInstanceOf(IpcRequestValidationError);
    });

    it('chimera:saves:load and chimera:saves:delete reject an empty slotId', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain });
        const loadHandler = stub.handled.get(SAVES_LOAD_CHANNEL);
        const deleteHandler = stub.handled.get(SAVES_DELETE_CHANNEL);

        await expect(Promise.resolve().then(() => loadHandler?.({}, ''))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
        await expect(Promise.resolve().then(() => deleteHandler?.({}, ''))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
    });

    it('chimera:settings:get and chimera:settings:reset reject an empty gameId', async () => {
        const stub = makeSettingsIpcMainStub();
        registerSettingsHandlers({ ipcMain: stub.ipcMain });
        const getHandler = stub.handled.get(SETTINGS_GET_CHANNEL);
        const resetHandler = stub.handled.get(SETTINGS_RESET_CHANNEL);

        await expect(Promise.resolve().then(() => getHandler?.({}, ''))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
        await expect(Promise.resolve().then(() => resetHandler?.({}, ''))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
    });

    it('chimera:settings:update rejects a malformed gameId or non-object patch', async () => {
        const stub = makeSettingsIpcMainStub();
        registerSettingsHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.handled.get(SETTINGS_UPDATE_CHANNEL);

        await expect(Promise.resolve().then(() => handler?.({}, '', {}))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
        await expect(
            Promise.resolve().then(() => handler?.({}, 'sample-game', [])),
        ).rejects.toBeInstanceOf(IpcRequestValidationError);
        await expect(
            Promise.resolve().then(() => handler?.({}, 'sample-game', null)),
        ).rejects.toBeInstanceOf(IpcRequestValidationError);
    });

    it('IpcRequestValidationError carries the channel that rejected the payload (invoke handlers)', async () => {
        // send-action no longer throws — it emits a REJECT push — so this
        // test exercises an `ipcMain.handle`-style channel where the throw
        // still surfaces as a renderer-side promise rejection.
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain });
        const handler = stub.handled.get(LOBBY_HOST_CHANNEL);

        try {
            await Promise.resolve().then(() => handler?.({}, { garbage: true }));
            throw new Error('expected IpcRequestValidationError');
        } catch (err) {
            expect(err).toBeInstanceOf(IpcRequestValidationError);
            expect((err as IpcRequestValidationError).channel).toBe(LOBBY_HOST_CHANNEL);
        }
    });
});

describe('Logger injection (invariant 67)', () => {
    it('registerSystemHandlers emits an info log tagged with the injected module', () => {
        const sink = createMemorySink();
        const logger = createLogger({
            source: { process: 'main', module: 'root' },
            sink,
        }).child({ module: 'system' });
        const stub = makeIpcMainStub();

        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app: { quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() },
            platform: 'linux',
            electronVersion: '33.4.11',
            logger,
        });

        const infoEntries = sink.entries.filter((e) => e.level === 'info');
        expect(infoEntries).toHaveLength(1);
        expect(infoEntries[0]?.source).toEqual({ process: 'main', module: 'system' });
        expect(infoEntries[0]?.message).toContain('chimera:system');
    });

    it('registerGameHandlers warn-logs every IPC REJECT with channel/reason/tick context', () => {
        const sink = createMemorySink();
        const logger = createLogger({
            source: { process: 'main', module: 'root' },
            sink,
        }).child({ module: 'game' });
        const stub = makeGameIpcMainStub();
        registerGameHandlers({ ipcMain: stub.ipcMain, logger });

        const handler = stub.listeners.get(GAME_SEND_ACTION_CHANNEL);
        const { event, sends } = makeGameEvent();
        sink.clear();
        // Use an envelope with recoverable tick + actionType so the log
        // context carries them.
        handler?.(event, { type: 'noop', playerId: 'p1', tick: 7, payload: 'not-an-object' });

        // REJECT push is still emitted for the renderer.
        expect(sends).toHaveLength(1);

        const warns = sink.entries.filter((e) => e.level === 'warn');
        expect(warns).toHaveLength(1);
        const warn = warns[0];
        expect(warn?.source).toEqual({ process: 'main', module: 'game' });
        expect(warn?.context).toMatchObject({
            channel: GAME_SEND_ACTION_CHANNEL,
            tick: 7,
            actionType: 'noop',
        });
        expect(String(warn?.context?.['reason'])).toContain(
            `ipc-validation:${GAME_SEND_ACTION_CHANNEL}`,
        );
    });

    it('handlers default to a noop logger when none is injected (back-compat with stub tests)', () => {
        // All preceding test blocks call register*Handlers without a `logger`
        // option. This test documents and pins the back-compat behaviour:
        // omitting `logger` must not throw and must not require any other
        // wiring. Failure of this test means the logger option became
        // required without updating the other call sites.
        const stub = makeGameIpcMainStub();
        expect(() => registerGameHandlers({ ipcMain: stub.ipcMain })).not.toThrow();
    });
});

describe('registerSettingsHandlers — BLOCK-4 per-game patch validation at IPC boundary', () => {
    it('update handler rejects an invalid patch before reaching the repo (BLOCK-4)', async () => {
        const stub = makeSettingsIpcMainStub();
        const { SettingsManager } = await import('./SettingsManager.js');
        const { InMemorySettingsRepository } =
            await import('@chimera/simulation/settings/index.js');
        const { z } = await import('zod');

        const engineSchema = z.object({
            audio: z.object({
                masterVolume: z.number(),
                sfxVolume: z.number(),
                musicVolume: z.number(),
                muted: z.boolean(),
            }),
            display: z.object({
                fullscreen: z.boolean(),
                vsync: z.boolean(),
                targetFps: z.literal(30).or(z.literal(60)).or(z.literal(120)).or(z.literal(0)),
                uiScale: z.number(),
            }),
            gameplay: z.object({
                language: z.string(),
                autoSave: z.boolean(),
                autoSaveIntervalTurns: z.number().int(),
                showHints: z.boolean(),
                showPerfHud: z.boolean(),
            }),
            controls: z.object({
                keyBindings: z.record(z.string(), z.string()),
            }),
        });

        const repo = new InMemorySettingsRepository();
        const mgr = new SettingsManager(repo);
        mgr.registerSchema({
            gameId: 'block4-game',
            defaults: (await import('@chimera/simulation/settings/index.js')).ENGINE_DEFAULTS,
            zodSchema: engineSchema,
        });

        registerSettingsHandlers({ ipcMain: stub.ipcMain, settingsManager: mgr });

        const handler = stub.handled.get(SETTINGS_UPDATE_CHANNEL)!;
        // Invalid patch: masterVolume should be number but is string
        // validatePatchForGame throws synchronously, so the handler throws before returning a Promise
        expect(() =>
            handler({}, 'block4-game', { audio: { masterVolume: 'loud' as unknown as number } }),
        ).toThrow();

        // Repo must remain empty — the invalid patch must not have been saved
        const persisted = await repo.load('block4-game');
        expect(persisted).toEqual({});
    });

    it('update handler passes a valid patch through when schema is registered', async () => {
        const stub = makeSettingsIpcMainStub();
        const { SettingsManager } = await import('./SettingsManager.js');
        const { InMemorySettingsRepository, ENGINE_DEFAULTS } =
            await import('@chimera/simulation/settings/index.js');
        const { z } = await import('zod');

        const engineSchema = z.object({
            audio: z.object({
                masterVolume: z.number(),
                sfxVolume: z.number(),
                musicVolume: z.number(),
                muted: z.boolean(),
            }),
            display: z.object({
                fullscreen: z.boolean(),
                vsync: z.boolean(),
                targetFps: z.literal(30).or(z.literal(60)).or(z.literal(120)).or(z.literal(0)),
                uiScale: z.number(),
            }),
            gameplay: z.object({
                language: z.string(),
                autoSave: z.boolean(),
                autoSaveIntervalTurns: z.number().int(),
                showHints: z.boolean(),
                showPerfHud: z.boolean(),
            }),
            controls: z.object({
                keyBindings: z.record(z.string(), z.string()),
            }),
        });

        const mgr = new SettingsManager(new InMemorySettingsRepository());
        mgr.registerSchema({
            gameId: 'block4-game',
            defaults: ENGINE_DEFAULTS,
            zodSchema: engineSchema,
        });
        registerSettingsHandlers({ ipcMain: stub.ipcMain, settingsManager: mgr });

        const handler = stub.handled.get(SETTINGS_UPDATE_CHANNEL)!;
        const result = (await Promise.resolve(
            handler({}, 'block4-game', { audio: { masterVolume: 0.2 } }),
        )) as { audio: { masterVolume: number } };
        expect(result.audio.masterVolume).toBe(0.2);
    });
});

// ── Logs handlers ──────────────────────────────────────────────────────────────

import {
    LOGS_EMIT_CHANNEL,
    LOGS_READ_RECENT_CHANNEL,
    registerLogsHandlers,
    type LogsHandlersIpcMain,
} from './ipc-handlers.js';
import type { LogEntry } from '@chimera/shared/logging.js';
import type { MemorySink } from './logger.js';

function makeLogsIpcMainStub(): {
    readonly ipcMain: LogsHandlersIpcMain;
    readonly handled: Map<string, (...args: unknown[]) => unknown>;
    readonly listeners: Map<string, (...args: unknown[]) => void>;
} {
    const handled = new Map<string, (...args: unknown[]) => unknown>();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const ipcMain: LogsHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
        on: (channel, handler) => {
            listeners.set(channel, handler);
        },
    };
    return { ipcMain, handled, listeners };
}

const VALID_ENTRY: LogEntry = {
    level: 'info',
    message: 'hello',
    timestamp: 123456789,
    source: { process: 'renderer', module: 'test' },
};

/**
 * Helper: build a `RegisterLogsHandlersOptions`-compatible set of stubs.
 * `sink` is the LoggerSink the handler writes trusted entries to.
 * `memorySink` is the ring buffer used by readRecent (may be the same sink).
 */
function makeLogsStubs(): {
    readonly ipcStub: ReturnType<typeof makeLogsIpcMainStub>;
    readonly sink: MemorySink;
    readonly memorySink: MemorySink;
    readonly logger: ReturnType<typeof createLogger>;
} {
    const sink = createMemorySink();
    const memorySink = createMemorySink();
    const logger = createLogger({ source: { process: 'main', module: 'root' }, sink: memorySink });
    return { ipcStub: makeLogsIpcMainStub(), sink, memorySink, logger };
}

describe('registerLogsHandlers', () => {
    it('chimera:logs:emit handler rejects entries that fail Zod validation', () => {
        const { ipcStub, sink, memorySink, logger } = makeLogsStubs();
        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.listeners.get(LOGS_EMIT_CHANNEL)!;
        const initialCount = sink.entries.length;
        // Malformed: missing required fields
        expect(() => handler({}, { message: 'bad' })).not.toThrow();
        // Sink must NOT receive a new entry from the bad payload
        expect(sink.entries.length).toBe(initialCount);
    });

    it('chimera:logs:emit handler forwards a valid LogEntry to the sink', () => {
        const { ipcStub, sink, memorySink, logger } = makeLogsStubs();
        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.listeners.get(LOGS_EMIT_CHANNEL)!;
        handler({}, VALID_ENTRY);
        const last = sink.entries.at(-1);
        expect(last?.message).toBe('hello');
        expect(last?.level).toBe('info');
    });

    it('overrides source.process to "renderer" even when the renderer sends source.process: "main"', () => {
        const { ipcStub, sink, memorySink, logger } = makeLogsStubs();
        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.listeners.get(LOGS_EMIT_CHANNEL)!;
        // Renderer claims to be 'main' — must be overridden
        handler({}, { ...VALID_ENTRY, source: { process: 'main', module: 'test' } });
        const last = sink.entries.at(-1);
        expect(last?.source.process).toBe('renderer');
        expect(last?.source.module).toBe('test');
    });

    it('overrides timestamp with the server-side wall clock regardless of renderer-supplied value', () => {
        const { ipcStub, sink, memorySink, logger } = makeLogsStubs();
        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const before = Date.now();
        const handler = ipcStub.listeners.get(LOGS_EMIT_CHANNEL)!;
        // Renderer supplies a backdated timestamp (epoch)
        handler({}, { ...VALID_ENTRY, timestamp: 1 });
        const after = Date.now();
        const last = sink.entries.at(-1);
        expect(last?.timestamp).toBeGreaterThanOrEqual(before);
        expect(last?.timestamp).toBeLessThanOrEqual(after);
    });

    it('preserves source.module from the validated renderer payload', () => {
        const { ipcStub, sink, memorySink, logger } = makeLogsStubs();
        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.listeners.get(LOGS_EMIT_CHANNEL)!;
        handler({}, { ...VALID_ENTRY, source: { process: 'renderer', module: 'my-module' } });
        const last = sink.entries.at(-1);
        expect(last?.source.module).toBe('my-module');
    });

    it('chimera:logs:readRecent returns the last N entries from the memory sink', async () => {
        const { ipcStub, sink, memorySink, logger } = makeLogsStubs();

        // Seed the memorySink with 5 entries
        for (let i = 0; i < 5; i++) {
            memorySink.write({ ...VALID_ENTRY, message: `entry-${i}` });
        }

        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.handled.get(LOGS_READ_RECENT_CHANNEL)!;
        const result = (await Promise.resolve(handler({}, 3))) as LogEntry[];
        expect(result).toHaveLength(3);
        expect(result[0]?.message).toBe('entry-2');
        expect(result[2]?.message).toBe('entry-4');
    });

    it('readRecent caps maxEntries at the sink capacity to prevent DoS', async () => {
        const { ipcStub, sink, logger } = makeLogsStubs();
        // Use a small-capacity memory sink (3 entries max)
        const smallSink = createMemorySink(3);
        for (let i = 0; i < 3; i++) {
            smallSink.write({ ...VALID_ENTRY, message: `entry-${i}` });
        }

        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink: smallSink, sink });

        const handler = ipcStub.handled.get(LOGS_READ_RECENT_CHANNEL)!;
        // Request more entries than the sink can hold
        const result = (await Promise.resolve(handler({}, Number.MAX_SAFE_INTEGER))) as LogEntry[];
        expect(result.length).toBeLessThanOrEqual(smallSink.capacity);
    });

    it('readRecent(MAX_SAFE_INTEGER) never returns more than MAX_READ_RECENT_ENTRIES (1000)', async () => {
        const { ipcStub, sink, logger } = makeLogsStubs();
        // Use a sink with 1001 capacity (greater than the 1000 cap)
        const bigSink = createMemorySink(1001);
        for (let i = 0; i < 1001; i++) {
            bigSink.write({ ...VALID_ENTRY, message: `entry-${i}` });
        }

        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink: bigSink, sink });

        const handler = ipcStub.handled.get(LOGS_READ_RECENT_CHANNEL)!;
        const result = (await Promise.resolve(handler({}, Number.MAX_SAFE_INTEGER))) as LogEntry[];
        expect(result.length).toBeLessThanOrEqual(1000);
    });

    it('readRecent(1.5) falls back to default because maxEntries must be an integer', async () => {
        const { ipcStub, sink, logger } = makeLogsStubs();
        const memorySink = createMemorySink();
        for (let i = 0; i < 5; i++) {
            memorySink.write({ ...VALID_ENTRY, message: `entry-${i}` });
        }

        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.handled.get(LOGS_READ_RECENT_CHANNEL)!;
        // 1.5 is not an integer — handler must fall back to the default (100) and
        // return all 5 seeded entries (5 < 100), not just 1 or 2 (what floor(1.5) would give).
        const result = (await Promise.resolve(handler({}, 1.5))) as LogEntry[];
        expect(result).toHaveLength(5);
    });

    it('readRecent(-1) falls back to default (100)', async () => {
        const { ipcStub, sink, logger } = makeLogsStubs();
        const memorySink = createMemorySink();
        for (let i = 0; i < 5; i++) {
            memorySink.write({ ...VALID_ENTRY, message: `entry-${i}` });
        }

        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.handled.get(LOGS_READ_RECENT_CHANNEL)!;
        const result = (await Promise.resolve(handler({}, -1))) as LogEntry[];
        // -1 is invalid — falls back to 100, so all 5 seeded entries are returned
        expect(result).toHaveLength(5);
    });

    it('readRecent(NaN) falls back to default (100)', async () => {
        const { ipcStub, sink, logger } = makeLogsStubs();
        const memorySink = createMemorySink();
        for (let i = 0; i < 5; i++) {
            memorySink.write({ ...VALID_ENTRY, message: `entry-${i}` });
        }

        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.handled.get(LOGS_READ_RECENT_CHANNEL)!;
        const result = (await Promise.resolve(handler({}, Number.NaN))) as LogEntry[];
        // NaN is invalid — falls back to 100, so all 5 seeded entries are returned
        expect(result).toHaveLength(5);
    });

    it('level:error entry with error field calls logger.error with reconstructed Error', () => {
        const { ipcStub, sink, memorySink, logger } = makeLogsStubs();
        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.listeners.get(LOGS_EMIT_CHANNEL)!;
        handler(
            {},
            {
                ...VALID_ENTRY,
                level: 'error',
                error: { name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n  at test' },
            },
        );

        // The logger writes to memorySink — check that an error entry arrived there
        const errorEntries = memorySink.entries.filter((e) => e.level === 'error');
        expect(errorEntries.length).toBeGreaterThanOrEqual(1);
        const last = errorEntries.at(-1);
        expect(last?.error?.name).toBe('TypeError');
        expect(last?.error?.message).toBe('boom');
        expect(last?.error?.stack).toContain('TypeError: boom');
    });

    it('level:fatal entry with error field calls logger.fatal with reconstructed Error', () => {
        const { ipcStub, sink, memorySink, logger } = makeLogsStubs();
        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.listeners.get(LOGS_EMIT_CHANNEL)!;
        handler(
            {},
            {
                ...VALID_ENTRY,
                level: 'fatal',
                error: {
                    name: 'RangeError',
                    message: 'out of range',
                    stack: 'RangeError: out of range',
                },
            },
        );

        const fatalEntries = memorySink.entries.filter((e) => e.level === 'fatal');
        expect(fatalEntries.length).toBeGreaterThanOrEqual(1);
        const last = fatalEntries.at(-1);
        expect(last?.error?.name).toBe('RangeError');
        expect(last?.error?.message).toBe('out of range');
    });

    it('level:info entry (no error) still works unchanged', () => {
        const { ipcStub, sink, memorySink, logger } = makeLogsStubs();
        registerLogsHandlers({ ipcMain: ipcStub.ipcMain, logger, memorySink, sink });

        const handler = ipcStub.listeners.get(LOGS_EMIT_CHANNEL)!;
        handler({}, { ...VALID_ENTRY, level: 'info', message: 'just info' });

        const last = sink.entries.at(-1);
        expect(last?.level).toBe('info');
        expect(last?.message).toBe('just info');
        expect(last?.error).toBeUndefined();
    });
});
