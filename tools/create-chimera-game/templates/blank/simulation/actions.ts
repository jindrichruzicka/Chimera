// __Game Title__'s action registry + game definition. The host calls
// `register__GamePascal__Actions` once at startup to register this game's
// reducers and lifecycle hooks into the shared engine `ActionRegistry`. This
// module is game-core (no renderer/electron imports).

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
 * wired end-to-end: `validate` always passes and `reduce` does the one thing
 * every reducer has to do — advance the tick. Replace it with your game's real
 * reducers (`validate` + `reduce` must stay pure).
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
        // Advance `tick` by exactly one, here and in every action you add. The
        // tick is the engine's clock and its action count: replaying a recorded
        // match feeds the same actions back through this reducer and expects
        // each one to land the tick one higher, so a reducer that skips it
        // records a match that cannot be played back.
        //
        // An action that would change nothing has no reducer to write: refuse
        // it in `validate` instead. By the time `reduce` runs the action has
        // already been accepted, and returning an unchanged snapshot from here
        // records exactly the entry a replay cannot play.
        return { ...state, tick: state.tick + 1 };
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
