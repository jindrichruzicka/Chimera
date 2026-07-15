/**
 * networking/provider/MultiplayerProvider.ts
 *
 * Canonical declaration of the pluggable multiplayer provider abstraction.
 *
 * This module is PURE TYPE DECLARATIONS — zero runtime code.
 * Consumers (electron/main/lobby/LobbyManager.ts) reference these interfaces;
 * concrete implementations live in sub-directories (local/, steam/, …).
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider
 *
 * Invariants upheld:
 *   #1 — GameSnapshot never leaves main process; only PlayerSnapshot crosses
 *        wire boundaries through HostTransport.sendSnapshot / onSnapshotReceived.
 *   #2 — networking/provider/ has zero imports from renderer/ or electron/.
 *        PlayerId and EngineAction are sourced from simulation/.
 *   networking boundary — networking/provider/local/ must not be imported from
 *        outside that directory; this file contains only the abstract surface.
 */

import type { PlayerId, EngineAction, GameResult } from '@chimera-engine/simulation/contracts';
import { playerId as _makePlayerId } from '@chimera-engine/simulation/engine/types.js';
import type {
    JoinSeatClaim,
    WireCommitmentReveal,
} from '@chimera-engine/simulation/foundation/messages.js';
import type { ChatScope, ChatRejectReason } from '@chimera-engine/simulation/foundation/chat.js';
// The projected wire snapshot and the lobby roster contracts live in the
// foundation leaf `@chimera-engine/simulation/foundation`. `WirePlayerSnapshot`
// is the canonical loose wire projection; it is imported here under the local
// name `PlayerSnapshot` and re-exported so this module's public import path is
// unchanged for every transport caller.
import type { WirePlayerSnapshot as PlayerSnapshot } from '@chimera-engine/simulation/foundation/snapshot-contract.js';
import type {
    LobbyAgentKind,
    LobbyAgentSlot,
    LobbyInfo,
    LobbyPlayerEntry,
    LobbyState,
} from '@chimera-engine/simulation/foundation/lobby-contract.js';

// ─── Re-export primitives used by callers of this module ──────────────────────

export type { PlayerId };

export type { GameResult };

export type { PlayerSnapshot };

export type { LobbyAgentKind, LobbyAgentSlot, LobbyInfo, LobbyPlayerEntry, LobbyState };

/**
 * Constructs a branded `PlayerId` from a raw string.
 *
 * Use this factory everywhere a `PlayerId` value needs to be created from a
 * literal or runtime string. This is the single authorised cast site for the
 * `PlayerId` brand — using `raw as PlayerId` directly outside this helper is
 * a lint/review violation.
 *
 * Re-exported from `simulation/engine/types.ts` so callers of the networking
 * layer do not need to reach into `simulation/` directly.
 *
 * @example
 *   const id = playerId('host-abc123');
 */
export const playerId = _makePlayerId;

// ─── Wire-level snapshot type ────────────────────────────────────────────────
//
// `PlayerSnapshot` (the loose wire projection) is declared in the foundation
// leaf as `WirePlayerSnapshot` and re-exported above. It is the ONLY snapshot
// type allowed to cross boundaries — GameSnapshot must never appear here
// (Invariant #1).

// ─── Lobby domain types ───────────────────────────────────────────────────────
//
// `LobbyAgentKind`, `LobbyAgentSlot`, `LobbyInfo`, `LobbyPlayerEntry`, and
// `LobbyState` are declared in the foundation leaf
// `@chimera-engine/simulation/foundation/lobby-contract.js` and re-exported
// above. The host-/join-param and transport interfaces below build on them.

/**
 * One saved-seat claim a restoring client presents on join.
 *
 * Alias of the wire-level {@link JoinSeatClaim} so the claim shape has exactly
 * one declaration. Plain strings on purpose: claims carry opaque host-minted
 * ids only — no display names or other profile data (Invariants #59/#60). The
 * host brands a claimed playerId only after matching it against its own
 * restored seats. Wire bounds: ≤16 claims per JOIN, each id ≤64 chars;
 * out-of-bounds entries are sanitized away client-side and degrade to a
 * fresh id.
 */
export type SeatClaim = JoinSeatClaim;

/** Parameters for hosting a new lobby session. */
export interface HostLobbyParams {
    readonly gameId: string;
    readonly maxPlayers: number;
    readonly agentSlots?: readonly LobbyAgentSlot[];
    /**
     * Optional lobby password. When set, joining clients must present a
     * matching password in their JOIN handshake or be rejected; when absent or
     * empty the lobby is open. Server-side only — never broadcast in
     * `LobbyState`/`LobbyInfo` or logged.
     */
    readonly password?: string;
    /**
     * Restored-session seed. When set, the provider mints
     * `hostPlayerId` as the lobby's host id (the host reclaims its saved seat)
     * and seeds `humanSeats` — the non-host restored human seats, pre-sorted
     * slotIndex-ascending — for join-time id resolution: a joining client may
     * reclaim one via a matching {@link SeatClaim}, and claimless joins fill
     * the seats in order. The initial `LobbyState` still contains only the
     * host entry; restored seats are never broadcast as a fabricated roster.
     */
    readonly restore?: {
        readonly matchId: string;
        readonly hostPlayerId: PlayerId;
        readonly humanSeats: readonly PlayerId[];
    };
}

/** Parameters for joining an existing lobby session. */
export interface JoinLobbyParams {
    readonly address: string;
    /** Provider-assigned player identity to reclaim after a disconnect. */
    readonly reconnectPlayerId?: PlayerId;
    /**
     * Optional lobby password presented to the host's password gate.
     * Required only when the host set one; a mismatch/absence is rejected with
     * `JoinRejectedError('invalid_password')`.
     */
    readonly password?: string;
    /**
     * Raw profile attestation to present to the host's profile gate.
     * Typed as `unknown` here; the host validates it via `ProfileSanitizer.admit()`
     * before it reaches any other subsystem (Invariant #61).
     */
    readonly profile?: unknown;
    /**
     * Saved-seat claims presented on join. The host grants the
     * first claim whose `matchId` matches its restored match and whose seat is
     * known but not connected; anything else — stale matchId, unknown or
     * already-connected seat, out-of-bounds entries — degrades to a fresh id.
     * Presenting claims (even an empty array after sanitization) opts the join
     * out of the claimless restored-seat fallback.
     */
    readonly claims?: readonly SeatClaim[];
}

// `LobbyInfo`, `LobbyPlayerEntry`, and `LobbyState` are declared in the
// foundation leaf `@chimera-engine/simulation/foundation/lobby-contract.js` and
// re-exported above.

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
 * Chat message payload carried by `SideChannelMessage.kind === 'chat'`.
 *
 * Carries the host-assigned `id` and the routing `scope` (§4.29). The host relay
 * assigns `id` and stamps `timestamp`; on the inbound (client → host) path both
 * are placeholders (`id: ''`, `timestamp: 0`) until `ChatRelay` assigns the
 * authoritative values.
 *
 * This payload is the wire form of the canonical `ChatMessage` in
 * `shared/chat.ts`; the field names differ (`senderId`/`text`/`timestamp`). It
 * is named `WireChatPayload` (not `ChatMessage`) precisely so the two never
 * collide at a call site. Chat is a cosmetic side-channel and never an
 * `EngineAction` (Invariant #72).
 */
export interface WireChatPayload {
    readonly id: string;
    readonly senderId: PlayerId;
    readonly text: string;
    readonly scope: ChatScope;
    readonly timestamp: number;
}

/**
 * Full player profile payload carried by SideChannelMessage.kind === 'profile'.
 *
 * See §4.24 — Player Profiles. Uses plain string types for wire compatibility;
 * branded LocalProfileId and AssetRef<T> exist only inside the engine
 * (simulation/profile/ProfileSchema.ts). The host passes this payload as
 * `unknown` to ProfileSanitizer.admit() which validates all fields structurally
 * (Invariant #61).
 */
export interface PlayerProfilePayload {
    readonly localProfileId: string;
    readonly displayName: string;
    readonly avatar:
        | { readonly kind: 'builtin'; readonly ref: string }
        | { readonly kind: 'custom'; readonly mimeType: string; readonly base64: string };
    readonly locale: string;
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
 *
 * Host → client response variants:
 *   profile_ack    — PROFILE_UPDATE was admitted and the directory updated.
 *   profile_reject — PROFILE_UPDATE was rejected; `reason` is either
 *                    `'profile:<AdmissionRejection>'` or `'rate_limit'`.
 *   chat_reject    — an inbound CHAT was rejected by the host ChatRelay gate
 *                    (Invariant #73); `reason` is the relay's rejection cause so
 *                    the sender can surface a toast. Parallel to profile_reject.
 */
export type SideChannelMessage =
    | { readonly kind: 'chat'; readonly payload: WireChatPayload }
    | { readonly kind: 'profile'; readonly payload: PlayerProfilePayload }
    | { readonly kind: 'profile_ack' }
    | { readonly kind: 'profile_reject'; readonly reason: string }
    | { readonly kind: 'chat_reject'; readonly reason: ChatRejectReason };

// ─── Subscription handle ──────────────────────────────────────────────────────

/** Returned by every subscription method; call to remove the listener. */
export type Unsubscribe = () => void;

// ─── Profile gate result ──────────────────────────────────────────────────────

/**
 * Result returned by the profile gate registered via `HostTransport.setProfileGate()`.
 *
 * - `admitted: true`  → the player is allowed in; `displayName` is used in the lobby roster.
 * - `admitted: false` → REJECT is sent to the client with the given `reason` string.
 */
export type JoinGateResult =
    | { readonly admitted: true; readonly displayName: string }
    | { readonly admitted: false; readonly reason: string };

// ─── Join classifier (spectator admission) ────────────────────────────────────

/**
 * Result of the host-supplied join classifier registered via
 * {@link HostTransport.setJoinClassifier}. Runs AFTER the profile gate admits
 * and decides how a token+profile-valid JOIN is admitted:
 *
 * - `{ role: 'player' }`    → a seated player (today's behaviour; the default
 *                             when no classifier is installed). Subject to the
 *                             player-capacity gate.
 * - `{ role: 'spectator' }` → a read-only session viewer. Does NOT consume a
 *                             player seat; subject to a separate spectator cap.
 * - `{ reject }`            → REJECT is sent with the given `reason` (e.g.
 *                             `match_in_progress` / `spectators_disabled`) and
 *                             the connection is closed.
 *
 * Spectator admission is host policy — the classifier reads match phase, the
 * game's `resolveSpectatorSupport` capability, and the `allowSpectators`
 * match-setting. Prepares Invariant #114 (spectators are read-only viewers,
 * never in `GameSnapshot.players`).
 */
export type JoinClassification =
    | { readonly role: 'player' }
    | { readonly role: 'spectator' }
    | { readonly reject: string };

/** Context the transport hands the join classifier for a single JOIN. */
export interface JoinClassifierContext {
    /**
     * The transport resolved this JOIN to a retained / restored seat — i.e. a
     * reconnect, not a fresh join. Reconnects always classify as `player`
     * (unchanged re-sync), independent of match phase.
     */
    readonly reconnect: boolean;
}

/**
 * Thrown by {@link MultiplayerProvider.joinLobby} when the host rejects the JOIN
 * handshake. Part of the provider contract (not a provider-internal type) so
 * consumers — e.g. `LobbyManager` raising the §4.30 "Profile rejected" toast —
 * can branch on the structured `reason` instead of string-matching
 * `Error.message`.
 *
 * For a profile-gate rejection, `reason` is `'profile:<AdmissionRejection>'`;
 * for other handshake failures it is the raw reason (`'lobby_full'`,
 * `'invalid_token'`, …). Every concrete provider must throw this (not a plain
 * `Error`) on a JOIN rejection.
 */
export class JoinRejectedError extends Error {
    constructor(readonly reason: string) {
        super(`MultiplayerProvider: server rejected JOIN: ${reason}`);
        this.name = 'JoinRejectedError';
    }
}

// ─── Host-side session ────────────────────────────────────────────────────────

/**
 * Returned by MultiplayerProvider.hostLobby().
 * Owned exclusively by LobbyManager for the session lifetime.
 */
export interface HostedSession {
    /** Shareable code / invite token that clients present to joinLobby(). */
    readonly lobbyCode: string;
    /**
     * Lobby metadata including the provider-assigned hostId.
     * Symmetric with JoinedSession.lobbyInfo — consumers read hostId from here
     * instead of casting a literal.
     */
    readonly lobbyInfo: LobbyInfo;
    readonly transport: HostTransport;
    /** Tears down the server-side session and frees all resources. */
    close(): Promise<void>;
}

/** Transport surface exposed to the server-side (simulation host) logic. */
export interface HostTransport {
    /** Push a projected PlayerSnapshot to one connected client. */
    sendSnapshot(playerId: PlayerId, snapshot: PlayerSnapshot): void;
    /** Push an authoritative tick-only clock update to one connected client. */
    sendTick(playerId: PlayerId, tick: number): void;
    /** Push updated lobby state to all connected clients. */
    broadcastLobbyState(state: LobbyState): void;
    /**
     * Send a non-authoritative out-of-band message to one client or broadcast
     * to all. Target is a PlayerId for unicast or 'broadcast' for all clients.
     */
    sendSideChannel(target: PlayerId | 'broadcast', msg: SideChannelMessage): void;
    /**
     * Send a cryptographic commitment reveal to one client or broadcast to all.
     * Target is a PlayerId for unicast or 'broadcast' for all clients.
     *
     * Invariant #9: callers on the receiving end MUST verify the reveal via
     * `CommitmentScheme.verify()` before trusting `reveal.value`. See §4.6.
     */
    sendReveal(target: PlayerId | 'broadcast', reveal: WireCommitmentReveal): void;
    /** Subscribe to inbound game actions from clients. */
    onActionReceived(cb: (from: PlayerId, action: EngineAction) => void): Unsubscribe;
    /** Subscribe to joined-client ready-state intent updates. */
    onReadyStateUpdate(cb: (from: PlayerId, ready: boolean) => void): Unsubscribe;
    /**
     * Subscribe to joined-client own-seat attribute intent updates (e.g. unit
     * colour). `from` is the connection-derived PlayerId — the host applies the
     * change to that seat and never trusts a client-supplied playerId.
     */
    onPlayerAttributeUpdate(cb: (from: PlayerId, key: string, value: string) => void): Unsubscribe;
    /** Subscribe to inbound side-channel messages from clients. */
    onSideChannelReceived(cb: (from: PlayerId, msg: SideChannelMessage) => void): Unsubscribe;
    /** Subscribe to player-joined notifications. */
    onPlayerJoined(cb: (player: LobbyPlayerEntry) => void): Unsubscribe;
    /** Subscribe to player-left / disconnect notifications. */
    onPlayerLeft(cb: (playerId: PlayerId, reason: DisconnectReason) => void): Unsubscribe;
    /**
     * Register a profile gate for JOIN attestation.
     *
     * Called synchronously when a JOIN arrives (after token validation, before
     * WELCOME is sent). Returning `{ admitted: true }` allows the player in
     * with the given `displayName`; returning `{ admitted: false }` causes
     * REJECT to be sent with the given `reason` and the connection is closed.
     *
     * If no gate is registered, all token-valid JOINs are admitted and the
     * `PlayerId` string is used as the display name (legacy behaviour).
     *
     * Invariant #61: raw attestation must never reach any subsystem other than
     * `ProfileSanitizer.admit()` — the gate callback is the only place allowed
     * to call `admit()`.
     */
    setProfileGate(gate: (pid: PlayerId, rawProfile: unknown) => JoinGateResult): void;
    /**
     * Register a join classifier that runs AFTER the profile gate admits a JOIN
     * and decides its role — `player` (default), `spectator`, or `reject`. See
     * {@link JoinClassification}.
     *
     * Called synchronously during the JOIN handshake. If no classifier is
     * registered, every profile-admitted JOIN is a `player` (legacy behaviour).
     * A `spectator` result admits a read-only viewer that does NOT consume a
     * player seat; a `reject` result sends REJECT with the reason and closes.
     *
     * The classifier is host policy (match phase + game spectator capability +
     * `allowSpectators` match-setting); the transport enforces the separate
     * spectator cap and never counts spectators against player capacity.
     */
    setJoinClassifier(
        classify: (pid: PlayerId, ctx: JoinClassifierContext) => JoinClassification,
    ): void;
}

// ─── Client-side session ──────────────────────────────────────────────────────

/**
 * Returned by MultiplayerProvider.joinLobby().
 * Owned exclusively by LobbyManager for the session lifetime.
 */
export interface JoinedSession {
    readonly lobbyInfo: LobbyInfo;
    /** Provider-assigned identity of the local joined player. */
    readonly localPlayerId: PlayerId;
    /**
     * Role the host admitted this client under (from the JOIN classifier).
     * `'player'` for a normal seated join (the default); `'spectator'` for a
     * read-only viewer admitted to a running match. The renderer read-only UX
     * (a later task) branches on this.
     */
    readonly role: 'player' | 'spectator';
    /**
     * Deterministic lobby snapshot captured at join success.
     * LobbyManager seeds renderer-facing state from this value immediately,
     * before any asynchronous onLobbyStateChanged pushes arrive.
     */
    readonly initialLobbyState: LobbyState;
    readonly transport: ClientTransport;
    /** Gracefully disconnects from the host and frees resources. */
    disconnect(): Promise<void>;
}

/** Transport surface exposed to the client-side logic. */
export interface ClientTransport {
    /** Send a game action to the authoritative host. */
    sendAction(action: EngineAction): void;
    /** Send ready-state intent to the authoritative host. */
    sendReadyStateUpdate(ready: boolean): void;
    /**
     * Send an own-seat attribute intent (e.g. unit colour) to the authoritative
     * host. The host infers the seat from this connection and rebroadcasts the
     * merged LobbyState; it never trusts a client-supplied playerId.
     */
    sendPlayerAttributeUpdate(key: string, value: string): void;
    /**
     * Send a non-authoritative side-channel message to the host. Mirror of
     * HostTransport.sendSideChannel — never an EngineAction, never entered in
     * ActionHistory, never replayed.
     */
    sendSideChannel(msg: SideChannelMessage): void;
    /** Subscribe to projected PlayerSnapshot pushes from the host. */
    onSnapshotReceived(cb: (snapshot: PlayerSnapshot, checksum: number) => void): Unsubscribe;
    /** Subscribe to authoritative tick-only clock updates from the host. */
    onTickReceived(cb: (tick: number) => void): Unsubscribe;
    /** Subscribe to inbound side-channel messages from the host. */
    onSideChannelReceived(cb: (msg: SideChannelMessage) => void): Unsubscribe;
    /** Subscribe to commitment reveal messages from the host.
     *
     * @remarks
     * **Security — Invariant #9**: Always call `CommitmentScheme.verify(reveal)`
     * before trusting `reveal.value`. An unverified reveal can be spoofed by a
     * malicious host or a man-in-the-middle. Discard and flag any reveal that
     * fails verification. See §4.6 — Cryptographic Commitment Scheme.
     */
    onReveal(cb: (reveal: WireCommitmentReveal) => void): Unsubscribe;
    /** Subscribe to lobby state changes broadcast by the host. */
    onLobbyStateChanged(cb: (state: LobbyState) => void): Unsubscribe;
    /** Subscribe to disconnect events. */
    onDisconnected(cb: (reason: DisconnectReason) => void): Unsubscribe;
    /**
     * Subscribe to round-trip latency updates. The callback is fired each time
     * a PONG is received from the host, with the measured RTT in milliseconds.
     * `latencyMs` is always >= 0.
     */
    onLatencyUpdate(cb: (latencyMs: number) => void): Unsubscribe;
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
    return typeof (p as Partial<BrowsableProvider>).listLobbies === 'function';
}
