/**
 * apps/tactics/simulation/action-schemas.ts
 *
 * Zod schemas for the three public tactics action payloads: MoveUnit, Attack,
 * and RevealTile. Each schema lives here so the schema definition is separate
 * from the reducer logic in actions.ts, and so bufferSchema.ts can import the
 * same primitives without duplication.
 *
 * Branded ids / coords are produced via `.transform()` — the repo's
 * branded-zod idiom (cf. `bufferSchema.ts`).
 *
 * Module boundary: imports only simulation types and own constants — never
 * renderer, electron, or other games.
 */

import { z } from 'zod';
import { entityId } from '@chimera-engine/simulation/engine/types.js';
import {
    tacticsGridCoordinate,
    type TacticsAttackPayload,
    type TacticsMoveUnitPayload,
    type TacticsRevealTilePayload,
} from './action-types.js';

// ─── Primitive schemas ────────────────────────────────────────────────────────

/** Non-empty string transformed into a branded `EntityId`. */
export const EntityIdSchema = z.string().min(1).transform(entityId);

/**
 * Integer number transformed into a branded `TacticsGridCoordinate`.
 * Uses the same validation as `tacticsGridCoordinate()` — must be an integer.
 */
export const GridCoordinateSchema = z.number().int().transform(tacticsGridCoordinate);

// ─── Payload schemas ──────────────────────────────────────────────────────────

/**
 * Validates and parses a raw `tactics:move_unit` payload.
 * Throws a `ZodError` on invalid input.
 */
export const TacticsMoveUnitPayloadSchema: z.ZodType<TacticsMoveUnitPayload> = z
    .object({
        unitId: EntityIdSchema,
        x: GridCoordinateSchema,
        y: GridCoordinateSchema,
    })
    .strict();

/**
 * Validates and parses a raw `tactics:attack` payload.
 * Throws a `ZodError` on invalid input.
 */
export const TacticsAttackPayloadSchema: z.ZodType<TacticsAttackPayload> = z
    .object({
        attackerId: EntityIdSchema,
        defenderId: EntityIdSchema,
    })
    .strict();

/**
 * Validates and parses a raw `tactics:reveal_tile` payload.
 * Throws a `ZodError` on invalid input.
 */
export const TacticsRevealTilePayloadSchema: z.ZodType<TacticsRevealTilePayload> = z
    .object({
        scoutId: EntityIdSchema,
        x: GridCoordinateSchema,
        y: GridCoordinateSchema,
    })
    .strict();
