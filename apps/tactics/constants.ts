export const TACTICS_GAME_ID = 'tactics';
export const TACTICS_MOVE_UNIT_ACTION = 'tactics:move_unit';
export const TACTICS_ATTACK_ACTION = 'tactics:attack';
export const TACTICS_REVEAL_TILE_ACTION = 'tactics:reveal_tile';
/**
 * Marks the active player as having committed their buffered turn in commitment
 * mode (T8 / #728). Its reducer writes only the non-secret per-turn commit
 * marker into `snapshot.committedTurns`; the player's actual buffered actions are
 * never carried by this action (they stay host-local in the reveal-staging
 * store). The end-turn guard reads the marker to gate `engine:end_turn`.
 */
export const TACTICS_COMMIT_ACTION = 'tactics:commit';
export const TACTICS_DEFAULT_UNIT_ID_VALUE = 'unit-1';

/**
 * Per-player stamina budget. Each player starts a turn with this many stamina
 * and spends 1 per `tactics:move_unit` / `tactics:attack`; `max === default`.
 * Stamina is deterministic `GameSnapshot` state derived solely from actions
 * (no clock/RNG — Invariant #43). Integer only.
 */
export const TACTICS_MAX_STAMINA = 3;

/**
 * Tactics turn mode (T6 / #726 — F54). `sequential` is today's behaviour: each
 * action is dispatched straight to the host, reduced, and projected back.
 * `commitment` switches the match to the cryptographic commit-then-sync turn
 * built on the existing commit/reveal primitive — each player acts locally,
 * commits a hidden bundle, and `End Turn` reveals & applies all bundles in a
 * deterministic order.
 *
 * Design note: docs/security-trust/tactics-commitment-battle-mode.md
 */
export type TacticsTurnMode = 'sequential' | 'commitment';

/**
 * Key under which the turn mode lives in the synced host-authored
 * `GameSetupConfig.matchSettings` (and therefore in `snapshot.setup`). The
 * Battle Setup checkbox (T7) writes this through the existing
 * `chimera:lobby:set-match-setting` path; reducers and the renderer read it via
 * {@link readTacticsTurnMode}.
 */
export const TACTICS_TURN_MODE_SETTING = 'turnMode';

/** Turn mode for a match with no explicit setting — commitment mode is opt-in. */
export const TACTICS_DEFAULT_TURN_MODE: TacticsTurnMode = 'sequential';

/**
 * Pure reader for the tactics turn mode. Accepts the raw match-settings record
 * (from the lobby's `matchSettings` or `snapshot.setup?.matchSettings`) so both
 * the renderer and the simulation can share one decode without a cross-module
 * type dependency. Fail-safe: anything other than the exact literal
 * `'commitment'` resolves to {@link TACTICS_DEFAULT_TURN_MODE}.
 */
export function readTacticsTurnMode(
    matchSettings: Readonly<Record<string, string>> | undefined,
): TacticsTurnMode {
    return matchSettings?.[TACTICS_TURN_MODE_SETTING] === 'commitment'
        ? 'commitment'
        : TACTICS_DEFAULT_TURN_MODE;
}

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
