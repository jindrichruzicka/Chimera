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

/** Example action payload — replace with your game's real payloads. */
interface __GamePascal__PingPayload {
    readonly note: string;
}

/**
 * A trivial example action so the registry is non-empty and the dispatch path is
 * wired end-to-end: `validate` always passes and `reduce` returns the snapshot
 * unchanged. Replace it with your game's real reducers (`validate` + `reduce`
 * must stay pure — Invariant #43).
 */
const __gameCamel__PingDefinition: ActionDefinition<__GamePascal__PingPayload, BaseGameSnapshot> = {
    type: __GAME_CONSTANT___PING_ACTION,

    parsePayload(raw): __GamePascal__PingPayload {
        const note = raw['note'];
        return { note: typeof note === 'string' ? note : '' };
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
