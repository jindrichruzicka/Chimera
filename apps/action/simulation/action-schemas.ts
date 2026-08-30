// The action app's action payload schemas. Zod schemas live here — separate
// from the reducer logic in `actions.ts` — so validation is easy to extend.
//
// Module boundary: imports only zod and own types — never renderer, electron,
// or another game.

import { z } from 'zod';

import type { ActionSelectPrimitivePayload, ActionSetVelocityPayload } from './action-types.js';

/**
 * A velocity component, spelled as the three literals rather than as an integer
 * range. The union IS the vocabulary; a range reads as a bound to loosen.
 */
const ActionVelocityComponentSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

/**
 * Validates a raw `action:set-velocity` payload. `.strict()` so an extra key
 * (a stale `dz` from a three-axis experiment, say) fails loudly at the wire
 * boundary instead of being silently dropped. Throws `ZodError` on invalid
 * input; `StateReducer` wraps that into `ActionSchemaError`.
 */
export const ActionSetVelocityPayloadSchema: z.ZodType<ActionSetVelocityPayload> = z
    .object({
        dx: ActionVelocityComponentSchema,
        dy: ActionVelocityComponentSchema,
    })
    .strict();

/**
 * Validates a raw `action:select-primitive` payload. The id is kept as a plain
 * non-empty string here — WHICH entity it names is a semantic question, so
 * `validate()` answers it against the snapshot rather than the schema.
 */
export const ActionSelectPrimitivePayloadSchema: z.ZodType<ActionSelectPrimitivePayload> = z
    .object({
        entityId: z.string().min(1),
    })
    .strict();
