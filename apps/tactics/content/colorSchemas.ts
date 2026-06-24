/**
 * apps/tactics/content/colorSchemas.ts
 *
 * Tactics owns the data contract for its content collections. `ColorItemSchema`
 * validates every item in the `player-colors` and `board-colors` collections at
 * load time (passed to the generic `ContentLoader` as a per-collection schema —
 * the engine never knows this shape). An item is `{ id, name, hex, order }` where
 * `hex` is a 6-digit `#rrggbb` string and `order` is the seat/display rank.
 *
 * `order` exists because the generic content pipeline delivers a collection's
 * items id-sorted (alphabetical); tactics re-imposes its own ordering from this
 * field so seat-`n` colour defaults and the lobby dropdowns stay independent of
 * filenames. Required so a new colour cannot silently land in the wrong slot.
 *
 * Module boundary (§3): may import from simulation/, ai/, shared/ and own files
 * only. Must NOT import from renderer/, electron/, or other games/ directories.
 */

import { z } from 'zod';

/** A single selectable colour: stored `id`, display `name`, render `hex`, seat/display `order`. */
export const ColorItemSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit #rrggbb hex colour'),
    order: z.number().int().nonnegative(),
});

/** The validated shape of a colour content item. */
export type ColorItem = z.infer<typeof ColorItemSchema>;
