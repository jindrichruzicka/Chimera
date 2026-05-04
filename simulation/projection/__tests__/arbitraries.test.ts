/**
 * simulation/projection/__tests__/arbitraries.test.ts
 *
 * Tests for the fast-check arbitraries that power F29 projection property tests.
 *
 * Tests written first (TDD red) — arbitraries.ts does not exist yet.
 * Verifies:
 *   - arbitraryPlayerId() produces branded PlayerId values.
 *   - arbitraryEntityState(ownerId) covers all three visibility scopes across samples.
 *   - arbitraryPlayerState(playerId) produces player states with an owner-only hand field.
 *   - arbitraryGameSnapshot() produces snapshots accepted by DefaultStateProjector.project()
 *     without runtime errors across 1 000 draws (smoke test).
 *
 * Architecture: §10.1
 * Invariant #3: GameSnapshot never crosses a process boundary — arbitraries produce
 *               GameSnapshot-shaped objects only, never serialise over the wire.
 */

import { describe, expect, it } from 'vitest';
import { assert, property, sample } from 'fast-check';

import type { GameEvent } from '../../engine/types.js';
import { playerId } from '../../engine/types.js';
import { DefaultStateProjector } from '../StateProjector.js';
import type { VisibilityRules } from '../types.js';

import {
    arbitraryEntityState,
    arbitraryGameSnapshot,
    arbitraryGameSnapshotWithHiddenEntity,
    arbitraryPlayerId,
    arbitraryPlayerState,
    type ArbitraryEntityState,
    type ArbitraryGameSnapshot,
    type ArbitraryPlayerState,
} from './arbitraries.js';

// ─── Observed types used by the smoke-test projector ─────────────────────────

interface ObservedArbitraryEntity extends Omit<ArbitraryEntityState, 'secretData'> {
    readonly secretData: string | null;
}

interface ObservedArbitraryPlayer extends Omit<ArbitraryPlayerState, 'hand'> {
    readonly hand: readonly string[] | null;
}

// ─── Smoke-test VisibilityRules ───────────────────────────────────────────────

/**
 * Visibility rules driven by the `visibilityScope` field baked into each
 * ArbitraryEntityState:
 *   - hidden    → entity absent from PlayerSnapshot
 *   - owner-only → secretData masked to null for non-owner
 *   - public    → secretData visible to all
 */
const smokeRules: VisibilityRules<
    ArbitraryGameSnapshot,
    ArbitraryEntityState,
    ArbitraryPlayerState,
    ObservedArbitraryEntity,
    ObservedArbitraryPlayer
> = {
    isEntityVisible(entity, _viewer) {
        return entity.visibilityScope !== 'hidden';
    },
    maskEntity(entity, viewer): ObservedArbitraryEntity {
        return {
            id: entity.id,
            ownerId: entity.ownerId,
            visibilityScope: entity.visibilityScope,
            value: entity.value,
            secretData:
                entity.visibilityScope === 'public' || entity.ownerId === viewer
                    ? entity.secretData
                    : null,
        };
    },
    maskPlayerState(target, viewer): ObservedArbitraryPlayer {
        return {
            id: target.id,
            score: target.score,
            hand: target.id === viewer ? target.hand : null,
        };
    },
    filterEvents(events: readonly GameEvent[]) {
        return events;
    },
};

const smokeProjector = new DefaultStateProjector(smokeRules);

// ─── arbitraryPlayerId ────────────────────────────────────────────────────────

describe('arbitraryPlayerId', () => {
    it('produces string values', () => {
        const samples = sample(arbitraryPlayerId(), 20);
        for (const id of samples) {
            expect(typeof id).toBe('string');
        }
    });

    it('produces non-empty IDs', () => {
        const samples = sample(arbitraryPlayerId(), 20);
        for (const id of samples) {
            expect(id.length).toBeGreaterThan(0);
        }
    });
});

// ─── arbitraryEntityState ─────────────────────────────────────────────────────

describe('arbitraryEntityState', () => {
    const ownerId = playerId('p1');

    it('produces entities with the supplied ownerId', () => {
        assert(
            property(arbitraryEntityState(ownerId), (entity) => {
                return entity.ownerId === ownerId;
            }),
            { numRuns: 200 },
        );
    });

    it('produces only valid VisibilityScope values', () => {
        const validScopes = new Set(['public', 'owner-only', 'hidden']);
        assert(
            property(arbitraryEntityState(ownerId), (entity) => {
                return validScopes.has(entity.visibilityScope);
            }),
            { numRuns: 200 },
        );
    });

    it('covers all three visibility scopes — public, owner-only, hidden — across 500 draws', () => {
        const samples = sample(arbitraryEntityState(ownerId), 500);
        const scopes = new Set(samples.map((e) => e.visibilityScope));
        expect(scopes).toContain('public');
        expect(scopes).toContain('owner-only');
        expect(scopes).toContain('hidden');
    });
});

// ─── arbitraryPlayerState ─────────────────────────────────────────────────────

describe('arbitraryPlayerState', () => {
    const pid = playerId('p1');

    it('produces players whose id matches the supplied playerId', () => {
        assert(
            property(arbitraryPlayerState(pid), (player) => {
                return player.id === pid;
            }),
            { numRuns: 200 },
        );
    });

    it('includes a hand field that is an array of strings (owner-only field)', () => {
        assert(
            property(arbitraryPlayerState(pid), (player) => {
                return Array.isArray(player.hand);
            }),
            { numRuns: 200 },
        );
    });

    it('includes a numeric score field (public field)', () => {
        assert(
            property(arbitraryPlayerState(pid), (player) => {
                return Number.isInteger(player.score);
            }),
            { numRuns: 200 },
        );
    });
});

// ─── arbitraryGameSnapshot ────────────────────────────────────────────────────

describe('arbitraryGameSnapshot', () => {
    it('generates snapshots with exactly two players', () => {
        assert(
            property(arbitraryGameSnapshot(), (snapshot) => {
                return Object.keys(snapshot.players).length === 2;
            }),
            { numRuns: 200 },
        );
    });

    it('satisfies BaseGameSnapshot integer invariants (#42/#44)', () => {
        assert(
            property(arbitraryGameSnapshot(), (snapshot) => {
                return (
                    Number.isInteger(snapshot.tick) &&
                    Number.isInteger(snapshot.seed) &&
                    Number.isInteger(snapshot.turnNumber)
                );
            }),
            { numRuns: 200 },
        );
    });

    it('is accepted by DefaultStateProjector.project() without runtime errors across 1 000 draws', () => {
        assert(
            property(arbitraryGameSnapshot(), (snapshot) => {
                const playerIds = Object.keys(snapshot.players);
                // Always 2 players — noUncheckedIndexedAccess: use non-null assertion
                // safe: invariant is asserted by the "two players" test above.
                const viewerId = playerId(playerIds[0]!);
                smokeProjector.project(snapshot, viewerId);
                return true;
            }),
            { numRuns: 1000 },
        );
    });

    it('generates snapshots whose entity IDs are unique within the snapshot', () => {
        assert(
            property(arbitraryGameSnapshot(), (snapshot) => {
                const entityIds = Object.keys(snapshot.entities);
                return entityIds.length === new Set(entityIds).size;
            }),
            { numRuns: 200 },
        );
    });
});

// ─── arbitraryGameSnapshotWithHiddenEntity ────────────────────────────────────

describe('arbitraryGameSnapshotWithHiddenEntity', () => {
    it('always produces a snapshot containing at least one hidden entity', () => {
        assert(
            property(arbitraryGameSnapshotWithHiddenEntity(), ({ snapshot }) => {
                return Object.values(snapshot.entities).some((e) => e.visibilityScope === 'hidden');
            }),
            { numRuns: 500 },
        );
    });

    it('the returned hiddenEntityId is a key present in snapshot.entities', () => {
        assert(
            property(arbitraryGameSnapshotWithHiddenEntity(), ({ snapshot, hiddenEntityId }) => {
                return hiddenEntityId in snapshot.entities;
            }),
            { numRuns: 500 },
        );
    });

    it('the entity at hiddenEntityId has visibilityScope === "hidden"', () => {
        assert(
            property(arbitraryGameSnapshotWithHiddenEntity(), ({ snapshot, hiddenEntityId }) => {
                const entity = snapshot.entities[hiddenEntityId];
                return entity?.visibilityScope === 'hidden';
            }),
            { numRuns: 500 },
        );
    });
});
