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
import type { AssetRef, TextureAsset } from '@chimera/simulation/content/AssetRef.js';
import { toSlotId } from '../api-types.js';
import type {
    ActionRejection,
    CrashRecoveryStatus,
    LocalProfileSlot,
    LobbyInfo,
    PlayerProfile,
    ResolvedSettings,
    SaveSlotMeta,
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

/** Schema for `chimera:lobby:get-local-player-id` invoke result. */
export const LocalPlayerIdSchema = z.string().nullable();

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
 * Schema for {@link CrashRecoveryStatus} returned by
 * `chimera:saves:check-crash-recovery`.
 */
export const CrashRecoveryStatusSchema = z.object({
    needsRecovery: z.boolean(),
    slotId: z.string().transform(toSlotId).nullable(),
}) satisfies z.ZodType<CrashRecoveryStatus>;

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
