/**
 * apps/tactics/commitment/contract.ts
 *
 * Type contract for the tactics **commitment-scheme battle mode** (T6 / #726,
 * part of F54 / #720). This is the design gate for T7 (#727, Battle Setup
 * checkbox), T8 (#728, commitment turn mode) and T9 (#729, reveal-sync): those
 * tasks implement against the shapes declared here.
 *
 * The mode layers a simultaneous **commit-then-sync** turn on top of the
 * EXISTING commit/reveal primitive — `CommitmentScheme` /
 * `SessionCommitmentRuntime` / `HostTransport.sendReveal` /
 * `ClientTransport.onReveal` / `PlayerSnapshot.commitments`. Nothing here
 * touches the crypto primitive; it only names the values that flow through it.
 *
 * Full protocol + invariants: docs/security-trust/tactics-commitment-battle-mode.md
 *
 * Module boundary (§3): a games/* module may import `shared/` (runtime) and
 * `simulation/` (type-only here). The only runtime import is the pure
 * action-type constant module, used for the discriminated-union tags — the same
 * source `apps/tactics/actions.ts` already imports.
 */

import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera-engine/tactics/constants.js';
import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';
import type {
    TacticsAttackPayload,
    TacticsMoveUnitPayload,
    TacticsRevealTilePayload,
} from '../actions.js';

// ─── Local action buffer (Phase: Local play, T8) ────────────────────────────

/**
 * Maps each bufferable tactics action type to its payload. The computed keys
 * reference the canonical action-type constants (single source of truth — no
 * duplicated string literals), and {@link BufferedTacticsAction} derives the
 * discriminated union from this map.
 */
interface BufferedActionPayloads {
    readonly [TACTICS_MOVE_UNIT_ACTION]: TacticsMoveUnitPayload;
    readonly [TACTICS_ATTACK_ACTION]: TacticsAttackPayload;
    readonly [TACTICS_REVEAL_TILE_ACTION]: TacticsRevealTilePayload;
}

/**
 * One action a player has queued locally during their turn but NOT yet
 * committed. Buffered entries drive the optimistic local view (and local
 * stamina spend) only — they never reach the host's authoritative snapshot
 * until reveal/apply.
 */
export type BufferedTacticsAction = {
    readonly [Type in keyof BufferedActionPayloads]: {
        readonly type: Type;
        readonly payload: BufferedActionPayloads[Type];
    };
}[keyof BufferedActionPayloads];

/**
 * The action types a player may buffer locally in commitment mode — the three
 * tactics gameplay actions. Engine actions (`engine:end_turn`, `engine:undo`,
 * …) are never buffered: end-turn triggers reveal and undo is a buffer
 * operation ([§4](../../docs/security-trust/tactics-commitment-battle-mode.md)).
 */
export const BUFFERABLE_TACTICS_ACTION_TYPES = [
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_ATTACK_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
] as const;

/**
 * A player's ordered, un-committed turn. Held per-instance in the acting
 * player's own main process; applied in order on reveal. Empty until the player
 * queues their first action.
 */
export type LocalActionBuffer = readonly BufferedTacticsAction[];

/**
 * True iff the buffer contains at least one `tactics:attack` — the discriminant
 * the reveal-ordering rule groups on (attack-committers reveal first).
 */
export function bufferHasAttack(buffer: LocalActionBuffer): boolean {
    return buffer.some((action) => action.type === TACTICS_ATTACK_ACTION);
}

// ─── Committed value (Phase: Commit, T8/T9) ──────────────────────────────────

/**
 * The value hashed into a {@link CommitmentEnvelope} and echoed verbatim in the
 * matching {@link CommitmentReveal.value}. One envelope is produced per
 * player-turn (not per action), so a single commitment covers a player's whole
 * buffered turn.
 *
 * `turnNumber` binds the commitment to the turn it was made in, so a stale
 * reveal cannot be replayed against a later turn.
 */
export interface TacticsCommitmentEnvelopeValue {
    readonly playerId: PlayerId;
    readonly turnNumber: number;
    readonly actions: LocalActionBuffer;
}

// ─── Reveal ordering (Phase: End turn / reveal, T9) ──────────────────────────

/**
 * The minimal per-player fact the deterministic reveal order needs: who
 * committed and whether their bundle contains an attack.
 */
export interface CommittedTurn {
    readonly playerId: PlayerId;
    readonly hasAttack: boolean;
}

/**
 * Derives the deterministic reveal order from the committed turns. Pure: order
 * is a function of `(seed, tick)` only, never host discretion, so replays and
 * `verify()` stay sound (Invariant #71; new "deterministic reveal order"
 * invariant drafted in T6, ratified in T11).
 *
 * Algorithm (see design note §Reveal ordering):
 *   1. Partition into attack-committers and the rest.
 *   2. Shuffle each partition independently with the seeded RNG
 *      (xoshiro256**, seeded from `(seed, tick)` — no `Math.random()`).
 *   3. Attack-committers first, then the rest.
 *
 * `seed` and `tick` mirror the integer `GameSnapshot.seed` / `GameSnapshot.tick`
 * fields. Implemented in T9; this type is the contract it satisfies.
 */
export type ResolveRevealOrder = (
    committed: readonly CommittedTurn[],
    seed: number,
    tick: number,
) => readonly PlayerId[];

// ─── Host-side reveal staging (Phase: Commit → reveal, T8/T9) ────────────────
//
// The host-side reveal-staging STORE is game-agnostic and lives next to the
// commit/reveal primitive at `simulation/projection/RevealStaging.ts`
// (`RevealStaging` / `RevealStagingPort` / `StagedReveal` / `StagedReveals`),
// keyed by envelope id with an opaque `value`. The host must stay ignorant of
// which games exist (Invariant #2), so the tactics value type is not baked into
// the store. T9 derives the tactics-specific {@link CommittedTurn} list (with
// `hasAttack`) and reveal order from the store's `capture()` by narrowing each
// staged `value` to {@link TacticsCommitmentEnvelopeValue}.
