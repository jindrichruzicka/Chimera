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
} from '../preload/api.js';

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
 * Schema for a {@link UserSettings} patch accepted by
 * `chimera:settings:update`. The real three-layer merge and per-game
 * schema validation lands in F07/F19; this schema enforces only the
 * structural `Record<string, unknown>` shape so a hostile renderer cannot
 * pass an array, primitive, or `null` and smuggle past the structural
 * typing into the (future) merger.
 */
export const UserSettingsPatchSchema: z.ZodType<UserSettings> = z.record(z.string(), z.unknown());

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
