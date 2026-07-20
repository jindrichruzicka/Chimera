/**
 * apps/tactics/simulation/action-types.ts
 *
 * Shared branded-coordinate type + payload interfaces for the three public
 * tactics actions. Lives here — separate from both actions.ts (reducers) and
 * action-schemas.ts (Zod validators) — so neither module needs to import from
 * the other to share types.
 *
 * Module boundary: no simulation/engine imports beyond basic primitives and
 * types.js — never renderer, electron, or other games.
 */

import type { EntityId } from '@chimera-engine/simulation/engine/types.js';

// ─── Branded coordinate ───────────────────────────────────────────────────────

export type TacticsGridCoordinate = number & { readonly __brand: 'TacticsGridCoordinate' };

export function tacticsGridCoordinate(raw: number): TacticsGridCoordinate {
    if (!Number.isInteger(raw)) {
        throw new TypeError('tactics coordinates must be integers.');
    }
    return raw as TacticsGridCoordinate;
}

// ─── Payload interfaces ───────────────────────────────────────────────────────

export interface TacticsMoveUnitPayload {
    readonly unitId: EntityId;
    readonly x: TacticsGridCoordinate;
    readonly y: TacticsGridCoordinate;
}

export interface TacticsAttackPayload {
    readonly attackerId: EntityId;
    readonly defenderId: EntityId;
}

export interface TacticsRevealTilePayload {
    readonly scoutId: EntityId;
    readonly x: TacticsGridCoordinate;
    readonly y: TacticsGridCoordinate;
}
