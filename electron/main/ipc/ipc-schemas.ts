// electron/main/ipc-schemas.ts
//
// Runtime validation of argument payloads received by `ipcMain.handle` /
// `ipcMain.on` on the `chimera:*` channels. The main-process analogue of
// `electron/preload/schemas.ts` — that file guards responses flowing OUT to
// the renderer; this one guards requests flowing IN from the (untrusted)
// renderer before any handler touches them.
//
// Today's handlers are stubs (F02). The real behaviour arrives in F06/F07/
// F11/F18/F19. Shipping the validation scaffolding now means every future
// handler inherits enforced input validation for free, and the §9.1 IPC
// Attack Surface Audit can point at a single module instead of trusting
// each handler to do its own defensive parsing.
//
// Scope: only `invoke` / `send` *argument* payloads are validated here.
// Response payloads are validated at the preload boundary in
// `electron/preload/schemas.ts`.

import { z } from 'zod';
import type {
    EngineAction,
    HostLobbyParams,
    JoinLobbyParams,
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

/** Schema for a single `gameId` argument (e.g. `chimera:saves:list`). */
export const GameIdSchema = NonEmptyStringSchema;

/** Schema for a single `slotId` argument (e.g. `chimera:saves:load`). */
export const SlotIdSchema = NonEmptyStringSchema;

/** Schema for a single `playerId` argument (e.g. `chimera:game:switch-seat`). */
export const PlayerIdSchema = NonEmptyStringSchema;

/** Schema for {@link HostLobbyParams} accepted by `chimera:lobby:host`. */
export const HostLobbyParamsSchema = z.object({
    gameId: NonEmptyStringSchema,
    maxPlayers: z.number().int().positive(),
}) satisfies z.ZodType<HostLobbyParams>;

/** Schema for {@link JoinLobbyParams} accepted by `chimera:lobby:join`. */
export const JoinLobbyParamsSchema = z.object({
    address: NonEmptyStringSchema,
}) satisfies z.ZodType<JoinLobbyParams>;

/** Schema for `ready` payload accepted by `chimera:lobby:update-ready-state`. */
export const LobbyReadyStateSchema = z.boolean();

/**
 * Schema for {@link SaveRequest} accepted by `chimera:saves:save`.
 * Typed via an explicit cast — see the schema header for why `satisfies`
 * cannot be used with `exactOptionalPropertyTypes` + `.optional()`.
 */
export const SaveRequestSchema: z.ZodType<SaveRequest> = z.object({
    gameId: NonEmptyStringSchema,
    slotId: NonEmptyStringSchema.optional(),
    label: z.string().optional(),
}) as z.ZodType<SaveRequest>;

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
 * to prevent DoS-shaped payloads reaching the merger (BLOCK-4 depth guard).
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
    playerId: NonEmptyStringSchema,
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

export const LogErrorInfoSchema = z.object({
    name: z.string(),
    message: z.string(),
    stack: z.string().optional(),
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
 */
export const RendererLogSourceSchema = z.object({
    module: z.string(),
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
