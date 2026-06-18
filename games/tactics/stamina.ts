/**
 * games/tactics/stamina.ts
 *
 * Per-player stamina for the tactics game (#721). Stamina is deterministic
 * `GameSnapshot` state derived solely from actions — no wall-clock, no RNG
 * (Invariant #43). It is stored as an optional ledger on the snapshot so that:
 *   - the start-of-game seed falls out as a derived default (absent ⇒ full), and
 *   - the start-of-turn refresh is derived from the player's own turn beginning
 *     on a later `turnNumber` than their last write — no engine turn-start hook
 *     is required (the engine offers games none; §3, §4.6/§8).
 *
 * The stored `refreshedTurn` marker is internal bookkeeping; only `{ current,
 * max }` is projected to clients via the tactics `VisibilityRules`.
 *
 * Imports stay inside the simulation ownership boundary (`shared/`,
 * `simulation/engine`) — no renderer/electron/networking (Invariant #3).
 */

import { TACTICS_MAX_STAMINA, readTacticsTurnMode } from '@chimera/games/tactics/constants.js';
import type {
    BaseGameSnapshot,
    BasePlayerState,
    PlayerId,
} from '@chimera/simulation/engine/types.js';

/**
 * Stored per-player stamina entry. `refreshedTurn` records the `turnNumber` at
 * which `current` was last written, letting {@link readStamina} distinguish
 * "spent earlier this turn" from "a new turn has begun ⇒ refresh". Integers
 * only (deterministic).
 */
export interface TacticsStaminaEntry {
    readonly current: number;
    readonly max: number;
    readonly refreshedTurn: number;
}

/** Projected stamina shape — the only part that reaches clients. */
export interface TacticsStamina {
    readonly current: number;
    readonly max: number;
}

/**
 * Tactics snapshot view: `BaseGameSnapshot` plus the optional stamina ledger.
 * Optional so engine-seeded start state and pre-#721 snapshots stay valid —
 * absence is the derived "seeded at max" default.
 */
export interface TacticsSnapshot extends BaseGameSnapshot {
    readonly playerStamina?: Readonly<Record<PlayerId, TacticsStaminaEntry>>;
}

/**
 * Projected per-player observed state for tactics. Owner-only: the viewer reads
 * their own `{ current, max }`; every other player is masked to `null`.
 *
 * `committed` is the non-secret "this seat has committed for the current turn"
 * marker (commitment battle mode, #730). Unlike stamina it is projected for
 * EVERY player to every viewer — it leaks only the boolean, never the buffered
 * actions (Invariants #3/#8) — so the renderer can gate the reveal-only End
 * Turn and show a waiting affordance. Always `false` in sequential mode.
 */
export interface TacticsObservedPlayer extends BasePlayerState {
    readonly stamina: TacticsStamina | null;
    readonly committed: boolean;
}

function staminaLedger(
    state: Readonly<BaseGameSnapshot>,
): Readonly<Record<PlayerId, TacticsStaminaEntry>> | undefined {
    return (state as TacticsSnapshot).playerStamina;
}

/**
 * Effective stamina for `playerId`, deriving both the start-of-game seed
 * (absent entry ⇒ full) and the start-of-turn refresh (the player's own turn
 * has begun on a later `turnNumber` than their last write ⇒ full). Pure; reads
 * only deterministic snapshot fields.
 */
export function readStamina(state: Readonly<BaseGameSnapshot>, playerId: PlayerId): TacticsStamina {
    const entry = staminaLedger(state)?.[playerId];
    if (entry === undefined) {
        return { current: TACTICS_MAX_STAMINA, max: TACTICS_MAX_STAMINA };
    }
    // Sequential turns refresh only the single active seat. Commitment
    // (simultaneous) turns have every seat acting in parallel, so the
    // active-seat marker is irrelevant — any seat refreshes once a later turn
    // has begun than its last write (#730, F54).
    const isCommitment = readTacticsTurnMode(state.setup?.matchSettings) === 'commitment';
    const turnHasBegun = isCommitment
        ? state.turnNumber > entry.refreshedTurn
        : state.turnClock?.activePlayerId === playerId && state.turnNumber > entry.refreshedTurn;
    return turnHasBegun
        ? { current: entry.max, max: entry.max }
        : { current: entry.current, max: entry.max };
}

/**
 * Next `playerStamina` ledger after `playerId` spends one stamina on a
 * move/attack. Normalises through {@link readStamina} first so the first action
 * of a turn refreshes before spending; floors at 0; stamps `refreshedTurn` to
 * the current turn so later actions the same turn keep decrementing from the
 * stored value. Never mutates `state`.
 */
export function consumeStamina(
    state: Readonly<BaseGameSnapshot>,
    playerId: PlayerId,
): Readonly<Record<PlayerId, TacticsStaminaEntry>> {
    const effective = readStamina(state, playerId);
    const next = effective.current > 0 ? effective.current - 1 : 0;
    return {
        ...(staminaLedger(state) ?? {}),
        [playerId]: { current: next, max: effective.max, refreshedTurn: state.turnNumber },
    };
}

/**
 * Returns a copy of `state` with each listed player's stamina explicitly seeded
 * to `amount` (default: full). Pure — never mutates `state`. The derived seed in
 * {@link readStamina} already gives absent players full stamina, so production
 * does not need this; it exists so host composition and perf/benchmark fixtures
 * that hand-build a mid-match snapshot can set a starting budget through the
 * tactics public API instead of reaching into the internal ledger shape.
 */
export function withSeededStamina(
    state: Readonly<BaseGameSnapshot>,
    playerIds: readonly PlayerId[],
    amount: number = TACTICS_MAX_STAMINA,
): BaseGameSnapshot {
    const ledger: Record<PlayerId, TacticsStaminaEntry> = { ...(staminaLedger(state) ?? {}) };
    for (const id of playerIds) {
        ledger[id] = { current: amount, max: amount, refreshedTurn: state.turnNumber };
    }
    const seeded: TacticsSnapshot = { ...state, playerStamina: ledger };
    return seeded;
}
