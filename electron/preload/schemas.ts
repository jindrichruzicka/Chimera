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
import type { ActionRejection, LobbyInfo, ResolvedSettings, SaveSlotMeta } from './api-types.js';
import type { PlatformInfo } from './system-api.js';

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

/**
 * Schema for a single {@link SaveSlotMeta} returned by `chimera:saves:save`.
 * Typed via a `z.ZodType<SaveSlotMeta>` cast — see the schema header for why
 * `satisfies` cannot be used with `exactOptionalPropertyTypes` + `.optional()`.
 */
export const SaveSlotMetaSchema: z.ZodType<SaveSlotMeta> = z.object({
    slotId: z.string(),
    gameId: z.string(),
    tick: z.number(),
    savedAt: z.number(),
    label: z.string().optional(),
}) as z.ZodType<SaveSlotMeta>;

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
