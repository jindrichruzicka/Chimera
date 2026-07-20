// __Game Title__'s action registry + game definition. The host calls
// `register__GamePascal__Actions` once at startup to register this game's
// reducers and lifecycle hooks into the shared engine `ActionRegistry`. This
// module is game-core (no renderer/electron imports — Invariant #1).

import type { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import type {
    ActionDefinition,
    BaseGameSnapshot,
    ValidationResult,
} from '@chimera-engine/simulation/engine/types.js';

import { __GAME_CONSTANT___GAME_ID, __GAME_CONSTANT___PING_ACTION } from './constants.js';
import { __GamePascal__PingPayloadSchema } from './action-schemas.js';
import type { __GamePascal__PingPayload } from './action-types.js';

// Re-export payload types so game consumers can import from here without
// needing to know about action-types.ts.
export type { __GamePascal__PingPayload } from './action-types.js';

/**
 * A trivial example action so the registry is non-empty and the dispatch path is
 * wired end-to-end: `validate` always passes and `reduce` returns the snapshot
 * unchanged. Replace it with your game's real reducers (`validate` + `reduce`
 * must stay pure — Invariant #43).
 */
const __gameCamel__PingDefinition: ActionDefinition<__GamePascal__PingPayload, BaseGameSnapshot> = {
    type: __GAME_CONSTANT___PING_ACTION,

    parsePayload(raw): __GamePascal__PingPayload {
        return __GamePascal__PingPayloadSchema.parse(raw);
    },

    validate(): ValidationResult {
        return { ok: true };
    },

    reduce(state): BaseGameSnapshot {
        return state;
    },
};

/**
 * Register __Game Title__'s actions and game definition. `buildInitialEntities`
 * seeds the match (empty here — add your starting entities) and
 * `resolveGameResult` returns `null` while the game is still in progress.
 */
export function register__GamePascal__Actions(registry: ActionRegistry<BaseGameSnapshot>): void {
    registry.register(__gameCamel__PingDefinition);
    registry.registerGame(__GAME_CONSTANT___GAME_ID, {
        buildInitialEntities: () => ({}),
        resolveGameResult: () => null,
    });
}
