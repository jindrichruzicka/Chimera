// __Game Title__'s content adapter — an empty stub. A game declares content by
// adding a Zod schema per collection here, keyed by the collection type (its
// `data/<collection>` subdirectory). The host hands these schemas to the generic
// ContentLoader at startup so malformed content fails validation (Invariant #14)
// before the lobby comes up. Example:
//
//   import { z } from 'zod';
//   const CardSchema = z.object({ id: z.string(), cost: z.number().int() });
//   export const __GAME_CONSTANT___CONTENT_SCHEMAS = {
//       cards: CardSchema,
//   } satisfies Readonly<Record<string, ZodType>>;
//
// An empty record (or omitting `contentSchemas` from the contribution) means the
// game declares no content and gets no ContentDatabase (Invariant #46).

import type { ZodType } from 'zod';

export const __GAME_CONSTANT___CONTENT_SCHEMAS: Readonly<Record<string, ZodType>> = {};
