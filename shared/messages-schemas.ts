/**
 * shared/messages-schemas.ts
 *
 * Zod runtime schemas for every variant of `ClientMessage` and `ServerMessage`
 * declared in `shared/messages.ts`.
 *
 * **Why strict schemas here?**
 * The existing `isClientMessage` / `isServerMessage` guards only check the
 * `type` discriminant; they do not validate payload structure. These Zod schemas
 * perform deep structural validation so that `LobbyServer` (server-side) and
 * `ServerConnection` (client-side) can reject malformed frames before any field
 * is accessed.
 *
 * Usage:
 *   ```ts
 *   const result = ClientMessageSchema.safeParse(parsed);
 *   if (!result.success) { logger.warn('malformed frame', { issues: result.error.issues }); return; }
 *   const msg = result.data;  // typed as ClientMessage
 *   ```
 *
 * Architecture: §4.3 — WebSocket Message Protocol
 * Task: F10.1 / T01 (issue #225)
 *
 * Invariants upheld:
 *   #2 — Zero runtime imports from renderer/, electron/, or DOM APIs.
 */

import { z } from 'zod';
import type { ClientMessage, ServerMessage } from './messages.js';

// ─── Primitive re-usable schemas ──────────────────────────────────────────────

const PlayerId = z.string();

/**
 * Coarse first-line bound on an inbound `CHAT.body`, in UTF-16 code units, applied
 * at the wire boundary so a hostile client cannot force the host to materialize an
 * unbounded string (e.g. the relay's `[...body]` code-point spread) before the
 * message is rejected. This is intentionally generous and well above the host
 * relay's default `maxBodyLength` (500 code points): the relay still applies the
 * precise, configurable per-policy cap and returns `too_long`. Anything past this
 * coarse bound is clearly abusive and dropped as a malformed frame.
 */
export const WIRE_MAX_CHAT_BODY_LENGTH = 4096;

/**
 * Routing scope for a CHAT frame. Mirrors `ChatScope` in `shared/chat.ts`;
 * the discriminated union rejects malformed `kind` discriminants at the wire
 * boundary so stale clients are detected before any field is read.
 */
const ChatScope = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('lobby') }).strict(),
    z.object({ kind: z.literal('team'), teamId: z.string() }).strict(),
    z.object({ kind: z.literal('private'), toPlayerId: PlayerId }).strict(),
]);

const WirePlayerProfile = z
    .object({
        localProfileId: z.string(),
        displayName: z.string(),
        avatar: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('builtin'), ref: z.string() }).strict(),
            z
                .object({
                    kind: z.literal('custom'),
                    mimeType: z.string(),
                    base64: z.string(),
                })
                .strict(),
        ]),
        locale: z.string(),
    })
    .strict();

const WireCommitmentReveal = z.object({
    id: z.string(),
    value: z.unknown(),
    nonce: z.string(),
});

const WireCommitmentEnvelope = z
    .object({
        id: z.string(),
        commitment: z.string(),
        revealedAt: z.number().int().optional(),
    })
    .strict();

const GameResult = z
    .object({
        winnerIds: z.array(PlayerId).readonly(),
    })
    .strict();

const SceneTransition = z
    .object({
        toSceneId: z.string(),
        phase: z.enum(['preparing', 'ready', 'committing']),
        startedAtTick: z.number().int(),
        params: z.record(z.string(), z.unknown()),
        playersReady: z.array(PlayerId).readonly(),
        timeoutTicks: z.number().int().nonnegative().optional(),
        onClientTimeout: z.enum(['proceed', 'drop']).optional(),
    })
    .strict();

const EngineAction = z.object({
    type: z.string(),
    playerId: PlayerId,
    tick: z.number().int(),
    payload: z.record(z.string(), z.unknown()),
});

// ─── LobbyState nested schemas ────────────────────────────────────────────────

const LobbyInfo = z.object({
    sessionId: z.string(),
    hostId: PlayerId,
    gameId: z.string(),
});

const LobbyPlayerEntry = z.object({
    playerId: PlayerId,
    displayName: z.string(),
    ready: z.boolean(),
});

const LobbyState = z.object({
    info: LobbyInfo,
    players: z.array(LobbyPlayerEntry).readonly(),
});

// ─── PlayerSnapshot schema ────────────────────────────────────────────────────

const PlayerSnapshot = z.object({
    tick: z.number().int(),
    viewerId: PlayerId,
    players: z.record(z.string(), z.record(z.string(), z.unknown())),
    entities: z.record(z.string(), z.record(z.string(), z.unknown())),
    phase: z.string(),
    sceneId: z.string().optional(),
    sceneDefaultScreen: z.string().optional(),
    sceneTransition: SceneTransition.nullable().optional(),
    events: z.array(z.object({ type: z.string() }).passthrough()),
    gameResult: GameResult.nullable(),
    commitments: z.record(z.string(), WireCommitmentEnvelope).optional(),
    undoMeta: z.object({ canUndo: z.boolean(), canRedo: z.boolean() }),
    isMyTurn: z.boolean(),
});

// ─── ClientMessage variants ───────────────────────────────────────────────────

const JoinMessage = z
    .object({
        type: z.literal('JOIN'),
        token: z.string(),
        reconnectPlayerId: PlayerId.optional(),
        // Accept any object — the host validates the contents via ProfileSanitizer.admit()
        // (Invariant #61). Using a strict sub-schema here would prevent full
        // EngineProfile payloads from reaching the gate.
        profile: z.record(z.string(), z.unknown()),
    })
    .strict();

const ActionMessage = z
    .object({
        type: z.literal('ACTION'),
        tick: z.number().int(),
        action: EngineAction,
        checksum: z.number(),
    })
    .strict();

const ProfileUpdateMessage = z
    .object({
        type: z.literal('PROFILE_UPDATE'),
        profile: WirePlayerProfile,
    })
    .strict();

const ReadyStateUpdateMessage = z
    .object({
        type: z.literal('READY_STATE_UPDATE'),
        ready: z.boolean(),
    })
    .strict();

const ChatClientMessage = z
    .object({
        type: z.literal('CHAT'),
        // Coarse DoS bound only; the host relay applies the precise per-policy cap.
        body: z.string().max(WIRE_MAX_CHAT_BODY_LENGTH),
        scope: ChatScope,
    })
    .strict();

const PingMessage = z
    .object({
        type: z.literal('PING'),
        sentAt: z.number(),
    })
    .strict();

// ─── ClientMessageSchema ──────────────────────────────────────────────────────

/**
 * Discriminated-union Zod schema for all `ClientMessage` variants.
 * Validates full payload structure — not just the `type` discriminant.
 *
 * Use `ClientMessageSchema.safeParse(unknown)` at the server receive boundary.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
    JoinMessage,
    ActionMessage,
    ProfileUpdateMessage,
    ReadyStateUpdateMessage,
    ChatClientMessage,
    PingMessage,
]);

// Make TypeScript confirm the inferred type is compatible with ClientMessage.
// This is a compile-time check — no runtime overhead.
type _AssertClientMessage =
    z.infer<typeof ClientMessageSchema> extends ClientMessage ? true : never;
// @ts-expect-error — intentional: asserts the inferred type is assignable to ClientMessage
const _clientCheck: _AssertClientMessage = true;

// ─── ServerMessage variants ───────────────────────────────────────────────────

const WelcomeMessage = z
    .object({
        type: z.literal('WELCOME'),
        playerId: PlayerId,
        lobbyState: LobbyState,
    })
    .strict();

const SnapshotMessage = z
    .object({
        type: z.literal('SNAPSHOT'),
        snapshot: PlayerSnapshot,
        checksum: z.number(),
    })
    .strict();

const TickMessage = z
    .object({
        type: z.literal('TICK'),
        tick: z.number().int(),
    })
    .strict();

const DeltaMessage = z
    .object({
        type: z.literal('DELTA'),
        fromTick: z.number().int(),
        events: z.array(z.object({ type: z.string() }).passthrough()),
    })
    .strict();

const RejectMessage = z
    .object({
        type: z.literal('REJECT'),
        reason: z.string(),
        tick: z.number().int(),
    })
    .strict();

const CloseMessage = z
    .object({
        type: z.literal('CLOSE'),
        reason: z.literal('host_closed'),
    })
    .strict();

const RevealMessage = z
    .object({
        type: z.literal('REVEAL'),
        reveal: WireCommitmentReveal,
    })
    .strict();

const ChatServerMessage = z
    .object({
        type: z.literal('CHAT'),
        id: z.string(),
        from: PlayerId,
        body: z.string(),
        scope: ChatScope,
        serverTime: z.number(),
    })
    .strict();

const PongMessage = z
    .object({
        type: z.literal('PONG'),
        sentAt: z.number(),
        // TODO(F-clock-skew): serverTime removed until clock-skew estimation is implemented.
    })
    .strict();

const LobbyStateMessage = z
    .object({
        type: z.literal('LOBBY_STATE'),
        state: LobbyState,
    })
    .strict();

// ─── ServerMessageSchema ──────────────────────────────────────────────────────

/**
 * Discriminated-union Zod schema for all `ServerMessage` variants.
 * Validates full payload structure — not just the `type` discriminant.
 *
 * Use `ServerMessageSchema.safeParse(unknown)` at the client receive boundary.
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
    WelcomeMessage,
    SnapshotMessage,
    TickMessage,
    DeltaMessage,
    RejectMessage,
    CloseMessage,
    RevealMessage,
    ChatServerMessage,
    PongMessage,
    LobbyStateMessage,
]);

type _AssertServerMessage =
    z.infer<typeof ServerMessageSchema> extends ServerMessage ? true : never;
// @ts-expect-error — intentional: asserts the inferred type is assignable to ServerMessage
const _serverCheck: _AssertServerMessage = true;

// ─── Exported types for renderer and other consumers ────────────────────────

/** Branded type for player identifiers across the system. */
export type PlayerId = z.infer<typeof PlayerId>;

/** Canonical shared type for a player's entry in the lobby roster. */
export type LobbyPlayerEntry = z.infer<typeof LobbyPlayerEntry>;

/** Canonical shared type for lobby information. */
export type LobbyInfo = z.infer<typeof LobbyInfo>;

/** Canonical shared type for the full lobby state. */
export type LobbyState = z.infer<typeof LobbyState>;
