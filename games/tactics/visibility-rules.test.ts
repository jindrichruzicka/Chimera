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
const ENTITY_B = entityId('entity-b');

const entity: BaseEntityState = { id: ENTITY_A };
const player: BasePlayerState = { id: PLAYER_A };
const event: GameEvent = { type: 'tactics:test-event' };
const ownUnit = {
    id: ENTITY_A,
    kind: 'unit',
    ownerId: PLAYER_A,
    x: 0,
    y: 0,
    hp: 1,
    visibleTo: [PLAYER_A],
} satisfies BaseEntityState & Readonly<Record<string, unknown>>;
const hiddenEnemyUnit = {
    id: ENTITY_B,
    kind: 'unit',
    ownerId: PLAYER_B,
    x: 1,
    y: 0,
    hp: 1,
    visibleTo: [PLAYER_B],
} satisfies BaseEntityState & Readonly<Record<string, unknown>>;
const revealedEnemyUnit = {
    ...hiddenEnemyUnit,
    visibleTo: [PLAYER_B, PLAYER_A],
} satisfies BaseEntityState & Readonly<Record<string, unknown>>;

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
    matchResult: null,
};

describe('tacticsVisibilityRules', () => {
    it('keeps public non-unit tactics entities visible', () => {
        expect(tacticsVisibilityRules.isEntityVisible(entity, PLAYER_A, snapshot)).toBe(true);
    });

    it('keeps a viewer-owned unit visible even when it is not externally revealed', () => {
        expect(tacticsVisibilityRules.isEntityVisible(ownUnit, PLAYER_A, snapshot)).toBe(true);
    });

    it('hides enemy units that have not been revealed to the viewer', () => {
        expect(tacticsVisibilityRules.isEntityVisible(hiddenEnemyUnit, PLAYER_A, snapshot)).toBe(
            false,
        );
    });

    it('reveals enemy units once the viewer is listed in visibleTo', () => {
        expect(tacticsVisibilityRules.isEntityVisible(revealedEnemyUnit, PLAYER_A, snapshot)).toBe(
            true,
        );
    });

    it('masks internal visibility metadata from visible units', () => {
        const masked = tacticsVisibilityRules.maskEntity(revealedEnemyUnit, PLAYER_A, snapshot);

        expect(masked).toMatchObject({ id: ENTITY_B, kind: 'unit', ownerId: PLAYER_B });
        expect(masked).not.toHaveProperty('visibleTo');
    });

    it('passes player state through unchanged', () => {
        expect(tacticsVisibilityRules.maskPlayerState(player, PLAYER_B, snapshot)).toBe(player);
    });

    it('does not filter current tactics events', () => {
        expect(tacticsVisibilityRules.filterEvents([event], PLAYER_A, snapshot)).toStrictEqual([
            event,
        ]);
    });
});
