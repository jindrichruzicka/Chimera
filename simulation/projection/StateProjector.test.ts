/**
 * simulation/projection/StateProjector.test.ts
 *
 * Unit tests for StateProjector interface and DefaultStateProjector class.
 *
 * Tests are written FIRST (TDD red) — StateProjector.ts does not exist yet.
 * Covers:
 *   - Fog-hidden entities are entirely ABSENT from PlayerSnapshot (not null)
 *   - Visible entities are PRESENT and masked via VisibilityRules.maskEntity
 *   - Player states are masked via VisibilityRules.maskPlayerState
 *   - Events are filtered per viewer via VisibilityRules.filterEvents
 *
 * Architecture: §4.6, §8
 * Invariants: #1, #3, #8
 */

import { describe, expect, it } from 'vitest';

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    EntityId,
    GameEvent,
    PlayerId,
} from '../engine/types.js';
import { entityId, gamePhase, playerId } from '../engine/types.js';

import type { PlayerSnapshot, StateProjector } from './StateProjector.js';
import { DefaultStateProjector } from './StateProjector.js';

import type { CommitmentEnvelope, CommitmentId } from './CommitmentScheme.js';
import { toCommitmentId } from './CommitmentScheme.js';

import type { VisibilityRules } from './types.js';

// ─── Test-domain types ────────────────────────────────────────────────────────

interface TestEntity extends BaseEntityState {
    readonly ownerId: PlayerId;
    readonly x: number;
    readonly y: number;
    readonly secretHp: number; // owner-only field
}

interface TestPlayer extends BasePlayerState {
    readonly score: number; // public
    readonly hand: readonly string[]; // owner-only field
}

interface TestSnapshot extends BaseGameSnapshot {
    readonly entities: Record<EntityId, TestEntity>;
    readonly players: Record<PlayerId, TestPlayer>;
}

/** Observed entity — secretHp is number for owner, null for others. */
interface TestEntityView extends BaseEntityState {
    readonly ownerId: PlayerId;
    readonly x: number;
    readonly y: number;
    readonly secretHp: number | null;
}

/** Observed player — hand is the actual array for owner, null for others. */
interface TestPlayerView extends BasePlayerState {
    readonly score: number;
    readonly hand: readonly string[] | null;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

const P1 = playerId('p1');
const P2 = playerId('p2');
const HOSTILE_PLAYER_ID = playerId('__proto__');
const E1 = entityId('e1');
const E2 = entityId('e2');
const HOSTILE_ENTITY_ID = entityId('__proto__');

const PHASE = gamePhase('playing');

const makeSnapshot = (overrides?: Partial<TestSnapshot>): TestSnapshot => ({
    tick: 1,
    seed: 42,
    phase: PHASE,
    turnNumber: 0,
    timers: {},
    events: [],
    players: {
        [P1]: { id: P1, score: 10, hand: ['cardA', 'cardB'] },
        [P2]: { id: P2, score: 5, hand: ['cardC'] },
    },
    entities: {
        [E1]: { id: E1, ownerId: P1, x: 0, y: 0, secretHp: 100 },
        [E2]: { id: E2, ownerId: P2, x: 5, y: 5, secretHp: 50 },
    },
    ...overrides,
    gameResult: overrides?.gameResult !== undefined ? overrides.gameResult : null,
});

/**
 * Fog-of-war rules: entity visible only to its owner.
 * secretHp is revealed to the owner; masked (null) for non-owners.
 * hand is revealed to the owner; masked (null) for opponents.
 * Events visible only to the player tagged in event.target.
 */
const fogRules: VisibilityRules<
    TestSnapshot,
    TestEntity,
    TestPlayer,
    TestEntityView,
    TestPlayerView
> = {
    isEntityVisible(entity, viewer) {
        return entity.ownerId === viewer;
    },
    maskEntity(entity, viewer): TestEntityView {
        return {
            ...entity,
            secretHp: entity.ownerId === viewer ? entity.secretHp : null,
        };
    },
    maskPlayerState(target, viewer): TestPlayerView {
        return {
            ...target,
            hand: target.id === viewer ? target.hand : null,
        };
    },
    filterEvents(events, viewer) {
        return events.filter((e) => (e as GameEvent & { target?: PlayerId }).target === viewer);
    },
};

/**
 * All-visible rules: every entity is visible but owner-only fields still masked.
 * Used to test masking in isolation from fog of war.
 */
const allVisibleRules: VisibilityRules<
    TestSnapshot,
    TestEntity,
    TestPlayer,
    TestEntityView,
    TestPlayerView
> = {
    isEntityVisible() {
        return true;
    },
    maskEntity(entity, viewer): TestEntityView {
        return {
            ...entity,
            secretHp: entity.ownerId === viewer ? entity.secretHp : null,
        };
    },
    maskPlayerState(target, viewer): TestPlayerView {
        return {
            ...target,
            hand: target.id === viewer ? target.hand : null,
        };
    },
    filterEvents(events) {
        return events;
    },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StateProjector interface', () => {
    it('DefaultStateProjector satisfies the StateProjector interface', () => {
        const projector: StateProjector<TestSnapshot> = new DefaultStateProjector(fogRules);
        expect(projector).toBeDefined();
    });

    it('project returns the canonical PlayerSnapshot contract with undoMeta', () => {
        const projector: StateProjector<TestSnapshot> = new DefaultStateProjector(fogRules);
        const snapshot = makeSnapshot();

        const view: PlayerSnapshot = projector.project(snapshot, P1);

        expect(view.undoMeta).toEqual({ canUndo: false, canRedo: false });
    });
});

describe('DefaultStateProjector.project()', () => {
    describe('entity fog of war', () => {
        it('fog-hidden entities are entirely absent from PlayerSnapshot.entities', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            // P1 owns E1; E2 is owned by P2 → E2 must be absent from P1's view
            const view = projector.project(snapshot, P1);

            expect(Object.keys(view.entities)).toContain(E1);
            expect(Object.keys(view.entities)).not.toContain(E2);
        });

        it('fog-hidden entities are not present as null — they are simply absent', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);

            // Key must not exist at all — not undefined, not null
            expect(E2 in view.entities).toBe(false);
        });

        it('each player sees only their own entities', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            const viewP1 = projector.project(snapshot, P1);
            const viewP2 = projector.project(snapshot, P2);

            expect(Object.keys(viewP1.entities)).toEqual([E1]);
            expect(Object.keys(viewP2.entities)).toEqual([E2]);
        });

        it('a player with no visible entities receives an empty entities record', () => {
            const projector = new DefaultStateProjector(fogRules);
            const P3 = playerId('p3');
            const snapshot = makeSnapshot({
                players: {
                    [P1]: { id: P1, score: 10, hand: [] },
                    [P2]: { id: P2, score: 5, hand: [] },
                    [P3]: { id: P3, score: 0, hand: [] },
                },
            });

            const view = projector.project(snapshot, P3);

            expect(Object.keys(view.entities)).toEqual([]);
            expect(Object.getPrototypeOf(view.entities)).toBeNull();
        });
    });

    describe('projection dictionary safety', () => {
        it('stores hostile entity ids as own snapshot entries', () => {
            const projector = new DefaultStateProjector(allVisibleRules);
            const snapshot = makeSnapshot({
                entities: {
                    [HOSTILE_ENTITY_ID]: {
                        id: HOSTILE_ENTITY_ID,
                        ownerId: P1,
                        x: 9,
                        y: 4,
                        secretHp: 33,
                    },
                },
            });

            const view = projector.project(snapshot, P1);

            expect(Object.getPrototypeOf(view.entities)).toBeNull();
            expect(Object.hasOwn(view.entities, HOSTILE_ENTITY_ID)).toBe(true);
            expect((view.entities[HOSTILE_ENTITY_ID] as TestEntityView).id).toBe(HOSTILE_ENTITY_ID);
        });

        it('stores hostile player ids as own snapshot entries', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot({
                players: {
                    [HOSTILE_PLAYER_ID]: {
                        id: HOSTILE_PLAYER_ID,
                        score: 7,
                        hand: ['trap'],
                    },
                },
            });

            const view = projector.project(snapshot, HOSTILE_PLAYER_ID);

            expect(Object.getPrototypeOf(view.players)).toBeNull();
            expect(Object.hasOwn(view.players, HOSTILE_PLAYER_ID)).toBe(true);
            expect((view.players[HOSTILE_PLAYER_ID] as TestPlayerView).id).toBe(HOSTILE_PLAYER_ID);
        });
    });

    describe('entity masking', () => {
        it('owner sees their own entity with secretHp unmasked', () => {
            const projector = new DefaultStateProjector(allVisibleRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);
            const entity = view.entities[E1] as TestEntityView;

            expect(entity.secretHp).toBe(100);
        });

        it('non-owner sees opponent entity with secretHp masked to null', () => {
            const projector = new DefaultStateProjector(allVisibleRules);
            const snapshot = makeSnapshot();

            // With allVisibleRules both entities are visible to everyone
            const view = projector.project(snapshot, P1);
            const opponentEntity = view.entities[E2] as TestEntityView;

            expect(opponentEntity.secretHp).toBeNull();
        });

        it('maskEntity is called and its result appears in the snapshot', () => {
            const projector = new DefaultStateProjector(allVisibleRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);
            const entity = view.entities[E1] as TestEntityView;

            expect(entity.id).toBe(E1);
            expect(entity.x).toBe(0);
            expect(entity.y).toBe(0);
        });
    });

    describe('player state masking', () => {
        it('viewer sees their own hand unmasked', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);
            const ownPlayer = view.players[P1] as TestPlayerView;

            expect(ownPlayer.hand).toEqual(['cardA', 'cardB']);
        });

        it("opponent's owner-only fields are null in the viewer's snapshot", () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);
            const opponent = view.players[P2] as TestPlayerView;

            expect(opponent.hand).toBeNull();
        });

        it('all players are present in the snapshot (just with masked fields)', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);

            expect(Object.keys(view.players)).toContain(P1);
            expect(Object.keys(view.players)).toContain(P2);
        });

        it('public player fields (score) are visible to all players', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);
            const opponent = view.players[P2] as TestPlayerView;

            expect(opponent.score).toBe(5);
        });
    });

    describe('event filtering', () => {
        it('events not targeted at the viewer are filtered out', () => {
            const projector = new DefaultStateProjector(fogRules);
            const p2Event = { type: 'score', target: P2 } as GameEvent & { target: PlayerId };
            const snapshot = makeSnapshot({ events: [p2Event] });

            const view = projector.project(snapshot, P1);

            expect(view.events).toHaveLength(0);
        });

        it('events targeted at the viewer are included', () => {
            const projector = new DefaultStateProjector(fogRules);
            const p1Event = { type: 'score', target: P1 } as GameEvent & { target: PlayerId };
            const snapshot = makeSnapshot({ events: [p1Event] });

            const view = projector.project(snapshot, P1);

            expect(view.events).toHaveLength(1);
            expect(view.events[0]).toBe(p1Event);
        });

        it('events from multiple players are each filtered independently', () => {
            const projector = new DefaultStateProjector(fogRules);
            const p1Event = { type: 'score', target: P1 } as GameEvent & { target: PlayerId };
            const p2Event = { type: 'score', target: P2 } as GameEvent & { target: PlayerId };
            const snapshot = makeSnapshot({ events: [p1Event, p2Event] });

            const viewP1 = projector.project(snapshot, P1);
            const viewP2 = projector.project(snapshot, P2);

            expect(viewP1.events).toEqual([p1Event]);
            expect(viewP2.events).toEqual([p2Event]);
        });
    });

    describe('PlayerSnapshot fields', () => {
        it('tick is copied from the full state', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot({ tick: 42 });

            const view = projector.project(snapshot, P1);

            expect(view.tick).toBe(42);
        });

        it('viewerId identifies the viewer', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            expect(projector.project(snapshot, P1).viewerId).toBe(P1);
            expect(projector.project(snapshot, P2).viewerId).toBe(P2);
        });

        it('phase is copied from the full state', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot({ phase: PHASE });

            const view = projector.project(snapshot, P1);

            expect(view.phase).toBe(PHASE);
        });

        it('gameResult is copied from the full state for every viewer', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot({ gameResult: { winnerIds: [P1] } });

            const viewP1 = projector.project(snapshot, P1);
            const viewP2 = projector.project(snapshot, P2);

            expect(viewP1.gameResult).toEqual({ winnerIds: [P1] });
            expect(viewP2.gameResult).toEqual({ winnerIds: [P1] });
        });

        it('gameResult remains null while the match is in progress', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot({ gameResult: null });

            const view = projector.project(snapshot, P1);

            expect(view.gameResult).toBeNull();
        });

        it('undoMeta defaults to false when no provider is configured', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);

            expect(view.undoMeta).toEqual({ canUndo: false, canRedo: false });
        });

        it('undoMeta can be supplied per viewer', () => {
            const projector = new DefaultStateProjector(fogRules, {
                getUndoMeta(viewerId) {
                    return { canUndo: viewerId === P1, canRedo: viewerId === P2 };
                },
            });
            const snapshot = makeSnapshot();

            const viewP1 = projector.project(snapshot, P1);
            const viewP2 = projector.project(snapshot, P2);

            expect(viewP1.undoMeta).toEqual({ canUndo: true, canRedo: false });
            expect(viewP2.undoMeta).toEqual({ canUndo: false, canRedo: true });
        });

        it('commitments is present in the projected snapshot', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);

            expect('commitments' in view).toBe(true);
        });

        it('commitments is empty by default (F27)', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);

            expect(Object.keys(view.commitments).length).toBe(0);
            expect(Object.getPrototypeOf(view.commitments)).toBeNull();
        });

        it('pending commitments from getPendingCommitments() appear in the projected snapshot', () => {
            const envelope: CommitmentEnvelope = {
                id: toCommitmentId('test-commitment-1'),
                commitment: 'sha256-hash-placeholder',
            };
            const pendingCommitments: Record<CommitmentId, CommitmentEnvelope> = Object.assign(
                Object.create(null) as Record<CommitmentId, CommitmentEnvelope>,
                { [envelope.id]: envelope },
            );
            const projector = new DefaultStateProjector(fogRules, {
                getPendingCommitments: () => pendingCommitments,
            });
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);

            expect(view.commitments[envelope.id]).toEqual(envelope);
        });

        it('getPendingCommitments() result is used verbatim (null prototype preserved)', () => {
            const envelope: CommitmentEnvelope = {
                id: toCommitmentId('test-commitment-2'),
                commitment: 'another-sha256-hash',
            };
            const pendingCommitments = Object.create(null) as Record<
                CommitmentId,
                CommitmentEnvelope
            >;
            pendingCommitments[envelope.id] = envelope;
            const projector = new DefaultStateProjector(fogRules, {
                getPendingCommitments: () => pendingCommitments,
            });
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);

            expect(Object.getPrototypeOf(view.commitments)).toBeNull();
            expect(Object.keys(view.commitments)).toContain(envelope.id);
        });

        it('empty getPendingCommitments() still produces a null-prototype commitments record', () => {
            const empty = Object.create(null) as Record<CommitmentId, CommitmentEnvelope>;
            const projector = new DefaultStateProjector(fogRules, {
                getPendingCommitments: () => empty,
            });
            const snapshot = makeSnapshot();

            const view = projector.project(snapshot, P1);

            expect(Object.keys(view.commitments)).toHaveLength(0);
            expect(Object.getPrototypeOf(view.commitments)).toBeNull();
        });
    });

    describe('setup passthrough (host-authored lobby config)', () => {
        const setup = {
            matchSettings: { boardColor: 'blue' },
            playerAttributes: {
                [P1]: { color: 'red' },
                [P2]: { color: 'black' },
            },
        };

        it('setup is passed through verbatim to every viewer when present', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot({ setup });

            const viewP1 = projector.project(snapshot, P1);
            const viewP2 = projector.project(snapshot, P2);

            // Same shape and same reference for every viewer — public host config
            // crosses verbatim (no owner-only fields, no masking).
            expect(viewP1.setup).toEqual(setup);
            expect(viewP2.setup).toEqual(setup);
            expect(viewP1.setup).toBe(snapshot.setup);
            expect(viewP2.setup).toBe(snapshot.setup);
        });

        it('setup is absent from the projected snapshot when the full state has none', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot(); // no setup

            const view = projector.project(snapshot, P1);

            expect('setup' in view).toBe(false);
        });
    });

    describe('isMyTurn (turn clock)', () => {
        it('isMyTurn is true when the viewer is the active player', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot({
                turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
            });

            const view = projector.project(snapshot, P1);

            expect(view.isMyTurn).toBe(true);
        });

        it('isMyTurn is false when the viewer is not the active player', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot({
                turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
            });

            const view = projector.project(snapshot, P2);

            expect(view.isMyTurn).toBe(false);
        });

        it('isMyTurn defaults to true when turnClock is absent', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot(); // no turnClock

            const view = projector.project(snapshot, P1);

            expect(view.isMyTurn).toBe(true);
        });

        it('isMyTurn is independently computed for each viewer', () => {
            const projector = new DefaultStateProjector(fogRules);
            const snapshot = makeSnapshot({
                turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
            });

            const viewP1 = projector.project(snapshot, P1);
            const viewP2 = projector.project(snapshot, P2);

            expect(viewP1.isMyTurn).toBe(true);
            expect(viewP2.isMyTurn).toBe(false);
        });
    });
});
