/**
 * Type-level tests for simulation/projection/types.ts.
 *
 * Written first (red) per TDD mandate — simulation/projection/types.ts does
 * not exist yet.
 */

import { describe, expect, it } from 'vitest';

import { entityId, gamePhase, playerId } from '../engine/types.js';

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    GameEvent,
    PlayerId,
} from '../engine/types.js';
import type {
    ObservedEntityState as BarrelObservedEntityState,
    VisibilityScope as BarrelVisibilityScope,
} from './index.js';
import type {
    ObservedEntityState,
    ObservedPlayerState,
    VisibilityRules,
    VisibilityScope,
} from './types.js';

interface TestPlayerState extends BasePlayerState {
    readonly publicScore: number;
    readonly hand: readonly string[];
    readonly secretObjective: string;
}

interface TestEntityState extends BaseEntityState {
    readonly ownerId: PlayerId;
    readonly x: number;
    readonly y: number;
    readonly visibleHp: number;
    readonly hiddenTrapCode: string;
    readonly ownerNotes: readonly string[];
}

type MaskedTestPlayerState = ObservedPlayerState<TestPlayerState, 'hand' | 'secretObjective'>;

type MaskedTestEntityState = ObservedEntityState<TestEntityState, 'hiddenTrapCode' | 'ownerNotes'>;

const P1 = playerId('p1');
const P2 = playerId('p2');
const E1 = entityId('e1');

const makeSnapshot = (event: GameEvent): BaseGameSnapshot => ({
    tick: 0,
    seed: 123,
    players: {},
    entities: {},
    phase: gamePhase('playing'),
    events: [event],
    turnNumber: 0,
    timers: {},
    matchResult: null,
});

describe('VisibilityScope', () => {
    it('includes the four architecture-defined classifications', () => {
        const scopes: readonly VisibilityScope[] = ['public', 'owner-only', 'hidden', 'committed'];

        expect(scopes).toEqual(['public', 'owner-only', 'hidden', 'committed']);
    });
});

describe('ObservedEntityState', () => {
    it('replaces selected owner-only and hidden entity fields with null', () => {
        const observed: MaskedTestEntityState = {
            id: E1,
            ownerId: P1,
            x: 3,
            y: 4,
            visibleHp: 8,
            hiddenTrapCode: null,
            ownerNotes: null,
        };

        expect(observed.hiddenTrapCode).toBeNull();
        expect(observed.ownerNotes).toBeNull();
        expect(observed.visibleHp).toBe(8);
    });
});

describe('ObservedPlayerState', () => {
    it('replaces selected owner-only and hidden player fields with null', () => {
        const observed: MaskedTestPlayerState = {
            id: P1,
            publicScore: 10,
            hand: null,
            secretObjective: null,
        };

        expect(observed.hand).toBeNull();
        expect(observed.secretObjective).toBeNull();
        expect(observed.publicScore).toBe(10);
    });
});

describe('VisibilityRules', () => {
    it('declares the four projection rule methods with simulation-only types', () => {
        const event: GameEvent = { type: 'unit_spotted' };
        const snapshot = makeSnapshot(event);
        const entity: TestEntityState = {
            id: E1,
            ownerId: P1,
            x: 1,
            y: 2,
            visibleHp: 5,
            hiddenTrapCode: 'alpha',
            ownerNotes: ['hold'],
        };
        const player: TestPlayerState = {
            id: P1,
            publicScore: 7,
            hand: ['card-a'],
            secretObjective: 'flank',
        };

        const rules: VisibilityRules<
            BaseGameSnapshot,
            TestEntityState,
            TestPlayerState,
            MaskedTestEntityState,
            MaskedTestPlayerState
        > = {
            isEntityVisible: (candidate, viewer, state) =>
                candidate.ownerId === viewer || state.tick === 0,
            maskEntity: (candidate) => ({
                ...candidate,
                hiddenTrapCode: null,
                ownerNotes: null,
            }),
            maskPlayerState: (target) => ({
                ...target,
                hand: null,
                secretObjective: null,
            }),
            filterEvents: (events, viewer) =>
                viewer === P2 ? events.filter((candidate) => candidate.type === event.type) : [],
        };

        expect(rules.isEntityVisible(entity, P2, snapshot)).toBe(true);
        expect(rules.maskEntity(entity, P2, snapshot).hiddenTrapCode).toBeNull();
        expect(rules.maskPlayerState(player, P2, snapshot).hand).toBeNull();
        expect(rules.filterEvents([event], P2, snapshot)).toEqual([event]);
    });
});

describe('projection barrel', () => {
    it('exists as the projection module entry point', async () => {
        const projectionModule = await import('./index.js');

        expect(projectionModule).toBeDefined();
    });

    it('re-exports public projection types from index.ts', () => {
        type TestBarrelObservedEntityState = BarrelObservedEntityState<
            TestEntityState,
            'hiddenTrapCode'
        >;

        const scope: BarrelVisibilityScope = 'public';
        const observed: TestBarrelObservedEntityState = {
            id: E1,
            ownerId: P1,
            x: 0,
            y: 0,
            visibleHp: 1,
            hiddenTrapCode: null,
            ownerNotes: [],
        };

        expect(scope).toBe('public');
        expect(observed.hiddenTrapCode).toBeNull();
    });
});
