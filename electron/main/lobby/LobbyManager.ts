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
    PlayerSnapshot,
    LobbyAgentSlot,
    Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { EngineAction } from '@chimera/simulation/engine/types.js';
import type { Logger } from '../logging/logger.js';
import type { ConnectionStatus } from '../../preload/api-types.js';
import type { ProfileGate } from '../profile/ProfileGate.js';
import type { E2eHooks } from '../runtime/e2e-hooks.js';

export interface HostedSessionMetadata {
    readonly hostId: PlayerId;
    readonly maxPlayers: number;
    readonly agentSlots?: readonly LobbyAgentSlot[];
    readonly e2eHooks?: E2eHooks;
}

/**
 * Optional callbacks and dependencies for {@link LobbyManager}.
 *
 * Collecting these into an options bag avoids a long positional constructor
 * parameter list where callers must pass `undefined` to reach a later slot.
 */
export interface LobbyManagerOptions {
    readonly onSessionHosted?: (
        transport: HostTransport,
        metadata: HostedSessionMetadata,
    ) => (() => void) | void;
    readonly onSessionJoined?: (transport: ClientTransport) => (() => void) | void;
    readonly onMatchStartRequested?: (state: LobbyState) => void | Promise<void>;
    readonly onLobbyStateChanged?: (state: LobbyState) => void;
    readonly onConnectionStatusChanged?: (status: ConnectionStatus) => void;
    readonly profileGate?: ProfileGate;
    readonly onClientSnapshotReceived?: (snapshot: PlayerSnapshot) => void;
    readonly e2eHooks?: E2eHooks;
}

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
    /**
     * Per-PlayerId timestamp of the last admitted PROFILE_UPDATE (in ms from
     * Date.now()).  Used to enforce the 1-per-5-second rate limit per client
     * (Invariant #62).  Cleared on lobby close so timestamps do not bleed
     * across sessions.
     */
    private readonly profileUpdateTimestamps = new Map<PlayerId, number>();
    /** Optional teardown returned by onSessionHosted; cleared on closeLobby(). */
    private sessionHostedTeardown: (() => void) | null = null;
    /** Optional teardown returned by onSessionJoined; cleared on closeLobby(). */
    private sessionJoinedTeardown: (() => void) | null = null;

    private readonly onSessionHosted: LobbyManagerOptions['onSessionHosted'];
    private readonly onSessionJoined: LobbyManagerOptions['onSessionJoined'];
    private readonly onMatchStartRequested: LobbyManagerOptions['onMatchStartRequested'];
    private readonly onLobbyStateChanged: LobbyManagerOptions['onLobbyStateChanged'];
    private readonly onConnectionStatusChanged: LobbyManagerOptions['onConnectionStatusChanged'];
    private readonly profileGate: LobbyManagerOptions['profileGate'];
    private readonly onClientSnapshotReceived: LobbyManagerOptions['onClientSnapshotReceived'];
    private readonly e2eHooks: LobbyManagerOptions['e2eHooks'];

    constructor(
        private readonly provider: MultiplayerProvider,
        logger: Logger,
        options: LobbyManagerOptions = {},
    ) {
        this.log = logger.child({ module: 'lobby-manager' });
        this.onSessionHosted = options.onSessionHosted;
        this.onSessionJoined = options.onSessionJoined;
        this.onMatchStartRequested = options.onMatchStartRequested;
        this.onLobbyStateChanged = options.onLobbyStateChanged;
        this.onConnectionStatusChanged = options.onConnectionStatusChanged;
        this.profileGate = options.profileGate;
        this.onClientSnapshotReceived = options.onClientSnapshotReceived;
        this.e2eHooks = options.e2eHooks;
    }

    private publishLobbyState(state: LobbyState): void {
        this.lobbyState = state;
        this.onLobbyStateChanged?.(state);
    }

    private publishConnectionStatus(status: ConnectionStatus): void {
        this.onConnectionStatusChanged?.(status);
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
     * wires transport event callbacks.  The action-received callback remains as
     * a no-op here; the actual dispatch is wired in index.ts and routed through
     * SessionRuntime and SimulationHost (F15 ActionPipeline integration complete).
     *
     * Returns a `LobbyInfo` for the IPC caller.
     */
    async hostLobby(params: HostLobbyParams): Promise<LobbyInfo> {
        this.log.info('hostLobby', { gameId: params.gameId, maxPlayers: params.maxPlayers });

        this.publishConnectionStatus('connecting');

        if (this.session !== null) {
            throw new Error(
                'LobbyManager: session already active — call closeLobby() before hosting again',
            );
        }
        let session: HostedSession;
        try {
            session = await this.provider.hostLobby(params);
        } catch (error) {
            this.publishConnectionStatus('error');
            throw error;
        }
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
        // Wire the profile gate BEFORE publishing the lobby state so there is
        // no window in which a client could learn the session token and JOIN
        // before the gate is active (Invariant #61).  Only active when a
        // ProfileGate was injected at construction time.
        if (this.profileGate !== undefined) {
            session.transport.setProfileGate(this.profileGate.check);
        }

        this.publishLobbyState(initialState);

        // Wire transport callbacks to simulation-host integration.  Capture the
        // Unsubscribe handles so closeLobby() can tear them down cleanly.
        // NOTE: F15 (ActionPipeline integration) is complete; the actual
        // onActionReceived handler is wired in index.ts and dispatches to
        // SimulationHost.  This stub remains as a placeholder since the transport
        // subscription is managed here and the callback is intentionally no-op
        // (the real dispatch happens at the HostSessionPipeline boundary).
        this.subscriptions.push(
            session.transport.onActionReceived((_from, _action) => {
                // Actions are dispatched in index.ts::hostLobby() via
                // SessionRuntime.applyAction(); see §4.14 & §4.20.
            }),
            session.transport.onSideChannelReceived((from, msg) => {
                if (msg.kind !== 'profile') {
                    return;
                }
                if (this.profileGate === undefined) {
                    return;
                }

                // Invariant #62 — rate limit: 1 PROFILE_UPDATE per 5 seconds per client.
                const lastAdmit = this.profileUpdateTimestamps.get(from);
                if (lastAdmit !== undefined && Date.now() - lastAdmit < 5000) {
                    session.transport.sendSideChannel(from, {
                        kind: 'profile_reject',
                        reason: 'rate_limit',
                    });
                    return;
                }

                // Invariant #61 — admit() is the mandatory gate for PROFILE_UPDATE.
                const result = this.profileGate.update(from, msg.payload);
                if (!result.ok) {
                    session.transport.sendSideChannel(from, {
                        kind: 'profile_reject',
                        reason: result.reason,
                    });
                    return;
                }

                // Admission succeeded: record timestamp, update lobby state, broadcast, ACK.
                this.profileUpdateTimestamps.set(from, Date.now());

                if (this.lobbyState !== null) {
                    const nextState: LobbyState = {
                        info: this.lobbyState.info,
                        players: this.lobbyState.players.map((entry) =>
                            entry.playerId === from
                                ? { ...entry, displayName: result.profile.displayName }
                                : entry,
                        ),
                    };
                    this.publishLobbyState(nextState);
                    this.broadcastLobbyStateIfHosted(nextState);
                }

                session.transport.sendSideChannel(from, { kind: 'profile_ack' });
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
        // so it can wire StateBroadcaster and SimulationHost.  F15 is complete;
        // the actual wiring happens in index.ts::hostLobby().
        const e2eHooks = this.e2eHooks;
        const metadata: HostedSessionMetadata = {
            hostId: info.hostId,
            maxPlayers: params.maxPlayers,
            ...(params.agentSlots !== undefined ? { agentSlots: params.agentSlots } : {}),
            ...(e2eHooks !== undefined ? { e2eHooks } : {}),
        };
        const teardown = this.onSessionHosted?.(session.transport, metadata);
        if (teardown !== undefined) {
            this.sessionHostedTeardown = teardown;
        }

        this.broadcastLobbyStateIfHosted(initialState);
        this.publishConnectionStatus('connected');
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

        this.publishConnectionStatus('connecting');

        if (this.session !== null) {
            throw new Error(
                'LobbyManager: session already active — call closeLobby() before joining',
            );
        }
        let session: JoinedSession;
        try {
            session = await this.provider.joinLobby(params);
        } catch (error) {
            this.publishConnectionStatus('error');
            throw error;
        }
        this.session = session;
        this.localPlayerId = session.localPlayerId;
        this.publishLobbyState(session.initialLobbyState);

        // Wire transport callbacks and capture Unsubscribe handles so
        // closeLobby() can tear them down cleanly.
        this.subscriptions.push(
            session.transport.onSnapshotReceived((snapshot) => {
                this.onClientSnapshotReceived?.(snapshot);
            }),
            session.transport.onLobbyStateChanged((state) => {
                this.publishLobbyState(state);
            }),
            session.transport.onDisconnected((_reason) => {
                this.publishConnectionStatus('disconnected');
            }),
        );

        this.publishConnectionStatus('connected');
        this.log.info('joinLobby:connected', { sessionId: session.lobbyInfo.sessionId });

        // Notify the wiring point (index.ts) that a joined session is live
        // so it can perform any additional transport wiring.
        const joinedTeardown = this.onSessionJoined?.(session.transport);
        if (joinedTeardown !== undefined) {
            this.sessionJoinedTeardown = joinedTeardown;
        }

        return session.lobbyInfo;
    }

    getLocalPlayerId(): PlayerId | null {
        return this.localPlayerId;
    }

    getCurrentState(): LobbyState | null {
        return this.lobbyState;
    }

    sendAction(action: EngineAction): void {
        const session = this.session;
        if (session === null) {
            throw new Error('LobbyManager: game actions require an active session');
        }

        if ('close' in session) {
            throw new Error('LobbyManager: hosted game actions are dispatched by SessionRuntime');
        }

        session.transport.sendAction(action);
    }

    switchActiveSeat(playerId: PlayerId): Promise<void> {
        if (this.session === null) {
            return Promise.reject(
                new Error('LobbyManager: seat switching requires an active session'),
            );
        }

        if (this.lobbyState === null) {
            return Promise.reject(new Error('LobbyManager: lobby state is not available'));
        }

        const hasRequestedSeat = this.lobbyState.players.some(
            (entry) => entry.playerId === playerId,
        );
        if (!hasRequestedSeat) {
            return Promise.reject(
                new Error('LobbyManager: requested seat is not present in the lobby roster'),
            );
        }

        this.localPlayerId = playerId;
        return Promise.resolve();
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

    async startMatch(): Promise<void> {
        const session = this.session;
        if (session === null) {
            throw new Error('LobbyManager: start-match requires an active session');
        }

        if (!('close' in session)) {
            throw new Error('LobbyManager: only the lobby host can start the match');
        }

        if (this.lobbyState === null || this.localPlayerId === null) {
            throw new Error('LobbyManager: lobby state is not available');
        }

        if (this.localPlayerId !== this.lobbyState.info.hostId) {
            throw new Error('LobbyManager: only the lobby host can start the match');
        }

        if (this.lobbyState.players.length === 0 || this.lobbyState.players.some((p) => !p.ready)) {
            throw new Error('LobbyManager: all players must be ready before starting the match');
        }

        await this.onMatchStartRequested?.(this.lobbyState);
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
        // Clear rate-limit timestamps so they do not bleed into the next session
        // (Invariant #62).
        this.profileUpdateTimestamps.clear();

        if (session === null) {
            return;
        }

        this.publishConnectionStatus('disconnected');

        this.log.info('closeLobby');

        // Delegate teardown to ProfileGate so the PlayerDirectory is reset and
        // stale profiles do not bleed into the next session (Invariant #61).
        this.profileGate?.onLobbyClose();

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
