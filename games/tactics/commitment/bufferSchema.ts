/**
 * games/tactics/commitment/bufferSchema.ts
 *
 * Zod validators for the committed buffer that rides the `tactics:commit` action
 * out-of-band to the host (T9 / #729). The host reads `action.payload.actions`
 * (the raw, un-parsed envelope rider — the commit reducer strips it so it never
 * reaches the snapshot) and the tactics orchestration validates it here before
 * staging it for reveal. This is the trust boundary for the buffer; each action
 * is also re-validated by its own `ActionDefinition.validate` when the host
 * re-dispatches it on reveal (defence in depth).
 *
 * Branded ids/coords are produced via `.transform()` so the parsed result is a
 * real {@link LocalActionBuffer} — the repo's branded-zod idiom (cf.
 * `PlayerIdSchema = NonEmptyStringSchema.transform(playerId)`).
 *
 * Module boundary: imports only `shared/`, `simulation/` (type-only), and own
 * files — never renderer/electron/other games.
 */

import { z } from 'zod';

import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera/games/tactics/constants.js';
import { entityId, playerId } from '@chimera/simulation/engine/types.js';

import { tacticsGridCoordinate } from '../actions.js';
import type { LocalActionBuffer, TacticsCommitmentEnvelopeValue } from './contract.js';

const EntityIdSchema = z.string().min(1).transform(entityId);
const GridCoordinateSchema = z.number().int().transform(tacticsGridCoordinate);

const MoveActionSchema = z
    .object({
        type: z.literal(TACTICS_MOVE_UNIT_ACTION),
        payload: z
            .object({ unitId: EntityIdSchema, x: GridCoordinateSchema, y: GridCoordinateSchema })
            .strict(),
    })
    .strict();

const AttackActionSchema = z
    .object({
        type: z.literal(TACTICS_ATTACK_ACTION),
        payload: z.object({ attackerId: EntityIdSchema, defenderId: EntityIdSchema }).strict(),
    })
    .strict();

const RevealTileActionSchema = z
    .object({
        type: z.literal(TACTICS_REVEAL_TILE_ACTION),
        payload: z
            .object({ scoutId: EntityIdSchema, x: GridCoordinateSchema, y: GridCoordinateSchema })
            .strict(),
    })
    .strict();

/** Discriminated union over the three bufferable tactics action shapes. */
export const BufferedTacticsActionSchema = z.discriminatedUnion('type', [
    MoveActionSchema,
    AttackActionSchema,
    RevealTileActionSchema,
]);

/**
 * Upper bound on a committed buffer's length. Not a gameplay rule — the pipeline
 * still re-validates each action's legality (stamina, adjacency, …) on reveal —
 * but a hard cap stops a malicious commit from staging an unbounded array the
 * host would then re-dispatch one-by-one. Generous: a legitimate turn spends at
 * most `TACTICS_MAX_STAMINA` on move/attack plus a handful of free reveal_tiles.
 */
export const MAX_COMMITTED_BUFFER_ACTIONS = 64;

/** The ordered, un-committed turn a player commits. */
export const LocalActionBufferSchema: z.ZodType<LocalActionBuffer> = z
    .array(BufferedTacticsActionSchema)
    .max(MAX_COMMITTED_BUFFER_ACTIONS);

/** The full committed value hashed into the envelope and echoed on reveal. */
export const TacticsCommitmentEnvelopeValueSchema: z.ZodType<TacticsCommitmentEnvelopeValue> = z
    .object({
        playerId: z.string().min(1).transform(playerId),
        turnNumber: z.number().int().nonnegative(),
        actions: LocalActionBufferSchema,
    })
    .strict();
