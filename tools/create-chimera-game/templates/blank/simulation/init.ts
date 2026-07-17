// __Game Title__'s match initialization. Game-core (no renderer/electron
// imports — Invariant #1): the host calls `resolve__GamePascal__FirstPlayer` at
// composition time to seat the starting player for a new match.

import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';

/**
 * First-player config — structurally assignable to the host's `FirstPlayerConfig`
 * (defined in `@chimera-engine/electron`), so this game-core module names no platform
 * type. Override the resolver to seat your game's starting player.
 */
export interface __GamePascal__GameInitializationConfig {
    readonly hostPlayerId: PlayerId;
    readonly firstPlayer?: PlayerId;
}

export function resolve__GamePascal__FirstPlayer(
    config: __GamePascal__GameInitializationConfig,
): PlayerId {
    return config.firstPlayer ?? config.hostPlayerId;
}
