/**
 * shared/messages.ts
 *
 * Wire-level message types for the LocalWebSocketProvider internal protocol.
 *
 * **Scope:** This is the internal contract of `LocalWebSocketProvider` (§4.3).
 * It is NOT part of the `MultiplayerProvider` interface — other providers use
 * their own wire formats. Callers outside `networking/provider/local/` must
 * never depend on these types directly; they interact only through the
 * `HostTransport` / `ClientTransport` interface.
 *
 * Placed in `shared/` per §4.3. All cross-module type references use
 * `import type` to avoid any circular runtime dependencies.
 *
 * Architecture: §4.3 — WebSocket Message Protocol
 * Task: F10 / T01 (issue #216)
 *
 * Invariants upheld:
 *   #1  — SNAPSHOT / LOBBY_STATE carry PlayerSnapshot, not GameSnapshot.
 *         GameSnapshot never leaves the host process.
 *   #2  — This module has zero runtime imports from electron/, renderer/,
 *         or any DOM API. Import-type-only from simulation/ and networking/.
 */

import type { PlayerId, EngineAction, GameResult } from './engine-contract.js';
import type { WirePlayerSnapshot as PlayerSnapshot } from './snapshot-contract.js';
import type { LobbyState } from './lobby-contract.js';
import type { ChatScope } from './chat.js';

// ─── Re-export for consumers in local/ ───────────────────────────────────────
// These contract types now live in the foundation leaf (issue #758); the wire
// `SNAPSHOT` frame carries the loose `WirePlayerSnapshot`, re-exported here under
// the historical name `PlayerSnapshot` so local/ consumers are unaffected.

export type { PlayerId, EngineAction, GameResult, PlayerSnapshot, LobbyState };

// ─── Stub / forward-declared types ───────────────────────────────────────────

/**
 * Wire-level player profile carried with JOIN and PROFILE_UPDATE messages.
 *
 * Expanded in F14 (§4.24) to carry the full sanitisable profile. Uses plain
 * string types for wire compatibility (no branded LocalProfileId / AssetRef).
 * The host passes this through ProfileSanitizer.admit() before any other
 * subsystem may read it (Invariant #61).
 */
export interface WirePlayerProfile {
    /** Stable, client-local identifier for the profile. */
    readonly localProfileId: string;
    /** Human-readable display name shown in the lobby. */
    readonly displayName: string;
    /** Avatar source: built-in asset reference or inline base64 image. */
    readonly avatar:
        | { readonly kind: 'builtin'; readonly ref: string }
        | { readonly kind: 'custom'; readonly mimeType: string; readonly base64: string };
    /** BCP 47 locale tag, e.g. 'en-US'. */
    readonly locale: string;
}

/**
 * Anti-tamper commitment reveal. Expanded in F27 — Cryptographic Commitment
 * Scheme (§4.6). Carried by `ServerMessage.REVEAL`.
 */
export interface WireCommitmentReveal {
    readonly id: string;
    readonly value: unknown;
    readonly nonce: string;
}

// ─── Client → Server messages ─────────────────────────────────────────────────

/**
 * All messages a client may send to the LocalWebSocketProvider host.
 *
 * - JOIN          Initial authentication handshake. The `token` is the lobby
 *                 token embedded in the lobby code returned by `hostLobby()`.
 * - ACTION        A game action to be processed by the ActionPipeline on the
 *                 host. `checksum` is CRC32 of JSON(action) — integrity guard,
 *                 not a cryptographic control (§4.3). Populated since F308.
 * - PROFILE_UPDATE Mid-lobby cosmetic update; side-channel only (§4.24).
 * - READY_STATE_UPDATE Joined-client intent to toggle its own ready state.
 *                 Host remains authoritative and rebroadcasts LOBBY_STATE.
 * - PLAYER_ATTRIBUTE_UPDATE Joined-client intent to set an attribute on its
 *                 OWN seat (e.g. unit colour). The host infers the seat from the
 *                 connection — it never trusts a client-supplied playerId —
 *                 applies the change, and rebroadcasts LOBBY_STATE.
 * - CHAT          Player chat message; rate-limited on the server (§4.29).
 * - PING          Latency probe; server responds with PONG.
 * - LEAVE         Explicit, graceful departure sent just before the client
 *                 closes its socket. Lets the host distinguish an intentional
 *                 leave from a transient connection drop, so opponent
 *                 "disconnected"/"reconnected" presence toasts (§4.30) never
 *                 fire on a deliberate leave. Carries no payload — the host
 *                 already knows which connection sent it.
 */
export type ClientMessage =
    | {
          readonly type: 'JOIN';
          readonly token: string;
          readonly reconnectPlayerId?: PlayerId;
          /**
           * Raw profile attestation from the joining client.
           * Typed as `Record<string, unknown>` at the transport layer — callers
           * must never trust the contents without passing through
           * `ProfileSanitizer.admit()` first (Invariant #61).
           */
          readonly profile: Record<string, unknown>;
          /**
           * Optional lobby password presented by the joining client (F56). Only
           * sent when the joiner supplied one; the host compares it timing-safe
           * against its host-set password and rejects a mismatch/absence with
           * `REJECT 'invalid_password'`. Absent on open lobbies and older clients.
           */
          readonly password?: string;
      }
    | {
          readonly type: 'ACTION';
          readonly tick: number;
          readonly action: EngineAction;
          readonly checksum: number;
      }
    | { readonly type: 'PROFILE_UPDATE'; readonly profile: WirePlayerProfile }
    | { readonly type: 'READY_STATE_UPDATE'; readonly ready: boolean }
    | {
          readonly type: 'PLAYER_ATTRIBUTE_UPDATE';
          readonly key: string;
          readonly value: string;
      }
    | { readonly type: 'CHAT'; readonly body: string; readonly scope: ChatScope }
    | { readonly type: 'PING'; readonly sentAt: number }
    | { readonly type: 'LEAVE' };

// ─── Server → Client messages ─────────────────────────────────────────────────

/**
 * All messages the LocalWebSocketProvider host may send to a connected client.
 *
 * - WELCOME       Response to JOIN. Confirms the client's assigned PlayerId and
 *                 the current full lobby state.
 * - SNAPSHOT      Full projected PlayerSnapshot for the receiving client.
 *                 GameSnapshot NEVER appears here (Invariant #1).
 * - TICK          Tiny authoritative clock update for idle ticks where no
 *                 projected state changed.
 * - DELTA         Incremental event stream optimisation (F13). Placeholder only
 *                 in F10 — hosts always send full SNAPSHOT in this milestone.
 * - REJECT        Signals that the host rejected an ACTION (stale tick, checksum
 *                 mismatch, etc.).
 * - CLOSE         Signals that the hosted session is terminating and the client
 *                 must disconnect.
 * - REVEAL        Discloses a committed hidden value for anti-tamper verification
 *                 (§4.6 / F27).
 * - CHAT          Chat message relayed from a player; includes server timestamp
 *                 for ordering.
 * - PONG          Reply to client PING; includes the server's own timestamp for
 *                 clock-skew estimation.
 * - LOBBY_STATE   Pushed whenever the lobby roster changes (player joins, leaves,
 *                 changes ready state). Keeps all clients in sync.
 * - PROFILE_REJECT Host→client rejection of a mid-session PROFILE_UPDATE. Carries
 *                 the structured `reason` (`'profile:<AdmissionRejection>'` or
 *                 `'rate_limit'`) so the client can raise the §4.30 "Profile
 *                 rejected" toast. The wire form of the `profile_reject`
 *                 side-channel (Invariants #61/#62).
 */
export type ServerMessage =
    | {
          readonly type: 'WELCOME';
          readonly playerId: PlayerId;
          readonly lobbyState: LobbyState;
      }
    | { readonly type: 'SNAPSHOT'; readonly snapshot: PlayerSnapshot; readonly checksum: number }
    | { readonly type: 'TICK'; readonly tick: number }
    | {
          readonly type: 'DELTA';
          readonly fromTick: number;
          readonly events: readonly { readonly type: string }[];
      }
    | { readonly type: 'REJECT'; readonly reason: string; readonly tick: number }
    | { readonly type: 'CLOSE'; readonly reason: 'host_closed' }
    | { readonly type: 'REVEAL'; readonly reveal: WireCommitmentReveal }
    | {
          readonly type: 'CHAT';
          readonly id: string;
          readonly from: PlayerId;
          readonly body: string;
          readonly scope: ChatScope;
          readonly serverTime: number;
      }
    | { readonly type: 'PONG'; readonly sentAt: number }
    | { readonly type: 'LOBBY_STATE'; readonly state: LobbyState }
    | { readonly type: 'PROFILE_REJECT'; readonly reason: string };

// ─── Type guards ──────────────────────────────────────────────────────────────

/** All valid `ClientMessage.type` values. */
const CLIENT_MESSAGE_TYPES = new Set<string>([
    'JOIN',
    'ACTION',
    'PROFILE_UPDATE',
    'READY_STATE_UPDATE',
    'PLAYER_ATTRIBUTE_UPDATE',
    'CHAT',
    'PING',
    'LEAVE',
]);

/** All valid `ServerMessage.type` values. */
const SERVER_MESSAGE_TYPES = new Set<string>([
    'WELCOME',
    'SNAPSHOT',
    'TICK',
    'DELTA',
    'REJECT',
    'CLOSE',
    'REVEAL',
    'CHAT',
    'PONG',
    'LOBBY_STATE',
    'PROFILE_REJECT',
]);

/**
 * Runtime type guard for `ClientMessage`.
 *
 * Validates only the discriminant (`type`) field — payload validation is the
 * responsibility of the receiving server (Zod schemas, ActionPipeline).
 */
export function isClientMessage(value: unknown): value is ClientMessage {
    if (value === null || typeof value !== 'object') return false;
    const type = (value as Record<string, unknown>)['type'];
    return typeof type === 'string' && CLIENT_MESSAGE_TYPES.has(type);
}

/**
 * Runtime type guard for `ServerMessage`.
 *
 * Validates only the discriminant (`type`) field — full payload parsing is
 * done by `WsClientTransport` on receipt.
 */
export function isServerMessage(value: unknown): value is ServerMessage {
    if (value === null || typeof value !== 'object') return false;
    const type = (value as Record<string, unknown>)['type'];
    return typeof type === 'string' && SERVER_MESSAGE_TYPES.has(type);
}
