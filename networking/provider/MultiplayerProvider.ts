/**
 * networking/provider/MultiplayerProvider.ts
 *
 * Canonical declaration of the pluggable multiplayer provider abstraction.
 *
 * This module is PURE TYPE DECLARATIONS — zero runtime code.
 * Consumers (electron/main/lobby-manager.ts) reference these interfaces;
 * concrete implementations live in sub-directories (local/, steam/, …).
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider
 * Task: F09 / T1 (issue #201)
 *
 * Invariants upheld:
 *   #1 — GameSnapshot never leaves main process; only PlayerSnapshot crosses
 *        wire boundaries through HostTransport.sendSnapshot / onSnapshotReceived.
 *   #2 — networking/provider/ has zero imports from renderer/ or electron/.
 *        PlayerId and EngineAction are sourced from simulation/.
 *   networking boundary — networking/provider/local/ must not be imported from
 *        outside that directory; this file contains only the abstract surface.
 */

import type { PlayerId, EngineAction } from '@chimera/simulation/engine/types.js';

// ─── Re-export simulation primitives used by callers of this module ───────────

export type { PlayerId };

// ─── Wire-level snapshot type ────────────────────────────────────────────────

/**
 * Projected player snapshot that crosses network and IPC boundaries.
 *
 * The authoritative definition lives in simulation/snapshot.ts (future task).
 * For now the canonical shape is declared here, as this module is the primary
 * consumer that sends/receives it over the wire. The preload stub in
 * electron/preload/api-types.ts mirrors this shape and will be superseded when
 * simulation/snapshot.ts materialises (F03 follow-up).
 *
 * INVARIANT #1: This is the ONLY snapshot type allowed to cross boundaries.
 * GameSnapshot (the full authoritative state) must never appear here.
 */
export interface PlayerSnapshot {
    readonly tick: number;
    readonly viewerId: PlayerId;
    /** Opaque per-player state visible to this viewer. */
    readonly players: Readonly<
        Record<string, Readonly<{ id: PlayerId }> & Readonly<Record<string, unknown>>>
    >;
    /** Opaque per-entity state visible to this viewer. */
    readonly entities: Readonly<
        Record<string, Readonly<{ id: string }> & Readonly<Record<string, unknown>>>
    >;
    readonly phase: string;
    readonly events: readonly Readonly<{ type: string }>[];
    readonly undoMeta: { readonly canUndo: boolean; readonly canRedo: boolean };
}

// ─── Lobby domain types ───────────────────────────────────────────────────────

/** Parameters for hosting a new lobby session. */
export interface HostLobbyParams {
    readonly gameId: string;
    readonly maxPlayers: number;
}

/** Parameters for joining an existing lobby session. */
export interface JoinLobbyParams {
    readonly address: string;
}

/** Metadata returned when a lobby is successfully hosted or joined. */
export interface LobbyInfo {
    readonly sessionId: string;
    readonly hostId: PlayerId;
    readonly gameId: string;
}

/** One player's entry in the live lobby roster. */
export interface LobbyPlayerEntry {
    readonly playerId: PlayerId;
    readonly displayName: string;
    readonly ready: boolean;
}

/** Full lobby state pushed to all clients. */
export interface LobbyState {
    readonly info: LobbyInfo;
    readonly players: readonly LobbyPlayerEntry[];
}

/** A browsable lobby entry returned by BrowsableProvider.listLobbies(). */
export interface LobbyListEntry {
    readonly address: string;
    readonly gameId: string;
    readonly playerCount: number;
    readonly maxPlayers: number;
}

/** Reason a client was disconnected from the host. */
export type DisconnectReason = 'kicked' | 'timeout' | 'host_closed' | 'error' | 'normal';

// ─── Side-channel message types ───────────────────────────────────────────────

/**
 * Stub for chat message payload. Expanded in F29 — Chat System (§4.29).
 * Carried by SideChannelMessage.kind === 'chat'.
 */
export interface ChatMessage {
    readonly senderId: PlayerId;
    readonly text: string;
    readonly timestamp: number;
}

/**
 * Stub for player profile payload. Expanded in F14 — Player Profiles (§4.24).
 * Carried by SideChannelMessage.kind === 'profile'.
 */
export interface PlayerProfilePayload {
    readonly playerId: PlayerId;
    readonly displayName: string;
}

/**
 * Discriminated union of all non-authoritative out-of-band messages carried by
 * the transport side-channel. New cosmetic/out-of-band channels (emotes, typing
 * indicators, spectator signals) extend this union rather than growing the
 * transport surface.
 *
 * Side-channel messages are STRICTLY PARALLEL to the ActionPipeline — they do
 * NOT advance `tick`, do NOT enter ActionHistory, and do NOT appear in saves or
 * replays. See §4.24 (profiles) and §4.29 (chat).
 */
export type SideChannelMessage =
    | { readonly kind: 'chat'; readonly payload: ChatMessage }
    | { readonly kind: 'profile'; readonly payload: PlayerProfilePayload };

// ─── Subscription handle ──────────────────────────────────────────────────────

/** Returned by every subscription method; call to remove the listener. */
export type Unsubscribe = () => void;

// ─── Host-side session ────────────────────────────────────────────────────────

/**
 * Returned by MultiplayerProvider.hostLobby().
 * Owned exclusively by LobbyManager for the session lifetime.
 */
export interface HostedSession {
    /** Shareable code / invite token that clients present to joinLobby(). */
    readonly lobbyCode: string;
    readonly transport: HostTransport;
    /** Tears down the server-side session and frees all resources. */
    close(): Promise<void>;
}

/** Transport surface exposed to the server-side (simulation host) logic. */
export interface HostTransport {
    /** Push a projected PlayerSnapshot to one connected client. */
    sendSnapshot(playerId: PlayerId, snapshot: PlayerSnapshot): void;
    /** Push updated lobby state to all connected clients. */
    broadcastLobbyState(state: LobbyState): void;
    /**
     * Send a non-authoritative out-of-band message to one client or broadcast
     * to all. Target is a PlayerId for unicast or 'broadcast' for all clients.
     */
    sendSideChannel(target: PlayerId | 'broadcast', msg: SideChannelMessage): void;
    /** Subscribe to inbound game actions from clients. */
    onActionReceived(cb: (from: PlayerId, action: EngineAction) => void): Unsubscribe;
    /** Subscribe to inbound side-channel messages from clients. */
    onSideChannelReceived(cb: (from: PlayerId, msg: SideChannelMessage) => void): Unsubscribe;
    /** Subscribe to player-joined notifications. */
    onPlayerJoined(cb: (player: LobbyPlayerEntry) => void): Unsubscribe;
    /** Subscribe to player-left / disconnect notifications. */
    onPlayerLeft(cb: (playerId: PlayerId, reason: DisconnectReason) => void): Unsubscribe;
}

// ─── Client-side session ──────────────────────────────────────────────────────

/**
 * Returned by MultiplayerProvider.joinLobby().
 * Owned exclusively by LobbyManager for the session lifetime.
 */
export interface JoinedSession {
    readonly lobbyInfo: LobbyInfo;
    readonly transport: ClientTransport;
    /** Gracefully disconnects from the host and frees resources. */
    disconnect(): Promise<void>;
}

/** Transport surface exposed to the client-side logic. */
export interface ClientTransport {
    /** Send a game action to the authoritative host. */
    sendAction(action: EngineAction): void;
    /**
     * Send a non-authoritative side-channel message to the host. Mirror of
     * HostTransport.sendSideChannel — never an EngineAction, never entered in
     * ActionHistory, never replayed.
     */
    sendSideChannel(msg: SideChannelMessage): void;
    /** Subscribe to projected PlayerSnapshot pushes from the host. */
    onSnapshotReceived(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe;
    /** Subscribe to inbound side-channel messages from the host. */
    onSideChannelReceived(cb: (msg: SideChannelMessage) => void): Unsubscribe;
    /** Subscribe to lobby state changes broadcast by the host. */
    onLobbyStateChanged(cb: (state: LobbyState) => void): Unsubscribe;
    /** Subscribe to disconnect events. */
    onDisconnected(cb: (reason: DisconnectReason) => void): Unsubscribe;
}

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * Core pluggable multiplayer provider abstraction.
 *
 * Concrete implementations: LocalWebSocketProvider (default, LAN/localhost),
 * SteamNetworkProvider (future Steamworks P2P integration).
 * Injected into LobbyManager at app start by electron/main/index.ts.
 *
 * The simulation (StateBroadcaster, MessageRouter) is decoupled from WebSocket
 * details — it communicates exclusively through HostTransport / ClientTransport.
 */
export interface MultiplayerProvider {
    /** Start a new hosted session. Returns a HostedSession for LobbyManager to drive. */
    hostLobby(params: HostLobbyParams): Promise<HostedSession>;
    /** Connect to an existing hosted session by address / invite code. */
    joinLobby(params: JoinLobbyParams): Promise<JoinedSession>;
    /** Release any persistent resources held by this provider (sockets, SDK handles). */
    dispose(): void;
}

// ─── Optional capability: lobby discovery ────────────────────────────────────

/**
 * Optional capability for providers that support browsable lobby discovery
 * (LAN broadcast, Steam lobby list). Declared as a SEPARATE interface per ISP —
 * not an optional method on MultiplayerProvider.
 *
 * Consumers narrow via `isBrowsable(provider)` before invoking `listLobbies()`.
 */
export interface BrowsableProvider {
    listLobbies(): Promise<LobbyListEntry[]>;
}

/**
 * Type-narrowing helper for BrowsableProvider.
 *
 * Returns true iff `p` has a `listLobbies` property that is a function,
 * narrowing the type to `MultiplayerProvider & BrowsableProvider` so that
 * callers cannot invoke `listLobbies()` without first passing through this guard.
 *
 * Uses `unknown` cast instead of `any` to satisfy strict-mode linting.
 */
export function isBrowsable(p: MultiplayerProvider): p is MultiplayerProvider & BrowsableProvider {
    return typeof (p as unknown as Record<string, unknown>)['listLobbies'] === 'function';
}
