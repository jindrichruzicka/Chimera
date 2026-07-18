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
 *
 * Invariants upheld:
 *   #2 — Zero runtime imports from renderer/, electron/, or DOM APIs.
 */

import { z } from 'zod';
import type { ClientMessage, ServerMessage } from './messages.js';
import { ChatScopeSchema } from './chat-schemas.js';

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
 * Coarse bound on an inbound `PROFILE_REJECT.reason`, in UTF-16 code units,
 * applied at the wire boundary. The reason is network-derived (a remote host
 * sends the frame) and flows through to the renderer's §4.30 "Profile rejected"
 * toast title, so an unbounded string would let a hostile or buggy host push
 * arbitrarily long text into the UI. Legitimate reasons are short admission
 * gate codes (e.g. `profile:DISPLAY_NAME_TOO_LONG`, `rate_limit`), so this cap
 * is intentionally generous yet well above any real value — anything past it is
 * clearly abusive and dropped as a malformed frame.
 */
export const WIRE_MAX_PROFILE_REJECT_REASON_LENGTH = 256;

/**
 * Coarse bound on an inbound `PLAYER_ATTRIBUTE_UPDATE` `key`, in UTF-16 code
 * units, applied at the wire boundary. The frame is owner-authored but
 * network-derived (a joined client sends it), and the host merges the value into
 * `LobbyPlayerEntry.attributes` and rebroadcasts it to every peer. Legitimate
 * keys are short game-defined ids (e.g. `color`, `deck`), so this cap is
 * generous yet well above any real key — anything past it is clearly abusive
 * and dropped as a malformed frame.
 */
export const WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH = 256;

/**
 * Coarse bound on an inbound `PLAYER_ATTRIBUTE_UPDATE` `value`, in UTF-16 code
 * units, applied at the wire boundary. Wider than the key cap because a value
 * may carry a game-defined structured payload (e.g. a card game's JSON-encoded
 * deck ≈ 2 KB) — mirroring how `WIRE_MAX_CHAT_BODY_LENGTH` is only the coarse
 * DoS bound while the host applies the precise policy cap: the per-game limit
 * (`GameLobbySetup.maxAttributeValueLength`, default 256) is enforced by
 * `LobbyManager` via `resolveAttributeValueCap`.
 */
export const WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH = 16_384;

/**
 * Coarse bound on the number of saved-seat claims an inbound `JOIN` may carry.
 * A restoring client presents one claim per saved seat it might
 * reclaim; real sessions have at most a handful of human seats, so this cap is
 * generous — anything past it is clearly abusive and dropped as a malformed
 * frame.
 */
export const WIRE_MAX_JOIN_CLAIMS = 16;

/**
 * Coarse bound on a `JOIN` claim's `matchId`/`playerId`, in UTF-16 code units.
 * Both are opaque host-minted ids (UUIDs, `player-N`, `host-…`),
 * so 64 is well above any real value.
 */
export const WIRE_MAX_JOIN_CLAIM_ID_LENGTH = 64;

/**
 * One saved-seat claim on a `JOIN` frame. Strict and opaque by
 * design: claims carry ids only — no display names or other profile data may
 * cross the wire here (Invariants #59/#60). The host matches `matchId` against
 * its own restored match and `playerId` against its known seats; a claim that
 * matches nothing degrades to a fresh id.
 */
const JoinSeatClaim = z
    .object({
        matchId: z.string().min(1).max(WIRE_MAX_JOIN_CLAIM_ID_LENGTH),
        playerId: z.string().min(1).max(WIRE_MAX_JOIN_CLAIM_ID_LENGTH),
    })
    .strict();

/**
 * Routing scope for a CHAT frame. Reuses the canonical {@link ChatScopeSchema}
 * from `shared/chat-schemas.ts` so the wire boundary, the IPC boundary, and the
 * preload boundary all validate the same shape — the discriminated union rejects
 * malformed `kind` discriminants before any field is read.
 */
const ChatScope = ChatScopeSchema;

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
    // Seat role for who-is-watching presentation. Absent ⇒ 'player'
    // (backward-compatible); a 'spectator' entry is a read-only viewer and is
    // NEVER part of the authoritative GameSnapshot.players roster (Invariant #114).
    role: z.enum(['player', 'spectator']).optional(),
    // Owner-authored, per-player match attributes (e.g. unit colour): each player
    // writes its own seat. Optional and backward-compatible: absent on older
    // clients and on games with no lobby setup.
    attributes: z.record(z.string(), z.string()).optional(),
});

// One host-configured controller slot (e.g. an AI player) carried in the synced
// lobby roster. Mirrors `LobbyAgentSlot` in networking/electron; the renderer
// reads it to render the AI sub-list.
const LobbyAgentSlot = z.object({
    slotIndex: z.number().int().nonnegative(),
    kind: z.enum(['human', 'ai']),
    omniscient: z.boolean().optional(),
});

const LobbyState = z.object({
    info: LobbyInfo,
    players: z.array(LobbyPlayerEntry).readonly(),
    // Host-authored match settings (e.g. board colour) synced to all clients on
    // every LobbyState broadcast. Optional and backward-compatible.
    matchSettings: z.record(z.string(), z.string()).optional(),
    // Host-configured AI agent slots, synced to all clients so every peer sees
    // the AI roster. Optional and backward-compatible:
    // absent on games with no AI and on older clients.
    agentSlots: z.array(LobbyAgentSlot).readonly().optional(),
});

/**
 * Synced match-setup config carried on `PlayerSnapshot.setup`. Runtime mirror of
 * the `GameSetupConfig` interface in `shared/game-lobby-contract.ts`: the chosen
 * match settings plus each player's attributes keyed by player id.
 */
const GameSetupConfig = z.object({
    matchSettings: z.record(z.string(), z.string()),
    playerAttributes: z.record(z.string(), z.record(z.string(), z.string())),
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
    // Public agreed lobby setup (host-authored match settings + owner-authored
    // per-player attributes), passed through projection verbatim. Optional and
    // backward-compatible.
    setup: GameSetupConfig.optional(),
    // Host-minted stable match identity, projected verbatim like `setup`
    // (Invariant #101). Optional and backward-compatible.
    matchId: z.string().optional(),
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
        // Optional lobby password — validated timing-safe by the host.
        password: z.string().optional(),
        // Optional saved-seat claims from a restoring client —
        // bounded, strict, opaque ids only.
        claims: z.array(JoinSeatClaim).max(WIRE_MAX_JOIN_CLAIMS).optional(),
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

const PlayerAttributeUpdateMessage = z
    .object({
        type: z.literal('PLAYER_ATTRIBUTE_UPDATE'),
        // Owner-authored but network-derived: cap key/value so a hostile client
        // cannot push unbounded strings into the broadcast lobby state. The
        // value cap is only the coarse wire bound — the host enforces the
        // precise per-game cap (resolveAttributeValueCap) before merging.
        key: z.string().min(1).max(WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH),
        value: z.string().max(WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH),
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

const LeaveMessage = z
    .object({
        type: z.literal('LEAVE'),
    })
    .strict();

const SpectateTargetUpdateMessage = z
    .object({
        type: z.literal('SPECTATE_TARGET_UPDATE'),
        // The seat the spectator wants to follow. Non-empty, and capped to the
        // same opaque-id length as `JoinSeatClaim.playerId` so a hostile client
        // cannot push an unbounded string across the wire boundary (coarse DoS
        // bound). The host further validates it is a currently-seated player
        // before re-pointing (Invariant #115).
        targetPlayerId: z.string().min(1).max(WIRE_MAX_JOIN_CLAIM_ID_LENGTH),
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
    PlayerAttributeUpdateMessage,
    ChatClientMessage,
    PingMessage,
    LeaveMessage,
    SpectateTargetUpdateMessage,
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
        // Whether the joiner was admitted as a seated 'player' or a read-only
        // 'spectator' (Invariant #114). Defaults to 'player' when the host omits
        // it, so an old host's WELCOME still yields a concrete role on parse.
        role: z.enum(['player', 'spectator']).default('player'),
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
        // TODO: serverTime removed until clock-skew estimation is implemented.
    })
    .strict();

const LobbyStateMessage = z
    .object({
        type: z.literal('LOBBY_STATE'),
        state: LobbyState,
    })
    .strict();

const ProfileRejectMessage = z
    .object({
        type: z.literal('PROFILE_REJECT'),
        reason: z.string().max(WIRE_MAX_PROFILE_REJECT_REASON_LENGTH),
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
    ProfileRejectMessage,
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

/** Canonical shared type for a host-configured lobby controller slot. */
export type LobbyAgentSlot = z.infer<typeof LobbyAgentSlot>;

/** Canonical shared type for the full lobby state. */
export type LobbyState = z.infer<typeof LobbyState>;
