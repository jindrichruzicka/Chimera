// @vitest-environment jsdom

/**
 * renderer/state/lobbyStoreBootstrap.test.ts
 *
 * Unit tests for lobbyStoreBootstrap.
 * Verifies that bootstrapLobbyStore registers the onUpdate and onConnectionStatus
 * callbacks and routes incoming push events into the lobbyStore singleton.
 *
 * Architecture reference: §F12/T02 (issue #269)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    LobbyAPI,
    SystemAPI,
    Unsubscribe,
    LobbyState,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { bootstrapLobbyStore } from './lobbyStoreBootstrap';
import { useLobbyStore } from './lobbyStore';
import { useLobbyUiStore } from './lobbyUiStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeLobbyState = (): LobbyState => ({
    info: {
        sessionId: 'test-session',
        hostId: 'player-1',
        gameId: 'tactics',
    },
    players: [
        {
            playerId: 'player-1',
            displayName: 'Player One',
            ready: false,
        },
    ],
});

function makeLobbyApi(onUpdateImpl?: (cb: (lobby: LobbyState) => void) => Unsubscribe): LobbyAPI {
    return {
        host: vi.fn(),
        join: vi.fn(),
        getCurrentState: vi.fn(async () => null),
        getLocalPlayerId: vi.fn(async () => null),
        leave: vi.fn(),
        startGame: vi.fn(),
        returnToLobby: vi.fn(),
        updatePlayerReadyState: vi.fn(),
        setMatchSetting: vi.fn(),
        setPlayerAttribute: vi.fn(),
        addAi: vi.fn(),
        removeAi: vi.fn(),
        onUpdate: vi.fn(onUpdateImpl ?? (() => vi.fn())),
        onPlayerConnectionChanged: vi.fn(() => vi.fn()),
        onOpponentLeftMatch: vi.fn(() => vi.fn()),
        onProfileRejected: vi.fn(() => vi.fn()),
    };
}

function makeSystemApi(
    onConnectionStatusImpl?: (
        cb: (status: 'connected' | 'disconnected' | 'connecting' | 'error') => void,
    ) => Unsubscribe,
): SystemAPI {
    return {
        onConnectionStatus: vi.fn(onConnectionStatusImpl ?? (() => vi.fn())),
        platform: vi.fn(),
        quit: vi.fn(),
        relaunch: vi.fn(),
        getDeviceInfo: vi.fn(),
        onDeviceInfoChange: vi.fn(),
        toggleDebugInspector: vi.fn(),
    };
}

// Reset the singleton store between tests
beforeEach(() => {
    useLobbyStore.getState().applyLobbyState(null);
    useLobbyStore.getState().markInitialStateLoading();
    useLobbyUiStore.getState().clearLocalLobbyContext();
});

// ── bootstrapLobbyStore ───────────────────────────────────────────────────────

describe('bootstrapLobbyStore()', () => {
    it('registers an onUpdate callback with the lobby API', () => {
        const lobbyApi = makeLobbyApi();
        const systemApi = makeSystemApi();
        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(lobbyApi.onUpdate).toHaveBeenCalledOnce();
    });

    it('registers an onConnectionStatus callback with the system API', () => {
        const lobbyApi = makeLobbyApi();
        const systemApi = makeSystemApi();
        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(systemApi.onConnectionStatus).toHaveBeenCalledOnce();
    });

    it('returns an Unsubscribe function', () => {
        const unsubscribeLobby = vi.fn();
        const unsubscribeSystem = vi.fn();
        const lobbyApi = makeLobbyApi(() => unsubscribeLobby);
        const systemApi = makeSystemApi(() => unsubscribeSystem);
        const result = bootstrapLobbyStore(lobbyApi, systemApi);
        expect(typeof result).toBe('function');
    });

    it('calling the returned unsubscribe invokes both API unsubscribes', () => {
        const unsubscribeLobby = vi.fn();
        const unsubscribeSystem = vi.fn();
        const lobbyApi = makeLobbyApi(() => unsubscribeLobby);
        const systemApi = makeSystemApi(() => unsubscribeSystem);
        const stop = bootstrapLobbyStore(lobbyApi, systemApi);
        stop();
        expect(unsubscribeLobby).toHaveBeenCalledOnce();
        expect(unsubscribeSystem).toHaveBeenCalledOnce();
    });

    it('routes onUpdate lobby state push event into the store via _applyLobbyState', () => {
        let capturedLobbyUpdate: ((lobby: LobbyState) => void) | undefined;
        const unsubLobby = vi.fn();
        const lobbyApi = makeLobbyApi((cb) => {
            capturedLobbyUpdate = cb;
            return unsubLobby;
        });
        const systemApi = makeSystemApi();

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedLobbyUpdate).toBeDefined();

        const incoming = makeLobbyState();
        capturedLobbyUpdate!(incoming);

        const stored = useLobbyStore.getState().lobbyState;
        expect(stored).toBe(incoming);
    });

    it('replays the current lobby state after registering push listeners', async () => {
        const currentState = makeLobbyState();
        const lobbyApi = makeLobbyApi();
        vi.mocked(lobbyApi.getCurrentState).mockResolvedValueOnce(currentState);
        const systemApi = makeSystemApi();

        bootstrapLobbyStore(lobbyApi, systemApi);
        await Promise.resolve();

        expect(lobbyApi.getCurrentState).toHaveBeenCalledOnce();
        expect(useLobbyStore.getState().lobbyState).toBe(currentState);
        expect(useLobbyStore.getState().hasLoadedInitialState).toBe(true);
    });

    it('marks the initial lobby-state replay as loaded when no session is active', async () => {
        const lobbyApi = makeLobbyApi();
        vi.mocked(lobbyApi.getCurrentState).mockResolvedValueOnce(null);
        const systemApi = makeSystemApi();
        useLobbyStore.getState().applyLobbyState(null);

        bootstrapLobbyStore(lobbyApi, systemApi);
        await Promise.resolve();

        expect(useLobbyStore.getState().lobbyState).toBeNull();
        expect(useLobbyStore.getState().hasLoadedInitialState).toBe(true);
    });

    it('hydrates local player identity when replaying an active lobby state', async () => {
        const currentState = makeLobbyState();
        const lobbyApi = makeLobbyApi();
        vi.mocked(lobbyApi.getCurrentState).mockResolvedValueOnce(currentState);
        vi.mocked(lobbyApi.getLocalPlayerId).mockResolvedValueOnce(playerId('player-1'));
        const systemApi = makeSystemApi();

        bootstrapLobbyStore(lobbyApi, systemApi);
        await Promise.resolve();
        await Promise.resolve();

        expect(lobbyApi.getLocalPlayerId).toHaveBeenCalledOnce();
        expect(useLobbyUiStore.getState().localPlayerId).toBe('player-1');
        expect(useLobbyUiStore.getState().localSeatIds).toEqual(['player-1']);
    });

    it('syncs localSeatIds from lobby players when local player identity is known', () => {
        let capturedLobbyUpdate: ((lobby: LobbyState) => void) | undefined;
        const lobbyApi = makeLobbyApi((cb) => {
            capturedLobbyUpdate = cb;
            return vi.fn();
        });
        const systemApi = makeSystemApi();

        useLobbyUiStore
            .getState()
            .setLocalLobbyContext(playerId('player-1'), [playerId('player-1')]);

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedLobbyUpdate).toBeDefined();

        capturedLobbyUpdate!({
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                {
                    playerId: playerId('player-1'),
                    displayName: 'Player One',
                    ready: false,
                },
                {
                    playerId: 'player-2',
                    displayName: 'Player Two',
                    ready: false,
                },
            ],
        });

        expect(useLobbyUiStore.getState().localSeatIds).toEqual(['player-1', 'player-2']);
    });

    it('clears local lobby context when local player is evicted from the roster', () => {
        let capturedLobbyUpdate: ((lobby: LobbyState) => void) | undefined;
        const lobbyApi = makeLobbyApi((cb) => {
            capturedLobbyUpdate = cb;
            return vi.fn();
        });
        const systemApi = makeSystemApi();

        // Establish that the local player is player-1
        useLobbyUiStore
            .getState()
            .setLocalLobbyContext(playerId('player-1'), [
                playerId('player-1'),
                playerId('player-2'),
            ]);

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedLobbyUpdate).toBeDefined();

        // Push a lobby state that no longer includes player-1 (evicted)
        capturedLobbyUpdate!({
            info: { sessionId: 'session-1', hostId: 'player-2', gameId: 'tactics' },
            players: [{ playerId: 'player-2', displayName: 'Player Two', ready: false }],
        });

        expect(useLobbyUiStore.getState().localPlayerId).toBeNull();
        expect(useLobbyUiStore.getState().localSeatIds).toEqual([]);
    });

    // ── WARN-1: replay should not clobber a newer push ────────────────────────

    it('[WARN-1] does not overwrite a push update that arrived while getCurrentState was in flight', async () => {
        let resolveCurrentState!: (state: LobbyState | null) => void;
        const staleState: LobbyState = {
            info: { sessionId: 'stale-session', hostId: 'player-1', gameId: 'tactics' },
            players: [{ playerId: 'player-1', displayName: 'Player One', ready: false }],
        };
        const freshState: LobbyState = {
            info: { sessionId: 'fresh-session', hostId: 'player-1', gameId: 'tactics' },
            players: [{ playerId: 'player-1', displayName: 'Player One', ready: false }],
        };

        let capturedLobbyUpdate: ((lobby: LobbyState) => void) | undefined;
        const lobbyApi = makeLobbyApi((cb) => {
            capturedLobbyUpdate = cb;
            return vi.fn();
        });
        vi.mocked(lobbyApi.getCurrentState).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveCurrentState = resolve;
            }),
        );
        const systemApi = makeSystemApi();

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedLobbyUpdate).toBeDefined();

        // A fresh push arrives while getCurrentState is still in flight
        capturedLobbyUpdate!(freshState);
        expect(useLobbyStore.getState().lobbyState).toBe(freshState);

        // Now the stale getCurrentState resolves
        resolveCurrentState(staleState);
        await Promise.resolve();
        await Promise.resolve();

        // The stale replay must NOT have overwritten the fresher push
        expect(useLobbyStore.getState().lobbyState).toBe(freshState);
        expect(useLobbyStore.getState().hasLoadedInitialState).toBe(true);
    });

    it('[WARN-1] ignores delayed replay when a disconnect event already cleared the lobby', async () => {
        let resolveCurrentState!: (state: LobbyState | null) => void;
        let capturedConnectionStatus:
            | ((status: 'connected' | 'disconnected' | 'connecting' | 'error') => void)
            | undefined;

        const staleState: LobbyState = {
            info: { sessionId: 'stale-session', hostId: 'player-1', gameId: 'tactics' },
            players: [{ playerId: 'player-1', displayName: 'Player One', ready: false }],
        };

        const lobbyApi = makeLobbyApi();
        vi.mocked(lobbyApi.getCurrentState).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveCurrentState = resolve;
            }),
        );
        const systemApi = makeSystemApi((cb) => {
            capturedConnectionStatus = cb;
            return vi.fn();
        });

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedConnectionStatus).toBeDefined();

        // A fresher disconnect clears lobby state while replay is still in flight.
        capturedConnectionStatus!('disconnected');
        expect(useLobbyStore.getState().lobbyState).toBeNull();

        // Delayed replay arrives afterwards with stale data.
        resolveCurrentState(staleState);
        await Promise.resolve();
        await Promise.resolve();

        expect(useLobbyStore.getState().lobbyState).toBeNull();
        expect(useLobbyStore.getState().hasLoadedInitialState).toBe(true);
    });

    // ── WARN-2: replay error must be logged ───────────────────────────────────

    it('[WARN-2] logs a warning when getCurrentState rejects', async () => {
        const lobbyApi = makeLobbyApi();
        const err = new Error('IPC schema validation failure');
        vi.mocked(lobbyApi.getCurrentState).mockRejectedValueOnce(err);
        const systemApi = makeSystemApi();

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        bootstrapLobbyStore(lobbyApi, systemApi);
        await Promise.resolve();
        await Promise.resolve();

        expect(warnSpy).toHaveBeenCalled();
        expect(useLobbyStore.getState().hasLoadedInitialState).toBe(true);

        warnSpy.mockRestore();
    });

    it('[WARN-1] does not clear fresher pushed lobby state when replay rejects late', async () => {
        let rejectCurrentState!: (err: unknown) => void;
        const freshState: LobbyState = {
            info: { sessionId: 'fresh-session', hostId: 'player-1', gameId: 'tactics' },
            players: [{ playerId: 'player-1', displayName: 'Player One', ready: false }],
        };

        let capturedLobbyUpdate: ((lobby: LobbyState) => void) | undefined;
        const lobbyApi = makeLobbyApi((cb) => {
            capturedLobbyUpdate = cb;
            return vi.fn();
        });
        vi.mocked(lobbyApi.getCurrentState).mockReturnValueOnce(
            new Promise((_, reject) => {
                rejectCurrentState = reject;
            }),
        );
        const systemApi = makeSystemApi();

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedLobbyUpdate).toBeDefined();

        // A fresher push is already applied.
        capturedLobbyUpdate!(freshState);
        expect(useLobbyStore.getState().lobbyState).toBe(freshState);

        // Replay fails afterwards; fallback must not wipe fresher state.
        rejectCurrentState(new Error('late replay failure'));
        await Promise.resolve();
        await Promise.resolve();

        expect(useLobbyStore.getState().lobbyState).toBe(freshState);
        expect(useLobbyStore.getState().hasLoadedInitialState).toBe(true);

        warnSpy.mockRestore();
    });

    // ── WARN-3: no concurrent getLocalPlayerId invocations ────────────────────

    it('[WARN-3] does not issue concurrent getLocalPlayerId invocations for near-simultaneous updates', async () => {
        let capturedLobbyUpdate: ((lobby: LobbyState) => void) | undefined;
        const lobbyApi = makeLobbyApi((cb) => {
            capturedLobbyUpdate = cb;
            return vi.fn();
        });

        // Simulate a slow IPC call that never resolves — lets us count invocations
        vi.mocked(lobbyApi.getLocalPlayerId).mockImplementation(() => new Promise(() => undefined));
        vi.mocked(lobbyApi.getCurrentState).mockResolvedValueOnce(null);
        const systemApi = makeSystemApi();

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedLobbyUpdate).toBeDefined();

        const state = makeLobbyState();
        // Fire three near-simultaneous updates before the IPC round-trip resolves
        capturedLobbyUpdate!(state);
        capturedLobbyUpdate!(state);
        capturedLobbyUpdate!(state);

        await Promise.resolve();

        // Despite three updates, getLocalPlayerId must only have been called once
        expect(lobbyApi.getLocalPlayerId).toHaveBeenCalledOnce();
    });

    it('calls applyLobbyState with null when connection status is disconnected', () => {
        let capturedConnectionStatus:
            | ((status: 'connected' | 'disconnected' | 'connecting' | 'error') => void)
            | undefined;
        const unsubSystem = vi.fn();
        const lobbyApi = makeLobbyApi();
        const systemApi = makeSystemApi((cb) => {
            capturedConnectionStatus = cb;
            return unsubSystem;
        });

        bootstrapLobbyStore(lobbyApi, systemApi);
        expect(capturedConnectionStatus).toBeDefined();

        // Set some initial lobby state
        const initialState = makeLobbyState();
        useLobbyStore.getState().applyLobbyState(initialState);
        useLobbyUiStore
            .getState()
            .setLocalLobbyContext(playerId('player-1'), [
                playerId('player-1'),
                playerId('player-2'),
            ]);
        expect(useLobbyStore.getState().lobbyState).toBe(initialState);

        // Trigger disconnection
        capturedConnectionStatus!('disconnected');

        // Verify lobby state was cleared
        const stored = useLobbyStore.getState().lobbyState;
        expect(stored).toBeNull();
        expect(useLobbyUiStore.getState().localPlayerId).toBeNull();
        expect(useLobbyUiStore.getState().localSeatIds).toEqual([]);
    });
});
