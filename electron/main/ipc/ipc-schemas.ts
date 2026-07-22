// electron/main/ipc-schemas.ts
//
// Runtime validation of argument payloads received by `ipcMain.handle` /
// `ipcMain.on` on the `chimera:*` channels. The main-process analogue of
// `electron/preload/schemas.ts` — that file guards responses flowing OUT to
// the renderer; this one guards requests flowing IN from the (untrusted)
// renderer before any handler touches them.
//
// Centralising the validation scaffolding here means every handler inherits
// enforced input validation for free, and the §9.1 IPC Attack Surface Audit
// can point at a single module instead of trusting each handler to do its own
// defensive parsing.
//
// Scope: only `invoke` / `send` *argument* payloads are validated here.
// Response payloads are validated at the preload boundary in
// `electron/preload/schemas.ts`.

import { z } from 'zod';
import {
    WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH,
    WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH,
} from '@chimera-engine/simulation/foundation/messages-schemas.js';
import { ChatScopeSchema } from '@chimera-engine/simulation/foundation/chat-schemas.js';
import type { ChatScope } from '@chimera-engine/simulation/foundation/chat.js';
import { MAX_SAVE_LABEL_LENGTH, toSlotId, playerId } from '../../preload/api-types.js';
import type {
    EngineAction,
    HostLobbyParams,
    JoinLobbyParams,
    LobbyAgentSlot,
    ReplayExportIntent,
    RestoreStatusEvent,
    SaveRequest,
    UserSettings,
} from '../../preload/api-types.js';

/**
 * Thrown by {@link parseInvokeRequest} when a renderer-supplied payload does
 * not conform to the declared schema. Carries the IPC channel name so
 * structured logs and bug reports point at the exact boundary that rejected
 * the payload. Electron surfaces a thrown error inside an `ipcMain.handle`
 * callback as a rejected promise on the renderer side — so throwing this
 * class is the correct way to signal a malformed request.
 */
export class IpcRequestValidationError extends Error {
    /** IPC channel whose request failed validation. */
    readonly channel: string;
    /** Structured Zod issues; useful for tests and structured logs. */
    readonly issues: readonly z.ZodIssue[];

    constructor(channel: string, issues: readonly z.ZodIssue[]) {
        const summary = issues
            .map((issue) => {
                const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
                return `${path}: ${issue.message}`;
            })
            .join('; ');
        super(`Main IPC request validation failed for channel "${channel}": ${summary}`);
        this.name = 'IpcRequestValidationError';
        this.channel = channel;
        this.issues = issues;
    }
}

/**
 * Parse an argument received by an `ipcMain.handle` / `ipcMain.on` callback
 * against a schema, throwing {@link IpcRequestValidationError} if it does
 * not conform.
 *
 * Callers run this at the top of every handler that accepts a structured
 * payload, before any manager mutation or side effect:
 *
 *   ipcMain.handle(CHANNEL, (_event, arg) => {
 *       const parsed = parseInvokeRequest(Schema, CHANNEL, arg);
 *       // … safe to use `parsed` here …
 *   });
 */
export function parseInvokeRequest<T>(schema: z.ZodType<T>, channel: string, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new IpcRequestValidationError(channel, result.error.issues);
    }
    return result.data;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
//
// One schema per invoke/send argument shape. Schemas whose inferred type
// matches the declared TypeScript interface exactly use `satisfies
// z.ZodType<T>` to pin the link at compile time. Schemas with *optional*
// properties (e.g. `SaveRequest.slotId?: string`) use an explicit
// `z.ZodType<T>` annotation + cast to work around the
// `exactOptionalPropertyTypes: true` + `.optional()` interaction — see the
// equivalent header in `electron/preload/schemas.ts` for the full rationale.

/**
 * A non-empty string used as an opaque identifier (playerId, gameId,
 * slotId, session address, …). Empty strings are almost always a bug
 * upstream — rejecting them here keeps the handler bodies free of
 * "is this string actually populated?" defensive checks.
 */
export const NonEmptyStringSchema = z.string().min(1);

/**
 * Schema for a no-argument invoke channel: the renderer must send no payload.
 * `ipcRenderer.invoke(channel)` with no second argument reaches the main-side
 * handler as `undefined`; this schema validates that emptiness so the handler
 * still satisfies the "validate every IPC boundary" rule (§8.3) and rejects any
 * stray payload before reaching a manager. Shared by host-only no-arg channels.
 */
export const EmptyPayloadSchema = z.undefined();

/** Schema for a single `gameId` argument (e.g. `chimera:saves:list`). */
export const GameIdSchema = NonEmptyStringSchema;

/** Schema for the `chimera:content:get-collections` request payload (§4.8). */
export const GetContentCollectionsParamsSchema = z.object({ gameId: GameIdSchema });

/**
 * Schema for a replay file-path argument (`chimera:replay:open-in-player`,
 * `chimera:replay:delete`). Shape validation only — "is this a populated
 * string?". The real path-traversal defence is enforced downstream by
 * `FileReplayRepository.assertInsideBase`, which rejects any path that
 * resolves outside the replay directory with a `ReplayPathError` (OWASP A01).
 */
export const ReplayPathSchema = NonEmptyStringSchema;

/**
 * Schema for a replay playback tick argument (`chimera:replay:snapshot-at`).
 * Ticks are non-negative integers (invariant #42); the playback manager
 * additionally rejects ticks beyond the replay's length.
 */
export const ReplayTickSchema = z.number().int().nonnegative();

/**
 * Hard upper bound on the number of ticks a single
 * `chimera:replay:snapshot-range` request may span. Bounds the per-call
 * projection loop so a malformed/hostile renderer cannot ask main to project an
 * unbounded number of snapshots in one round-trip (OWASP A05 — resource limit).
 */
export const MAX_SNAPSHOT_RANGE = 256;

/**
 * Schema for a replay playback *range* argument
 * (`chimera:replay:snapshot-range`). Both bounds are non-negative integer ticks
 * (invariant #42), `to` must not precede `from`, and the inclusive span is
 * capped at {@link MAX_SNAPSHOT_RANGE} ticks.
 */
export const ReplaySnapshotRangeSchema = z
    .object({ from: ReplayTickSchema, to: ReplayTickSchema })
    .refine(({ from, to }) => to >= from, { message: '`to` must be >= `from`' })
    .refine(({ from, to }) => to - from < MAX_SNAPSHOT_RANGE, {
        message: `snapshot range may span at most ${MAX_SNAPSHOT_RANGE.toString()} ticks`,
    });

/**
 * Schema for the optional `intent` argument of
 * `chimera:replay:export-current-match`. `'save'` (the user pressed the replay
 * player's **save icon**) raises the §4.30 "Replay saved" toast; `'view'` (the
 * post-game **Replay** button) exports only to obtain a stable on-disk path for
 * `openInPlayer` and suppresses the toast.
 *
 * Unlike the other replay schemas this one is deliberately **non-throwing**:
 * `.catch('save')` coerces an absent, `undefined`, or otherwise malformed value
 * to `'save'`. The only thing this boundary must prevent is a hostile or buggy
 * renderer *suppressing* a toast it should not — never breaking the export
 * itself over a cosmetic decision. Failing safe to `'save'` means an unexpected
 * payload shows the (harmless) toast rather than silently hiding it.
 */
export const ReplayExportIntentSchema: z.ZodType<ReplayExportIntent> = z
    .enum(['save', 'view'])
    .catch('save');

/**
 * Schema for the optional `saveable` flag of `chimera:replay:open-in-player`
 * (and its perspective twin). `true` marks the just-finished match so the player
 * surfaces its compact save icon; `false` (the default) is a library-opened
 * replay, already on disk.
 *
 * Like {@link ReplayExportIntentSchema} this is deliberately **non-throwing**:
 * `.catch(false)` coerces an absent, `undefined`, or malformed value to `false`.
 * The flag only governs whether a (harmless, idempotent) save affordance is
 * shown, so failing safe to "not saveable" can never break navigation itself.
 */
export const ReplaySaveableFlagSchema: z.ZodType<boolean> = z.boolean().catch(false);

/**
 * The `chimera:replay:export-current-match` request payload: the toast-gating
 * {@link ReplayExportIntent} plus the optional user-entered replay `name` from
 * the player's save dialog.
 */
export interface ReplayExportRequest {
    readonly intent: ReplayExportIntent;
    readonly name?: string;
}

/**
 * Schema for the {@link ReplayExportRequest}. Deliberately **non-throwing** via
 * `.catch({ intent: 'save' })`: any malformed/absent payload — an unexpected bare
 * value from an older renderer, or a `name` over the bound — fails safe to a
 * named-less save (toast shown), so a hostile/buggy renderer can neither break
 * the export nor silently suppress the toast (mirrors {@link ReplayExportIntentSchema}).
 *
 * `name` is bounded to {@link MAX_SAVE_LABEL_LENGTH} — the same limit as a save
 * label, which the save dialog mirrors as its input `maxLength` so the UI can
 * never produce a name the wire silently drops.
 */
export const ReplayExportRequestSchema = z
    .object({
        intent: ReplayExportIntentSchema,
        name: z.string().max(MAX_SAVE_LABEL_LENGTH).optional(),
    })
    .catch({ intent: 'save' }) as unknown as z.ZodType<ReplayExportRequest>;

/**
 * The `chimera:replay:perspective:export-current` request payload: only the
 * optional user-entered replay `name` (the perspective surface takes no intent —
 * it raises no "Replay saved" toast).
 */
export interface PerspectiveReplayExportRequest {
    readonly name?: string;
}

/**
 * Schema for the {@link PerspectiveReplayExportRequest}. Non-throwing via
 * `.catch({})`: a malformed/absent payload (or an over-long name) fails safe to
 * an unnamed export rather than breaking the client's save. `name` is bounded to
 * {@link MAX_SAVE_LABEL_LENGTH} (the save dialog mirrors the bound).
 */
export const PerspectiveReplayExportRequestSchema = z
    .object({
        name: z.string().max(MAX_SAVE_LABEL_LENGTH).optional(),
    })
    .catch({}) as unknown as z.ZodType<PerspectiveReplayExportRequest>;

/**
 * Pattern for a single slot-ID component (`gameId` or `slotName`).
 * Mirrors `SLOT_COMPONENT_RE` in `FileSaveRepository` — duplicated
 * intentionally so the IPC schema layer has no import dependency on
 * the save-persistence layer.
 */
const SLOT_COMPONENT_PAT = '[a-z0-9][a-z0-9_-]{0,63}';

/**
 * Schema for a single qualified `slotId` argument (e.g. `chimera:saves:load`).
 * Must be `'<gameId>/<slotName>'` — each component matching
 * `^[a-z0-9][a-z0-9_-]{0,63}$`.  Enforcing the structure here means
 * `parseGameIdFromSlotId` in the handler can assume validity and never
 * silently degrade to "no broadcast".
 */
export const SlotIdSchema = z
    .string()
    .regex(
        new RegExp(`^${SLOT_COMPONENT_PAT}\\/${SLOT_COMPONENT_PAT}$`),
        'slotId must be "<gameId>/<slotName>" — each component: ^[a-z0-9][a-z0-9_-]{0,63}$',
    )
    .transform(toSlotId);

/** Schema for `playerId` fields inside validated IPC payloads. */
export const PlayerIdSchema = NonEmptyStringSchema.transform(playerId);

const LobbyAgentSlotSchema = z
    .object({
        slotIndex: z.number().int().nonnegative(),
        kind: z.enum(['human', 'ai']),
        omniscient: z.boolean().optional(),
    })
    .strict();

/** Schema for {@link HostLobbyParams} accepted by `chimera:lobby:host`. */
export const HostLobbyParamsSchema = z
    .object({
        gameId: NonEmptyStringSchema,
        maxPlayers: z.number().int().positive(),
        agentSlots: z.array(LobbyAgentSlotSchema).readonly().optional(),
        // Optional lobby password. Bounded to avoid unbounded payloads;
        // a present password must be non-empty (an empty/whitespace password is
        // treated as "no password" at the call site, not sent over IPC).
        password: z.string().min(1).max(128).optional(),
    })
    .transform((value): HostLobbyParams => {
        const agentSlots = value.agentSlots?.map((slot): LobbyAgentSlot => {
            if (slot.omniscient === undefined) {
                return { slotIndex: slot.slotIndex, kind: slot.kind };
            }
            return { slotIndex: slot.slotIndex, kind: slot.kind, omniscient: slot.omniscient };
        });

        const base = {
            gameId: value.gameId,
            maxPlayers: value.maxPlayers,
            ...(value.password !== undefined ? { password: value.password } : {}),
        };

        if (agentSlots === undefined) {
            return base;
        }

        return { ...base, agentSlots };
    });

/** Schema for {@link JoinLobbyParams} accepted by `chimera:lobby:join`. */
export const JoinLobbyParamsSchema = z
    .object({
        address: NonEmptyStringSchema,
        // Optional lobby password — bounded; absent on open lobbies.
        password: z.string().max(128).optional(),
    })
    // Map to the explicit type so an absent password is omitted rather than set
    // to `undefined` (the repo runs with `exactOptionalPropertyTypes`).
    .transform((value): JoinLobbyParams => {
        if (value.password === undefined) {
            return { address: value.address };
        }
        return { address: value.address, password: value.password };
    });

/** Schema for `ready` payload accepted by `chimera:lobby:update-ready-state`. */
export const LobbyReadyStateSchema = z.boolean();

/**
 * Schema for the `{key, value}` payload accepted by
 * `chimera:lobby:set-match-setting` (host-only). `value` may be empty (e.g. a
 * "none" option); `key` must be a non-empty setting id. `.strict()` rejects
 * unknown keys at the boundary (§9.1).
 */
export const SetMatchSettingPayloadSchema = z
    .object({
        key: NonEmptyStringSchema,
        value: z.string(),
    })
    .strict();

/**
 * Schema for the `{playerId, key, value}` payload accepted by
 * `chimera:lobby:set-player-attribute`. Owner-authored: the handler
 * accepts only the caller's own-seat write; `playerId` is validated and
 * branded via {@link PlayerIdSchema} so the handler receives a typed `PlayerId`.
 * `key`/`value` are length-capped to match the wire frame's coarse bounds —
 * the value bound is wide so game-defined structured payloads (e.g. a
 * JSON-encoded deck) can pass; the precise per-game cap
 * (`GameLobbySetup.maxAttributeValueLength`, default 256) is enforced by
 * `LobbyManager.setPlayerAttribute` behind this boundary.
 */
export const SetPlayerAttributePayloadSchema = z
    .object({
        playerId: PlayerIdSchema,
        key: NonEmptyStringSchema.max(WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH),
        value: z.string().max(WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH),
    })
    .strict();

/**
 * Schema for the `{slotIndex}` payload accepted by `chimera:lobby:remove-ai`
 * (host-only). `slotIndex` is a non-negative integer matching the slot index
 * the host assigned when the AI was added. `.strict()` rejects unknown
 * keys at the boundary (§9.1). The companion `chimera:lobby:add-ai` channel
 * takes no payload (the host assigns the next free slot index).
 */
export const RemoveAiPayloadSchema = z
    .object({
        slotIndex: z.number().int().nonnegative(),
    })
    .strict();

/**
 * Schema for {@link SaveRequest} accepted by `chimera:saves:save`.
 * Typed via an explicit cast — see the schema header for why `satisfies`
 * cannot be used with `exactOptionalPropertyTypes` + `.optional()`.
 * `as unknown as` is needed for two reasons: (1) `slotId?: SlotId` (branded)
 * prevents `as z.ZodType<SaveRequest>` — the double-cast is safe here because
 * SlotIdSchema validates the qualified format on the load/delete channels;
 * save accepts any non-empty string hint; and (2) the `label?: string` field
 * triggers the `exactOptionalPropertyTypes` + `.optional()` incompatibility.
 *
 * `label` is user-typed free text persisted into slot metadata; it is bounded
 * to {@link MAX_SAVE_LABEL_LENGTH} (the save-name input mirrors the bound as
 * its `maxLength`). Read paths stay unbounded so legacy saves keep loading.
 */
export const SaveRequestSchema: z.ZodType<SaveRequest> = z.object({
    gameId: NonEmptyStringSchema,
    slotId: NonEmptyStringSchema.optional(),
    label: z.string().max(MAX_SAVE_LABEL_LENGTH).optional(),
}) as unknown as z.ZodType<SaveRequest>;

/**
 * Schema for the {@link RestoreStatusEvent} pushed over
 * `chimera:saves:restore-status`. Main-side copy — the preload
 * validates the same shape independently in `preload/shared/schemas.ts`
 * (Invariant #5: no shared schema module spans the main↔preload boundary).
 * `toRestoreStatusEvent` parses every outgoing event through this schema so
 * a slim, validated projection is the only thing that can cross IPC
 * (Invariant #1). `matchId` allows `''` — a load can fail before any
 * validated matchId exists. The state↔lobbyCode and state↔pendingSeats
 * correlations are pinned by the refinements: `waiting` must carry the join
 * code (the overlay shows it) and at least one pending seat (a fully seated
 * restore is `ready`, never `waiting`); every other state must carry
 * neither. The `as unknown as` cast is the established `.optional()` ×
 * `exactOptionalPropertyTypes` workaround (see {@link SaveRequestSchema}).
 */
export const RestoreStatusEventSchema: z.ZodType<RestoreStatusEvent> = z
    .object({
        state: z.enum(['waiting', 'ready', 'cancelled', 'failed']),
        gameId: NonEmptyStringSchema,
        matchId: z.string(),
        lobbyCode: NonEmptyStringSchema.optional(),
        pendingSeats: z.array(NonEmptyStringSchema.transform(playerId)).readonly(),
    })
    .refine((event) => event.state !== 'waiting' || event.lobbyCode !== undefined, {
        message: "a 'waiting' event must carry the lobby join code",
        path: ['lobbyCode'],
    })
    .refine((event) => event.state === 'waiting' || event.lobbyCode === undefined, {
        message: "lobbyCode is only valid on a 'waiting' event",
        path: ['lobbyCode'],
    })
    .refine((event) => (event.state === 'waiting') === event.pendingSeats.length > 0, {
        message: "a 'waiting' event must carry pending seats; other states must carry none",
        path: ['pendingSeats'],
    }) as unknown as z.ZodType<RestoreStatusEvent>;

/**
 * Maximum allowed nesting depth for a {@link UserSettings} patch.
 * Settings patches are at most 3 levels deep (e.g. `{ audio: { masterVolume: 0.5 } }`).
 * Inputs deeper than this limit are rejected to prevent DoS-shaped payloads
 * from reaching downstream merge/validate logic.
 */
const SETTINGS_PATCH_MAX_DEPTH = 5;

function objectDepth(value: unknown, current = 0): number {
    if (current > SETTINGS_PATCH_MAX_DEPTH) return current;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return current;
    const depths = Object.values(value as Record<string, unknown>).map((v) =>
        objectDepth(v, current + 1),
    );
    return depths.length === 0 ? current : Math.max(...depths);
}

/**
 * Schema for a {@link UserSettings} patch accepted by
 * `chimera:settings:update`. Enforces the structural `Record<string, unknown>`
 * shape and rejects objects nested deeper than {@link SETTINGS_PATCH_MAX_DEPTH}
 * to prevent DoS-shaped payloads reaching the merger.
 */
export const UserSettingsPatchSchema: z.ZodType<UserSettings> = z
    .record(z.string(), z.unknown())
    .refine((v) => objectDepth(v) <= SETTINGS_PATCH_MAX_DEPTH, {
        message: `Settings patch must not be nested deeper than ${SETTINGS_PATCH_MAX_DEPTH} levels`,
    });

/**
 * Structural schema for the {@link EngineAction} envelope accepted by
 * `chimera:game:send-action`. The action-type-specific `parsePayload`
 * validator is the simulation layer's job (§4.7); this schema guards
 * only the outer envelope so a malformed request cannot reach the
 * pipeline. `payload` must be a plain object — arrays, primitives, and
 * `null` are rejected before the registry lookup runs.
 */
export const EngineActionSchema = z.object({
    type: NonEmptyStringSchema,
    playerId: PlayerIdSchema,
    tick: z.number().int().nonnegative(),
    payload: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<EngineAction>;

/**
 * Runtime schema for a {@link LogEntry} received from the renderer via
 * `chimera:logs:emit`. Validates every required field before forwarding
 * to the main-process logger (Invariant 1).
 */
export const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

export const LogSourceSchema = z.union([
    z.object({ process: z.literal('main'), module: z.string() }),
    z.object({ process: z.literal('renderer'), module: z.string() }),
    z.object({ process: z.literal('simulation'), module: z.string() }),
]);

// Capped like `message` below — every string field this schema *names* is
// bounded (§9.1): `message`, `source.module`, and these three. `context` is
// named but bounded in shape only, so neither it nor any string inside it has
// a size bound; §4.27 states why. Every patched renderer
// console.warn/console.error carrying an Error emits one of these, so the
// field is reachable at volume rather than once per crash. The renderer
// truncates to these exact caps in
// serialiseError (renderer/logging/rendererLogger.ts — the two sides cannot
// share a constant across the electron/renderer boundary), so on the
// RendererLogEntrySchema channel an oversized field means a producer that
// bypassed the bridge, and the entry is dropped like any other malformed
// payload. LogEntrySchema shares these caps as a plain bound only: main-side
// producers build their LogErrorInfo without truncation and are not validated
// by it in production.
export const LogErrorInfoSchema = z.object({
    name: z.string().max(256),
    message: z.string().max(4096),
    stack: z.string().max(8192).optional(),
});

export const LogEntrySchema = z.object({
    level: LogLevelSchema,
    message: z.string().max(4096),
    timestamp: z.number().int().nonnegative().finite(),
    source: LogSourceSchema,
    context: z.record(z.string(), z.unknown()).optional(),
    error: LogErrorInfoSchema.optional(),
});

/**
 * Schema for the `source` field of a {@link LogEntry} arriving from the
 * renderer via `chimera:logs:emit`. Only `module` is validated — `process`
 * is intentionally absent so any renderer-supplied value is stripped by
 * Zod before the handler sees it. The handler unconditionally sets
 * `process: 'renderer'` on the trusted entry (§9.1, Invariant #1).
 *
 * `module` reaches the sink verbatim, so it carries the same cap as the
 * other renderer-supplied strings; `makeEntry` truncates to it renderer-side
 * (renderer/logging/rendererLogger.ts) because this handler drops on
 * validation failure rather than truncating.
 */
export const RendererLogSourceSchema = z.object({
    module: z.string().max(256),
});

/**
 * Schema for a {@link LogEntry} received from the renderer via
 * `chimera:logs:emit`. Differs from {@link LogEntrySchema} in that
 * `source.process` is **not part of the schema** — any renderer-supplied
 * `process` value is stripped by Zod's default object parsing, and the
 * handler replaces it with the server-side constant `'renderer'`.
 * `timestamp` is also validated (must be a number) but the handler
 * overrides it with `Date.now()` after parsing (§9.1, Invariant #1).
 */
export const RendererLogEntrySchema = z.object({
    level: LogLevelSchema,
    message: z.string().max(4096),
    timestamp: z.number().int().nonnegative().finite(),
    source: RendererLogSourceSchema,
    context: z.record(z.string(), z.unknown()).optional(),
    error: LogErrorInfoSchema.optional(),
});

// ─── Profile domain schemas ───────────────────────────────────────────────────

/**
 * Schema for the `{ localProfileId: string }` payload accepted by
 * `chimera:profile:switch-slot`.
 */
export const SwitchLocalSlotRequestSchema = z.object({
    localProfileId: NonEmptyStringSchema,
});

/**
 * Zod schema for the {@link AvatarSource} discriminated union received in an
 * `updateLocal` patch payload. Mirrors the client-side `AvatarSourceSchema`
 * in `electron/preload/shared/schemas.ts` — defined independently here
 * (Invariant #5: channel constants + payload shapes live in their respective
 * boundary modules; no shared schema file spans both sides).
 */
export const AvatarSourceSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('builtin'),
        ref: z.string().min(1),
    }),
    z.object({
        kind: z.literal('custom'),
        mimeType: z.union([z.literal('image/png'), z.literal('image/jpeg')]),
        base64: z.string().min(1),
    }),
]);

/**
 * Schema for the `patch` argument accepted by `chimera:profile:update-local`.
 *
 * `localProfileId` is intentionally absent — it is the immutable primary key
 * and must never be patched over IPC. Any payload containing it is rejected
 * by `.strict()` which disallows unknown keys.
 *
 * All fields are optional because the renderer may send a partial update
 * (e.g. only `displayName` or only `avatar`).
 */
export const EngineProfilePatchSchema = z
    .object({
        displayName: z.string().optional(),
        avatar: AvatarSourceSchema.optional(),
        locale: z.string().optional(),
    })
    .strict();

// ─── Chat domain schemas (§4.29) ──────────────────────────────────────────────

/**
 * Schema for the `{ body, scope }` payload accepted by `chimera:chat:send`.
 *
 * Reuses the canonical {@link ChatScopeSchema} (shared with the wire `CHAT`
 * frame in `shared/messages-schemas.ts`) so a single scope definition guards
 * every *server-side* boundary — this does not span the main↔preload IPC
 * boundary (the preload owns an independent copy, Invariant #5). The
 * `as unknown as` cast bridges the `PlayerId` brand inside a `private` scope; the
 * runtime shape is validated exactly. The relay re-checks scope semantics and
 * caps `body` length (Invariant #73); this guards only the envelope.
 */
export const ChatSendRequestSchema: z.ZodType<{
    readonly body: string;
    readonly scope: ChatScope;
}> = z
    .object({
        body: z.string(),
        scope: ChatScopeSchema,
    })
    .strict() as unknown as z.ZodType<{ readonly body: string; readonly scope: ChatScope }>;

/**
 * Schema for the `{ maxEntries? }` payload accepted by `chimera:chat:history`.
 * `maxEntries` bounds the returned slice; the hub clamps it to the buffer size.
 */
export const ChatHistoryRequestSchema = z
    .object({
        maxEntries: z.number().int().nonnegative().optional(),
    })
    .strict();

/**
 * Schema for the `{ playerId }` payload accepted by `chimera:chat:mute` and
 * `chimera:chat:unmute`. Reuses {@link PlayerIdSchema} so the handler receives a
 * branded `PlayerId`.
 */
export const ChatMuteRequestSchema = z
    .object({
        playerId: PlayerIdSchema,
    })
    .strict();

/**
 * Schema for the `{ targetPlayerId }` payload accepted by
 * `chimera:spectate:set-target` (Spectator Mode). Reuses
 * {@link PlayerIdSchema} so the handler receives a branded `PlayerId` for the
 * seat a spectator wants to follow.
 */
export const SpectateSetTargetPayloadSchema = z
    .object({
        targetPlayerId: PlayerIdSchema,
    })
    .strict();
