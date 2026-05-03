import { describe, expect, it } from 'vitest';
import { entityId, gamePhase, playerId } from '@chimera/simulation/engine/types.js';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    GameEvent,
} from '@chimera/simulation/engine/types.js';
import { tacticsVisibilityRules } from './visibility-rules.js';

const PLAYER_A = playerId('player-a');
const PLAYER_B = playerId('player-b');
const ENTITY_A = entityId('entity-a');

const entity: BaseEntityState = { id: ENTITY_A };
const player: BasePlayerState = { id: PLAYER_A };
const event: GameEvent = { type: 'tactics:test-event' };

const snapshot: BaseGameSnapshot = {
    tick: 1,
    seed: 123,
    players: {
        [PLAYER_A]: player,
        [PLAYER_B]: { id: PLAYER_B },
    },
    entities: {
        [ENTITY_A]: entity,
    },
    phase: gamePhase('playing'),
    events: [event],
    turnNumber: 0,
    timers: {},
};

describe('tacticsVisibilityRules', () => {
    it('keeps all current tactics entities visible until game-specific fog rules land', () => {
        expect(tacticsVisibilityRules.isEntityVisible(entity, PLAYER_A, snapshot)).toBe(true);
    });

    it('passes visible entity and player state through unchanged', () => {
        expect(tacticsVisibilityRules.maskEntity(entity, PLAYER_A, snapshot)).toBe(entity);
        expect(tacticsVisibilityRules.maskPlayerState(player, PLAYER_B, snapshot)).toBe(player);
    });

    it('does not filter current tactics events', () => {
        expect(tacticsVisibilityRules.filterEvents([event], PLAYER_A, snapshot)).toStrictEqual([
            event,
        ]);
    });
});
