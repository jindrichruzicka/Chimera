import { describe, expect, it, vi } from 'vitest';
import {
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
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    mapPlatform,
    registerGameHandlers,
    registerLobbyHandlers,
    registerSavesHandlers,
    registerSystemHandlers,
    type GameHandlersIpcMain,
    type GameHandlerListener,
    type GameInvokeHandler,
    type LobbyHandlerListener,
    type LobbyHandlersIpcMain,
    type LobbyInvokeHandler,
    type SavesHandlersIpcMain,
    type SavesInvokeHandler,
    type SystemHandlersAppHost,
    type SystemHandlersIpcMain,
} from './ipc-handlers.js';
import type {
    EngineAction,
    HostLobbyParams,
    JoinLobbyParams,
    SaveRequest,
} from '../preload/api.js';

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
        const app: SystemHandlersAppHost = { quit: vi.fn() };
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
        const app: SystemHandlersAppHost = { quit };
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

    it('registers exactly the two system channels (no cross-namespace leakage)', () => {
        const stub = makeIpcMainStub();
        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app: { quit: vi.fn() },
            platform: 'linux',
            electronVersion: '33.4.11',
        });

        expect([...stub.handled.keys()]).toEqual([SYSTEM_PLATFORM_CHANNEL]);
        expect([...stub.listeners.keys()]).toEqual([SYSTEM_QUIT_CHANNEL]);
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
        expect(() => handler?.({}, action)).not.toThrow();
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
