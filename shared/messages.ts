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

import type { PlayerId, EngineAction } from '@chimera/simulation/engine/types.js';
import type {
    PlayerSnapshot,
    LobbyState,
} from '@chimera/networking/provider/MultiplayerProvider.js';

// ─── Re-export for consumers in local/ ───────────────────────────────────────

export type { PlayerId, EngineAction, PlayerSnapshot, LobbyState };

// ─── Stub / forward-declared types ───────────────────────────────────────────

/**
 * Chat scope. Expanded in F45 — Chat System (§4.29).
 * Carried by both `ClientMessage.CHAT` and `ServerMessage.CHAT`.
 */
export type ChatScope = 'all' | 'team' | 'lobby';

/**
 * Lightweight player profile carried with JOIN and PROFILE_UPDATE messages.
 * The full `PlayerProfile` type lands in F14 (§4.24); for now only the
 * fields needed for the wire handshake are declared.
 */
export interface WirePlayerProfile {
    /** Stable, branded identifier matching the simulation's PlayerId. */
    readonly playerId: PlayerId;
    /** Human-readable display name shown in the lobby. */
    readonly displayName: string;
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
 *                 host. `checksum` is a CRC32 of the serialised payload (0 for
 *                 F10 — full implementation lands in F13 §4.3).
 * - PROFILE_UPDATE Mid-lobby cosmetic update; side-channel only (§4.24).
 * - CHAT          Player chat message; rate-limited on the server (§4.29).
 * - PING          Latency probe; server responds with PONG.
 */
export type ClientMessage =
    | { readonly type: 'JOIN'; readonly token: string; readonly profile: WirePlayerProfile }
    | {
          readonly type: 'ACTION';
          readonly tick: number;
          readonly action: EngineAction;
          readonly checksum: number;
      }
    | { readonly type: 'PROFILE_UPDATE'; readonly profile: WirePlayerProfile }
    | { readonly type: 'CHAT'; readonly body: string; readonly scope: ChatScope }
    | { readonly type: 'PING'; readonly sentAt: number };

// ─── Server → Client messages ─────────────────────────────────────────────────

/**
 * All messages the LocalWebSocketProvider host may send to a connected client.
 *
 * - WELCOME       Response to JOIN. Confirms the client's assigned PlayerId and
 *                 the current full lobby state.
 * - SNAPSHOT      Full projected PlayerSnapshot for the receiving client.
 *                 GameSnapshot NEVER appears here (Invariant #1).
 * - DELTA         Incremental event stream optimisation (F13). Placeholder only
 *                 in F10 — hosts always send full SNAPSHOT in this milestone.
 * - REJECT        Signals that the host rejected an ACTION (stale tick, etc.).
 * - REVEAL        Discloses a committed hidden value for anti-tamper verification
 *                 (§4.6 / F27).
 * - CHAT          Chat message relayed from a player; includes server timestamp
 *                 for ordering.
 * - PONG          Reply to client PING; includes the server's own timestamp for
 *                 clock-skew estimation.
 * - LOBBY_STATE   Pushed whenever the lobby roster changes (player joins, leaves,
 *                 changes ready state). Keeps all clients in sync.
 */
export type ServerMessage =
    | {
          readonly type: 'WELCOME';
          readonly playerId: PlayerId;
          readonly lobbyState: LobbyState;
      }
    | { readonly type: 'SNAPSHOT'; readonly snapshot: PlayerSnapshot; readonly checksum: number }
    | {
          readonly type: 'DELTA';
          readonly fromTick: number;
          readonly events: readonly { readonly type: string }[];
      }
    | { readonly type: 'REJECT'; readonly reason: string; readonly tick: number }
    | { readonly type: 'REVEAL'; readonly reveal: WireCommitmentReveal }
    | {
          readonly type: 'CHAT';
          readonly from: PlayerId;
          readonly body: string;
          readonly scope: ChatScope;
          readonly serverTime: number;
      }
    | { readonly type: 'PONG'; readonly sentAt: number; readonly serverTime: number }
    | { readonly type: 'LOBBY_STATE'; readonly state: LobbyState };

// ─── Type guards ──────────────────────────────────────────────────────────────

/** All valid `ClientMessage.type` values. */
const CLIENT_MESSAGE_TYPES = new Set<string>(['JOIN', 'ACTION', 'PROFILE_UPDATE', 'CHAT', 'PING']);

/** All valid `ServerMessage.type` values. */
const SERVER_MESSAGE_TYPES = new Set<string>([
    'WELCOME',
    'SNAPSHOT',
    'DELTA',
    'REJECT',
    'REVEAL',
    'CHAT',
    'PONG',
    'LOBBY_STATE',
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
