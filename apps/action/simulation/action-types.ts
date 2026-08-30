// The action app's entity + action payload shapes. Lives here — separate from
// `actions.ts` (reducers) and `action-schemas.ts` (Zod validators) — so neither
// module has to import from the other to share types.
//
// Module boundary: only `@chimera-engine/simulation` types and own constants —
// never renderer, electron or networking.

import type { BaseEntityState, PlayerId } from '@chimera-engine/simulation/engine/types.js';

import type { ActionPrimitiveShape } from './constants.js';

/**
 * One velocity component. The whole vocabulary is three integers, so a
 * primitive moves at most one arena cell per axis per tick and the simulation
 * never needs a fractional quantity (Invariant #44 — and therefore never
 * engages Invariant #75's `FixedPoint` requirement, which governs fractional
 * gameplay state).
 */
export type ActionVelocityComponent = -1 | 0 | 1;

/** A movable primitive: one of the three shapes, on an integer arena cell. */
export interface ActionPrimitiveEntity extends BaseEntityState {
    readonly kind: 'primitive';
    readonly shape: ActionPrimitiveShape;
    readonly x: number;
    readonly y: number;
    readonly dx: ActionVelocityComponent;
    readonly dy: ActionVelocityComponent;
    /** The seat driving this primitive, or `null` while it is unclaimed. */
    readonly ownerId: PlayerId | null;
}

/**
 * The arena floor. Carries the arena size so the renderer sizes its plane from
 * the snapshot rather than re-deriving the extents on its own side.
 */
export interface ActionGroundEntity extends BaseEntityState {
    readonly kind: 'ground';
    readonly widthCells: number;
    readonly depthCells: number;
}

/** Payload of `action:set-velocity`. */
export interface ActionSetVelocityPayload {
    readonly dx: ActionVelocityComponent;
    readonly dy: ActionVelocityComponent;
}

/** Payload of `action:select-primitive`. */
export interface ActionSelectPrimitivePayload {
    readonly entityId: string;
}
