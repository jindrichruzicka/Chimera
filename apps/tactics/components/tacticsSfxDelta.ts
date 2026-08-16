/**
 * tacticsSfxDelta.ts
 *
 * Which positioned SFX a projected snapshot owes the viewer, derived from the
 * two unit lists alone.
 *
 * F84 moved `step` and `swordHit` out of `TACTICS_EVENT_AUDIO_BINDING` and onto
 * the board's intent site so they could carry the acting unit's world position —
 * `GameEvent` is `{ type }` only and cannot. The two halves are each correct and
 * compose into a silenced seat: `filterEvents` in `apps/tactics` returns every
 * event to every seat, so both clients had been playing both verbs, while only
 * the acting client ever reaches an intent site.
 *
 * The position an event cannot carry is nevertheless already in the viewer's
 * hands — in the projection they just received. So the cue is derived here from
 * the delta between two projected unit lists, which restores both seats without
 * touching the projection contract (Invariants #3 / #8 / #98) and keeps the
 * position F84 bought. The simulation still produces no audio (Invariant #63).
 *
 * Three consequences of deriving from the projection rather than from an intent,
 * each pinned by a test:
 *
 * 1. **Only units in both lists are voiced.** Tactics units start `visibleTo`
 *    their owner alone, so an opponent ENTERS the viewer's projection when it
 *    steps into reveal range. It has no previous tile, so there is no move to
 *    describe — the delta can say a unit is here, never that it came from
 *    somewhere. The approach move that reveals a unit is therefore silent for
 *    the observer.
 * 2. **A hit is positioned on the defender.** A delta names the unit whose hp
 *    fell; the attacker is not recoverable from it. That is the same limit the
 *    `{ type }`-only event has, and the defender is where the blow lands.
 * 3. **Cues are per changed unit, not per event.** A revealed commitment turn
 *    can move two units under two indistinguishable `{ type }` events; two moved
 *    units are distinguishable.
 */

import type { EntityId } from '@chimera-engine/simulation/engine/types.js';
import type { TacticsSceneUnit, TacticsWorldPoint } from './tacticsSceneModel.js';

/** `move` is the step verb, `hit` the sword verb; the board owns the clip and volume. */
export type TacticsSfxCueKind = 'move' | 'hit';

export interface TacticsSfxCue {
    readonly kind: TacticsSfxCueKind;
    readonly unitId: EntityId;
    /** Where the cue is heard: the tile the unit occupies in the NEW list. */
    readonly world: TacticsWorldPoint;
}

/**
 * The cues owed by the step from `previous` to `next`, in `next` order and, for a
 * unit that both moved and took damage, move before hit. The order is fixed for
 * determinism rather than claimed to be chronological — a delta cannot say which
 * happened first.
 *
 * Both lists are read only; neither is mutated.
 */
export function resolveTacticsSfxCues(
    previous: readonly TacticsSceneUnit[],
    next: readonly TacticsSceneUnit[],
): readonly TacticsSfxCue[] {
    // Keyed by id, never paired by index: `parseTacticsSceneUnits` walks
    // `Object.values(entities)`, whose order no projection promises to preserve.
    const before = new Map(previous.map((unit) => [unit.id, unit]));
    const cues: TacticsSfxCue[] = [];

    for (const unit of next) {
        const was = before.get(unit.id);
        if (was === undefined) {
            continue;
        }
        if (was.grid.x !== unit.grid.x || was.grid.y !== unit.grid.y) {
            cues.push({ kind: 'move', unitId: unit.id, world: unit.world });
        }
        // Directional: a rising hp is a heal or a restore, not a blow.
        if (unit.hp < was.hp) {
            cues.push({ kind: 'hit', unitId: unit.id, world: unit.world });
        }
    }

    return cues;
}
