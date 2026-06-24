/**
 * apps/tactics/commitment/commitAction.ts
 *
 * The `tactics:commit` action for commitment-scheme battle mode (T8 / #728). It
 * records the non-secret per-turn commit marker so the end-turn guard can gate
 * `engine:end_turn` until every seated player has committed.
 *
 * Secrecy: the reducer writes ONLY `committedTurns[playerId] = turnNumber`. The
 * player's actual buffered actions are never carried by this action nor stored
 * on the snapshot — they reach the host out-of-band and live only in the
 * host-side reveal-staging store (Invariants #3/#8). All mutation flows through
 * the ActionPipeline (Invariant #2: no side-door snapshot mutation).
 *
 * Design note: docs/security-trust/tactics-commitment-battle-mode.md §3, §4
 */

import { TACTICS_COMMIT_ACTION, readTacticsTurnMode } from '@chimera/tactics/constants.js';
import type {
    ActionDefinition,
    BaseGameSnapshot,
    ValidationResult,
} from '@chimera/simulation/engine/types.js';

/** The commit action carries no payload — the acting player is the committer. */
export type TacticsCommitPayload = Record<string, never>;

export const tacticsCommitDefinition: ActionDefinition<TacticsCommitPayload, BaseGameSnapshot> = {
    type: TACTICS_COMMIT_ACTION,

    parsePayload(): TacticsCommitPayload {
        return {};
    },

    validate(_payload, state, playerId): ValidationResult {
        if (readTacticsTurnMode(state.setup?.matchSettings) !== 'commitment') {
            return { ok: false, reason: 'not_commitment_mode' };
        }
        if (!(playerId in state.players)) {
            return { ok: false, reason: 'not_in_game' };
        }
        return { ok: true };
    },

    reduce(state, _payload, playerId): BaseGameSnapshot {
        return {
            ...state,
            tick: state.tick + 1,
            committedTurns: {
                ...(state.committedTurns ?? {}),
                [playerId]: state.turnNumber,
            },
        };
    },
};
