// __Game Title__'s visibility policy, used by the main-process StateProjector to
// mask host-local `GameSnapshot` state before it is projected to each viewer's
// `PlayerSnapshot`. This blank policy is fully open — every entity and player
// field is visible to everyone. Tighten it for hidden information (fog-of-war,
// owner-only fields) by masking entities/player fields per viewer.

import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import type { VisibilityRules } from '@chimera/simulation/projection/types.js';

export const __gameCamel__VisibilityRules: VisibilityRules<BaseGameSnapshot> = {
    isEntityVisible(): boolean {
        return true;
    },
    maskEntity(entity) {
        return entity;
    },
    maskPlayerState(target) {
        return target;
    },
    filterEvents(events) {
        return events;
    },
};
