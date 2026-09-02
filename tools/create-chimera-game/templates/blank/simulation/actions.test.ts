import { describe, expect, it } from 'vitest';

import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { createRng } from '@chimera-engine/simulation/engine/DeterministicRng.js';
import type {
    ActionDefinition,
    BaseGameSnapshot,
    GameReduceContext,
} from '@chimera-engine/simulation/engine/types.js';
import { gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';

import { __GAME_CONSTANT___PING_ACTION } from './constants.js';
import type { __GamePascal__PingPayload } from './action-types.js';
import { register__GamePascal__Actions } from './actions.js';

// Reducer unit smoke. Reducers are pure functions of a snapshot, so a test is a
// direct call: build a snapshot, reduce, assert the next one. No mocks, no
// host, no renderer.
//
// Keep the tick assertion for every action you add. The tick is the engine's
// clock and its action count, and replaying a recorded match feeds the same
// actions back through these reducers expecting each to land the tick one
// higher.

const P1 = playerId('player-1');

function makeSnapshot(tick: number): BaseGameSnapshot {
    return {
        tick,
        seed: 7,
        players: { [P1]: { id: P1 } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: P1,
        timers: {},
        gameResult: null,
    };
}

function makeReduceContext(snapshot: BaseGameSnapshot): GameReduceContext {
    return { rng: createRng(snapshot.seed, snapshot.tick), dispatchDepth: 0 };
}

function pingDefinition(): ActionDefinition<__GamePascal__PingPayload, BaseGameSnapshot> {
    const registry = new ActionRegistry<BaseGameSnapshot>();
    register__GamePascal__Actions(registry);
    return registry.resolve(__GAME_CONSTANT___PING_ACTION) as ActionDefinition<
        __GamePascal__PingPayload,
        BaseGameSnapshot
    >;
}

describe('__game_kebab__:ping', () => {
    it('is registered under the id the constants declare', () => {
        expect(pingDefinition().type).toBe(__GAME_CONSTANT___PING_ACTION);
    });

    it('advances the tick by exactly one', () => {
        const snapshot = makeSnapshot(9);

        const next = pingDefinition().reduce(
            snapshot,
            { note: 'hello' },
            P1,
            makeReduceContext(snapshot),
        );

        expect(next.tick).toBe(10);
    });

    it('does not mutate the snapshot it was given', () => {
        // Reducers return a NEW snapshot. Writing into the argument corrupts
        // the state the host still holds, and no assertion on the return value
        // would notice.
        const snapshot = makeSnapshot(9);
        const before = structuredClone(snapshot);

        pingDefinition().reduce(snapshot, { note: 'hello' }, P1, makeReduceContext(snapshot));

        expect(snapshot).toEqual(before);
    });
});
