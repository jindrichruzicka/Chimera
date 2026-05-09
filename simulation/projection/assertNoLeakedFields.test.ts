import { describe, expect, it } from 'vitest';

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    EntityId,
    PlayerId,
} from '../engine/types.js';
import { entityId, gamePhase, playerId } from '../engine/types.js';

import type { PlayerSnapshot } from './StateProjector.js';
import { DefaultStateProjector } from './StateProjector.js';
import { assertNoLeakedFields, ObfuscationAssertionError } from './assertNoLeakedFields.js';
import type { VisibilityRules } from './types.js';

interface TestPlayerState extends BasePlayerState {
    readonly score: number;
    readonly hand: readonly string[];
    readonly hiddenPlan: string;
}

interface TestEntityState extends BaseEntityState {
    readonly ownerId: PlayerId;
    readonly x: number;
    readonly y: number;
    readonly secretHp: number;
    readonly hiddenTrapSeed: string;
}

interface TestGameSnapshot extends BaseGameSnapshot {
    readonly players: Record<PlayerId, TestPlayerState>;
    readonly entities: Record<EntityId, TestEntityState>;
}

interface TestPlayerView extends BasePlayerState {
    readonly score: number;
    readonly hand: readonly string[] | null;
}

interface TestEntityView extends BaseEntityState {
    readonly ownerId: PlayerId;
    readonly x: number;
    readonly y: number;
    readonly secretHp: number | null;
}

interface OwnerOnlyFieldMarker {
    readonly __visibility: 'owner-only';
    readonly value: readonly string[];
}

interface HiddenFieldMarker {
    readonly __visibility: 'hidden';
    readonly value: string;
}

interface LeakedOpponentPlayerView extends BasePlayerState {
    readonly score: number;
    readonly hand: OwnerOnlyFieldMarker;
}

interface HiddenLeakPlayerView extends BasePlayerState {
    readonly score: number;
    readonly hand: null;
    readonly hiddenPlan: HiddenFieldMarker;
}

const HOST_PLAYER_ID = playerId('host');
const OPPONENT_PLAYER_ID = playerId('opponent');
const HOST_ENTITY_ID = entityId('host-unit');
const OPPONENT_ENTITY_ID = entityId('opponent-unit');
const ALL_PLAYER_IDS = [HOST_PLAYER_ID, OPPONENT_PLAYER_ID] as const;

const visibilityRules: VisibilityRules<
    TestGameSnapshot,
    TestEntityState,
    TestPlayerState,
    TestEntityView,
    TestPlayerView
> = {
    isEntityVisible() {
        return true;
    },
    maskEntity(entity, viewer): TestEntityView {
        return {
            id: entity.id,
            ownerId: entity.ownerId,
            x: entity.x,
            y: entity.y,
            secretHp: entity.ownerId === viewer ? entity.secretHp : null,
        };
    },
    maskPlayerState(player, viewer): TestPlayerView {
        return {
            id: player.id,
            score: player.score,
            hand: player.id === viewer ? player.hand : null,
        };
    },
    filterEvents(events) {
        return events;
    },
};

function makeSnapshot(): TestGameSnapshot {
    return {
        tick: 7,
        seed: 123,
        phase: gamePhase('playing'),
        turnNumber: 1,
        timers: {},
        events: [],
        players: {
            [HOST_PLAYER_ID]: {
                id: HOST_PLAYER_ID,
                score: 10,
                hand: ['host-card'],
                hiddenPlan: 'alpha',
            },
            [OPPONENT_PLAYER_ID]: {
                id: OPPONENT_PLAYER_ID,
                score: 4,
                hand: ['opponent-card'],
                hiddenPlan: 'bravo',
            },
        },
        entities: {
            [HOST_ENTITY_ID]: {
                id: HOST_ENTITY_ID,
                ownerId: HOST_PLAYER_ID,
                x: 1,
                y: 2,
                secretHp: 12,
                hiddenTrapSeed: 'host-trap-seed',
            },
            [OPPONENT_ENTITY_ID]: {
                id: OPPONENT_ENTITY_ID,
                ownerId: OPPONENT_PLAYER_ID,
                x: 5,
                y: 6,
                secretHp: 9,
                hiddenTrapSeed: 'opponent-trap-seed',
            },
        },
        matchResult: null,
    };
}

function projectHostSnapshot(): PlayerSnapshot {
    return new DefaultStateProjector(visibilityRules).project(makeSnapshot(), HOST_PLAYER_ID);
}

function expectAssertionMessage(error: unknown, fieldName: string): void {
    expect(error).toBeInstanceOf(ObfuscationAssertionError);
    expect(error).toBeInstanceOf(Error);

    if (!(error instanceof Error)) {
        throw new Error('Expected an ObfuscationAssertionError');
    }

    expect(error.message).toContain(fieldName);
    expect(error.message).toContain(HOST_PLAYER_ID);
}

describe('assertNoLeakedFields', () => {
    it('does not throw for a two-player host PlayerSnapshot projected through visibility rules', () => {
        const snapshot = projectHostSnapshot();

        expect(() => assertNoLeakedFields(snapshot, HOST_PLAYER_ID, ALL_PLAYER_IDS)).not.toThrow();
    });

    it('throws ObfuscationAssertionError when an opponent owner-only field leaks', () => {
        const snapshot = projectHostSnapshot();
        const leakedOpponent: LeakedOpponentPlayerView = {
            id: OPPONENT_PLAYER_ID,
            score: 4,
            hand: {
                __visibility: 'owner-only',
                value: ['opponent-card'],
            },
        };
        const leakedSnapshot: PlayerSnapshot = {
            ...snapshot,
            players: {
                ...snapshot.players,
                [OPPONENT_PLAYER_ID]: leakedOpponent,
            },
        };

        let caught: unknown;
        try {
            assertNoLeakedFields(leakedSnapshot, HOST_PLAYER_ID, ALL_PLAYER_IDS);
        } catch (error) {
            caught = error;
        }

        expectAssertionMessage(caught, 'hand');
    });

    it('throws ObfuscationAssertionError when a hidden field is present', () => {
        const snapshot = projectHostSnapshot();
        const hiddenLeak: HiddenLeakPlayerView = {
            id: HOST_PLAYER_ID,
            score: 10,
            hand: null,
            hiddenPlan: {
                __visibility: 'hidden',
                value: 'alpha',
            },
        };
        const leakedSnapshot: PlayerSnapshot = {
            ...snapshot,
            players: {
                ...snapshot.players,
                [HOST_PLAYER_ID]: hiddenLeak,
            },
        };

        let caught: unknown;
        try {
            assertNoLeakedFields(leakedSnapshot, HOST_PLAYER_ID, ALL_PLAYER_IDS);
        } catch (error) {
            caught = error;
        }

        expectAssertionMessage(caught, 'hiddenPlan');
    });
});
