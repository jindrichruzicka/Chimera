export const TACTICS_GAME_ID = 'tactics';
export const TACTICS_MOVE_UNIT_ACTION = 'tactics:move_unit';
export const TACTICS_ATTACK_ACTION = 'tactics:attack';
export const TACTICS_REVEAL_TILE_ACTION = 'tactics:reveal_tile';
export const TACTICS_DEFAULT_UNIT_ID_VALUE = 'unit-1';
export const TACTICS_PROXIMITY_REVEAL_RANGE_TILES = 1;
export const TACTICS_PROXIMITY_REVEAL_RANGE_TILES_SQUARED =
    TACTICS_PROXIMITY_REVEAL_RANGE_TILES * TACTICS_PROXIMITY_REVEAL_RANGE_TILES;
export const TACTICS_INITIAL_UNIT_SPACING_TILES = TACTICS_PROXIMITY_REVEAL_RANGE_TILES + 1;

/**
 * Playable grid extents of the tactics board — the single source of truth for
 * its 6×4 *size*. The renderer ground plane (TacticsGroundPlane) sizes its mesh
 * from the tile counts, and start positions + tests derive their corners/bounds
 * from the min/max, so a resize here propagates to all three.
 *
 * Centring does NOT derive from these constants: the ground-plane world
 * position (TacticsGroundPlane) and camera framing (tacticsCamera) are both
 * centred on the legacy 2-player midpoint (1, 0) and must be re-centred by hand
 * on a resize. Valid integer grid cells span x ∈ [MIN_X, MAX_X],
 * y ∈ [MIN_Y, MAX_Y]; origin (0,0) is interior.
 */
export const TACTICS_BOARD_WIDTH_TILES = 6;
export const TACTICS_BOARD_HEIGHT_TILES = 4;
export const TACTICS_BOARD_MIN_X = -2;
export const TACTICS_BOARD_MIN_Y = -2;
export const TACTICS_BOARD_MAX_X = TACTICS_BOARD_MIN_X + TACTICS_BOARD_WIDTH_TILES - 1;
export const TACTICS_BOARD_MAX_Y = TACTICS_BOARD_MIN_Y + TACTICS_BOARD_HEIGHT_TILES - 1;

/**
 * Per-seat start positions on the tactics board. The layout is deliberately
 * asymmetric: seats 0–1 keep the legacy placement near board-centre (NOT
 * corners) so the 2-player match is unchanged, while seats 2–3 take the two
 * opposing corners of one diagonal derived from the board extents. The other
 * two corners are intentionally left unused. Integer coords only —
 * deterministic (Invariant #43).
 */
export const TACTICS_START_POSITIONS: readonly { readonly x: number; readonly y: number }[] = [
    { x: 0, y: 0 }, // (0, 0) — board centre (legacy seat 0)
    { x: TACTICS_INITIAL_UNIT_SPACING_TILES, y: 0 }, // (2, 0) — near centre, just outside seat 0's reveal range
    { x: TACTICS_BOARD_MAX_X, y: TACTICS_BOARD_MIN_Y }, // (3, -2) — bottom-right corner
    { x: TACTICS_BOARD_MIN_X, y: TACTICS_BOARD_MAX_Y }, // (-2, 1) — top-left corner
];
