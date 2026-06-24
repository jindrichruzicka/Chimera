/**
 * apps/tactics/visibility-rules.ts
 *
 * Tactics visibility policy used by the main-process StateProjector wiring.
 * Tactics units are visible to their owner and to players listed in the
 * unit's internal `visibleTo` reveal list. Projection strips that internal
 * reveal list before snapshots leave the host boundary.
 *
 * Architecture: §4.6, §8 — VisibilityRules / state projection.
 */

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import type { ObservedEntityState, VisibilityRules } from '@chimera/simulation/projection/types.js';
import { hasCommittedThisTurn } from './commitment/turnGate.js';
import type { TacticsObservedPlayer } from './stamina.js';
import { readStamina } from './stamina.js';

interface TacticsVisibleUnit extends BaseEntityState {
    readonly kind: 'unit';
    readonly ownerId: PlayerId;
    readonly visibleTo?: readonly PlayerId[];
}

function isTacticsVisibleUnit(entity: BaseEntityState): entity is TacticsVisibleUnit {
    const candidate = entity as {
        readonly kind?: unknown;
        readonly ownerId?: unknown;
        readonly visibleTo?: unknown;
    };
    return (
        candidate.kind === 'unit' &&
        typeof candidate.ownerId === 'string' &&
        (candidate.visibleTo === undefined ||
            (Array.isArray(candidate.visibleTo) &&
                candidate.visibleTo.every((viewer) => typeof viewer === 'string')))
    );
}

export const tacticsVisibilityRules: VisibilityRules<
    BaseGameSnapshot,
    BaseEntityState,
    BasePlayerState,
    ObservedEntityState<BaseEntityState>,
    TacticsObservedPlayer
> = {
    isEntityVisible(entity, viewer): boolean {
        if (!isTacticsVisibleUnit(entity)) {
            return true;
        }
        return entity.ownerId === viewer || (entity.visibleTo ?? []).includes(viewer);
    },
    maskEntity(entity): BaseEntityState {
        if (isTacticsVisibleUnit(entity)) {
            const { visibleTo, ...masked } = entity;
            void visibleTo;
            return masked;
        }
        return entity;
    },
    // Owner-only stamina (#721): the viewer reads their own remaining moves so
    // the HUD can show them; every other player's stamina is masked to null —
    // an opponent's budget is irrelevant to the viewer and never leaves the host.
    maskPlayerState(player, viewer, state): TacticsObservedPlayer {
        // `committed` is the public per-turn commit marker — projected for every
        // seat (not owner-only) so the renderer can gate the reveal-only End Turn.
        const committed = hasCommittedThisTurn(state, player.id);
        if (player.id === viewer) {
            return { ...player, stamina: readStamina(state, viewer), committed };
        }
        return { ...player, stamina: null, committed };
    },
    filterEvents(events) {
        return events;
    },
};
