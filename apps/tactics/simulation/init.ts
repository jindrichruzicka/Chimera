import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';

export interface TacticsGameInitializationConfig {
    readonly hostPlayerId: PlayerId;
    readonly firstPlayer?: PlayerId;
}

export function resolveTacticsFirstPlayer(config: TacticsGameInitializationConfig): PlayerId {
    return config.firstPlayer ?? config.hostPlayerId;
}
