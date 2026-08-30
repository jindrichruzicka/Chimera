// The action app's match initialization. Game-core (no renderer/electron
// imports): the host calls `resolveActionFirstPlayer` at composition time to
// seat the starting player for a new match.
//
// A realtime game has no turn order to speak of — every seat drives its own
// primitive on every beat — so the resolved "first player" only names the seat
// the engine's turn bookkeeping starts on. It is the host unless the session
// explicitly names another.

import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';

/**
 * First-player config — structurally assignable to the host's
 * `FirstPlayerConfig` (declared in `@chimera-engine/electron`), so this
 * game-core module names no platform type.
 */
export interface ActionGameInitializationConfig {
    readonly hostPlayerId: PlayerId;
    readonly firstPlayer?: PlayerId;
}

export function resolveActionFirstPlayer(config: ActionGameInitializationConfig): PlayerId {
    return config.firstPlayer ?? config.hostPlayerId;
}
