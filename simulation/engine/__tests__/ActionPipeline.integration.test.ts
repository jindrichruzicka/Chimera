/**
 * simulation/engine/__tests__/ActionPipeline.integration.test.ts
 *
 * Integration tests for engine-reserved actions flowing through the complete
 * ActionPipeline with a real ActionRegistry populated by registerEngineActions().
 *
 * Architecture reference: §4.7
 * Task: issue #354
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ActionPipeline, ActionSchemaError, ActionUnauthorizedError } from '../ActionPipeline.js';
import { ActionRegistry } from '../ActionRegistry.js';
import { registerEngineActions } from '../EngineActions.js';
import type { ActionEnvelope, BaseGameSnapshot, PlayerId } from '../types.js';
import { playerId as toPlayerId } from '../types.js';

const hostId = toPlayerId('p1');
const guestId = toPlayerId('p2');

function makeSnapshot(options?: {
    readonly hostPlayerId?: PlayerId;
    readonly turnClock?: BaseGameSnapshot['turnClock'];
}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 42,
        players: {
            [hostId]: { id: hostId },
            [guestId]: { id: guestId },
        },
        entities: {},
        phase: 'waiting' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
        ...(options?.hostPlayerId === undefined ? {} : { hostPlayerId: options.hostPlayerId }),
        ...(options?.turnClock === undefined ? {} : { turnClock: options.turnClock }),
    };
}

function makeEnvelope(
    type: ActionEnvelope['type'],
    playerId: PlayerId,
    payload: ActionEnvelope['payload'],
): ActionEnvelope {
    return {
        type,
        playerId,
        tick: 0,
        payload,
    };
}

describe('ActionPipeline integration with engine-reserved actions', () => {
    let pipeline: ActionPipeline;

    beforeEach(() => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        pipeline = new ActionPipeline(registry);
    });

    it('passes engine:tick through the complete pipeline without throwing on a no-timers snapshot', () => {
        const snapshot = makeSnapshot();

        const next = pipeline.process(snapshot, makeEnvelope('engine:tick', hostId, { seed: 7 }));

        // No timers in the registry: the logical clock still advances, while
        // timers remains an empty object through downstream pipeline stages.
        expect(next).not.toBe(snapshot);
        expect(next.tick).toBe(snapshot.tick + 1);
        expect(next.timers).toStrictEqual({});
    });

    it('advances engine:end_turn to the next active player when turnClock is configured', () => {
        const snapshot = makeSnapshot({
            turnClock: {
                activePlayerId: hostId,
                deadlineMs: 30_000,
            },
        });

        const next = pipeline.process(snapshot, makeEnvelope('engine:end_turn', hostId, {}));

        expect(next).not.toBe(snapshot);
        expect(next.turnClock).toEqual({
            activePlayerId: guestId,
            deadlineMs: 30_000,
        });
    });

    it('rejects engine:end_turn from a non-active player with ActionUnauthorizedError', () => {
        const snapshot = makeSnapshot({
            turnClock: {
                activePlayerId: hostId,
                deadlineMs: 30_000,
            },
        });

        expect(() =>
            pipeline.process(snapshot, makeEnvelope('engine:end_turn', guestId, {})),
        ).toThrow(ActionUnauthorizedError);

        try {
            pipeline.process(snapshot, makeEnvelope('engine:end_turn', guestId, {}));
        } catch (error) {
            expect(error).toBeInstanceOf(ActionUnauthorizedError);
            expect((error as ActionUnauthorizedError).type).toBe('engine:end_turn');
            expect((error as ActionUnauthorizedError).reason).toBe('not_active_player');
        }
    });

    it.each(['engine:undo', 'engine:redo'] as const)(
        'passes %s through the complete pipeline without throwing',
        (type) => {
            const snapshot = makeSnapshot();

            const next = pipeline.process(snapshot, makeEnvelope(type, hostId, {}));

            expect(next).toBe(snapshot);
        },
    );

    it('passes engine:sync_request through the complete pipeline without throwing', () => {
        const snapshot = makeSnapshot();

        const next = pipeline.process(snapshot, makeEnvelope('engine:sync_request', hostId, {}));

        expect(next).toBe(snapshot);
    });

    it.each(['engine:save', 'engine:load'] as const)(
        'passes %s for the host player through the complete pipeline',
        (type) => {
            const snapshot = makeSnapshot({ hostPlayerId: hostId });

            const next = pipeline.process(
                snapshot,
                makeEnvelope(type, hostId, { slotId: 'tactics/autosave' }),
            );

            expect(next).toBe(snapshot);
        },
    );

    it.each(['engine:save', 'engine:load'] as const)(
        'rejects %s for a non-host player with ActionUnauthorizedError',
        (type) => {
            const snapshot = makeSnapshot({ hostPlayerId: hostId });

            expect(() =>
                pipeline.process(
                    snapshot,
                    makeEnvelope(type, guestId, { slotId: 'tactics/autosave' }),
                ),
            ).toThrow(ActionUnauthorizedError);

            try {
                pipeline.process(
                    snapshot,
                    makeEnvelope(type, guestId, { slotId: 'tactics/autosave' }),
                );
            } catch (error) {
                expect(error).toBeInstanceOf(ActionUnauthorizedError);
                expect((error as ActionUnauthorizedError).type).toBe(type);
            }
        },
    );

    it.each(['engine:save', 'engine:load'] as const)(
        'fails %s parsePayload when slotId is missing',
        (type) => {
            const snapshot = makeSnapshot({ hostPlayerId: hostId });

            expect(() => pipeline.process(snapshot, makeEnvelope(type, hostId, {}))).toThrow(
                ActionSchemaError,
            );

            try {
                pipeline.process(snapshot, makeEnvelope(type, hostId, {}));
            } catch (error) {
                expect(error).toBeInstanceOf(ActionSchemaError);
                expect((error as ActionSchemaError).type).toBe(type);
            }
        },
    );
});
