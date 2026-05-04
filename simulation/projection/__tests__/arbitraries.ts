/**
 * simulation/projection/__tests__/arbitraries.ts
 *
 * fast-check arbitraries for GameSnapshot-shaped inputs used by F29 property tests.
 *
 * Exports:
 *   - arbitraryPlayerId()                    — branded PlayerId string
 *   - arbitraryEntityState(owner)            — entity covering public / owner-only / hidden scopes
 *   - arbitraryPlayerState(pid)              — player with a public score and an owner-only hand
 *   - arbitraryGameSnapshot()               — full snapshot with two players + random entity set
 *   - arbitraryGameSnapshotWithHiddenEntity() — snapshot guaranteed to contain a hidden entity;
 *                                              also returns the hidden entity's ID (T03 / #452)
 *
 * Distribution: each call to arbitraryEntityState uses fc.constantFrom over the three
 * non-committed visibility scopes, giving an equal 1/3 probability to public,
 * owner-only, and hidden — all scopes are reachable by construction.
 *
 * Invariant #3: these objects are constructed entirely in memory. No IPC, no
 * serialisation, no networking. Consumers must never transmit ArbitraryGameSnapshot
 * across any process boundary.
 *
 * Architecture: §10.1
 * Module boundary: must NOT import from renderer/, electron/, networking/, or games/.
 */

import {
    type Arbitrary,
    array,
    constant,
    constantFrom,
    integer,
    oneof,
    record,
    string,
    tuple,
    uniqueArray,
} from 'fast-check';

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    EntityId,
    PlayerId,
} from '../../engine/types.js';
import { entityId, gamePhase, playerId } from '../../engine/types.js';
import type { VisibilityScope } from '../types.js';

// ─── Extended types for the arbitraries ──────────────────────────────────────

/**
 * Entity shape used by the arbitrary generators.
 *
 * Extends `BaseEntityState` with:
 *   - `ownerId`          — which player owns this entity.
 *   - `visibilityScope`  — one of `public` | `owner-only` | `hidden`; consumed by
 *                          the smoke-test VisibilityRules to drive masking/fog logic.
 *   - `value`            — a public integer field (always visible).
 *   - `secretData`       — an owner-only / hidden string field (masked for non-owners).
 */
export interface ArbitraryEntityState extends BaseEntityState {
    readonly ownerId: PlayerId;
    readonly visibilityScope: Exclude<VisibilityScope, 'committed'>;
    readonly value: number;
    readonly secretData: string;
}

/**
 * Player shape used by the arbitrary generators.
 *
 * Extends `BasePlayerState` with:
 *   - `score` — a public integer field (always visible to all viewers).
 *   - `hand`  — an owner-only field: an array of card-name strings.
 */
export interface ArbitraryPlayerState extends BasePlayerState {
    readonly score: number;
    readonly hand: readonly string[];
}

/**
 * Full game-snapshot shape used by `arbitraryGameSnapshot()`.
 *
 * Narrows `BaseGameSnapshot` so that `entities` and `players` use the
 * concrete projected-test types above.
 */
export interface ArbitraryGameSnapshot extends BaseGameSnapshot {
    readonly entities: Record<EntityId, ArbitraryEntityState>;
    readonly players: Record<PlayerId, ArbitraryPlayerState>;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates a branded `PlayerId` of the form `p<N>` where N ∈ [1, 99_999].
 *
 * The large range keeps the collision probability below 0.001 % when two
 * independent draws are compared (used in `arbitraryGameSnapshot`).
 */
export function arbitraryPlayerId(): Arbitrary<PlayerId> {
    return integer({ min: 1, max: 99_999 }).map((n) => playerId(`p${n}`));
}

/**
 * Generates an `ArbitraryEntityState` owned by `ownerId`.
 *
 * The `visibilityScope` field is drawn uniformly from
 * `['public', 'owner-only', 'hidden']`, so all three scopes are reachable
 * by construction (each with probability 1/3).
 */
export function arbitraryEntityState(ownerId: PlayerId): Arbitrary<ArbitraryEntityState> {
    return record({
        // id is a placeholder — arbitraryGameSnapshot() overwrites it with a
        // positionally-unique entityId to guarantee no duplicates in the record.
        id: constant(entityId('_placeholder')),
        ownerId: constant(ownerId),
        // Equal probability for all three scopes — covers the full VisibilityScope
        // test surface required by §10.1 and the F29 acceptance criteria.
        visibilityScope: constantFrom<Exclude<VisibilityScope, 'committed'>>(
            'public',
            'owner-only',
            'hidden',
        ),
        value: integer(),
        secretData: string(),
    });
}

/**
 * Generates an `ArbitraryPlayerState` for the supplied `playerId`.
 *
 * - `score` is a non-negative integer (public field visible to all viewers).
 * - `hand` is an array of up to eight alphanumeric card names (owner-only field).
 */
export function arbitraryPlayerState(pid: PlayerId): Arbitrary<ArbitraryPlayerState> {
    return record({
        id: constant(pid),
        score: integer({ min: 0, max: 1_000_000 }),
        hand: array(string({ minLength: 2, maxLength: 10, unit: 'grapheme-ascii' }), {
            maxLength: 8,
        }),
    });
}

/**
 * Generates a complete `ArbitraryGameSnapshot` with:
 *   - Two distinct players (IDs drawn from `arbitraryPlayerId()`).
 *   - Up to eight entities distributed across both owners and all three
 *     visibility scopes.
 *   - Integer `tick`, `seed`, and `turnNumber` (Invariants #42/#44).
 *   - Empty `events` and `timers` (sufficient for projection smoke tests).
 *
 * The `entities` record is built with positional keys (`e0`, `e1`, …) to
 * guarantee uniqueness within the snapshot.
 */
export function arbitraryGameSnapshot(): Arbitrary<ArbitraryGameSnapshot> {
    // Generate two distinct player IDs; uniqueArray guarantees no duplicates.
    const twoPlayerIds = uniqueArray(arbitraryPlayerId(), {
        minLength: 2,
        maxLength: 2,
    });

    return twoPlayerIds.chain(([p1, p2]) => {
        // p1 and p2 are always defined: uniqueArray with minLength=maxLength=2.
        const pid1 = p1!;
        const pid2 = p2!;

        return tuple(
            arbitraryPlayerState(pid1),
            arbitraryPlayerState(pid2),
            array(oneof(arbitraryEntityState(pid1), arbitraryEntityState(pid2)), {
                maxLength: 8,
            }),
            integer({ min: 0, max: 10_000 }), // tick — integer invariant #42
            integer({ min: 0, max: 2_147_483_647 }), // seed — integer invariant #42
            constantFrom(gamePhase('lobby'), gamePhase('playing'), gamePhase('ended')),
            integer({ min: 0, max: 10_000 }), // turnNumber — integer invariant #44
        ).map(([player1, player2, entityArray, tick, seed, phase, turnNumber]) => {
            // Build a null-prototype entities record with positional unique IDs.
            const entities = Object.create(null) as Record<EntityId, ArbitraryEntityState>;
            entityArray.forEach((e, i) => {
                const eid = entityId(`e${i}`);
                entities[eid] = { ...e, id: eid };
            });

            const players = Object.create(null) as Record<PlayerId, ArbitraryPlayerState>;
            players[pid1] = player1;
            players[pid2] = player2;

            return {
                tick,
                seed,
                phase,
                turnNumber,
                timers: {},
                events: [],
                players,
                entities,
            } satisfies ArbitraryGameSnapshot;
        });
    });
}

// ─── ArbitrarySnapshotWithHiddenEntity ────────────────────────────────────────

/**
 * The shape returned by `arbitraryGameSnapshotWithHiddenEntity`.
 *
 * Pairs a full `ArbitraryGameSnapshot` with the `EntityId` of a guaranteed
 * hidden entity — so targeted fog-of-war property tests can assert key absence
 * on every run without needing to filter the snapshot post-generation.
 */
export interface ArbitrarySnapshotWithHiddenEntity {
    readonly snapshot: ArbitraryGameSnapshot;
    /** ID of an entity inside `snapshot` whose `visibilityScope` is `'hidden'`. */
    readonly hiddenEntityId: EntityId;
}

/**
 * Generates an `ArbitraryGameSnapshot` that is **guaranteed** to contain at
 * least one fog-hidden entity, alongside the `EntityId` of that entity.
 *
 * Unlike `arbitraryGameSnapshot()` — which distributes entity visibility
 * uniformly and may therefore produce runs with zero hidden entities — this
 * function forces entity `e0` to have `visibilityScope: 'hidden'`.  Up to
 * seven additional entities with random visibility scopes are placed at `e1`…
 * `e7`.
 *
 * Use this in targeted fog-of-war property tests (T03, §10.1, #452) where
 * every run must exercise the "hidden entity absent from PlayerSnapshot"
 * invariant.
 *
 * Architecture: §10.1
 * Module boundary: must NOT import from renderer/, electron/, networking/, or games/.
 */
export function arbitraryGameSnapshotWithHiddenEntity(): Arbitrary<ArbitrarySnapshotWithHiddenEntity> {
    const twoPlayerIds = uniqueArray(arbitraryPlayerId(), { minLength: 2, maxLength: 2 });

    return twoPlayerIds.chain(([p1, p2]) => {
        const pid1 = p1!;
        const pid2 = p2!;

        // Guaranteed hidden entity — visibilityScope is fixed to 'hidden'.
        const forcedHiddenEntity = record({
            id: constant(entityId('_placeholder')),
            ownerId: constantFrom(pid1, pid2),
            visibilityScope: constant('hidden' as const),
            value: integer(),
            secretData: string(),
        });

        return tuple(
            arbitraryPlayerState(pid1),
            arbitraryPlayerState(pid2),
            forcedHiddenEntity,
            array(oneof(arbitraryEntityState(pid1), arbitraryEntityState(pid2)), {
                maxLength: 7,
            }),
            integer({ min: 0, max: 10_000 }), // tick — integer invariant #42
            integer({ min: 0, max: 2_147_483_647 }), // seed — integer invariant #42
            constantFrom(gamePhase('lobby'), gamePhase('playing'), gamePhase('ended')),
            integer({ min: 0, max: 10_000 }), // turnNumber — integer invariant #44
        ).map(([player1, player2, hiddenEntity, extraEntities, tick, seed, phase, turnNumber]) => {
            const entities = Object.create(null) as Record<EntityId, ArbitraryEntityState>;

            // e0 is always the guaranteed hidden entity.
            const hiddenId = entityId('e0');
            entities[hiddenId] = { ...hiddenEntity, id: hiddenId };

            // e1…e7 are additional randomly-scoped entities.
            extraEntities.forEach((e, i) => {
                const eid = entityId(`e${i + 1}`);
                entities[eid] = { ...e, id: eid };
            });

            const players = Object.create(null) as Record<PlayerId, ArbitraryPlayerState>;
            players[pid1] = player1;
            players[pid2] = player2;

            const snapshot: ArbitraryGameSnapshot = {
                tick,
                seed,
                phase,
                turnNumber,
                timers: {},
                events: [],
                players,
                entities,
            };

            return { snapshot, hiddenEntityId: hiddenId };
        });
    });
}
