/**
 * games/tactics/visibility-rules.ts
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
import type { VisibilityRules } from '@chimera/simulation/projection/types.js';

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
    BasePlayerState
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
    maskPlayerState(player): BasePlayerState {
        return player;
    },
    filterEvents(events) {
        return events;
    },
};
