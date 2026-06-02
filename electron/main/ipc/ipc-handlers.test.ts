import { buildAssetRef, type TextureAsset } from '@chimera/simulation/content/AssetRef.js';
import { describe, expect, it, vi } from 'vitest';
import {
    GAME_ACTION_REJECTED_CHANNEL,
    GAME_SEND_ACTION_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_REVEAL_CHANNEL,
    GAME_PREDICTABLE_TYPES_CHANNEL,
    GAME_GET_CURRENT_SNAPSHOT_CHANNEL,
    LOBBY_HOST_CHANNEL,
    LOBBY_GET_CURRENT_STATE_CHANNEL,
    LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL,
    LOBBY_JOIN_CHANNEL,
    LOBBY_LEAVE_CHANNEL,
    LOBBY_START_GAME_CHANNEL,
    LOBBY_UPDATE_READY_STATE_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
    SAVES_DELETE_CHANNEL,
    SAVES_LIST_CHANNEL,
    SAVES_LOAD_CHANNEL,
    SAVES_SAVE_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
    SAVES_CHECK_CRASH_RECOVERY_CHANNEL,
    SETTINGS_CHANGE_CHANNEL,
    SETTINGS_GET_CHANNEL,
    SETTINGS_RESET_CHANNEL,
    SETTINGS_UPDATE_CHANNEL,
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    SYSTEM_RELAUNCH_CHANNEL,
    SYSTEM_DEVICE_INFO_CHANNEL,
    mapPlatform,
    registerGameHandlers,
    registerLobbyHandlers,
    registerProfileHandlers,
    registerReplayHandlers,
    registerSavesHandlers,
    registerSettingsHandlers,
    registerSystemHandlers,
    REPLAY_DELETE_CHANNEL,
    REPLAY_EXPORT_CURRENT_MATCH_CHANNEL,
    REPLAY_LIST_CHANNEL,
    REPLAY_NAVIGATE_CHANNEL,
    REPLAY_OPEN_IN_PLAYER_CHANNEL,
    PROFILE_DIRECTORY_CHANGED_CHANNEL,
    PROFILE_GET_LOBBY_DIRECTORY_CHANNEL,
    PROFILE_GET_LOCAL_CHANNEL,
    PROFILE_LIST_LOCAL_SLOTS_CHANNEL,
    PROFILE_SWITCH_SLOT_CHANNEL,
    PROFILE_UPDATE_LOCAL_CHANNEL,
    type GameHandlersIpcMain,
    type GameHandlerEvent,
    type GameHandlerListener,
    type GameInvokeHandler,
    type LobbyHandlersIpcMain,
    type LobbyInvokeHandler,
    type ProfileHandlersIpcMain,
    type ProfileInvokeHandler,
    type ReplayHandlersIpcMain,
    type ReplayInvokeHandler,
    type ReplayIpcPort,
    type SavesHandlersIpcMain,
    type SavesInvokeHandler,
    type SavesIpcPort,
    type SettingsHandlersIpcMain,
    type SettingsInvokeHandler,
    type SystemHandlersAppHost,
    type SystemHandlersIpcMain,
} from './ipc-handlers.js';
import { IpcRequestValidationError } from './ipc-schemas.js';
import { createLogger, createMemorySink, createNoopLogger } from '../logging/logger.js';
import { LobbyManager } from '../lobby/LobbyManager.js';
import { InMemoryMultiplayerProvider } from '@chimera/networking/provider/InMemoryMultiplayerProvider.js';
import type { LobbyInfo, LobbyState } from '@chimera/networking/provider/MultiplayerProvider.js';
import { playerId as toPlayerId } from '@chimera/networking/provider/MultiplayerProvider.js';
import { toSlotId, playerId } from '../../preload/api-types.js';
import type {
    ActionRejection,
    DeviceInfo,
    EngineAction,
    HostLobbyParams,
    JoinLobbyParams,
    PlayerProfile,
    ReplayListItem,
    SaveRequest,
    SaveSlotMeta,
    UserSettings,
} from '../../preload/api-types.js';
import * as nodePath from 'node:path';

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

    it('does not call app.quit() when isE2e is true (CHIMERA_E2E guard)', () => {
        const stub = makeIpcMainStub();
        const quit = vi.fn();
        const app: SystemHandlersAppHost = { quit, relaunch: vi.fn(), exit: vi.fn() };
        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app,
            platform: 'linux',
            electronVersion: '33.4.11',
            isE2e: true,
        });

        const handler = stub.listeners.get(SYSTEM_QUIT_CHANNEL);
        expect(handler).toBeDefined();
        handler?.();

        expect(quit).not.toHaveBeenCalled();
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

    it('registers exactly the four system channels (no cross-namespace leakage)', () => {
        const stub = makeIpcMainStub();
        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app: { quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() },
            platform: 'linux',
            electronVersion: '33.4.11',
        });

        expect([...stub.handled.keys()]).toEqual([
            SYSTEM_PLATFORM_CHANNEL,
            SYSTEM_DEVICE_INFO_CHANNEL,
        ]);
        expect([...stub.listeners.keys()]).toEqual([SYSTEM_QUIT_CHANNEL, SYSTEM_RELAUNCH_CHANNEL]);
    });

    it('chimera:system:device-info handler returns result from injected getDeviceInfo()', async () => {
        const stub = makeIpcMainStub();
        const deviceInfo: DeviceInfo = {
            os: 'linux' as const,
            osVersion: '6.1.0',
            arch: 'x64' as const,
            electronVer: '33.4.11',
            chromiumVer: '130.0.0.0',
            locale: 'en-US',
            formFactor: 'unknown' as const,
            screens: [
                { id: 1, width: 1920, height: 1080, pixelRatio: 1, refreshHz: 60, primary: true },
            ],
            windowSizeClass: 'large' as const,
            inputs: ['mouse', 'keyboard'] as const,
            primaryInput: 'mouse' as const,
            battery: null,
        };
        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app: { quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() },
            platform: 'linux',
            electronVersion: '33.4.11',
            getDeviceInfo: () => deviceInfo,
        });

        const handler = stub.handled.get(SYSTEM_DEVICE_INFO_CHANNEL);
        expect(handler).toBeDefined();
        expect(await handler?.()).toBe(deviceInfo);
    });

    it('chimera:system:device-info handler returns a default DeviceInfo when getDeviceInfo is not injected', async () => {
        const stub = makeIpcMainStub();
        registerSystemHandlers({
            ipcMain: stub.ipcMain,
            app: { quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() },
            platform: 'linux',
            electronVersion: '33.4.11',
        });

        const handler = stub.handled.get(SYSTEM_DEVICE_INFO_CHANNEL);
        expect(handler).toBeDefined();
        const result = await handler?.();
        // Should return a minimally valid DeviceInfo with at least an os field
        expect(result).toMatchObject({ os: 'linux' });
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
    it('registers chimera:game:send-action as a send listener and delegates valid actions', () => {
        const stub = makeGameIpcMainStub();
        const actionDispatcher = vi.fn();
        registerGameHandlers({ ipcMain: stub.ipcMain, actionDispatcher });

        const handler = stub.listeners.get(GAME_SEND_ACTION_CHANNEL);
        expect(handler).toBeDefined();

        const action: EngineAction = {
            type: 'noop',
            playerId: playerId('p1'),
            tick: 0,
            payload: {},
        };
        const { event, sends } = makeGameEvent();
        expect(() => handler?.(event, action)).not.toThrow();
        expect(actionDispatcher).toHaveBeenCalledWith(action);
        // Happy path: no REJECT push is emitted when the envelope is valid.
        expect(sends).toEqual([]);
    });

    it('registers exactly the game request channels (snapshot is push-only, not registered here)', () => {
        const stub = makeGameIpcMainStub();
        registerGameHandlers({ ipcMain: stub.ipcMain });

        // `chimera:game:snapshot` and `chimera:game:reveal` are one-way pushes
        // from main → renderer via `webContents.send`. They must NOT appear as
        // main-side listeners or invoke handlers.
        expect([...stub.handled.keys()]).toEqual([
            GAME_PREDICTABLE_TYPES_CHANNEL,
            GAME_GET_CURRENT_SNAPSHOT_CHANNEL,
        ]);
        expect([...stub.listeners.keys()]).toEqual([GAME_SEND_ACTION_CHANNEL]);
        expect(stub.handled.has(GAME_SNAPSHOT_CHANNEL)).toBe(false);
        expect(stub.listeners.has(GAME_SNAPSHOT_CHANNEL)).toBe(false);
        expect(stub.handled.has(GAME_REVEAL_CHANNEL)).toBe(false);
        expect(stub.listeners.has(GAME_REVEAL_CHANNEL)).toBe(false);
    });

    describe('chimera:game:predictable-action-types handler', () => {
        it('returns an empty array when no actionRegistry is provided', async () => {
            const stub = makeGameIpcMainStub();
            registerGameHandlers({ ipcMain: stub.ipcMain });

            const handler = stub.handled.get(GAME_PREDICTABLE_TYPES_CHANNEL);
            expect(handler).toBeDefined();
            await expect(Promise.resolve(handler?.({}))).resolves.toEqual([]);
        });

        it('returns only types with predictable: true from the injected registry', async () => {
            const stub = makeGameIpcMainStub();
            const registry = {
                registeredTypes: () => ['tactics:move', 'tactics:pass', 'tactics:chat'],
                resolve: (type: string): { readonly predictable?: boolean } => {
                    if (type === 'tactics:move') return { predictable: true };
                    if (type === 'tactics:pass') return { predictable: false };
                    return {}; // tactics:chat — predictable absent
                },
            };
            registerGameHandlers({ ipcMain: stub.ipcMain, actionRegistry: registry });

            const handler = stub.handled.get(GAME_PREDICTABLE_TYPES_CHANNEL);
            await expect(Promise.resolve(handler?.({}))).resolves.toEqual(['tactics:move']);
        });

        it('returns all types when all are marked predictable: true', async () => {
            const stub = makeGameIpcMainStub();
            const registry = {
                registeredTypes: () => ['a:x', 'a:y'],
                resolve: (_type: string): { readonly predictable?: boolean } => ({
                    predictable: true,
                }),
            };
            registerGameHandlers({ ipcMain: stub.ipcMain, actionRegistry: registry });

            const handler = stub.handled.get(GAME_PREDICTABLE_TYPES_CHANNEL);
            await expect(Promise.resolve(handler?.({}))).resolves.toEqual(['a:x', 'a:y']);
        });

        it('returns an empty array when the registry has no registered types', async () => {
            const stub = makeGameIpcMainStub();
            const registry = {
                registeredTypes: () => [] as string[],
                resolve: (_type: string): { readonly predictable?: boolean } => ({}),
            };
            registerGameHandlers({ ipcMain: stub.ipcMain, actionRegistry: registry });

            const handler = stub.handled.get(GAME_PREDICTABLE_TYPES_CHANNEL);
            await expect(Promise.resolve(handler?.({}))).resolves.toEqual([]);
        });
    });

    describe('chimera:game:get-current-snapshot handler', () => {
        it('returns null when no getCurrentSnapshot is provided', async () => {
            const stub = makeGameIpcMainStub();
            registerGameHandlers({ ipcMain: stub.ipcMain });

            const handler = stub.handled.get(GAME_GET_CURRENT_SNAPSHOT_CHANNEL);
            expect(handler).toBeDefined();
            await expect(Promise.resolve(handler?.({}))).resolves.toBeNull();
        });

        it('returns the snapshot from the injected accessor', async () => {
            const fakeSnapshot = { tick: 42, viewerId: 'player-a' };
            const stub = makeGameIpcMainStub();
            registerGameHandlers({
                ipcMain: stub.ipcMain,
                getCurrentSnapshot: () => fakeSnapshot,
            });

            const handler = stub.handled.get(GAME_GET_CURRENT_SNAPSHOT_CHANNEL);
            await expect(Promise.resolve(handler?.({}))).resolves.toEqual(fakeSnapshot);
        });

        it('returns null when the accessor returns null', async () => {
            const stub = makeGameIpcMainStub();
            registerGameHandlers({
                ipcMain: stub.ipcMain,
                getCurrentSnapshot: () => null,
            });

            const handler = stub.handled.get(GAME_GET_CURRENT_SNAPSHOT_CHANNEL);
            await expect(Promise.resolve(handler?.({}))).resolves.toBeNull();
        });
    });
});

/**
 * Recording stub for the narrow `LobbyHandlersIpcMain` slice. The lobby
 * namespace uses `handle` exclusively — every request/response is an
 * invoke-style round-trip so the renderer can surface failures.
 */
function makeLobbyIpcMainStub(): {
    readonly ipcMain: LobbyHandlersIpcMain;
    readonly handled: Map<string, LobbyInvokeHandler>;
} {
    const handled = new Map<string, LobbyInvokeHandler>();

    const ipcMain: LobbyHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
    };

    return { ipcMain, handled };
}

/**
 * Creates a real LobbyManager backed by InMemoryMultiplayerProvider.
 * Tests that need to control return values should spy on specific methods.
 */
function makeLobbyManagerStub(): LobbyManager {
    return new LobbyManager(new InMemoryMultiplayerProvider(), createNoopLogger());
}

describe('registerLobbyHandlers', () => {
    it('registers chimera:lobby:host as an invoke handler that calls lobbyManager.hostLobby', async () => {
        const stub = makeLobbyIpcMainStub();
        const lobbyManager = makeLobbyManagerStub();
        const spy = vi.spyOn(lobbyManager, 'hostLobby');
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager });

        const handler = stub.handled.get(LOBBY_HOST_CHANNEL);
        expect(handler).toBeDefined();

        const params: HostLobbyParams = { gameId: 'sample-game', maxPlayers: 4 };
        const result = (await Promise.resolve(handler?.({}, params))) as LobbyInfo | undefined;
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith(params);
        expect(result?.gameId).toBe('sample-game');
        expect(result?.sessionId).toBeTruthy();
    });

    it('registers chimera:lobby:join as an invoke handler that calls lobbyManager.joinLobby', async () => {
        const stub = makeLobbyIpcMainStub();
        const lobbyManager = makeLobbyManagerStub();
        const mockHostId = toPlayerId('host-1');
        const mockInfo: LobbyInfo = {
            sessionId: 'sess-1',
            hostId: mockHostId,
            gameId: 'tactics',
        };
        const spy = vi.spyOn(lobbyManager, 'joinLobby').mockResolvedValue(mockInfo);
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager });

        const handler = stub.handled.get(LOBBY_JOIN_CHANNEL);
        expect(handler).toBeDefined();

        const params: JoinLobbyParams = { address: 'ws://127.0.0.1:7777' };
        const result = await Promise.resolve(handler?.({}, params));
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith(params);
        expect(result).toEqual(mockInfo);
    });

    it('adds the current local profile attestation to chimera:lobby:join when a ProfileManager is wired', async () => {
        const stub = makeLobbyIpcMainStub();
        const lobbyManager = makeLobbyManagerStub();
        const profile = makeProfile({ localProfileId: 'local-client', displayName: 'Client' });
        const profileManager = {
            currentAttestation: vi.fn<() => PlayerProfile>().mockReturnValue(profile),
            updateLocal: vi
                .fn<(patch: Partial<Omit<PlayerProfile, 'localProfileId'>>) => PlayerProfile>()
                .mockReturnValue(profile),
            listLocalSlots: vi.fn(async () => []),
            switchLocalSlot: vi.fn(async () => profile),
        };
        const mockInfo: LobbyInfo = {
            sessionId: 'sess-1',
            hostId: toPlayerId('host-1'),
            gameId: 'tactics',
        };
        const spy = vi.spyOn(lobbyManager, 'joinLobby').mockResolvedValue(mockInfo);
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager, profileManager });

        const handler = stub.handled.get(LOBBY_JOIN_CHANNEL);
        expect(handler).toBeDefined();

        const params: JoinLobbyParams = { address: '127.0.0.1:7777:token' };
        const result = await Promise.resolve(handler?.({}, params));

        expect(profileManager.currentAttestation).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith({ address: params.address, profile });
        expect(result).toEqual(mockInfo);
    });

    it('registers chimera:lobby:leave as an invoke handler that calls lobbyManager.closeLobby', async () => {
        const stub = makeLobbyIpcMainStub();
        const lobbyManager = makeLobbyManagerStub();
        const spy = vi.spyOn(lobbyManager, 'closeLobby');
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager });

        const handler = stub.handled.get(LOBBY_LEAVE_CHANNEL);
        expect(handler).toBeDefined();
        await Promise.resolve(handler?.({}));
        expect(spy).toHaveBeenCalledOnce();
    });

    it('registers chimera:lobby:start-game as an invoke handler that calls lobbyManager.startGame', async () => {
        const stub = makeLobbyIpcMainStub();
        const lobbyManager = makeLobbyManagerStub();
        const spy = vi.spyOn(lobbyManager, 'startGame').mockResolvedValue(undefined);
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager });

        const handler = stub.handled.get(LOBBY_START_GAME_CHANNEL);
        expect(handler).toBeDefined();

        await Promise.resolve(handler?.({}));
        expect(spy).toHaveBeenCalledOnce();
    });

    it('registers chimera:lobby:get-local-player-id as an invoke handler that calls lobbyManager.getLocalPlayerId', async () => {
        const stub = makeLobbyIpcMainStub();
        const lobbyManager = makeLobbyManagerStub();
        const spy = vi
            .spyOn(lobbyManager, 'getLocalPlayerId')
            .mockReturnValue(toPlayerId('player-2'));
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager });

        const handler = stub.handled.get(LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL);
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.({}))).resolves.toBe('player-2');
        expect(spy).toHaveBeenCalledOnce();
    });

    it('registers chimera:lobby:get-current-state as an invoke handler that calls lobbyManager.getCurrentState', async () => {
        const stub = makeLobbyIpcMainStub();
        const lobbyManager = makeLobbyManagerStub();
        const currentState: LobbyState = {
            info: { sessionId: 'sess-1', hostId: toPlayerId('player-1'), gameId: 'tactics' },
            players: [{ playerId: toPlayerId('player-1'), displayName: 'Host', ready: true }],
        };
        const spy = vi.spyOn(lobbyManager, 'getCurrentState').mockReturnValue(currentState);
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager });

        const handler = stub.handled.get(LOBBY_GET_CURRENT_STATE_CHANNEL);
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.({}))).resolves.toBe(currentState);
        expect(spy).toHaveBeenCalledOnce();
    });

    it('registers chimera:lobby:update-ready-state as an invoke handler that calls lobbyManager.updatePlayerReadyState', async () => {
        const stub = makeLobbyIpcMainStub();
        const lobbyManager = makeLobbyManagerStub();
        const spy = vi.spyOn(lobbyManager, 'updatePlayerReadyState').mockResolvedValue(undefined);
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager });

        const handler = stub.handled.get(LOBBY_UPDATE_READY_STATE_CHANNEL);
        expect(handler).toBeDefined();

        await Promise.resolve(handler?.({}, true));
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith(true);
    });

    it('rejects invalid update-ready-state payloads with IpcRequestValidationError', async () => {
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager: makeLobbyManagerStub() });

        const handler = stub.handled.get(LOBBY_UPDATE_READY_STATE_CHANNEL);
        expect(handler).toBeDefined();

        expect(() => handler?.({}, 'yes')).toThrow(IpcRequestValidationError);
    });

    it('rejects when lobbyManager.closeLobby throws', async () => {
        const stub = makeLobbyIpcMainStub();
        const lobbyManager = makeLobbyManagerStub();
        const error = new Error('WebSocket in CLOSING state');
        vi.spyOn(lobbyManager, 'closeLobby').mockRejectedValue(error);
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager });

        const handler = stub.handled.get(LOBBY_LEAVE_CHANNEL);
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.({}))).rejects.toThrow('WebSocket in CLOSING state');
    });

    it('registers exactly the lobby request channels (update is push-only, not registered here)', () => {
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager: makeLobbyManagerStub() });

        // `chimera:lobby:update` is a one-way push from main → renderer via
        // `webContents.send`. It must NOT appear as a main-side listener or
        // invoke handler.
        expect([...stub.handled.keys()].sort()).toEqual(
            [
                LOBBY_HOST_CHANNEL,
                LOBBY_GET_CURRENT_STATE_CHANNEL,
                LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL,
                LOBBY_JOIN_CHANNEL,
                LOBBY_LEAVE_CHANNEL,
                LOBBY_START_GAME_CHANNEL,
                LOBBY_UPDATE_READY_STATE_CHANNEL,
            ].sort(),
        );
        expect(stub.handled.has(LOBBY_UPDATE_CHANNEL)).toBe(false);
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

/**
 * Minimal `SavesIpcPort` whose every method is a no-op stub that resolves
 * with the canonical empty result.  Used by tests that exercise channel
 * registration and Zod validation without modelling a real save flow.
 */
function makeNoopSavesPort(): SavesIpcPort {
    return {
        list: () => Promise.resolve([]),
        save: () =>
            Promise.resolve({
                slotId: toSlotId(''),
                gameId: '',
                tick: 0,
                savedAt: 0,
            } satisfies SaveSlotMeta),
        load: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        checkCrashRecovery: () => Promise.resolve({ needsRecovery: false, slotId: null }),
    };
}

describe('registerSavesHandlers', () => {
    it('registers chimera:saves:list as an invoke handler delegating to the port', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: makeNoopSavesPort() });

        const handler = stub.handled.get(SAVES_LIST_CHANNEL);
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.({}, 'sample-game'))).resolves.toEqual([]);
    });

    it('registers chimera:saves:save as an invoke handler accepting a SaveRequest', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: makeNoopSavesPort() });

        const handler = stub.handled.get(SAVES_SAVE_CHANNEL);
        expect(handler).toBeDefined();

        const request: SaveRequest = { gameId: 'sample-game', label: 'autosave' };
        const result = await Promise.resolve(handler?.({}, request));
        expect(result).toBeDefined();
    });

    it('registers chimera:saves:load as an invoke handler resolving to undefined', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: makeNoopSavesPort() });

        const handler = stub.handled.get(SAVES_LOAD_CHANNEL);
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.({}, 'sample-game/slot-a'))).resolves.toBeUndefined();
    });

    it('registers chimera:saves:delete as an invoke handler resolving to undefined', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: makeNoopSavesPort() });

        const handler = stub.handled.get(SAVES_DELETE_CHANNEL);
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.({}, 'sample-game/slot-a'))).resolves.toBeUndefined();
    });

    it('registers exactly the saves request channels (slot-update is push-only, not registered here)', () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: makeNoopSavesPort() });

        // `chimera:saves:slot-update` is a one-way push from main → renderer
        // via `webContents.send`. It must NOT appear as an invoke handler.
        expect([...stub.handled.keys()].sort()).toEqual(
            [
                SAVES_DELETE_CHANNEL,
                SAVES_LIST_CHANNEL,
                SAVES_LOAD_CHANNEL,
                SAVES_SAVE_CHANNEL,
                SAVES_CHECK_CRASH_RECOVERY_CHANNEL,
            ].sort(),
        );
        expect(stub.handled.has(SAVES_SLOT_UPDATE_CHANNEL)).toBe(false);
    });

    it('registers chimera:saves:check-crash-recovery delegating to the port', async () => {
        const stub = makeSavesIpcMainStub();
        const port: SavesIpcPort = {
            ...makeNoopSavesPort(),
            checkCrashRecovery: () =>
                Promise.resolve({ needsRecovery: true, slotId: toSlotId('tactics/autosave') }),
        };
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: port });

        const handler = stub.handled.get(SAVES_CHECK_CRASH_RECOVERY_CHANNEL);
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.({}))).resolves.toEqual({
            needsRecovery: true,
            slotId: 'tactics/autosave',
        });
    });

    describe('with injected SavesIpcPort', () => {
        const sampleMeta: SaveSlotMeta = {
            slotId: toSlotId('sample-game/slot-1'),
            gameId: 'sample-game',
            tick: 42,
            savedAt: 1_700_000_000_000,
            label: 'autosave',
        };
        const refreshedMeta: SaveSlotMeta = {
            slotId: toSlotId('sample-game/slot-2'),
            gameId: 'sample-game',
            tick: 50,
            savedAt: 1_700_000_001_000,
        };

        function makeFakePort(overrides?: Partial<SavesIpcPort>): {
            readonly port: SavesIpcPort;
            readonly listCalls: string[];
            readonly saveCalls: SaveRequest[];
            readonly loadCalls: string[];
            readonly deleteCalls: string[];
            // Mutable so individual tests can swap the post-mutation list.
            slotsByGameId: Map<string, SaveSlotMeta[]>;
        } {
            const listCalls: string[] = [];
            const saveCalls: SaveRequest[] = [];
            const loadCalls: string[] = [];
            const deleteCalls: string[] = [];
            const slotsByGameId = new Map<string, SaveSlotMeta[]>([['sample-game', [sampleMeta]]]);
            const port: SavesIpcPort = {
                list: (gameId) => {
                    listCalls.push(gameId);
                    return Promise.resolve(slotsByGameId.get(gameId) ?? []);
                },
                save: (request) => {
                    saveCalls.push(request);
                    return Promise.resolve(sampleMeta);
                },
                load: (slotId) => {
                    loadCalls.push(slotId);
                    return Promise.resolve();
                },
                delete: (slotId) => {
                    deleteCalls.push(slotId);
                    return Promise.resolve();
                },
                checkCrashRecovery: () => Promise.resolve({ needsRecovery: false, slotId: null }),
                ...overrides,
            };
            return { port, listCalls, saveCalls, loadCalls, deleteCalls, slotsByGameId };
        }

        it('list delegates to port and returns its SaveSlotMeta[]', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            registerSavesHandlers({ ipcMain: stub.ipcMain, saves: fake.port });

            const handler = stub.handled.get(SAVES_LIST_CHANNEL);
            const result = await Promise.resolve(handler?.({}, 'sample-game'));

            expect(result).toEqual([sampleMeta]);
            expect(fake.listCalls).toEqual(['sample-game']);
        });

        it('save delegates to port, then broadcasts slot-update with refreshed list', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            const broadcasts: { gameId: string; slots: SaveSlotMeta[] }[] = [];
            registerSavesHandlers({
                ipcMain: stub.ipcMain,
                saves: fake.port,
                broadcastSlotsChanged: (gameId, slots) => {
                    broadcasts.push({ gameId, slots });
                },
            });

            // Simulate that after the save completes, the port returns a
            // longer slot list when re-queried (refreshed view).
            fake.slotsByGameId.set('sample-game', [sampleMeta, refreshedMeta]);

            const request: SaveRequest = { gameId: 'sample-game', label: 'autosave' };
            const handler = stub.handled.get(SAVES_SAVE_CHANNEL);
            const result = await Promise.resolve(handler?.({}, request));

            expect(result).toEqual(sampleMeta);
            expect(fake.saveCalls).toEqual([request]);
            expect(fake.listCalls).toEqual(['sample-game']);
            expect(broadcasts).toEqual([
                { gameId: 'sample-game', slots: [sampleMeta, refreshedMeta] },
            ]);
        });

        it('save records last saved slot and tick on the E2E hooks after a successful save', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            const e2eHooks = {
                lastSavedSlotId: null as string | null,
                lastSavedTick: null as number | null,
            };
            registerSavesHandlers({ ipcMain: stub.ipcMain, saves: fake.port, e2eHooks });

            const handler = stub.handled.get(SAVES_SAVE_CHANNEL);
            await Promise.resolve(handler?.({}, { gameId: 'sample-game' }));

            expect(e2eHooks.lastSavedSlotId).toBe('sample-game/slot-1');
            expect(e2eHooks.lastSavedTick).toBe(42);
        });

        it('load delegates to port and resolves to undefined', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            registerSavesHandlers({ ipcMain: stub.ipcMain, saves: fake.port });

            const handler = stub.handled.get(SAVES_LOAD_CHANNEL);
            const result = await Promise.resolve(handler?.({}, 'sample-game/slot-1'));

            expect(result).toBeUndefined();
            expect(fake.loadCalls).toEqual(['sample-game/slot-1']);
        });

        it('delete delegates to port, then broadcasts slot-update with refreshed list', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            const broadcasts: { gameId: string; slots: SaveSlotMeta[] }[] = [];
            registerSavesHandlers({
                ipcMain: stub.ipcMain,
                saves: fake.port,
                broadcastSlotsChanged: (gameId, slots) => {
                    broadcasts.push({ gameId, slots });
                },
            });

            // After delete, the slot list is empty for that game.
            fake.slotsByGameId.set('sample-game', []);

            const handler = stub.handled.get(SAVES_DELETE_CHANNEL);
            const result = await Promise.resolve(handler?.({}, 'sample-game/slot-1'));

            expect(result).toBeUndefined();
            expect(fake.deleteCalls).toEqual(['sample-game/slot-1']);
            // gameId for refresh is parsed from the qualified slotId prefix.
            expect(fake.listCalls).toEqual(['sample-game']);
            expect(broadcasts).toEqual([{ gameId: 'sample-game', slots: [] }]);
        });

        it('rejects invalid list input before calling the port', () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            registerSavesHandlers({ ipcMain: stub.ipcMain, saves: fake.port });

            const handler = stub.handled.get(SAVES_LIST_CHANNEL);
            expect(() => handler?.({}, '')).toThrow(IpcRequestValidationError);
            expect(fake.listCalls).toEqual([]);
        });

        it('rejects invalid save input before calling the port', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            registerSavesHandlers({ ipcMain: stub.ipcMain, saves: fake.port });

            const handler = stub.handled.get(SAVES_SAVE_CHANNEL);
            await expect(Promise.resolve(handler?.({}, { gameId: '' }))).rejects.toThrow(
                IpcRequestValidationError,
            );
            expect(fake.saveCalls).toEqual([]);
            expect(fake.listCalls).toEqual([]);
        });

        it('rejects invalid load input before calling the port', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            registerSavesHandlers({ ipcMain: stub.ipcMain, saves: fake.port });

            const handler = stub.handled.get(SAVES_LOAD_CHANNEL);
            await expect(Promise.resolve(handler?.({}, ''))).rejects.toThrow(
                IpcRequestValidationError,
            );
            expect(fake.loadCalls).toEqual([]);
        });

        it('rejects invalid delete input before calling the port', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            registerSavesHandlers({ ipcMain: stub.ipcMain, saves: fake.port });

            const handler = stub.handled.get(SAVES_DELETE_CHANNEL);
            await expect(Promise.resolve(handler?.({}, ''))).rejects.toThrow(
                IpcRequestValidationError,
            );
            expect(fake.deleteCalls).toEqual([]);
            expect(fake.listCalls).toEqual([]);
        });

        it('does not broadcast on save when broadcastSlotsChanged is absent', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort();
            registerSavesHandlers({ ipcMain: stub.ipcMain, saves: fake.port });

            const request: SaveRequest = { gameId: 'sample-game' };
            const handler = stub.handled.get(SAVES_SAVE_CHANNEL);
            await Promise.resolve(handler?.({}, request));

            // The port still receives the save call, but no slot list refresh
            // is performed when there is no broadcast subscriber to inform.
            expect(fake.saveCalls).toEqual([request]);
            expect(fake.listCalls).toEqual([]);
        });

        it('save resolves with meta even when post-save list() throws', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort({
                list: () => Promise.reject(new Error('list failure')),
            });
            const broadcasts: unknown[] = [];
            registerSavesHandlers({
                ipcMain: stub.ipcMain,
                saves: fake.port,
                broadcastSlotsChanged: (_, slots) => {
                    broadcasts.push(slots);
                },
            });

            const request: SaveRequest = { gameId: 'sample-game' };
            const handler = stub.handled.get(SAVES_SAVE_CHANNEL);
            const result = await Promise.resolve(handler?.({}, request));

            // Handler resolves with the saved meta — the failed list/broadcast
            // must not surface as a rejection to the renderer.
            expect(result).toEqual(sampleMeta);
            expect(broadcasts).toEqual([]);
        });

        it('delete resolves even when post-delete list() throws', async () => {
            const stub = makeSavesIpcMainStub();
            const fake = makeFakePort({
                list: () => Promise.reject(new Error('list failure')),
            });
            const broadcasts: unknown[] = [];
            registerSavesHandlers({
                ipcMain: stub.ipcMain,
                saves: fake.port,
                broadcastSlotsChanged: (_, slots) => {
                    broadcasts.push(slots);
                },
            });

            const handler = stub.handled.get(SAVES_DELETE_CHANNEL);
            const result = await Promise.resolve(handler?.({}, 'sample-game/slot-1'));

            // Handler resolves to undefined — the failed list/broadcast must
            // not surface as a rejection to the renderer.
            expect(result).toBeUndefined();
            expect(broadcasts).toEqual([]);
        });
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
        const { SettingsManager } = await import('../settings/SettingsManager.js');
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
                bindings: z.record(
                    z.string(),
                    z.object({
                        primary: z.string(),
                        secondary: z.string().optional(),
                        modifiers: z.array(z.enum(['Ctrl', 'Shift', 'Alt', 'Meta'])).optional(),
                    }),
                ),
            }),
        });

        const mgr = new SettingsManager(new InMemorySettingsRepository());
        mgr.registerSchema({
            gameId: 'wired-game',
            defaults: ENGINE_DEFAULTS,
            schema: engineSchema,
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
        const { SettingsManager } = await import('../settings/SettingsManager.js');
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
                bindings: z.record(
                    z.string(),
                    z.object({
                        primary: z.string(),
                        secondary: z.string().optional(),
                        modifiers: z.array(z.enum(['Ctrl', 'Shift', 'Alt', 'Meta'])).optional(),
                    }),
                ),
            }),
        });

        const mgr = new SettingsManager(new InMemorySettingsRepository());
        mgr.registerSchema({
            gameId: 'wired-game',
            defaults: ENGINE_DEFAULTS,
            schema: engineSchema,
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
        const { SettingsManager } = await import('../settings/SettingsManager.js');
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
                bindings: z.record(
                    z.string(),
                    z.object({
                        primary: z.string(),
                        secondary: z.string().optional(),
                        modifiers: z.array(z.enum(['Ctrl', 'Shift', 'Alt', 'Meta'])).optional(),
                    }),
                ),
            }),
        });

        const repo = new InMemorySettingsRepository();
        await repo.save('wired-game', { audio: { masterVolume: 0.1 } });
        const mgr = new SettingsManager(repo);
        mgr.registerSchema({
            gameId: 'wired-game',
            defaults: ENGINE_DEFAULTS,
            schema: engineSchema,
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

    it('chimera:lobby:host rejects a malformed HostLobbyParams', async () => {
        const stub = makeLobbyIpcMainStub();
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager: makeLobbyManagerStub() });
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
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager: makeLobbyManagerStub() });
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
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: makeNoopSavesPort() });
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
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: makeNoopSavesPort() });
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
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: makeNoopSavesPort() });
        const loadHandler = stub.handled.get(SAVES_LOAD_CHANNEL);
        const deleteHandler = stub.handled.get(SAVES_DELETE_CHANNEL);

        await expect(Promise.resolve().then(() => loadHandler?.({}, ''))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
        await expect(Promise.resolve().then(() => deleteHandler?.({}, ''))).rejects.toBeInstanceOf(
            IpcRequestValidationError,
        );
    });

    it('chimera:saves:load and chimera:saves:delete reject a bare (unqualified) slotId', async () => {
        const stub = makeSavesIpcMainStub();
        registerSavesHandlers({ ipcMain: stub.ipcMain, saves: makeNoopSavesPort() });
        const loadHandler = stub.handled.get(SAVES_LOAD_CHANNEL);
        const deleteHandler = stub.handled.get(SAVES_DELETE_CHANNEL);

        // A slot ID without the '<gameId>/' prefix must be rejected at the IPC
        // boundary by SlotIdSchema, not silently degrade to "no broadcast".
        await expect(
            Promise.resolve().then(() => loadHandler?.({}, 'autosave')),
        ).rejects.toBeInstanceOf(IpcRequestValidationError);
        await expect(
            Promise.resolve().then(() => deleteHandler?.({}, 'autosave')),
        ).rejects.toBeInstanceOf(IpcRequestValidationError);
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
        registerLobbyHandlers({ ipcMain: stub.ipcMain, lobbyManager: makeLobbyManagerStub() });
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
        const { SettingsManager } = await import('../settings/SettingsManager.js');
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
                bindings: z.record(
                    z.string(),
                    z.object({
                        primary: z.string(),
                        secondary: z.string().optional(),
                        modifiers: z.array(z.enum(['Ctrl', 'Shift', 'Alt', 'Meta'])).optional(),
                    }),
                ),
            }),
        });

        const repo = new InMemorySettingsRepository();
        const mgr = new SettingsManager(repo);
        mgr.registerSchema({
            gameId: 'block4-game',
            defaults: (await import('@chimera/simulation/settings/index.js')).ENGINE_DEFAULTS,
            schema: engineSchema,
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
        const { SettingsManager } = await import('../settings/SettingsManager.js');
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
                bindings: z.record(
                    z.string(),
                    z.object({
                        primary: z.string(),
                        secondary: z.string().optional(),
                        modifiers: z.array(z.enum(['Ctrl', 'Shift', 'Alt', 'Meta'])).optional(),
                    }),
                ),
            }),
        });

        const mgr = new SettingsManager(new InMemorySettingsRepository());
        mgr.registerSchema({
            gameId: 'block4-game',
            defaults: ENGINE_DEFAULTS,
            schema: engineSchema,
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
import type { MemorySink } from '../logging/logger.js';

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

// ── Profile handler tests (§4.24 — F14-T08) ───────────────────────────────────

/**
 * Fixture: a valid PlayerProfile for use in profile handler tests.
 */
function makeProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
    return {
        localProfileId: 'local-1',
        displayName: 'Alice',
        avatar: { kind: 'builtin', ref: buildAssetRef<TextureAsset>('avatar', 'default') },
        locale: 'en-US',
        ...overrides,
    };
}

/**
 * Recording stub for the narrow `ProfileHandlersIpcMain` slice. The profile
 * namespace uses `handle` exclusively — every request is an invoke-style
 * round-trip so the renderer can surface failures.
 */
function makeProfileIpcMainStub(): {
    readonly ipcMain: ProfileHandlersIpcMain;
    readonly handled: Map<string, ProfileInvokeHandler>;
} {
    const handled = new Map<string, ProfileInvokeHandler>();

    const ipcMain: ProfileHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
    };

    return { ipcMain, handled };
}

describe('registerProfileHandlers', () => {
    it('registers exactly the profile request channels (directory-changed is push-only)', () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        // `chimera:profile:directory-changed` is a one-way push from main →
        // renderer via `webContents.send`. It must NOT appear as an invoke
        // handler.
        expect([...stub.handled.keys()].sort()).toEqual(
            [
                PROFILE_GET_LOCAL_CHANNEL,
                PROFILE_UPDATE_LOCAL_CHANNEL,
                PROFILE_GET_LOBBY_DIRECTORY_CHANNEL,
                PROFILE_LIST_LOCAL_SLOTS_CHANNEL,
                PROFILE_SWITCH_SLOT_CHANNEL,
            ].sort(),
        );
        expect(stub.handled.has(PROFILE_DIRECTORY_CHANGED_CHANNEL)).toBe(false);
    });

    it('chimera:profile:get-local resolves to a stub profile when no profileManager provided', async () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(PROFILE_GET_LOCAL_CHANNEL);
        expect(handler).toBeDefined();

        const result = await Promise.resolve(handler?.({}));
        // Stub must return an object with the required PlayerProfile shape
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
        const profile = result as PlayerProfile;
        expect(typeof profile.localProfileId).toBe('string');
        expect(typeof profile.displayName).toBe('string');
        expect(profile.avatar).toBeDefined();
        expect(typeof profile.locale).toBe('string');
    });

    it('chimera:profile:get-local returns profileManager.currentAttestation() when manager provided', async () => {
        const stub = makeProfileIpcMainStub();
        const expectedProfile = makeProfile({ displayName: 'Bob' });
        const profileManager = {
            currentAttestation: vi.fn<() => PlayerProfile>().mockReturnValue(expectedProfile),
            updateLocal: vi
                .fn<(patch: Partial<PlayerProfile>) => PlayerProfile>()
                .mockReturnValue(expectedProfile),
            listLocalSlots: vi.fn(async () => []),
            switchLocalSlot: vi.fn(async () => expectedProfile),
        };
        registerProfileHandlers({ ipcMain: stub.ipcMain, profileManager });

        const handler = stub.handled.get(PROFILE_GET_LOCAL_CHANNEL);
        expect(handler).toBeDefined();

        const result = await Promise.resolve(handler?.({}));
        expect(result).toStrictEqual(expectedProfile);
        expect(profileManager.currentAttestation).toHaveBeenCalledOnce();
    });

    it('chimera:profile:update-local validates patch and calls profileManager.updateLocal', async () => {
        const stub = makeProfileIpcMainStub();
        const profileManager = {
            currentAttestation: vi.fn<() => PlayerProfile>().mockReturnValue(makeProfile()),
            updateLocal: vi
                .fn<(patch: Partial<PlayerProfile>) => PlayerProfile>()
                .mockReturnValue(makeProfile({ displayName: 'Charlie' })),
            listLocalSlots: vi.fn(async () => []),
            switchLocalSlot: vi.fn(async () => makeProfile()),
        };
        registerProfileHandlers({ ipcMain: stub.ipcMain, profileManager });

        const handler = stub.handled.get(PROFILE_UPDATE_LOCAL_CHANNEL);
        expect(handler).toBeDefined();

        const patch = { displayName: 'Charlie' };
        await Promise.resolve(handler?.({}, patch));

        expect(profileManager.updateLocal).toHaveBeenCalledOnce();
        expect(profileManager.updateLocal).toHaveBeenCalledWith(patch);
    });

    it('chimera:profile:update-local resolves to undefined (Promise<void>)', async () => {
        const stub = makeProfileIpcMainStub();
        const profileManager = {
            currentAttestation: vi.fn<() => PlayerProfile>().mockReturnValue(makeProfile()),
            updateLocal: vi
                .fn<(patch: Partial<PlayerProfile>) => PlayerProfile>()
                .mockReturnValue(makeProfile()),
            listLocalSlots: vi.fn(async () => []),
            switchLocalSlot: vi.fn(async () => makeProfile()),
        };
        registerProfileHandlers({ ipcMain: stub.ipcMain, profileManager });

        const handler = stub.handled.get(PROFILE_UPDATE_LOCAL_CHANNEL);
        const result = await Promise.resolve(handler?.({}, { displayName: 'Dave' }));
        expect(result).toBeUndefined();
    });

    it('chimera:profile:update-local rejects with IpcRequestValidationError on invalid patch', async () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(PROFILE_UPDATE_LOCAL_CHANNEL);
        expect(handler).toBeDefined();

        // `localProfileId` is not in the patch schema (immutable primary key)
        expect(() => handler?.({}, { localProfileId: 'should-be-rejected' })).toThrow(
            IpcRequestValidationError,
        );
    });

    it('chimera:profile:update-local rejects with IpcRequestValidationError when patch is not an object', async () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(PROFILE_UPDATE_LOCAL_CHANNEL);
        expect(() => handler?.({}, 'not-a-patch')).toThrow(IpcRequestValidationError);
    });

    it('chimera:profile:get-lobby-directory returns empty record when no playerDirectory provided', async () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(PROFILE_GET_LOBBY_DIRECTORY_CHANNEL);
        expect(handler).toBeDefined();

        const result = await Promise.resolve(handler?.({}));
        expect(result).toStrictEqual({});
    });

    it('chimera:profile:get-lobby-directory returns playerDirectory.snapshot() when directory provided', async () => {
        const stub = makeProfileIpcMainStub();
        const directory = { p1: makeProfile({ displayName: 'Host' }) };
        const playerDirectory = {
            snapshot: vi
                .fn<() => Readonly<Record<string, PlayerProfile>>>()
                .mockReturnValue(directory),
        };
        registerProfileHandlers({ ipcMain: stub.ipcMain, playerDirectory });

        const handler = stub.handled.get(PROFILE_GET_LOBBY_DIRECTORY_CHANNEL);
        expect(handler).toBeDefined();

        const result = await Promise.resolve(handler?.({}));
        expect(result).toStrictEqual(directory);
        expect(playerDirectory.snapshot).toHaveBeenCalledOnce();
    });

    it('chimera:profile:update-local is a no-op when no profileManager provided (resolves undefined)', async () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(PROFILE_UPDATE_LOCAL_CHANNEL);
        expect(handler).toBeDefined();

        const result = await Promise.resolve(handler?.({}, { displayName: 'Eve' }));
        expect(result).toBeUndefined();
    });

    it('chimera:profile:list-local-slots returns empty array when no profileManager provided', async () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(PROFILE_LIST_LOCAL_SLOTS_CHANNEL);
        expect(handler).toBeDefined();

        const result = await Promise.resolve(handler?.({}));
        expect(result).toStrictEqual([]);
    });

    it('chimera:profile:list-local-slots returns profileManager.listLocalSlots() when manager provided', async () => {
        const stub = makeProfileIpcMainStub();
        const slots = [
            { localProfileId: 'local-a', displayName: 'Alice' },
            { localProfileId: 'local-b', displayName: 'Bob' },
        ];
        const profileManager = {
            currentAttestation: vi.fn<() => PlayerProfile>().mockReturnValue(makeProfile()),
            updateLocal: vi
                .fn<(patch: Partial<PlayerProfile>) => PlayerProfile>()
                .mockReturnValue(makeProfile()),
            listLocalSlots: vi.fn(async () => slots),
            switchLocalSlot: vi.fn(async () => makeProfile()),
        };
        registerProfileHandlers({ ipcMain: stub.ipcMain, profileManager });

        const handler = stub.handled.get(PROFILE_LIST_LOCAL_SLOTS_CHANNEL);
        expect(handler).toBeDefined();

        const result = await Promise.resolve(handler?.({}));
        expect(result).toStrictEqual(slots);
        expect(profileManager.listLocalSlots).toHaveBeenCalledOnce();
    });

    it('chimera:profile:switch-slot registers an invoke handler', () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        expect(stub.handled.has(PROFILE_SWITCH_SLOT_CHANNEL)).toBe(true);
    });

    it('chimera:profile:switch-slot calls profileManager.switchLocalSlot with the provided id', async () => {
        const stub = makeProfileIpcMainStub();
        const expected = makeProfile({ displayName: 'Bob' });
        const profileManager = {
            currentAttestation: vi.fn<() => PlayerProfile>().mockReturnValue(expected),
            updateLocal: vi
                .fn<(patch: Partial<PlayerProfile>) => PlayerProfile>()
                .mockReturnValue(expected),
            listLocalSlots: vi.fn(async () => []),
            switchLocalSlot: vi.fn(async (_id: string) => expected),
        };
        registerProfileHandlers({ ipcMain: stub.ipcMain, profileManager });

        const handler = stub.handled.get(PROFILE_SWITCH_SLOT_CHANNEL);
        expect(handler).toBeDefined();

        await Promise.resolve(handler?.({}, { localProfileId: 'local-b' }));

        expect(profileManager.switchLocalSlot).toHaveBeenCalledOnce();
        expect(profileManager.switchLocalSlot).toHaveBeenCalledWith('local-b');
    });

    it('chimera:profile:switch-slot rejects with IpcRequestValidationError when localProfileId is missing', () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(PROFILE_SWITCH_SLOT_CHANNEL);
        expect(handler).toBeDefined();

        expect(() => handler?.({}, {})).toThrow(IpcRequestValidationError);
    });

    it('chimera:profile:switch-slot rejects with IpcRequestValidationError when localProfileId is empty', () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(PROFILE_SWITCH_SLOT_CHANNEL);

        expect(() => handler?.({}, { localProfileId: '' })).toThrow(IpcRequestValidationError);
    });

    it('chimera:profile:switch-slot is a no-op when no profileManager is provided', async () => {
        const stub = makeProfileIpcMainStub();
        registerProfileHandlers({ ipcMain: stub.ipcMain });

        const handler = stub.handled.get(PROFILE_SWITCH_SLOT_CHANNEL);
        const result = await Promise.resolve(handler?.({}, { localProfileId: 'local-a' }));

        expect(result).toBeUndefined();
    });
});

// ─── Replay namespace (§4.28, F44 / T5, #659) ────────────────────────────────

function makeReplayIpcMainStub(): {
    readonly ipcMain: ReplayHandlersIpcMain;
    readonly handled: Map<string, ReplayInvokeHandler>;
} {
    const handled = new Map<string, ReplayInvokeHandler>();
    const ipcMain: ReplayHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
    };
    return { ipcMain, handled };
}

function makeReplayItem(path: string): ReplayListItem {
    return {
        path,
        gameId: 'tactics',
        gameVersion: '0.1.0',
        engineVersion: '0.1.0',
        recordedAt: '2026-06-02T10:00:00.000Z',
        durationTicks: 9,
        playerIds: ['p1', 'p2'],
    };
}

/** Minimal `ReplayIpcPort` whose methods resolve with canonical empty results. */
function makeNoopReplayPort(): ReplayIpcPort {
    return {
        listItems: () => Promise.resolve([]),
        delete: () => Promise.resolve(),
    };
}

const REPLAY_DIR = nodePath.resolve('/var/userData/replays');

function registerReplay(overrides: {
    ipcMain: ReplayHandlersIpcMain;
    replay?: ReplayIpcPort;
    exportCurrentMatch?: () => Promise<string>;
    navigateToPlayer?: (path: string) => void;
    replayDir?: string;
}): void {
    registerReplayHandlers({
        ipcMain: overrides.ipcMain,
        replay: overrides.replay ?? makeNoopReplayPort(),
        replayDir: overrides.replayDir ?? REPLAY_DIR,
        exportCurrentMatch:
            overrides.exportCurrentMatch ??
            (() => Promise.resolve(nodePath.join(REPLAY_DIR, 'tactics', 'abc.chimera-replay'))),
        navigateToPlayer: overrides.navigateToPlayer ?? (() => undefined),
    });
}

describe('registerReplayHandlers', () => {
    it('registers exactly the four invoke channels (navigate is push-only)', () => {
        const stub = makeReplayIpcMainStub();
        registerReplay({ ipcMain: stub.ipcMain });

        expect([...stub.handled.keys()].sort()).toEqual(
            [
                REPLAY_LIST_CHANNEL,
                REPLAY_EXPORT_CURRENT_MATCH_CHANNEL,
                REPLAY_OPEN_IN_PLAYER_CHANNEL,
                REPLAY_DELETE_CHANNEL,
            ].sort(),
        );
        expect(stub.handled.has(REPLAY_NAVIGATE_CHANNEL)).toBe(false);
    });

    describe('chimera:replay:list', () => {
        it('validates the gameId and delegates to replay.listItems', async () => {
            const stub = makeReplayIpcMainStub();
            const items = [
                makeReplayItem(nodePath.join(REPLAY_DIR, 'tactics', 'a.chimera-replay')),
            ];
            registerReplay({
                ipcMain: stub.ipcMain,
                replay: { ...makeNoopReplayPort(), listItems: () => Promise.resolve(items) },
            });

            const handler = stub.handled.get(REPLAY_LIST_CHANNEL);
            await expect(Promise.resolve(handler?.({}, 'tactics'))).resolves.toStrictEqual(items);
        });

        it('rejects a malformed gameId before touching the port', () => {
            const stub = makeReplayIpcMainStub();
            const listItems = vi.fn(() => Promise.resolve([] as ReplayListItem[]));
            registerReplay({
                ipcMain: stub.ipcMain,
                replay: { ...makeNoopReplayPort(), listItems },
            });

            const handler = stub.handled.get(REPLAY_LIST_CHANNEL);
            expect(() => handler?.({}, '')).toThrow(IpcRequestValidationError);
            expect(listItems).not.toHaveBeenCalled();
        });
    });

    describe('chimera:replay:export-current-match', () => {
        it('delegates to exportCurrentMatch and resolves with the saved path', async () => {
            const stub = makeReplayIpcMainStub();
            const saved = nodePath.join(REPLAY_DIR, 'tactics', 'saved.chimera-replay');
            registerReplay({
                ipcMain: stub.ipcMain,
                exportCurrentMatch: () => Promise.resolve(saved),
            });

            const handler = stub.handled.get(REPLAY_EXPORT_CURRENT_MATCH_CHANNEL);
            await expect(Promise.resolve(handler?.({}))).resolves.toBe(saved);
        });

        it('rejects when there is no active hosted session', async () => {
            const stub = makeReplayIpcMainStub();
            registerReplay({
                ipcMain: stub.ipcMain,
                exportCurrentMatch: () => Promise.reject(new Error('no active hosted session')),
            });

            const handler = stub.handled.get(REPLAY_EXPORT_CURRENT_MATCH_CHANNEL);
            await expect(Promise.resolve(handler?.({}))).rejects.toThrow(
                /no active hosted session/,
            );
        });
    });

    describe('chimera:replay:open-in-player', () => {
        it('validates the path is inside the replay dir, then navigates the renderer', () => {
            const stub = makeReplayIpcMainStub();
            const navigateToPlayer = vi.fn<(path: string) => void>();
            registerReplay({ ipcMain: stub.ipcMain, navigateToPlayer });

            const target = nodePath.join(REPLAY_DIR, 'tactics', 'abc.chimera-replay');
            const handler = stub.handled.get(REPLAY_OPEN_IN_PLAYER_CHANNEL);
            handler?.({}, target);

            expect(navigateToPlayer).toHaveBeenCalledOnce();
            expect(navigateToPlayer).toHaveBeenCalledWith(target);
        });

        it('rejects a path that escapes the replay dir and never navigates', () => {
            const stub = makeReplayIpcMainStub();
            const navigateToPlayer = vi.fn<(path: string) => void>();
            registerReplay({ ipcMain: stub.ipcMain, navigateToPlayer });

            const traversal = nodePath.join(REPLAY_DIR, '..', '..', 'etc', 'passwd');
            const handler = stub.handled.get(REPLAY_OPEN_IN_PLAYER_CHANNEL);

            expect(() => handler?.({}, traversal)).toThrow();
            expect(navigateToPlayer).not.toHaveBeenCalled();
        });

        it('rejects a malformed (empty) path argument', () => {
            const stub = makeReplayIpcMainStub();
            registerReplay({ ipcMain: stub.ipcMain });

            const handler = stub.handled.get(REPLAY_OPEN_IN_PLAYER_CHANNEL);
            expect(() => handler?.({}, '')).toThrow(IpcRequestValidationError);
        });
    });

    describe('chimera:replay:delete', () => {
        it('validates the path and delegates to replay.delete', async () => {
            const stub = makeReplayIpcMainStub();
            const target = nodePath.join(REPLAY_DIR, 'tactics', 'abc.chimera-replay');
            const del = vi.fn((_path: string) => Promise.resolve());
            registerReplay({
                ipcMain: stub.ipcMain,
                replay: { ...makeNoopReplayPort(), delete: del },
            });

            const handler = stub.handled.get(REPLAY_DELETE_CHANNEL);
            await expect(Promise.resolve(handler?.({}, target))).resolves.toBeUndefined();
            expect(del).toHaveBeenCalledWith(target);
        });

        it('rejects a malformed (empty) path before touching the port', () => {
            const stub = makeReplayIpcMainStub();
            const del = vi.fn((_path: string) => Promise.resolve());
            registerReplay({
                ipcMain: stub.ipcMain,
                replay: { ...makeNoopReplayPort(), delete: del },
            });

            const handler = stub.handled.get(REPLAY_DELETE_CHANNEL);
            expect(() => handler?.({}, '')).toThrow(IpcRequestValidationError);
            expect(del).not.toHaveBeenCalled();
        });

        it('rejects a path that escapes the replay dir at the IPC layer (never reaches the port)', () => {
            const stub = makeReplayIpcMainStub();
            const del = vi.fn((_path: string) => Promise.resolve());
            registerReplay({
                ipcMain: stub.ipcMain,
                replay: { ...makeNoopReplayPort(), delete: del },
            });

            const traversal = nodePath.join(REPLAY_DIR, '..', '..', 'etc', 'passwd');
            const handler = stub.handled.get(REPLAY_DELETE_CHANNEL);

            expect(() => handler?.({}, traversal)).toThrow();
            expect(del).not.toHaveBeenCalled();
        });
    });
});
