// electron/preload/schemas.ts
//
// Runtime validation of values returned by main-process `ipcMain.handle`
// calls to the preload's `ipcRenderer.invoke` callers.
//
// The preload namespace factories used to cast `ipc.invoke(...)` results via
// `as Promise<T>` with no runtime shape check, trusting main to return
// whatever each method's declared `SomeType` demands. That held today —
// every handler in F02 is a stub — but any drift between what a future main
// handler actually returns and what the preload contract declares would
// surface as a confusing `Cannot read properties of undefined` inside a React
// component, far from the root cause.
//
// Validating at the preload boundary turns shape drift into a single clear
// `PreloadIpcValidationError` that names the offending channel, so the
// renderer never has to defend against malformed payloads and bug reports
// point at the right file.
//
// Scope: only `invoke` response payloads are validated here. Inbound
// `invoke` argument payloads (main-side) and push-channel events
// (`webContents.send` → `ipcRenderer.on`) are separate concerns and handled
// elsewhere.

import { z } from 'zod';
import type { AssetRef, TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import { toCommitmentId } from '@chimera-engine/simulation/projection/index.js';
import { toSlotId, playerId } from '../api-types.js';
import type {
    ActionRejection,
    ChatMessage,
    CommitmentReveal,
    DeviceInfo,
    LocalProfileSlot,
    LobbyInfo,
    LobbyState,
    PerspectiveReplayPlaybackInfo,
    PlayerProfile,
    RelayResult,
    ReplayListItem,
    ReplayPlaybackInfo,
    ResolvedSettings,
    SaveSlotMeta,
    PlayerId,
} from '../api-types.js';
import type { PlatformInfo } from '../apis/system-api.js';

/**
 * Thrown by {@link parseInvokeResponse} when a main-process payload does not
 * conform to the declared schema. Carries the IPC channel name so bug
 * reports and renderer error boundaries can point at the exact boundary
 * that rejected the payload.
 */
export class PreloadIpcValidationError extends Error {
    /** IPC channel whose response failed validation. */
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
        super(`Preload IPC validation failed for channel "${channel}": ${summary}`);
        this.name = 'PreloadIpcValidationError';
        this.channel = channel;
        this.issues = issues;
    }
}

/**
 * Parse a value received from `ipcRenderer.invoke` against a schema, throwing
 * {@link PreloadIpcValidationError} if it does not conform.
 *
 * Callers typically chain this onto the invoke promise:
 *
 *   ipc.invoke(CHANNEL, arg).then((value) =>
 *       parseInvokeResponse(Schema, CHANNEL, value),
 *   );
 */
export function parseInvokeResponse<T>(schema: z.ZodType<T>, channel: string, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new PreloadIpcValidationError(channel, result.error.issues);
    }
    return result.data;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
//
// One schema per invoke-response payload. For schemas whose inferred type
// matches the declared TypeScript interface exactly, `satisfies z.ZodType<T>`
// pins the link at compile time so a breaking change to either side fails
// the typecheck gate rather than silently diverging.
//
// Schemas with *optional* properties (e.g. `SaveSlotMeta.label?: string`)
// cannot use `satisfies` because Zod's `.optional()` widens the output type
// to `string | undefined`, which `exactOptionalPropertyTypes: true` rejects
// as assignable to `label?: string`. Those schemas are instead typed via an
// explicit `z.ZodType<T, …, …>` annotation that matches the interface; the
// `parseInvokeResponse` helper narrows the return value to `T` at the
// boundary.

/** Schema for {@link PlatformInfo} returned by `chimera:system:platform`. */
export const PlatformInfoSchema = z.object({
    os: z.enum(['macos', 'windows', 'linux']),
    version: z.string(),
}) satisfies z.ZodType<PlatformInfo>;

/** Schema for {@link LobbyInfo} returned by `chimera:lobby:host` and `:join`. */
export const LobbyInfoSchema = z.object({
    sessionId: z.string(),
    hostId: z.string(),
    gameId: z.string(),
}) satisfies z.ZodType<LobbyInfo>;

const LobbyPlayerEntrySchema = z.object({
    playerId: z.string(),
    displayName: z.string(),
    ready: z.boolean(),
});

const LobbyAgentSlotSchema = z.object({
    slotIndex: z.number().int().nonnegative(),
    kind: z.enum(['human', 'ai']),
    omniscient: z.boolean().optional(),
});

export const LobbyStateSchema = z.object({
    info: LobbyInfoSchema,
    players: z.array(LobbyPlayerEntrySchema).readonly(),
    // Synced AI agent slots so a renderer reading the snapshot (e.g. on initial
    // load / replay) sees the AI roster, not just the live `onUpdate` push (#724).
    agentSlots: z.array(LobbyAgentSlotSchema).readonly().optional(),
}) satisfies z.ZodType<LobbyState>;

export const NullableLobbyStateSchema =
    LobbyStateSchema.nullable() satisfies z.ZodType<LobbyState | null>;

// ─── Generic game content (§4.8) ───────────────────────────────────────────────
//
// Structural, game-AGNOSTIC validation of the content collections returned by
// `chimera:content:get-collections`. Each item is only guaranteed a string `id`;
// all other fields pass through untouched (`.passthrough()`) — the engine and
// renderer never interpret them, only the authoring game does. Deliberately not
// annotated `z.ZodType<GameContent>`: GameContent's readonly arrays make the
// ZodType invariance awkward, and the (mutable) inferred output assigns cleanly
// to the readonly `GameContent` at the call site.

/** One content item: a string `id` plus arbitrary passthrough JSON fields. */
export const GameContentItemSchema = z.object({ id: z.string() }).passthrough();

/** A game's collections keyed by collection type → items. */
export const GameContentSchema = z.record(z.string(), z.array(GameContentItemSchema));

/** Nullable variant for `chimera:content:get-collections` (null = game has none). */
export const NullableGameContentSchema = GameContentSchema.nullable();

/** Schema for `chimera:lobby:get-local-player-id` invoke result. */
export const LocalPlayerIdSchema: z.ZodType<PlayerId | null> = z
    .string()
    .transform(playerId)
    .nullable();

/**
 * Schema for a single {@link SaveSlotMeta} returned by `chimera:saves:save`.
 * Typed via a `z.ZodType<SaveSlotMeta>` cast — see the schema header for why
 * `satisfies` cannot be used with `exactOptionalPropertyTypes` + `.optional()`.
 * `as unknown as` is needed for two reasons: (1) `label?: string` requires the
 * double-step cast due to `exactOptionalPropertyTypes` + `.optional()`; and
 * (2) the `SlotId` brand on `slotId` makes the inferred Zod output type
 * incompatible with `z.ZodType<SaveSlotMeta>` without the intermediate cast.
 */
export const SaveSlotMetaSchema: z.ZodType<SaveSlotMeta> = z.object({
    slotId: z.string().transform(toSlotId),
    gameId: z.string(),
    tick: z.number(),
    savedAt: z.number(),
    label: z.string().optional(),
}) as unknown as z.ZodType<SaveSlotMeta>;

/** Schema for the array returned by `chimera:saves:list`. */
export const SaveSlotListSchema: z.ZodType<readonly SaveSlotMeta[]> = z.array(SaveSlotMetaSchema);

/**
 * Schema for {@link ResolvedSettings} returned by `chimera:settings:*`. The
 * declared type is `Record<string, unknown>` — the merge / schema-per-game
 * logic lands in F07/F19 — so the preload gate only enforces "is a plain
 * object, not a primitive / array / null".
 */
export const ResolvedSettingsSchema = z.record(
    z.string(),
    z.unknown(),
) satisfies z.ZodType<ResolvedSettings>;

/**
 * Schema for {@link ActionRejection} pushed on `chimera:game:action-rejected`.
 * Typed via a `z.ZodType<ActionRejection>` cast because `actionType` is
 * optional (same `exactOptionalPropertyTypes` + `.optional()` interaction as
 * {@link SaveSlotMetaSchema}). `tick` allows `-1` to flag a rejection where
 * the envelope was too malformed for the tick to be recovered.
 */
export const ActionRejectionSchema: z.ZodType<ActionRejection> = z.object({
    reason: z.string().min(1),
    tick: z.number().int(),
    actionType: z.string().optional(),
}) as z.ZodType<ActionRejection>;

/** Schema for {@link CommitmentReveal} pushed on `chimera:game:reveal`. */
export const CommitmentRevealSchema = z.object({
    id: z.string().transform(toCommitmentId),
    value: z.unknown(),
    nonce: z.string().min(1),
}) satisfies z.ZodType<CommitmentReveal>;

// ─── Profile domain schemas ───────────────────────────────────────────────────

/**
 * Schema for the {@link AvatarSource} discriminated union returned as part of
 * a {@link PlayerProfile} in `chimera:profile:get-local` or
 * `chimera:profile:get-lobby-directory` responses.
 */
export const AvatarSourceSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('builtin'),
        ref: z.custom<AssetRef<TextureAsset>>(
            (value): value is AssetRef<TextureAsset> => typeof value === 'string',
        ),
    }),
    z.object({
        kind: z.literal('custom'),
        mimeType: z.union([z.literal('image/png'), z.literal('image/jpeg')]),
        base64: z.string(),
    }),
]);

/**
 * Schema for {@link PlayerProfile} returned by
 * `chimera:profile:get-local`.
 *
 * Structural validation only — business-rule checks (display-name
 * length caps, avatar byte limits) are enforced by `ProfileSanitizer` on
 * the main process side before profiles reach the renderer.
 */
export const PlayerProfileSchema = z.object({
    localProfileId: z.string(),
    displayName: z.string(),
    avatar: AvatarSourceSchema,
    locale: z.string(),
}) satisfies z.ZodType<PlayerProfile>;

/**
 * Schema for the `Record<PlayerId, PlayerProfile>` directory returned by
 * `chimera:profile:get-lobby-directory`.
 */
export const LobbyDirectorySchema = z.record(z.string(), PlayerProfileSchema);

/**
 * Schema for a single {@link LocalProfileSlot} entry returned by
 * `chimera:profile:list-local-slots`.
 */
export const LocalProfileSlotSchema = z.object({
    localProfileId: z.string(),
    displayName: z.string(),
});

/** Schema for the array returned by `chimera:profile:list-local-slots`. */
export const LocalProfileSlotListSchema: z.ZodType<readonly LocalProfileSlot[]> =
    z.array(LocalProfileSlotSchema);

/**
 * Schema for the `readonly string[]` returned by
 * `chimera:game:predictable-action-types`. Each element is the
 * `ActionDefinition.type` string of a predictable action.
 */
export const PredictableActionTypesSchema: z.ZodType<readonly string[]> = z.array(z.string());

// ─── Replay domain schemas (§4.28) ────────────────────────────────────────────

/**
 * Schema for a single {@link ReplayListItem} element of the array returned by
 * `chimera:replay:list`. Structural validation only — the host projects these
 * from validated replay files; the gate catches main↔preload contract drift.
 */
export const ReplayListItemSchema = z.object({
    path: z.string().min(1),
    gameId: z.string(),
    gameVersion: z.string(),
    engineVersion: z.string(),
    recordedAt: z.string(),
    durationTicks: z.number().int(),
    playerIds: z.array(z.string()),
}) satisfies z.ZodType<ReplayListItem>;

/** Schema for the array returned by `chimera:replay:list`. */
export const ReplayListSchema: z.ZodType<readonly ReplayListItem[]> = z.array(ReplayListItemSchema);

/**
 * Schema for the saved file path returned by `chimera:replay:export-current-match`.
 */
export const ReplaySavedPathSchema: z.ZodType<string> = z.string().min(1);

/**
 * Schema for the {@link ReplayPlaybackInfo} returned by
 * `chimera:replay:open-playback`. Structural validation only — the host builds
 * it from a validated replay file; the gate catches main↔preload contract drift.
 *
 * The per-tick `PlayerSnapshot` returned by `chimera:replay:snapshot-at` is not
 * schema-validated here: it is projected host-side and handled exactly like
 * `chimera:game:get-current-snapshot` (a trusted cast — invariant #3 guarantees
 * only a `PlayerSnapshot` can reach that channel).
 */
export const ReplayPlaybackInfoSchema = z.object({
    gameId: z.string(),
    totalTicks: z.number().int(),
    playerIds: z.array(z.string()),
    viewerId: z.string(),
}) satisfies z.ZodType<ReplayPlaybackInfo>;

/**
 * Schema for the path array returned by `chimera:replay:perspective:list`.
 * A perspective replay's metadata is read only when it is opened, so `list`
 * yields opaque, non-empty path handles rather than the rich
 * {@link ReplayListItem}s of the deterministic surface.
 */
export const PerspectiveReplayPathListSchema: z.ZodType<readonly string[]> = z.array(
    z.string().min(1),
);

/**
 * Schema for the {@link PerspectiveReplayPlaybackInfo} returned by
 * `chimera:replay:perspective:open-playback`. Structural validation only — the
 * host builds it from a validated perspective replay file; the gate catches
 * main↔preload contract drift. Carries the single locked `viewerId` and **no
 * `playerIds`** (invariant #98).
 *
 * As with the deterministic surface, the per-tick `PlayerSnapshot` returned by
 * `chimera:replay:perspective:snapshot-at` is not schema-validated here: it is a
 * stored, already-projected snapshot handled as a trusted cast (invariant #3).
 */
export const PerspectiveReplayPlaybackInfoSchema = z.object({
    gameId: z.string(),
    totalTicks: z.number().int(),
    viewerId: z.string(),
}) satisfies z.ZodType<PerspectiveReplayPlaybackInfo>;

// ─── Chat domain schemas (§4.29) ──────────────────────────────────────────────
//
// Response-side mirror of the canonical chat contract (`shared/chat.ts`). Kept
// local to the preload boundary like every other namespace's response schema —
// the preload owns its own drift gate and imports `shared/` type-only.

/**
 * Schema for the {@link import('../api-types.js').ChatScope} routing discriminant
 * embedded in a {@link ChatMessage}. Structural validation only; the host relay
 * is the source of truth for scope semantics (recipient resolution, Invariant #73).
 */
const ChatScopeSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('lobby') }).strict(),
    z.object({ kind: z.literal('team'), teamId: z.string() }).strict(),
    z.object({ kind: z.literal('private'), toPlayerId: z.string() }).strict(),
]);

/**
 * Schema for a {@link ChatMessage} pushed on `chimera:chat:message` or returned
 * by `chimera:chat:history`. The `as unknown as` cast bridges the `PlayerId`
 * brand on `fromPlayerId` (and inside a private `scope`) — the runtime shape is
 * validated exactly; only the compile-time brand is re-applied by the annotation.
 */
export const ChatMessageSchema: z.ZodType<ChatMessage> = z
    .object({
        id: z.string(),
        fromPlayerId: z.string(),
        scope: ChatScopeSchema,
        body: z.string(),
        serverTime: z.number(),
    })
    .strict() as unknown as z.ZodType<ChatMessage>;

/** Schema for the bounded, server-ordered list returned by `chimera:chat:history`. */
export const ChatMessageListSchema: z.ZodType<readonly ChatMessage[]> = z.array(ChatMessageSchema);

/** Schema for the {@link RelayResult} returned by `chimera:chat:send`. */
export const RelayResultSchema = z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true) }).strict(),
    z
        .object({
            ok: z.literal(false),
            reason: z.enum(['too_long', 'rate_limited', 'empty', 'invalid_scope', 'no_session']),
        })
        .strict(),
]) satisfies z.ZodType<RelayResult>;

// ─── System device-info schema (§4.17) ───────────────────────────────────────

const ScreenEntrySchema = z.object({
    id: z.number(),
    width: z.number(),
    height: z.number(),
    pixelRatio: z.number(),
    refreshHz: z.number(),
    primary: z.boolean(),
});

/**
 * Schema for {@link DeviceInfo} returned by `chimera:system:device-info`.
 *
 * Uses `z.ZodType<DeviceInfo>` annotation (rather than `satisfies`) because
 * `inputs` is a `readonly InputModality[]` whose Zod inferred type is
 * `string[]` — not assignable under `exactOptionalPropertyTypes` rules.
 */
export const DeviceInfoSchema: z.ZodType<DeviceInfo> = z.object({
    os: z.enum(['macos', 'windows', 'linux']),
    osVersion: z.string(),
    arch: z.enum(['x64', 'arm64']),
    electronVer: z.string(),
    chromiumVer: z.string(),
    locale: z.string(),
    formFactor: z.enum(['desktop', 'laptop', 'tablet-convertible', 'unknown']),
    screens: z.array(ScreenEntrySchema).min(1),
    windowSizeClass: z.enum(['compact', 'regular', 'large', 'ultrawide']),
    inputs: z.array(z.enum(['mouse', 'keyboard', 'touch', 'pen', 'gamepad'])),
    primaryInput: z.enum(['mouse', 'keyboard', 'touch', 'pen', 'gamepad']),
    battery: z
        .object({
            charging: z.boolean(),
            level: z.number().min(0).max(1),
        })
        .nullable(),
});
