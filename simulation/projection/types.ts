/**
 * simulation/projection/types.ts
 *
 * Shared type contracts for state projection and visibility rules.
 *
 * This module is PURE TYPE DECLARATIONS only — zero runtime code.
 * Architecture references: §4.6, §8.
 * Invariants upheld:
 *   #1 — simulation/ has zero runtime dependencies on React, DOM, or networking.
 *   #8 — StateProjector.project() is the mandatory gate for outbound snapshots.
 */

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    GameEvent,
    PlayerId,
} from '../engine/types.js';

export type VisibilityScope = 'public' | 'owner-only' | 'hidden' | 'committed';

export type ObservedEntityState<
    TEntity extends BaseEntityState = BaseEntityState,
    TMaskedKeys extends keyof TEntity = never,
> = Readonly<Omit<TEntity, TMaskedKeys>> & Readonly<Record<TMaskedKeys, null>>;

export type ObservedPlayerState<
    TPlayer extends BasePlayerState = BasePlayerState,
    TMaskedKeys extends keyof TPlayer = never,
> = Readonly<Omit<TPlayer, TMaskedKeys>> & Readonly<Record<TMaskedKeys, null>>;

export interface VisibilityRules<
    TState extends BaseGameSnapshot = BaseGameSnapshot,
    TEntity extends BaseEntityState = BaseEntityState,
    TPlayer extends BasePlayerState = BasePlayerState,
    TObservedEntity extends Readonly<{ readonly id: TEntity['id'] }> = ObservedEntityState<
        TEntity,
        never
    >,
    TObservedPlayer extends Readonly<{ readonly id: TPlayer['id'] }> = ObservedPlayerState<
        TPlayer,
        never
    >,
> {
    isEntityVisible(entity: TEntity, viewer: PlayerId, state: TState): boolean;
    maskEntity(entity: TEntity, viewer: PlayerId, state: TState): TObservedEntity;
    maskPlayerState(target: TPlayer, viewer: PlayerId, state: TState): TObservedPlayer;
    filterEvents(
        events: readonly GameEvent[],
        viewer: PlayerId,
        state: TState,
    ): readonly GameEvent[];
}
