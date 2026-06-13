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
    WireChatPayload,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import { JoinRejectedError } from '@chimera/networking/provider/MultiplayerProvider.js';
import type { EngineAction } from '@chimera/simulation/engine/types.js';
import type { Logger } from '../logging/logger.js';
import type { ConnectionStatus, PlayerConnectionEvent } from '../../preload/api-types.js';
import type { ProfileGate } from '../profile/ProfileGate.js';
import type { ChatRelay } from '../ChatRelay.js';
import type { ChatMessage, ChatScope, RelayResult } from '@chimera/shared/chat.js';
import type { E2eHooks } from '../runtime/e2e-hooks.js';
import type { GameLobbySetup } from '@chimera/shared/game-lobby-contract.js';
import {
    resolveMatchSettingsDefaults,
    resolvePlayerAttributeDefaults,
} from '@chimera/shared/game-lobby-contract.js';

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
    readonly onGameStartRequested?: (state: LobbyState) => void | Promise<void>;
    readonly onLobbyStateChanged?: (state: LobbyState) => void;
    readonly onLocalSeatAdded?: (player: LobbyPlayerEntry) => void;
    readonly onConnectionStatusChanged?: (status: ConnectionStatus) => void;
    readonly profileGate?: ProfileGate;
    /**
     * Mandatory host-side gate for inbound `CHAT` side-channel messages
     * (Invariant #73). When omitted, chat messages are dropped (no bypass).
     */
    readonly chatRelay?: ChatRelay;
    /**
     * Invoked once per accepted {@link ChatMessage} for which the *local* player
     * is a recipient — whether locally-originated (via {@link LobbyManager.sendLocalChat})
     * or relayed from a remote client. The wiring point forwards this to
     * `ChatHub` to buffer the message and push it to the renderer (§4.29). Remote
     * recipients are reached over the transport, not through this callback.
     */
    readonly onLocalChatDelivered?: (message: ChatMessage) => void;
    readonly onClientSnapshotReceived?: (snapshot: PlayerSnapshot, checksum: number) => void;
    readonly onClientTickReceived?: (tick: number) => void;
    /**
     * Invoked when an opponent's connection presence transitions (transient drop
     * or reconnect) while hosting. The wiring point forwards this to the renderer
     * over `chimera:lobby:player-connection` so it can raise the §4.30
     * "Player disconnected"/"Player reconnected" toasts (#687).
     */
    readonly onPlayerConnectionChanged?: (event: PlayerConnectionEvent) => void;
    /**
     * Invoked when this client's profile is rejected — at JOIN or for a
     * mid-session PROFILE_UPDATE. The wiring point forwards this to the renderer
     * over `chimera:lobby:profile-rejected` for the §4.30 "Profile rejected"
     * toast (#688). `reason` is the raw gate code (`'profile:<...>'` /
     * `'rate_limit'`), never a parsed `Error.message`.
     */
    readonly onProfileRejected?: (reason: string) => void;
    readonly e2eHooks?: E2eHooks;
    /**
     * Resolves the host-authored lobby-setup descriptor for a `gameId`, or
     * `undefined` when the game declares none (#706). Injected from the
     * composition root (`electron/main/index.ts`) so the manager can seed
     * default match settings and per-player attributes without importing
     * `games/*` directly (Invariant #2). When omitted — or when it returns
     * `undefined` — all seeding no-ops and behavior stays backward-compatible.
     */
    readonly resolveLobbySetup?: (gameId: string) => GameLobbySetup | undefined;
}

export interface AddLocalSeatOptions {
    readonly displayName?: string;
    readonly ready?: boolean;
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
    private readonly localSeatIds = new Set<PlayerId>();
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
    private readonly onGameStartRequested: LobbyManagerOptions['onGameStartRequested'];
    private readonly onLobbyStateChanged: LobbyManagerOptions['onLobbyStateChanged'];
    private readonly onLocalSeatAdded: LobbyManagerOptions['onLocalSeatAdded'];
    private readonly onConnectionStatusChanged: LobbyManagerOptions['onConnectionStatusChanged'];
    private readonly profileGate: LobbyManagerOptions['profileGate'];
    private readonly chatRelay: LobbyManagerOptions['chatRelay'];
    private readonly onLocalChatDelivered: LobbyManagerOptions['onLocalChatDelivered'];
    private readonly onClientSnapshotReceived: LobbyManagerOptions['onClientSnapshotReceived'];
    private readonly onClientTickReceived: LobbyManagerOptions['onClientTickReceived'];
    private readonly onPlayerConnectionChanged: LobbyManagerOptions['onPlayerConnectionChanged'];
    private readonly onProfileRejected: LobbyManagerOptions['onProfileRejected'];
    private readonly e2eHooks: LobbyManagerOptions['e2eHooks'];
    private readonly resolveLobbySetup: LobbyManagerOptions['resolveLobbySetup'];
    /**
     * Opponents currently in a transient-drop state (left with a non-deliberate
     * reason, not yet reconnected). Gates the "reconnected" toast so it fires
     * only for a genuine reconnect — never for a first-time join (#687). Cleared
     * on lobby close so presence does not bleed across sessions.
     */
    private readonly disconnectedPlayers = new Set<PlayerId>();

    constructor(
        private readonly provider: MultiplayerProvider,
        logger: Logger,
        options: LobbyManagerOptions = {},
    ) {
        this.log = logger.child({ module: 'lobby-manager' });
        this.onSessionHosted = options.onSessionHosted;
        this.onSessionJoined = options.onSessionJoined;
        this.onGameStartRequested = options.onGameStartRequested;
        this.onLobbyStateChanged = options.onLobbyStateChanged;
        this.onLocalSeatAdded = options.onLocalSeatAdded;
        this.onConnectionStatusChanged = options.onConnectionStatusChanged;
        this.profileGate = options.profileGate;
        this.chatRelay = options.chatRelay;
        this.onLocalChatDelivered = options.onLocalChatDelivered;
        this.onClientSnapshotReceived = options.onClientSnapshotReceived;
        this.onClientTickReceived = options.onClientTickReceived;
        this.onPlayerConnectionChanged = options.onPlayerConnectionChanged;
        this.onProfileRejected = options.onProfileRejected;
        this.e2eHooks = options.e2eHooks;
        this.resolveLobbySetup = options.resolveLobbySetup;
    }

    /**
     * Resolve the lobby-setup descriptor for the current session's game, or
     * `undefined` when none is registered / no injector was wired. Read from the
     * live `LobbyState.info.gameId` so seeding works on every join, not just at
     * host time (#706).
     */
    private currentLobbySetup(): GameLobbySetup | undefined {
        if (this.resolveLobbySetup === undefined || this.lobbyState === null) {
            return undefined;
        }
        return this.resolveLobbySetup(this.lobbyState.info.gameId);
    }

    /**
     * Return `entry` seeded with default host-authored attributes for `seatIndex`
     * when a descriptor resolves and the entry has none yet. Used on join and
     * local-seat add so every seat carries deterministic per-player defaults.
     * No-ops (returns `entry` unchanged) when no descriptor resolves or the entry
     * already carries attributes (host edits are never clobbered).
     */
    private seedSeatAttributes(
        entry: LobbyPlayerEntry,
        seatIndex: number,
        setup: GameLobbySetup | undefined,
    ): LobbyPlayerEntry {
        if (setup === undefined || entry.attributes !== undefined) {
            return entry;
        }
        return { ...entry, attributes: resolvePlayerAttributeDefaults(setup, seatIndex) };
    }

    /**
     * Rebuild a full {@link LobbyState} from `base` with a new `players` roster,
     * preserving the host-authored top-level `matchSettings` (#706). Roster
     * mutations must funnel through here so seeded match settings survive every
     * join / leave / ready / profile update broadcast.
     */
    private static withPlayers(base: LobbyState, players: readonly LobbyPlayerEntry[]): LobbyState {
        return {
            info: base.info,
            players,
            ...(base.matchSettings !== undefined ? { matchSettings: base.matchSettings } : {}),
        };
    }

    private publishLobbyState(state: LobbyState): void {
        this.lobbyState = state;
        this.onLobbyStateChanged?.(state);
    }

    private publishConnectionStatus(status: ConnectionStatus): void {
        this.onConnectionStatusChanged?.(status);
    }

    private publishPlayerConnection(event: PlayerConnectionEvent): void {
        this.onPlayerConnectionChanged?.(event);
    }

    private publishProfileRejected(reason: string): void {
        this.onProfileRejected?.(reason);
    }

    private broadcastLobbyStateIfHosted(state: LobbyState): void {
        const session = this.session;
        if (session !== null && 'close' in session) {
            session.transport.broadcastLobbyState(state);
        }
    }

    /**
     * Fan an accepted {@link ChatMessage} out to its resolved recipients (§4.29).
     * The local player (when present in `recipients`) is delivered in-process via
     * {@link LobbyManagerOptions.onLocalChatDelivered} so the message reaches the
     * renderer; every remote recipient receives the wire form over the transport
     * side-channel. Shared by the inbound (remote → host) relay path and the
     * locally-originated {@link sendLocalChat} path so delivery is identical
     * regardless of origin.
     */
    private deliverChat(
        transport: HostTransport,
        recipients: readonly PlayerId[],
        message: ChatMessage,
    ): void {
        // The local host is always a recipient of `lobby`-scope chat on its own
        // machine — lobby means "every connected player", and the host is one.
        // The relay resolves recipients from the PlayerDirectory, which does not
        // include the host (it is admitted only via the ProfileGate on JOIN, and
        // self-registering it there would collide with a client sharing the
        // host's localProfileId — NAMESPACE_COLLISION). Including it here, at the
        // delivery layer, keeps the relay the sole acceptance gate (Invariant #73)
        // while ensuring the host sees its own and clients' lobby messages.
        // `team` scope stays relay-resolved (inert until team membership exists);
        // `private` already includes the sender. A Set dedupes the host if the
        // relay already listed it.
        const targets = new Set<PlayerId>(recipients);
        if (this.localPlayerId !== null && message.scope.kind === 'lobby') {
            targets.add(this.localPlayerId);
        }
        for (const recipient of targets) {
            if (recipient === this.localPlayerId) {
                this.onLocalChatDelivered?.(message);
                continue;
            }
            transport.sendSideChannel(recipient, {
                kind: 'chat',
                payload: {
                    id: message.id,
                    senderId: message.fromPlayerId,
                    text: message.body,
                    scope: message.scope,
                    timestamp: message.serverTime,
                },
            });
        }
    }

    /**
     * Convert the wire chat payload (`{id, senderId, text, scope, timestamp}`)
     * back to the canonical {@link ChatMessage} (`{id, fromPlayerId, scope, body,
     * serverTime}`). Inverse of the map in {@link deliverChat}; used on the
     * joined-client receive path to surface host-relayed chat to the renderer.
     */
    private static wireChatToCanonical(payload: WireChatPayload): ChatMessage {
        return {
            id: payload.id,
            fromPlayerId: payload.senderId,
            scope: payload.scope,
            body: payload.text,
            serverTime: payload.timestamp,
        };
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
        this.localSeatIds.clear();
        this.localSeatIds.add(info.hostId);

        // Seed host-authored defaults from the game's lobby-setup descriptor
        // (#706). The host occupies seat 0. No-ops when no descriptor resolves,
        // leaving `matchSettings`/`attributes` absent (backward-compatible).
        const setup = this.resolveLobbySetup?.(params.gameId);
        const hostEntry: LobbyPlayerEntry = {
            playerId: info.hostId,
            displayName: info.hostId,
            ready: false,
            ...(setup !== undefined
                ? { attributes: resolvePlayerAttributeDefaults(setup, 0) }
                : {}),
        };
        const initialState: LobbyState = {
            info,
            players: [hostEntry],
            ...(setup !== undefined ? { matchSettings: resolveMatchSettingsDefaults(setup) } : {}),
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
                if (msg.kind === 'chat') {
                    // Invariant #73 — ChatRelay.relay() is the mandatory gate
                    // between an inbound CHAT and rebroadcast. No bypass: when no
                    // relay is wired, the message is dropped. The relay assigns
                    // the authoritative id + serverTime and resolves recipients;
                    // we only fan the result out over the transport.
                    if (this.chatRelay === undefined) {
                        return;
                    }
                    const result = this.chatRelay.relay(
                        { from, body: msg.payload.text, scope: msg.payload.scope },
                        (recipients, message) =>
                            this.deliverChat(session.transport, recipients, message),
                    );
                    if (!result.ok) {
                        // Tell the offending sender why their message was dropped
                        // (parallel to profile_reject) so the renderer can surface
                        // a toast instead of the message silently vanishing. The
                        // renderer toast and the WS wire frame are follow-on tasks;
                        // today this reaches the sender over the in-process
                        // provider (see WsHostTransport / chat-system.md).
                        this.log.debug('chat:rejected', { from, reason: result.reason });
                        session.transport.sendSideChannel(from, {
                            kind: 'chat_reject',
                            reason: result.reason,
                        });
                    }
                    return;
                }
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
                    const nextState = LobbyManager.withPlayers(
                        this.lobbyState,
                        this.lobbyState.players.map((entry) =>
                            entry.playerId === from
                                ? { ...entry, displayName: result.profile.displayName }
                                : entry,
                        ),
                    );
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

                const nextState = LobbyManager.withPlayers(
                    this.lobbyState,
                    this.lobbyState.players.map((entry) =>
                        entry.playerId === from ? { ...entry, ready } : entry,
                    ),
                );

                this.publishLobbyState(nextState);
                this.broadcastLobbyStateIfHosted(nextState);
            }),
            session.transport.onPlayerJoined((player) => {
                if (this.lobbyState === null) {
                    return;
                }

                // A player rejoining after a transient drop → "reconnected"
                // (#687). A first-time join is silent — only players we saw drop
                // are in `disconnectedPlayers`.
                if (this.disconnectedPlayers.delete(player.playerId)) {
                    this.publishPlayerConnection({
                        playerId: player.playerId,
                        status: 'reconnected',
                    });
                }

                const existing = this.lobbyState.players.find(
                    (entry) => entry.playerId === player.playerId,
                );
                // A fresh join takes the next free seat and is seeded with the
                // descriptor's default attributes for that seat index (#706). A
                // duplicate join event for a player already in the roster
                // preserves the host-authored attributes rather than reseeding
                // — the transport-delivered entry never carries them, so a
                // verbatim replace would wipe host edits.
                const setup = this.currentLobbySetup();
                const nextPlayers: readonly LobbyPlayerEntry[] =
                    existing === undefined
                        ? [
                              ...this.lobbyState.players,
                              this.seedSeatAttributes(
                                  player,
                                  this.lobbyState.players.length,
                                  setup,
                              ),
                          ]
                        : this.lobbyState.players.map((entry) =>
                              entry.playerId === player.playerId
                                  ? {
                                        ...player,
                                        ...(existing.attributes !== undefined
                                            ? { attributes: existing.attributes }
                                            : {}),
                                    }
                                  : entry,
                          );

                const nextState = LobbyManager.withPlayers(this.lobbyState, nextPlayers);
                this.publishLobbyState(nextState);
                this.broadcastLobbyStateIfHosted(nextState);
            }),
            session.transport.onPlayerLeft((playerId, reason) => {
                if (this.lobbyState === null) {
                    return;
                }

                // A transient drop ('timeout'/'error') raises the opponent
                // "disconnected" toast and remembers the player so a later rejoin
                // counts as a reconnect. A deliberate leave ('normal'/'kicked'/
                // 'host_closed') is silent and clears any pending drop state (#687).
                if (reason === 'timeout' || reason === 'error') {
                    this.disconnectedPlayers.add(playerId);
                    this.publishPlayerConnection({ playerId, status: 'disconnected' });
                } else {
                    this.disconnectedPlayers.delete(playerId);
                }

                const nextState = LobbyManager.withPlayers(
                    this.lobbyState,
                    this.lobbyState.players.filter((entry) => entry.playerId !== playerId),
                );
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
            // A profile-gate JOIN rejection carries a structured reason
            // (`'profile:<AdmissionRejection>'`); surface it for the §4.30
            // "Profile rejected" toast (#688), then rethrow so the lobby page
            // still shows its inline error. Non-profile rejections (lobby_full,
            // invalid_token) and other failures are not profile toasts.
            if (error instanceof JoinRejectedError && error.reason.startsWith('profile:')) {
                this.publishProfileRejected(error.reason);
            }
            throw error;
        }
        this.session = session;
        this.localPlayerId = session.localPlayerId;
        this.localSeatIds.clear();
        this.localSeatIds.add(session.localPlayerId);
        this.publishLobbyState(session.initialLobbyState);

        // Wire transport callbacks and capture Unsubscribe handles so
        // closeLobby() can tear them down cleanly.
        this.subscriptions.push(
            session.transport.onSnapshotReceived((snapshot, checksum) => {
                this.onClientSnapshotReceived?.(snapshot, checksum);
            }),
            session.transport.onTickReceived((tick) => {
                this.onClientTickReceived?.(tick);
            }),
            session.transport.onLobbyStateChanged((state) => {
                this.publishLobbyState(state);
            }),
            // Surface host-relayed chat to the joined client's renderer (§4.29).
            // The host ChatRelay is the only gate (Invariant #73); the client
            // merely forwards what the host delivered, mapping the wire payload
            // to the canonical ChatMessage. Mirrors the host's onLocalChatDelivered
            // sink so both roles reach the renderer the same way.
            session.transport.onSideChannelReceived((msg) => {
                if (msg.kind === 'chat') {
                    this.onLocalChatDelivered?.(LobbyManager.wireChatToCanonical(msg.payload));
                } else if (msg.kind === 'profile_reject') {
                    // Mid-session PROFILE_UPDATE rejection (#688) — surface the
                    // structured reason for the §4.30 "Profile rejected" toast.
                    this.publishProfileRejected(msg.reason);
                }
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

    isLocalSeat(playerId: PlayerId): boolean {
        return this.localSeatIds.has(playerId);
    }

    addLocalSeat(playerId: PlayerId, options: AddLocalSeatOptions = {}): Promise<void> {
        const session = this.session;
        if (session === null) {
            return Promise.reject(
                new Error('LobbyManager: adding a local seat requires an active session'),
            );
        }

        if (!('close' in session)) {
            return Promise.reject(
                new Error('LobbyManager: only hosted sessions can add local seats'),
            );
        }

        if (this.lobbyState === null) {
            return Promise.reject(new Error('LobbyManager: lobby state is not available'));
        }

        const existing = this.lobbyState.players.find((entry) => entry.playerId === playerId);
        const baseEntry: LobbyPlayerEntry = {
            playerId,
            displayName: options.displayName ?? existing?.displayName ?? playerId,
            ready: options.ready ?? existing?.ready ?? false,
        };
        // A brand-new local seat (AI / pass-and-play) is a real game seat, so it
        // is seeded with the descriptor's default attributes for its seat index
        // (#706). A re-add preserves any host-authored attributes already set.
        const entry: LobbyPlayerEntry =
            existing === undefined
                ? this.seedSeatAttributes(
                      baseEntry,
                      this.lobbyState.players.length,
                      this.currentLobbySetup(),
                  )
                : {
                      ...baseEntry,
                      ...(existing.attributes !== undefined
                          ? { attributes: existing.attributes }
                          : {}),
                  };
        const wasLocal = this.localSeatIds.has(playerId);
        this.localSeatIds.add(playerId);
        if (!wasLocal) {
            this.onLocalSeatAdded?.(entry);
        }

        const nextState = LobbyManager.withPlayers(
            this.lobbyState,
            existing === undefined
                ? [...this.lobbyState.players, entry]
                : this.lobbyState.players.map((player) =>
                      player.playerId === playerId ? entry : player,
                  ),
        );

        this.publishLobbyState(nextState);
        return Promise.resolve();
    }

    /**
     * Set a host-authored match setting and rebroadcast the full lobby state
     * (#706). Host-only: rejects from a joined (non-host) session — the host is
     * the sole authority for match settings. The value is merged into the
     * existing `matchSettings`, the renderer is re-pushed via
     * {@link publishLobbyState}, and clients receive the full updated state.
     */
    setMatchSetting(key: string, value: string): Promise<void> {
        const session = this.session;
        if (session === null) {
            return Promise.reject(
                new Error('LobbyManager: setting a match setting requires an active session'),
            );
        }
        if (!('close' in session)) {
            return Promise.reject(
                new Error('LobbyManager: only hosted sessions can set match settings'),
            );
        }
        if (this.lobbyState === null) {
            return Promise.reject(new Error('LobbyManager: lobby state is not available'));
        }

        const nextState: LobbyState = {
            ...this.lobbyState,
            matchSettings: { ...this.lobbyState.matchSettings, [key]: value },
        };
        this.publishLobbyState(nextState);
        this.broadcastLobbyStateIfHosted(nextState);
        return Promise.resolve();
    }

    /**
     * Set a host-authored attribute on the player at `playerId` and rebroadcast
     * the full lobby state (#706). Host-only: rejects from a joined (non-host)
     * session, and rejects when `playerId` is not in the roster. The value is
     * merged into that player's `attributes`.
     */
    setPlayerAttribute(playerId: PlayerId, key: string, value: string): Promise<void> {
        const session = this.session;
        if (session === null) {
            return Promise.reject(
                new Error('LobbyManager: setting a player attribute requires an active session'),
            );
        }
        if (!('close' in session)) {
            return Promise.reject(
                new Error('LobbyManager: only hosted sessions can set player attributes'),
            );
        }
        if (this.lobbyState === null) {
            return Promise.reject(new Error('LobbyManager: lobby state is not available'));
        }
        if (!this.lobbyState.players.some((entry) => entry.playerId === playerId)) {
            return Promise.reject(
                new Error('LobbyManager: target player is not present in the lobby roster'),
            );
        }

        const nextState = LobbyManager.withPlayers(
            this.lobbyState,
            this.lobbyState.players.map((entry) =>
                entry.playerId === playerId
                    ? { ...entry, attributes: { ...entry.attributes, [key]: value } }
                    : entry,
            ),
        );
        this.publishLobbyState(nextState);
        this.broadcastLobbyStateIfHosted(nextState);
        return Promise.resolve();
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

    /**
     * Submit a locally-originated chat message to the host relay (§4.29). Runs
     * the mandatory `ChatRelay` gate (Invariant #73), then fans the accepted
     * message out via {@link deliverChat}. Returns the relay's {@link RelayResult}
     * so the renderer can surface a rejection.
     *
     * Host/local path only (F45 T03): a joined-client session has no local relay
     * — client send over the wire is a deliberate follow-on — so this returns a
     * `no_session` rejection there (and when called before a lobby is hosted)
     * rather than bypassing the gate.
     *
     * NOTE (follow-on): the local host is delivered its own `lobby`/`team`-scope
     * messages only if it is present in the `PlayerDirectory` (the relay's
     * recipient universe). The host is admitted to the directory solely through
     * `ProfileGate.admit()` (Invariant #61 — the one authorised path), which today
     * runs only for *joining* clients. Until the host self-registers via that gate,
     * local echo of `lobby`/`team` scope (and receipt of such messages from
     * clients) depends on host admission — tracked for the profile/renderer
     * follow-on. `private` scope is unaffected: the relay always includes the
     * sender.
     */
    sendLocalChat(body: string, scope: ChatScope): RelayResult {
        const session = this.session;
        if (session === null) {
            this.log.debug('chat:send-local:no-session');
            return { ok: false, reason: 'no_session' };
        }

        // Joined client: there is no local relay. Send the CHAT frame up to the
        // host — the authoritative ChatRelay gate (Invariant #73) — and report
        // success optimistically. The host re-validates, assigns the
        // authoritative `id`/`serverTime`, and echoes accepted messages back over
        // the side-channel (surfaced via the joinLobby receive wiring). Per-send
        // rejection feedback to the client (wire `chat_reject` frame + toast) is a
        // deliberate follow-on (F14 wire frame / F46 toast, #646), so the client
        // never blocks on a synchronous verdict.
        if (!('close' in session)) {
            session.transport.sendSideChannel({
                kind: 'chat',
                payload: {
                    id: '',
                    // The host overrides this with the transport-authenticated
                    // sender; sent only to satisfy the wire payload shape.
                    senderId: session.localPlayerId,
                    text: body,
                    scope,
                    timestamp: 0,
                },
            });
            return { ok: true };
        }

        if (this.chatRelay === undefined || this.localPlayerId === null) {
            this.log.debug('chat:send-local:no-relay');
            return { ok: false, reason: 'no_session' };
        }
        return this.chatRelay.relay(
            { from: this.localPlayerId, body, scope },
            (recipients, message) => this.deliverChat(session.transport, recipients, message),
        );
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

        if (!this.localSeatIds.has(playerId)) {
            return Promise.reject(new Error('LobbyManager: requested seat is not a local seat'));
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

        const nextState = LobbyManager.withPlayers(
            this.lobbyState,
            this.lobbyState.players.map((entry) =>
                entry.playerId === this.localPlayerId ? { ...entry, ready } : entry,
            ),
        );

        this.publishLobbyState(nextState);
        session.transport.broadcastLobbyState(nextState);
        return Promise.resolve();
    }

    async startGame(): Promise<void> {
        const session = this.session;
        if (session === null) {
            throw new Error('LobbyManager: start-game requires an active session');
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

        await this.onGameStartRequested?.(this.lobbyState);
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
        this.localSeatIds.clear();
        // Clear rate-limit timestamps so they do not bleed into the next session
        // (Invariant #62).
        this.profileUpdateTimestamps.clear();
        // Clear opponent-presence tracking so a stale "disconnected" player does
        // not produce a spurious "reconnected" toast in the next session (#687).
        this.disconnectedPlayers.clear();

        if (session === null) {
            return;
        }

        this.publishConnectionStatus('disconnected');

        this.log.info('closeLobby');

        // Delegate teardown to ProfileGate so the PlayerDirectory is reset and
        // stale profiles do not bleed into the next session (Invariant #61).
        this.profileGate?.onLobbyClose();

        // Clear chat rate-limit buckets so token state does not bleed into the
        // next session (Invariant #73 — relay state is session-scoped).
        this.chatRelay?.reset();

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
