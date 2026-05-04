/**
 * simulation/projection/__tests__/StateProjector.property.test.ts
 *
 * F29 property tests — §10.1 "Projection Property Tests"
 *
 * Asserts that `StateProjector.project()` NEVER leaks an `owner-only` or
 * `hidden` field to a non-owner viewer across 10 000 random snapshots.
 *
 * Design:
 *   - The `VisibilityRules` used here wraps sensitive fields in
 *     `{ __visibility: 'owner-only', rawValue: ... }` markers for the owning
 *     player and masks them to `null` for all non-owners.  Hidden entities are
 *     excluded entirely via `isEntityVisible`.  This encoding makes structural
 *     leaks detectable by `assertNoLeakedFields`.
 *   - The property is exercised for BOTH viewers in each snapshot (i.e., each
 *     player appears as the non-owner viewer at some point).
 *   - A dedicated "Honest AI viewer" section exercises the same assertion
 *     framing the projection as an AI agent receiving a `PlayerSnapshot`
 *     (Invariant #17).
 *
 * Acceptance criteria addressed:
 *   - fc.assert runs 10 000 times (numRuns: 10_000).
 *   - assertNoLeakedFields is called — not inlined — in the assertion body.
 *   - Covers entity-level (ObservedEntityState) and player-state-level
 *     (ObservedPlayerState) owner-only / hidden fields.
 *   - Honest AI scenario: same assertion applied when simulating an AI viewer
 *     receiving a non-owner PlayerSnapshot.
 *   - No forbidden cross-module imports.
 *
 * Invariants: #8, #17
 * Architecture: §10.1
 * Module boundary: must NOT import from renderer/, electron/, networking/, or games/.
 */

import { assert, property } from 'fast-check';
import { describe, it } from 'vitest';

import type { EntityId, GameEvent, PlayerId } from '../../engine/types.js';
import { DefaultStateProjector } from '../StateProjector.js';
import { assertNoLeakedFields } from '../assertNoLeakedFields.js';
import type { VisibilityRules } from '../types.js';

import {
    arbitraryGameSnapshot,
    type ArbitraryEntityState,
    type ArbitraryGameSnapshot,
    type ArbitraryPlayerState,
} from './arbitraries.js';

// ─── Observed types with __visibility markers ─────────────────────────────────

/**
 * Owner-only field wrapper: carries the `__visibility` marker so that
 * `assertNoLeakedFields` can detect if this object leaks to a non-owner.
 */
interface OwnerOnlyMarker<T> {
    readonly __visibility: 'owner-only';
    readonly rawValue: T;
}

/**
 * Masked observed entity for the property test.
 *
 * - `secretData` is wrapped in an `OwnerOnlyMarker` for the owning viewer.
 * - For all non-owners the field is `null`.
 * - Public entities carry plain scalar values (no marker).
 */
interface PropertyObservedEntity {
    readonly id: EntityId;
    readonly ownerId: PlayerId;
    readonly visibilityScope: ArbitraryEntityState['visibilityScope'];
    readonly value: number;
    readonly secretData: OwnerOnlyMarker<string> | null | string;
}

/**
 * Masked observed player for the property test.
 *
 * - `hand` is wrapped in an `OwnerOnlyMarker` for the owning viewer.
 * - For all non-owners the field is `null`.
 */
interface PropertyObservedPlayer {
    readonly id: PlayerId;
    readonly score: number;
    readonly hand: OwnerOnlyMarker<readonly string[]> | null;
}

// ─── VisibilityRules ──────────────────────────────────────────────────────────

/**
 * Visibility rules designed to make structural leaks detectable by
 * `assertNoLeakedFields`:
 *
 * Entity masking:
 *   - `hidden`     → absent from PlayerSnapshot (`isEntityVisible` returns false).
 *   - `owner-only` → `secretData` wrapped as `OwnerOnlyMarker` for owner;
 *                    `null` for non-owners.
 *   - `public`     → all fields visible as plain values.
 *
 * Player masking:
 *   - `hand` is owner-only: wrapped as `OwnerOnlyMarker` for the owner;
 *     `null` for non-owners.
 */
const propertyRules: VisibilityRules<
    ArbitraryGameSnapshot,
    ArbitraryEntityState,
    ArbitraryPlayerState,
    PropertyObservedEntity,
    PropertyObservedPlayer
> = {
    isEntityVisible(entity: ArbitraryEntityState): boolean {
        return entity.visibilityScope !== 'hidden';
    },

    maskEntity(entity: ArbitraryEntityState, viewer: PlayerId): PropertyObservedEntity {
        const isOwner = entity.ownerId === viewer;

        if (entity.visibilityScope === 'owner-only') {
            return {
                id: entity.id,
                ownerId: entity.ownerId,
                visibilityScope: entity.visibilityScope,
                value: entity.value,
                secretData: isOwner
                    ? { __visibility: 'owner-only' as const, rawValue: entity.secretData }
                    : null,
            };
        }

        // public — plain value, no marker
        return {
            id: entity.id,
            ownerId: entity.ownerId,
            visibilityScope: entity.visibilityScope,
            value: entity.value,
            secretData: entity.secretData,
        };
    },

    maskPlayerState(player: ArbitraryPlayerState, viewer: PlayerId): PropertyObservedPlayer {
        const isOwner = player.id === viewer;
        return {
            id: player.id,
            score: player.score,
            hand: isOwner ? { __visibility: 'owner-only' as const, rawValue: player.hand } : null,
        };
    },

    filterEvents(_events: readonly GameEvent[]): readonly GameEvent[] {
        return [];
    },
};

const projector = new DefaultStateProjector(propertyRules);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function playerIdsOf(snapshot: ArbitraryGameSnapshot): readonly PlayerId[] {
    return Object.keys(snapshot.players) as PlayerId[];
}

// ─── Property tests ───────────────────────────────────────────────────────────

describe('StateProjector — projection property tests (F29)', () => {
    describe('entity-level: no owner-only or hidden field in non-owner PlayerSnapshot', () => {
        it('assertNoLeakedFields passes for every viewer across 10 000 random snapshots', () => {
            assert(
                property(arbitraryGameSnapshot(), (snapshot: ArbitraryGameSnapshot) => {
                    const allPlayerIds = playerIdsOf(snapshot);

                    for (const viewerId of allPlayerIds) {
                        const projected = projector.project(snapshot, viewerId);
                        // Invariant #8: assertNoLeakedFields is the mandatory
                        // post-projection gate — not inlined logic.
                        assertNoLeakedFields(projected, viewerId, allPlayerIds);
                    }
                }),
                { numRuns: 10_000 },
            );
        });
    });

    describe('player-state-level: hand (owner-only) masked for non-owners', () => {
        it('no non-owner viewer ever receives a non-null hand across 10 000 random snapshots', () => {
            assert(
                property(arbitraryGameSnapshot(), (snapshot: ArbitraryGameSnapshot) => {
                    const allPlayerIds = playerIdsOf(snapshot);

                    for (const viewerId of allPlayerIds) {
                        const projected = projector.project(snapshot, viewerId);
                        assertNoLeakedFields(projected, viewerId, allPlayerIds);
                    }
                }),
                { numRuns: 10_000 },
            );
        });
    });

    describe('fog-of-war: hidden entities absent (not null) from PlayerSnapshot', () => {
        it('no hidden entity is present in any viewer snapshot across 10 000 random snapshots', () => {
            assert(
                property(arbitraryGameSnapshot(), (snapshot: ArbitraryGameSnapshot) => {
                    const allPlayerIds = playerIdsOf(snapshot);

                    // Collect IDs of hidden entities in the full snapshot.
                    const hiddenEntityIds = new Set(
                        Object.entries(snapshot.entities)
                            .filter(([, e]) => e.visibilityScope === 'hidden')
                            .map(([id]) => id),
                    );

                    for (const viewerId of allPlayerIds) {
                        const projected = projector.project(snapshot, viewerId);

                        // Hidden entities must be absent (not even keyed with null).
                        for (const hiddenId of hiddenEntityIds) {
                            if (hiddenId in projected.entities) {
                                throw new Error(
                                    `Hidden entity "${hiddenId}" found in snapshot for viewer "${viewerId}" — must be absent, not null.`,
                                );
                            }
                        }

                        assertNoLeakedFields(projected, viewerId, allPlayerIds);
                    }
                }),
                { numRuns: 10_000 },
            );
        });
    });
});

describe('Honest AI viewer — PlayerSnapshot passed to AI never contains opponent owner-only fields (Invariant #17)', () => {
    it('AI viewer receives only its own owner-only fields; opponent fields are null across 10 000 random snapshots', () => {
        assert(
            property(arbitraryGameSnapshot(), (snapshot: ArbitraryGameSnapshot) => {
                const allPlayerIds = playerIdsOf(snapshot);

                // Simulate each player as the "AI viewer" — the non-owning
                // perspective validates Invariant #17: honest AI receives only
                // its own PlayerSnapshot, never the opponent's full state.
                for (const aiViewerId of allPlayerIds) {
                    const aiSnapshot = projector.project(snapshot, aiViewerId);

                    // The same gate used for human viewers applies to AI viewers.
                    assertNoLeakedFields(aiSnapshot, aiViewerId, allPlayerIds);
                }
            }),
            { numRuns: 10_000 },
        );
    });
});
