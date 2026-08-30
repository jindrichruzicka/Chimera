// The action app's visibility policy, used by the main-process StateProjector
// to mask host-local `GameSnapshot` state before it is projected into each
// viewer's `PlayerSnapshot`.
//
// OMNISCIENT, deliberately: an arena of three primitives on an open floor has
// no hidden information to hide, and inventing a mask here would be an
// unexercised branch pretending to be a policy. Every rule is the identity, so
// each seat's projection carries the whole arena.
//
// Module boundary: game-core (only `@chimera-engine/simulation` types).

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
} from '@chimera-engine/simulation/engine/types.js';
import type { VisibilityRules } from '@chimera-engine/simulation/projection/types.js';

export const actionVisibilityRules: VisibilityRules<
    BaseGameSnapshot,
    BaseEntityState,
    BasePlayerState
> = {
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
