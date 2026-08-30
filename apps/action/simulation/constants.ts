// The action app's identity, action ids and arena geometry — the single place
// that names the game. Every other module imports it from here.
//
// Module boundary: game-core (no renderer/electron/networking imports). Every
// quantity below is an INTEGER: the arena is a grid of whole cells and a
// primitive advances by whole cells per tick, so the simulation carries no
// fractional gameplay quantity at all (Invariant #44). The renderer is the only
// layer that turns a cell into a float world position.

/** This game's stable id (also its settings namespace and asset ref prefix). */
export const ACTION_GAME_ID = 'action';

/** Sets the acting seat's primitive moving (or stops it) — see `actions.ts`. */
export const ACTION_SET_VELOCITY_ACTION = `${ACTION_GAME_ID}:set-velocity`;

/** Claims a primitive for the acting seat — see `actions.ts`. */
export const ACTION_SELECT_PRIMITIVE_ACTION = `${ACTION_GAME_ID}:select-primitive`;

/**
 * Wall-clock heartbeat, in milliseconds, that the manifest hands the host's
 * `RealtimeTicker`. 100 ms is 10 Hz — deliberately modest: this is the engine's
 * first realtime consumer, and a primitive advances one whole arena cell per
 * tick, so a faster heartbeat would only make the same movement coarser to
 * watch, not smoother.
 */
export const ACTION_TICK_RATE_MS = 100;

/**
 * Arena extents in whole cells. Valid positions span x ∈ [MIN_X, MAX_X],
 * y ∈ [MIN_Y, MAX_Y]; the origin is interior and the two axes have DIFFERENT
 * extents so the arena reads as a landscape rectangle under the top-down camera
 * (and so an axis mix-up in the clamp is observable rather than symmetric).
 */
export const ACTION_ARENA_MIN_X = -8;
export const ACTION_ARENA_MAX_X = 8;
export const ACTION_ARENA_MIN_Y = -5;
export const ACTION_ARENA_MAX_Y = 5;

/** Arena size in cells, derived from the extents (both bounds are inclusive). */
export const ACTION_ARENA_WIDTH_CELLS = ACTION_ARENA_MAX_X - ACTION_ARENA_MIN_X + 1;
export const ACTION_ARENA_DEPTH_CELLS = ACTION_ARENA_MAX_Y - ACTION_ARENA_MIN_Y + 1;

/** The three primitive shapes a match seeds, in the order they are laid out. */
export const ACTION_PRIMITIVE_SHAPES = ['cube', 'sphere', 'cone'] as const;
export type ActionPrimitiveShape = (typeof ACTION_PRIMITIVE_SHAPES)[number];

/** Entity id of the arena's ground plane — one per match, owned by nobody. */
export const ACTION_GROUND_ENTITY_ID_VALUE = 'ground';

/** One seeded primitive: its entity id, shape and starting cell. */
export interface ActionPrimitiveSeed {
    readonly id: string;
    readonly shape: ActionPrimitiveShape;
    readonly x: number;
    readonly y: number;
}

/**
 * The primitives every match starts with. Which seat drives which is decided by
 * `assignActionPrimitiveOwners` in `entities.ts`; a primitive no seat took stays
 * unowned and stationary until one selects it.
 *
 * Spread across the arena's long axis so a two-seat match starts with visible
 * space between the driven primitives and the spare one.
 */
export const ACTION_PRIMITIVE_SEEDS: readonly ActionPrimitiveSeed[] = [
    { id: 'primitive-cube', shape: 'cube', x: -4, y: 0 },
    { id: 'primitive-sphere', shape: 'sphere', x: 0, y: 0 },
    { id: 'primitive-cone', shape: 'cone', x: 4, y: 0 },
];

/** Clamps an arena X coordinate into `[ACTION_ARENA_MIN_X, ACTION_ARENA_MAX_X]`. */
export function clampToArenaX(x: number): number {
    if (x < ACTION_ARENA_MIN_X) return ACTION_ARENA_MIN_X;
    if (x > ACTION_ARENA_MAX_X) return ACTION_ARENA_MAX_X;
    return x;
}

/** Clamps an arena Y coordinate into `[ACTION_ARENA_MIN_Y, ACTION_ARENA_MAX_Y]`. */
export function clampToArenaY(y: number): number {
    if (y < ACTION_ARENA_MIN_Y) return ACTION_ARENA_MIN_Y;
    if (y > ACTION_ARENA_MAX_Y) return ACTION_ARENA_MAX_Y;
    return y;
}

// ── Seat attributes ──────────────────────────────────────────────────────────
//
// The per-seat picks the shell's `/select` page writes onto the quick-start
// draft and the lobby carries into `snapshot.setup.playerAttributes`
// (Invariant #101). They are named HERE, beside the shapes and the seeds,
// because both ends read them: the shell writes them and `entities.ts` seats
// each player on the primitive its `primitive` names.

/** Seat attribute naming the {@link ACTION_PRIMITIVE_SHAPES} member a seat drives. */
export const ACTION_PRIMITIVE_ATTRIBUTE = 'primitive';

/**
 * Seat attribute naming which key cluster on the HOST machine drives a seat.
 *
 * Only the pass-and-play seat carries it. The host's own seat needs none: the
 * engine already names that seat to the renderer as `localPlayerId`, so a
 * marker on it would be a second answer to a question already answered.
 */
export const ACTION_CONTROL_ATTRIBUTE = 'control';

/** The one {@link ACTION_CONTROL_ATTRIBUTE} value this app declares. */
export const ACTION_WASD_CONTROL = 'wasd';

/** Whether `value` names one of the three primitive shapes. */
export function isActionPrimitiveShape(value: unknown): value is ActionPrimitiveShape {
    return (
        typeof value === 'string' && (ACTION_PRIMITIVE_SHAPES as readonly string[]).includes(value)
    );
}
