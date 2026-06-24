/**
 * apps/tactics/commitment/revealOrder.ts
 *
 * The deterministic reveal order for tactics commitment-scheme battle mode
 * (T9 / #729). Implements the {@link ResolveRevealOrder} contract declared in
 * `contract.ts`: a pure function of `(seed, tick)` that groups by player,
 * reveals attack-committers first, and shuffles each partition with the seeded
 * `DeterministicRng` — never `Math.random`.
 *
 * Why attack-first: an attack reveal can end the match
 * (`resolveTacticsGameResult`); putting attack-committers ahead of move-only
 * players means a game-ending attack resolves before any non-attack reveal, so
 * non-attack actions need no special end-state handling (design §5).
 *
 * Why deterministic: the order is a pure function of the integer
 * `GameSnapshot.seed`/`tick`, never host discretion, so every client and every
 * replay converges on the same reveal sequence and `verify()` stays sound
 * (Invariant #71; the "deterministic reveal order" invariant ratified in T11).
 *
 * Design note: docs/security-trust/tactics-commitment-battle-mode.md §5
 */

import { createRng } from '@chimera/simulation/engine/DeterministicRng.js';
import type { PlayerId } from '@chimera/simulation/engine/types.js';

import type { CommittedTurn, ResolveRevealOrder } from './contract.js';

/**
 * Derive the reveal order from the committed turns. Attack-committers' group is
 * shuffled and placed first; the remaining (move-only) group is shuffled and
 * placed second. Both partitions are shuffled with a single RNG seeded from
 * `(seed, tick)`, so the result is fully determined by those integers.
 *
 * @see ResolveRevealOrder — the contract this satisfies.
 */
export const resolveRevealOrder: ResolveRevealOrder = (
    committed: readonly CommittedTurn[],
    seed: number,
    tick: number,
): readonly PlayerId[] => {
    const rng = createRng(seed, tick);
    // Canonicalize the input order FIRST so the result is a pure function of the
    // committed-player set and (seed, tick) — never of commit-arrival order (which
    // is the staging map's insertion order). PlayerId is a branded string; compare
    // by UTF-16 code unit (NOT `localeCompare`, which is locale-dependent and would
    // reintroduce nondeterminism across environments).
    const canonical = [...committed].sort((a, b) =>
        a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0,
    );
    const attackers: PlayerId[] = [];
    const movers: PlayerId[] = [];
    for (const turn of canonical) {
        (turn.hasAttack ? attackers : movers).push(turn.playerId);
    }
    // Shuffle each partition independently, attack-committers first. A single
    // rng instance threaded through both shuffles keeps the whole order a pure
    // function of (seed, tick) with no cross-partition correlation surprises.
    return [...rng.shuffle(attackers), ...rng.shuffle(movers)];
};
