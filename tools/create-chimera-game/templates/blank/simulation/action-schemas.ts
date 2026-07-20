// __Game Title__'s action payload schemas. Zod schemas live here — separate
// from the reducer logic in actions.ts — so validation is easy to extend and
// reuse. Add one schema per action payload you define in actions.ts.
//
// Module boundary: imports only simulation types and own constants — never
// renderer, electron, or other games.

import { z } from 'zod';
import type { __GamePascal__PingPayload } from './action-types.js';

/**
 * Validates and parses a raw `__game_kebab__:ping` payload.
 * Replace this with your game's real payload schemas.
 * Throws a `ZodError` on invalid input.
 */
export const __GamePascal__PingPayloadSchema: z.ZodType<__GamePascal__PingPayload> = z
    .object({
        note: z.string(),
    })
    .strict();
