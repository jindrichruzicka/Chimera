/**
 * simulation/projection/__tests__/snapshot-dilation-wire.integration.test.ts
 *
 * Integration test for the projected time-dilation field across the two stages
 * a `PlayerSnapshot` actually passes through on its way to a joined client:
 * `StateProjector.project()` and then `ServerMessageSchema.safeParse()`.
 *
 * Why the second stage is asserted rather than assumed. The `PlayerSnapshot`
 * schema in `simulation/foundation/messages-schemas.ts` is a plain `z.object`
 * with neither `.strict()` nor `.passthrough()`, and the enclosing
 * `SnapshotMessage.strict()` constrains only its own three keys — it cannot
 * reach a nested plain object. Zod parses an undeclared key out of such a
 * schema and still reports `success: true`, while `validateSnapshotCrc` runs on
 * the PRE-zod bytes. A projected field that the schema does not declare
 * therefore reaches `ServerConnection` stripped, with a matching checksum and
 * no error — the host would dilate while every joined client rendered at full
 * speed. A projector-only assertion cannot see that; this one reads
 * `res.data`.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Architecture: §4.3, §4.6
 */

import { describe, expect, it } from 'vitest';

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    EntityId,
    PlayerId,
} from '../../engine/types.js';
import { entityId, gamePhase, playerId } from '../../engine/types.js';
import { ServerMessageSchema } from '../../foundation/messages-schemas.js';
import { DefaultStateProjector } from '../StateProjector.js';
import type { VisibilityRules } from '../types.js';

// ─── Fixture ──────────────────────────────────────────────────────────────────

const P1 = playerId('p1');
const E1 = entityId('e1');

interface TestSnapshot extends BaseGameSnapshot {
    readonly players: Record<PlayerId, BasePlayerState>;
    readonly entities: Record<EntityId, BaseEntityState>;
}

/** Everything visible, nothing masked — this test is about the wire, not fog. */
const openRules: VisibilityRules<TestSnapshot> = {
    isEntityVisible: () => true,
    maskEntity: (entity) => entity,
    maskPlayerState: (target) => target,
    filterEvents: (events) => events,
};

const makeSnapshot = (overrides?: Partial<TestSnapshot>): TestSnapshot => ({
    tick: 12,
    seed: 7,
    phase: gamePhase('playing'),
    turnNumber: 0,
    timers: {},
    events: [],
    players: { [P1]: { id: P1 } },
    entities: { [E1]: { id: E1 } },
    gameResult: null,
    ...overrides,
});

const parseSnapshotFrame = (snapshot: unknown): ReturnType<typeof ServerMessageSchema.safeParse> =>
    ServerMessageSchema.safeParse({ type: 'SNAPSHOT', snapshot, checksum: 42 });

// ─── The projected field survives the wire schema ─────────────────────────────

describe('timeScalePermille survives projection AND the wire schema', () => {
    it('is present on res.data after ServerMessageSchema.safeParse', () => {
        const projector = new DefaultStateProjector(openRules);
        const projected = projector.project(makeSnapshot({ timeScalePermille: 250 }), P1);

        // Stage 1 — the projector emitted it.
        expect(projected.timeScalePermille).toBe(250);

        // Stage 2 — and the wire schema declares it, so it is still there after
        // parsing. This is the assertion the projector cannot make.
        const res = parseSnapshotFrame(projected);
        expect(res.success).toBe(true);
        if (!res.success || res.data.type !== 'SNAPSHOT') {
            throw new Error('expected a parsed SNAPSHOT frame');
        }
        expect(res.data.snapshot.timeScalePermille).toBe(250);
    });

    it('an UNDECLARED key on the same frame is silently stripped with success: true', () => {
        const projector = new DefaultStateProjector(openRules);
        const projected = projector.project(makeSnapshot({ timeScalePermille: 250 }), P1);

        // The mutation control for the assertion above, executed rather than
        // described: this is exactly what `timeScalePermille` would do if the
        // `messages-schemas.ts` field were deleted — parsed away, no error.
        const res = parseSnapshotFrame({ ...projected, notDeclaredAnywhere: 99 });
        expect(res.success).toBe(true);
        if (!res.success || res.data.type !== 'SNAPSHOT') {
            throw new Error('expected a parsed SNAPSHOT frame');
        }
        expect(res.data.snapshot).not.toHaveProperty('notDeclaredAnywhere');
        // ...while the declared field beside it survives the same parse.
        expect(res.data.snapshot.timeScalePermille).toBe(250);
    });

    it('rejects a fractional permille at the wire trust boundary (Invariant #44)', () => {
        const projector = new DefaultStateProjector(openRules);
        const projected = projector.project(makeSnapshot(), P1);

        const res = parseSnapshotFrame({ ...projected, timeScalePermille: 250.5 });

        expect(res.success).toBe(false);
    });

    it('parses a frame with no timeScalePermille at all (backward compatible)', () => {
        const projector = new DefaultStateProjector(openRules);
        const projected = projector.project(makeSnapshot(), P1);

        const res = parseSnapshotFrame(projected);
        expect(res.success).toBe(true);
        if (!res.success || res.data.type !== 'SNAPSHOT') {
            throw new Error('expected a parsed SNAPSHOT frame');
        }
        expect(res.data.snapshot.timeScalePermille).toBeUndefined();
    });
});
