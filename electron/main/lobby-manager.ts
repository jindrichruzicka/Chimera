/**
 * electron/main/lobby-manager.ts
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
    HostTransport,
    Unsubscribe,
} from '../../networking/provider/MultiplayerProvider.js';
import type { Logger } from './logger.js';

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
    /** Active transport subscriptions; cleared and invoked on every closeLobby(). */
    private readonly subscriptions: Unsubscribe[] = [];

    constructor(
        private readonly provider: MultiplayerProvider,
        logger: Logger,
        private readonly onSessionHosted?: (transport: HostTransport) => void,
    ) {
        this.log = logger.child({ module: 'lobby-manager' });
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

        const session = await this.provider.hostLobby(params);
        this.session = session;

        // Wire transport callbacks to simulation-host stubs (F15/F17 will
        // replace these with real simulationHost calls).  Capture the
        // Unsubscribe handles so closeLobby() can tear them down cleanly.
        this.subscriptions.push(
            session.transport.onActionReceived((_from, _action) => {
                // TODO(F15): simulationHost.enqueueAction(from, action)
            }),
            session.transport.onPlayerJoined((_player) => {
                // TODO(F15): simulationHost.notifyPlayerJoined(player)
            }),
            session.transport.onPlayerLeft((_playerId, _reason) => {
                // TODO(F17): simulationHost.notifyPlayerLeft(playerId, reason)
            }),
        );

        // Notify the wiring point (index.ts) that a hosted session is live
        // so it can wire StateBroadcaster.  F15/F17 will replace this with
        // real simulationHost wiring.
        this.onSessionHosted?.(session.transport);

        const info: LobbyInfo = {
            sessionId: session.lobbyCode,
            hostId: session.lobbyInfo.hostId,
            gameId: params.gameId,
        };

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

        const session = await this.provider.joinLobby(params);
        this.session = session;

        // Wire transport callbacks to renderer broadcast stubs (F12 / F15 will
        // replace these with real IPC pushes to the renderer).  Capture the
        // Unsubscribe handles so closeLobby() can tear them down cleanly.
        this.subscriptions.push(
            session.transport.onSnapshotReceived((_snapshot) => {
                // TODO(F12/F15): broadcastToRenderer('chimera:snapshot', snapshot)
            }),
            session.transport.onLobbyStateChanged((_state) => {
                // TODO(F12): broadcastToRenderer('chimera:lobby-update', state)
            }),
            session.transport.onDisconnected((_reason) => {
                // TODO(F12): broadcastToRenderer('chimera:connection-status', { status: 'disconnected', reason })
            }),
        );

        this.log.info('joinLobby:connected', { sessionId: session.lobbyInfo.sessionId });
        return session.lobbyInfo;
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

        if (session === null) {
            return;
        }

        this.log.info('closeLobby');

        // Tear down all transport subscriptions before closing the session so
        // that re-hosting does not accumulate dead callbacks (BLOCK-2 fix).
        const subs = this.subscriptions.splice(0);
        for (const unsub of subs) unsub();

        if ('close' in session) {
            await session.close();
        } else {
            await session.disconnect();
        }
    }
}
