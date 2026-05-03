/**
 * games/tactics/visibility-rules.ts
 *
 * Tactics visibility policy used by the main-process StateProjector wiring.
 * Current tactics state has no hidden-information fields yet, so the rule set
 * is intentionally all-visible until game-specific fog-of-war data lands.
 *
 * Architecture: §4.6, §8 — VisibilityRules / state projection.
 */

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
} from '@chimera/simulation/engine/types.js';
import type { VisibilityRules } from '@chimera/simulation/projection/types.js';

export const tacticsVisibilityRules: VisibilityRules<
    BaseGameSnapshot,
    BaseEntityState,
    BasePlayerState
> = {
    isEntityVisible(): boolean {
        return true;
    },
    maskEntity(entity): BaseEntityState {
        return entity;
    },
    maskPlayerState(player): BasePlayerState {
        return player;
    },
    filterEvents(events) {
        return events;
    },
};
