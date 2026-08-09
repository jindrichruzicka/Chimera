/**
 * simulation/engine/__tests__/AnimationWindow.property.test.ts
 *
 * The closure-guarantee property for the beat-owned window ledger.
 *
 * Over an arbitrary sequence of `open` / `interrupt` / entity-removal /
 * `advance`, every window instance that ever entered the registry is reported
 * in exactly ONE `ClosedAnimationWindow` — unless it is still open when the
 * sequence ends.
 *
 * The witness is the CLOSED LIST. A registry-side phrasing of the guarantee
 * ("owner gone ⇒ no record") is satisfied by an implementation that drops the
 * record and reports nothing — measured: deleting the `owner-gone` push from
 * `advance` leaves the registry correct and reds this file. The registry is
 * read only for the still-open term, which the closed list cannot supply.
 *
 * A window id is reusable: the same id may be opened, closed and opened again.
 * The property is therefore counted per INSTANCE — the n-th `open` of an id
 * pairs with the n-th closure reported for it — which is also why each open
 * carries a distinct payload: a closure reporting the wrong generation's
 * payload fails the pairing.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Module boundary: must NOT import from renderer/, electron/, networking/, ai/,
 * or apps/.
 */

import { assert, property, constantFrom, integer, record, array, oneof } from 'fast-check';
import { describe, it, expect } from 'vitest';

import type {
    AnimationWindowId,
    AnimationWindowPayload,
    AnimationWindowRegistry,
    ClosedAnimationWindow,
    WindowCloseReason,
} from '../AnimationWindow.js';
import { AnimationWindowManager } from '../AnimationWindow.js';
import type { BaseGameSnapshot, EntityId } from '../types.js';
import { entityId, gamePhase } from '../types.js';

// ─── The op alphabet ──────────────────────────────────────────────────────────

const OWNERS = [entityId('e0'), entityId('e1'), entityId('e2')] as const;
const WINDOW_IDS = ['w0', 'w1', 'w2'].map((raw) => raw as AnimationWindowId);

const CLOSE_REASONS: readonly WindowCloseReason[] = [
    'expired',
    'owner-gone',
    'replaced',
    'interrupted',
];

type Op =
    | {
          readonly kind: 'open';
          readonly id: AnimationWindowId;
          readonly ownerId: EntityId;
          readonly durationBeats: number;
      }
    | { readonly kind: 'interrupt'; readonly id: AnimationWindowId }
    | { readonly kind: 'kill'; readonly ownerId: EntityId }
    | { readonly kind: 'advance' };

const openOp = record({
    kind: constantFrom('open' as const),
    id: constantFrom(...WINDOW_IDS),
    ownerId: constantFrom(...OWNERS),
    durationBeats: integer({ min: 1, max: 3 }),
});

const interruptOp = record({
    kind: constantFrom('interrupt' as const),
    id: constantFrom(...WINDOW_IDS),
});

const killOp = record({
    kind: constantFrom('kill' as const),
    ownerId: constantFrom(...OWNERS),
});

const advanceOp = record({ kind: constantFrom('advance' as const) });

// `advance` is weighted up so countdowns actually reach their end: with the
// four ops equally likely, an `expired` closure would be rare.
const anyOp = oneof(
    { arbitrary: openOp, weight: 3 },
    { arbitrary: interruptOp, weight: 1 },
    { arbitrary: killOp, weight: 1 },
    { arbitrary: advanceOp, weight: 4 },
);

const opSequence = array(anyOp, { minLength: 1, maxLength: 40 });

// ─── The model ────────────────────────────────────────────────────────────────

function makeState(): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 1,
        players: {},
        entities: Object.fromEntries(OWNERS.map((id) => [id, { id }])),
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

function liveIds(state: BaseGameSnapshot): ReadonlySet<EntityId> {
    return new Set(Object.keys(state.entities) as EntityId[]);
}

function withoutEntity(state: BaseGameSnapshot, id: EntityId): BaseGameSnapshot {
    const entities = Object.fromEntries(
        Object.entries(state.entities).filter(([key]) => key !== id),
    );
    return { ...state, entities };
}

interface RunResult {
    /** Every payload opened, per window id, in open order. */
    readonly openedById: ReadonlyMap<AnimationWindowId, AnimationWindowPayload[]>;
    /** Every closure reported, per window id, in report order. */
    readonly closedById: ReadonlyMap<AnimationWindowId, ClosedAnimationWindow[]>;
    readonly finalRegistry: AnimationWindowRegistry;
    readonly allClosed: readonly ClosedAnimationWindow[];
}

function run(ops: readonly Op[]): RunResult {
    let state = makeState();
    const openedById = new Map<AnimationWindowId, AnimationWindowPayload[]>();
    const closedById = new Map<AnimationWindowId, ClosedAnimationWindow[]>();
    const allClosed: ClosedAnimationWindow[] = [];
    let generation = 0;

    const recordClosures = (closed: readonly ClosedAnimationWindow[]): void => {
        for (const entry of closed) {
            const list = closedById.get(entry.id) ?? [];
            list.push(entry);
            closedById.set(entry.id, list);
            allClosed.push(entry);
        }
    };

    for (const op of ops) {
        if (op.kind === 'open') {
            generation += 1;
            // A distinct payload per open, so a closure can be paired with the
            // exact instance it reports rather than merely with the id.
            const payload: AnimationWindowPayload = { generation };
            const result = AnimationWindowManager.open(state, {
                id: op.id,
                ownerId: op.ownerId,
                durationBeats: op.durationBeats,
                payload,
            });
            state = result.next;
            const opened = openedById.get(op.id) ?? [];
            opened.push(payload);
            openedById.set(op.id, opened);
            recordClosures(result.closed);
            continue;
        }

        if (op.kind === 'interrupt') {
            const result = AnimationWindowManager.interrupt(state, op.id);
            state = result.next;
            recordClosures(result.closed);
            continue;
        }

        if (op.kind === 'kill') {
            state = withoutEntity(state, op.ownerId);
            continue;
        }

        const result = AnimationWindowManager.advance(state.animationWindows ?? {}, liveIds(state));
        state = { ...state, animationWindows: result.next };
        recordClosures(result.closed);
    }

    return {
        openedById,
        closedById,
        finalRegistry: state.animationWindows ?? {},
        allClosed,
    };
}

// ─── The property ─────────────────────────────────────────────────────────────

describe('four-reason closure guarantee', () => {
    it('reports every window instance that ever opened in exactly one closure', () => {
        assert(
            property(opSequence, (ops) => {
                const { openedById, closedById, finalRegistry } = run(ops);

                for (const [id, openedPayloads] of openedById) {
                    const closures = closedById.get(id) ?? [];
                    const stillOpen = finalRegistry[id] === undefined ? 0 : 1;

                    // Exactly one closure per instance: no instance is dropped
                    // silently, and none is reported twice.
                    expect(closures.length + stillOpen).toBe(openedPayloads.length);

                    // Instance identity: the k-th closure reports the k-th
                    // open's payload, so a closure carrying the replacement
                    // rather than the replaced record fails here.
                    expect(closures.map((entry) => entry.payload)).toEqual(
                        openedPayloads.slice(0, closures.length),
                    );
                }
            }),
            { numRuns: 2000 },
        );
    });

    it('never reports a closure for an id that never opened', () => {
        assert(
            property(opSequence, (ops) => {
                const { openedById, allClosed } = run(ops);

                for (const entry of allClosed) {
                    expect(openedById.has(entry.id)).toBe(true);
                }
            }),
            { numRuns: 2000 },
        );
    });

    it('reports only the four close reasons', () => {
        assert(
            property(opSequence, (ops) => {
                for (const entry of run(ops).allClosed) {
                    expect(CLOSE_REASONS).toContain(entry.reason);
                }
            }),
            { numRuns: 2000 },
        );
    });
});

// ─── The generator really exercises all four reasons ──────────────────────────

describe('the op alphabet exercises every close reason', () => {
    it('produces all four reasons across a random sample of sequences', () => {
        // Without this the properties above could hold vacuously over a
        // generator that, say, never lets a countdown reach its end.
        const seen = new Set<WindowCloseReason>();

        assert(
            property(opSequence, (ops) => {
                for (const entry of run(ops).allClosed) seen.add(entry.reason);
                return true;
            }),
            { numRuns: 2000 },
        );

        expect([...seen].sort()).toEqual([...CLOSE_REASONS].sort());
    });
});
