/**
 * electron/main/lobby/LobbyManager.ts
 *
 * Orchestrates all multiplayer session management for the main process.
 * Holds the active MultiplayerProvider and translates IPC calls into
 * provider calls.  The simulation (StateBroadcaster, MessageRouter) talks
 * to HostTransport / ClientTransport — never to WebSocket connections directly.
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider / LobbyManager
 * Task: F11-T01 (issue #234)
 *
 * Invariants upheld:
 *   #1  — Only PlayerSnapshot crosses transport boundaries; this module never
 *          references GameSnapshot.
 *   #2  — No import from networking/provider/local/, renderer/, or electron/.
 *   #67 — Constructed with an injected Logger child; no console.* calls.
 */

import type {
    MultiplayerProvider,
    HostedSession,
    JoinedSession,
    HostLobbyParams,
    JoinLobbyParams,
    LobbyInfo,
    LobbyPlayerEntry,
    LobbyState,
    HostTransport,
    ClientTransport,
    PlayerId,
    Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { Logger } from '../logging/logger.js';

/**
 * Main-process orchestrator for the multiplayer session lifecycle.
 *
 * Injected with a `MultiplayerProvider` at construction time by
 * `electron/main/index.ts`.  The concrete provider (LocalWebSocketProvider,
 * SteamNetworkProvider, InMemoryMultiplayerProvider in tests) is resolved at
 * the wiring point and never imported here.
 */
export class LobbyManager {
    private readonly log: Logger;
    private session: HostedSession | JoinedSession | null = null;
    private localPlayerId: PlayerId | null = null;
    private lobbyState: LobbyState | null = null;
    /** Active transport subscriptions; cleared and invoked on every closeLobby(). */
    private readonly subscriptions: Unsubscribe[] = [];
    /** Optional teardown returned by onSessionHosted; cleared on closeLobby(). */
    private sessionHostedTeardown: (() => void) | null = null;
    /** Optional teardown returned by onSessionJoined; cleared on closeLobby(). */
    private sessionJoinedTeardown: (() => void) | null = null;

    constructor(
        private readonly provider: MultiplayerProvider,
        logger: Logger,
        private readonly onSessionHosted?: (transport: HostTransport) => (() => void) | void,
        private readonly onSessionJoined?: (transport: ClientTransport) => (() => void) | void,
        private readonly onLobbyStateChanged?: (state: LobbyState) => void,
    ) {
        this.log = logger.child({ module: 'lobby-manager' });
    }

    private publishLobbyState(state: LobbyState): void {
        this.lobbyState = state;
        this.onLobbyStateChanged?.(state);
    }

    private broadcastLobbyStateIfHosted(state: LobbyState): void {
        const session = this.session;
        if (session !== null && 'close' in session) {
            session.transport.broadcastLobbyState(state);
        }
    }

    /**
     * Start a new hosted session.
     *
     * Calls `provider.hostLobby()`, stores the returned `HostedSession`, and
     * wires transport event callbacks to simulation-host stubs.  The stubs are
     * intentionally no-ops at this stage; they will be replaced in F15 / F17
     * when the simulation host is wired.
     *
     * Returns a `LobbyInfo` for the IPC caller.
     */
    async hostLobby(params: HostLobbyParams): Promise<LobbyInfo> {
        this.log.info('hostLobby', { gameId: params.gameId, maxPlayers: params.maxPlayers });

        if (this.session !== null) {
            throw new Error(
                'LobbyManager: session already active — call closeLobby() before hosting again',
            );
        }
        const session = await this.provider.hostLobby(params);
        this.session = session;

        const info: LobbyInfo = {
            sessionId: session.lobbyCode,
            hostId: session.lobbyInfo.hostId,
            gameId: params.gameId,
        };
        this.localPlayerId = info.hostId;

        const initialState: LobbyState = {
            info,
            players: [
                {
                    playerId: info.hostId,
                    displayName: info.hostId,
                    ready: false,
                },
            ],
        };
        this.publishLobbyState(initialState);

        // Wire transport callbacks to simulation-host stubs (F15/F17 will
        // replace these with real simulationHost calls).  Capture the
        // Unsubscribe handles so closeLobby() can tear them down cleanly.
        this.subscriptions.push(
            session.transport.onActionReceived((_from, _action) => {
                // TODO(F15): simulationHost.enqueueAction(from, action)
            }),
            session.transport.onReadyStateUpdate((from, ready) => {
                if (this.lobbyState === null) {
                    return;
                }

                const hasPlayer = this.lobbyState.players.some((entry) => entry.playerId === from);
                if (!hasPlayer) {
                    return;
                }

                const nextState: LobbyState = {
                    info: this.lobbyState.info,
                    players: this.lobbyState.players.map((entry) =>
                        entry.playerId === from ? { ...entry, ready } : entry,
                    ),
                };

                this.publishLobbyState(nextState);
                this.broadcastLobbyStateIfHosted(nextState);
            }),
            session.transport.onPlayerJoined((player) => {
                if (this.lobbyState === null) {
                    return;
                }

                const existing = this.lobbyState.players.find(
                    (entry) => entry.playerId === player.playerId,
                );
                const nextPlayers: readonly LobbyPlayerEntry[] =
                    existing === undefined
                        ? [...this.lobbyState.players, player]
                        : this.lobbyState.players.map((entry) =>
                              entry.playerId === player.playerId ? player : entry,
                          );

                const nextState: LobbyState = {
                    info: this.lobbyState.info,
                    players: nextPlayers,
                };
                this.publishLobbyState(nextState);
                this.broadcastLobbyStateIfHosted(nextState);
            }),
            session.transport.onPlayerLeft((playerId, _reason) => {
                if (this.lobbyState === null) {
                    return;
                }

                const nextState: LobbyState = {
                    info: this.lobbyState.info,
                    players: this.lobbyState.players.filter((entry) => entry.playerId !== playerId),
                };
                this.publishLobbyState(nextState);
                this.broadcastLobbyStateIfHosted(nextState);
            }),
        );

        // Notify the wiring point (index.ts) that a hosted session is live
        // so it can wire StateBroadcaster.  F15/F17 will replace this with
        // real simulationHost wiring.
        const teardown = this.onSessionHosted?.(session.transport);
        if (teardown !== undefined) {
            this.sessionHostedTeardown = teardown;
        }

        this.broadcastLobbyStateIfHosted(initialState);
        this.log.info('hostLobby:ready', { sessionId: info.sessionId });
        return info;
    }

    /**
     * Join an existing hosted session.
     *
     * Calls `provider.joinLobby()`, stores the returned `JoinedSession`, and
     * wires transport event callbacks to no-op renderer broadcast stubs.  The
     * stubs will be replaced in a follow-up task when the renderer IPC bridge
     * is fully wired.
     *
     * Returns the `LobbyInfo` from the session.
     */
    async joinLobby(params: JoinLobbyParams): Promise<LobbyInfo> {
        this.log.info('joinLobby', { address: params.address });

        if (this.session !== null) {
            throw new Error(
                'LobbyManager: session already active — call closeLobby() before joining',
            );
        }
        const session = await this.provider.joinLobby(params);
        this.session = session;
        this.localPlayerId = session.localPlayerId;
        this.publishLobbyState(session.initialLobbyState);

        // Wire transport callbacks to renderer broadcast stubs (F12 / F15 will
        // replace these with real IPC pushes to the renderer).  Capture the
        // Unsubscribe handles so closeLobby() can tear them down cleanly.
        this.subscriptions.push(
            session.transport.onSnapshotReceived((_snapshot) => {
                // TODO(F12/F15): broadcastToRenderer('chimera:snapshot', snapshot)
            }),
            session.transport.onLobbyStateChanged((state) => {
                this.publishLobbyState(state);
            }),
            session.transport.onDisconnected((_reason) => {
                // TODO(F12): broadcastToRenderer('chimera:connection-status', { status: 'disconnected', reason })
            }),
        );

        this.log.info('joinLobby:connected', { sessionId: session.lobbyInfo.sessionId });

        // Notify the wiring point (index.ts) that a joined session is live
        // so it can wire the renderer IPC bridge.  F12 will replace this with
        // real broadcastToRenderer wiring.
        const joinedTeardown = this.onSessionJoined?.(session.transport);
        if (joinedTeardown !== undefined) {
            this.sessionJoinedTeardown = joinedTeardown;
        }

        return session.lobbyInfo;
    }

    getLocalPlayerId(): PlayerId | null {
        return this.localPlayerId;
    }

    updatePlayerReadyState(ready: boolean): Promise<void> {
        const session = this.session;
        if (session === null) {
            throw new Error('LobbyManager: ready-state updates require an active session');
        }

        if (!('close' in session)) {
            session.transport.sendReadyStateUpdate(ready);
            return Promise.resolve();
        }

        if (this.lobbyState === null || this.localPlayerId === null) {
            throw new Error('LobbyManager: lobby state is not available');
        }

        const hasLocalPlayer = this.lobbyState.players.some(
            (entry) => entry.playerId === this.localPlayerId,
        );
        if (!hasLocalPlayer) {
            throw new Error('LobbyManager: local player is not present in the lobby roster');
        }

        const nextState: LobbyState = {
            info: this.lobbyState.info,
            players: this.lobbyState.players.map((entry) =>
                entry.playerId === this.localPlayerId ? { ...entry, ready } : entry,
            ),
        };

        this.publishLobbyState(nextState);
        session.transport.broadcastLobbyState(nextState);
        return Promise.resolve();
    }

    /**
     * Tear down the active session (hosted or joined) and release all resources.
     *
     * Safe to call when no session is active and safe to call twice — the
     * session reference is nulled before any async teardown begins, so a
     * second call is a no-op.
     */
    async closeLobby(): Promise<void> {
        const session = this.session;
        this.session = null;
        this.localPlayerId = null;
        this.lobbyState = null;

        if (session === null) {
            return;
        }

        this.log.info('closeLobby');

        // Tear down all transport subscriptions before closing the session so
        // that re-hosting does not accumulate dead callbacks (BLOCK-2 fix).
        const subs = this.subscriptions.splice(0);
        for (const unsub of subs) unsub();

        // Call the teardown returned by onSessionHosted (e.g. StateBroadcaster
        // cleanup) before closing the underlying transport (BLOCK-4 fix).
        const hostedTeardown = this.sessionHostedTeardown;
        this.sessionHostedTeardown = null;
        hostedTeardown?.();

        // Call the teardown returned by onSessionJoined (e.g. renderer IPC
        // bridge cleanup) before disconnecting.
        const joinedTeardown = this.sessionJoinedTeardown;
        this.sessionJoinedTeardown = null;
        joinedTeardown?.();

        try {
            if ('close' in session) {
                await session.close();
            } else {
                await session.disconnect();
            }
        } catch (err) {
            this.log.warn('closeLobby:teardown-error', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
