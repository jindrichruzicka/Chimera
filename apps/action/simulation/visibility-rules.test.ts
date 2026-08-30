import { describe, expect, it } from 'vitest';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
    GameEvent,
} from '@chimera-engine/simulation/engine/types.js';
import { gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';

import { buildInitialActionEntities } from './entities.js';
import { actionVisibilityRules } from './visibility-rules.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');

/** The seeded cube, narrowed off the record so the tests take no `undefined`. */
function seededCube(snapshot: BaseGameSnapshot): BaseEntityState {
    const cube = snapshot.entities['primitive-cube' as EntityId];
    if (cube === undefined) throw new Error('the arena seeds no cube');
    return cube;
}

function makeSnapshot(): BaseGameSnapshot {
    return {
        tick: 3,
        seed: 7,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: buildInitialActionEntities([P1, P2]),
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

// The action app is an OMNISCIENT game: there is no hidden information to hide,
// so every rule is the identity. These assertions are what stop a copy of the
// tactics policy (which masks) landing here unnoticed.
describe('actionVisibilityRules', () => {
    it('shows every seeded entity to a viewer that owns none of them', () => {
        const snapshot = makeSnapshot();

        for (const entity of Object.values(snapshot.entities)) {
            expect(
                actionVisibilityRules.isEntityVisible(entity, playerId('spectator'), snapshot),
                entity.id,
            ).toBe(true);
        }
    });

    it('shows one seat’s primitive to the other seat', () => {
        const snapshot = makeSnapshot();
        const cube = seededCube(snapshot);

        expect(actionVisibilityRules.isEntityVisible(cube, P2, snapshot)).toBe(true);
    });

    it('projects an entity with every field intact, by identity', () => {
        const snapshot = makeSnapshot();
        const cube = seededCube(snapshot);

        const masked = actionVisibilityRules.maskEntity(cube, P2, snapshot);

        expect(masked).toBe(cube);
        expect(masked).toEqual(cube);
    });

    it('projects a player entry with every field intact, by identity', () => {
        const snapshot = makeSnapshot();
        const target = snapshot.players[P1];
        if (target === undefined) throw new Error('missing seat');

        const masked = actionVisibilityRules.maskPlayerState(target, P2, snapshot);

        expect(masked).toBe(target);
    });

    it('passes every event through, by identity', () => {
        const snapshot = makeSnapshot();
        const events: readonly GameEvent[] = [{ type: 'action:moved' }];

        expect(actionVisibilityRules.filterEvents(events, P2, snapshot)).toBe(events);
    });

    it('shows an entity kind the game does not seed', () => {
        // A rule that whitelisted the two known kinds would hide anything a
        // later scene adds; omniscience is unconditional.
        const snapshot = makeSnapshot();
        const stranger = { id: 'unknown-1', kind: 'marker' } as unknown as BaseEntityState;

        expect(actionVisibilityRules.isEntityVisible(stranger, P1, snapshot)).toBe(true);
    });
});
