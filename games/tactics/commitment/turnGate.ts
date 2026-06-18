/**
 * games/tactics/commitment/turnGate.ts
 *
 * Pure turn-mode authorization for the tactics commitment-scheme battle mode
 * (F54 / #730). Sequential turns are single-active and unchanged; commitment
 * mode makes the turn **simultaneous**: every seated, not-yet-committed player
 * acts in parallel, and once every seat has committed any of them may fire the
 * reveal-only End Turn.
 *
 * These hooks reach the engine through generic injection points that name no
 * game (Invariant #2): {@link tacticsResolveIsMyTurn} via
 * `StateProjectorOptions.resolveIsMyTurn`, and {@link tacticsMayEndTurn} via
 * `GameDefinition.mayEndTurn` → `GameReduceContext.endTurnAuthority`. The
 * `committedTurns` marker they read is host-local and never projected
 * (Invariants #3/#8); the resolver/authority run host-side with the full state.
 *
 * Pure: reads only deterministic snapshot fields (`setup`, `turnNumber`,
 * `committedTurns`, `turnClock`, `players`) — no clock, no RNG (#43/#44).
 *
 * Design note: docs/security-trust/tactics-commitment-battle-mode.md §2, §4
 */

import { readTacticsTurnMode } from '@chimera/games/tactics/constants.js';
import type { BaseGameSnapshot, PlayerId } from '@chimera/simulation/engine/types.js';

/** True iff this match runs the commitment (simultaneous) turn mode. */
export function isTacticsCommitmentMode(state: Readonly<BaseGameSnapshot>): boolean {
    return readTacticsTurnMode(state.setup?.matchSettings) === 'commitment';
}

/**
 * True iff `playerId` has a commitment marker for the CURRENT turn. Stale
 * markers from prior turns (`committedTurns[id] < turnNumber`) do not count.
 */
export function hasCommittedThisTurn(
    state: Readonly<BaseGameSnapshot>,
    playerId: PlayerId,
): boolean {
    return state.committedTurns?.[playerId] === state.turnNumber;
}

/** True iff every seated player has committed for the current turn. */
export function allSeatsCommitted(state: Readonly<BaseGameSnapshot>): boolean {
    const committedTurns = state.committedTurns ?? {};
    return Object.keys(state.players).every(
        (id) => committedTurns[id as PlayerId] === state.turnNumber,
    );
}

/**
 * `isMyTurn` resolver for tactics (`StateProjectorOptions.resolveIsMyTurn`).
 *
 * Sequential mode: the single `turnClock.activePlayerId` (or everyone when there
 * is no clock) — identical to the engine default. Commitment mode: every seated
 * player who has NOT yet committed this turn is active simultaneously, so both
 * boards stay interactive until their owner commits, then go inert.
 */
export function tacticsResolveIsMyTurn(
    state: Readonly<BaseGameSnapshot>,
    viewerId: PlayerId,
): boolean {
    if (!isTacticsCommitmentMode(state)) {
        return state.turnClock === undefined || state.turnClock.activePlayerId === viewerId;
    }
    if (!(viewerId in state.players)) {
        return false;
    }
    return !hasCommittedThisTurn(state, viewerId);
}

/**
 * End-turn AUTHORIZATION for tactics (`GameDefinition.mayEndTurn`). Replaces the
 * engine's active-player check.
 *
 * Sequential mode: only the active seat may end the turn (engine default).
 * Commitment mode: End Turn is the reveal trigger — any seated player may fire
 * it, but only once every seat has committed (the pure active-player gate would
 * deadlock a simultaneous turn). The `awaiting_commitment` reason before that
 * point is surfaced by the separate `canEndTurn` guard.
 */
export function tacticsMayEndTurn(state: Readonly<BaseGameSnapshot>, playerId: PlayerId): boolean {
    if (!isTacticsCommitmentMode(state)) {
        return state.turnClock === undefined || state.turnClock.activePlayerId === playerId;
    }
    return playerId in state.players && allSeatsCommitted(state);
}
