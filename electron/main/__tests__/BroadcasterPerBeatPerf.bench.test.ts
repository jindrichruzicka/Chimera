// electron/main/__tests__/BroadcasterPerBeatPerf.bench.test.ts
//
// What `StateBroadcaster` itself spends per eventful beat, by the kind of
// recipient it is sending to. `apps/action/__tests__/OutboundPerBeatPerf.bench.test.ts`
// times an outbound wave assembled by hand, with no broadcaster in it; this one
// drives the real broadcaster, so it sees which work a given recipient is made
// to pay for.
//
// Three arms per grid, every one of them `broadcastWave` per seat:
//  - REACHABLE: the transport can reach every seat — a remote viewer. The
//    broadcaster projects, diffs against what the seat was last sent, and
//    measures the delta against the last keyframe.
//  - UNREACHABLE: the transport can reach no seat and no renderer is bound to
//    any. Nothing receives the frame, so the projection is the only work the
//    broadcaster has a use for.
//  - PROJECTION FLOOR: `StateProjector.project()` per seat and nothing else,
//    which is what the unreachable arm is compared against.
//
// The transport double does no work of its own: a real transport's
// serialisation and checksum are below the layer this file measures.
//
// The beats alternate between two arenas a twentieth of the entities apart, so
// every beat between keyframes is a delta beat at a realtime beat's motion, and
// the default keyframe interval is left in place so its keyframes are counted
// where they fall. Timings are logged, never gated — they move with the
// machine; the per-arm counters are what the cases assert.

import { describe, expect, it } from 'vitest';

import type { HostTransport } from '@chimera-engine/networking';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';
import { DefaultStateProjector } from '@chimera-engine/simulation/projection/StateProjector.js';
import type { VisibilityRules } from '@chimera-engine/simulation/projection/types.js';

import { createNoopLogger } from '../logging/logger.js';
import { StateBroadcaster } from '../runtime/StateBroadcaster.js';

// ─── Fixture ──────────────────────────────────────────────────────────────────

/** The grids §7.5 quotes: entities × seated viewers. */
const GRIDS: readonly (readonly [number, number])[] = [
    [500, 4],
    [2000, 8],
];

const WARM_UP_BEATS = 100;
const TIMED_BEATS = 200;

const identityRules: VisibilityRules = {
    isEntityVisible: () => true,
    maskEntity: (entity) => entity,
    maskPlayerState: (player) => player,
    filterEvents: (events) => events,
};

function seats(count: number): readonly PlayerId[] {
    return Array.from({ length: count }, (_, i) => playerId(`seat-${i.toString()}`));
}

/** `entityCount` entities; the first `movedCount` sit one cell further on when `shift` is 1. */
function makeArena(
    entityCount: number,
    viewers: readonly PlayerId[],
    shift: number,
    movedCount: number,
): BaseGameSnapshot {
    const entities: Record<EntityId, BaseEntityState> = {};
    for (let index = 0; index < entityCount; index += 1) {
        const id = entityId(`unit-${index.toString()}`);
        const moved = index < movedCount ? shift : 0;
        entities[id] = {
            id,
            kind: 'unit',
            x: ((index + moved) % 17) - 8,
            y: ((index + moved) % 11) - 5,
            ownerId: viewers[index % viewers.length] ?? null,
        } as BaseEntityState;
    }
    return {
        tick: 0,
        seed: 42,
        players: Object.fromEntries(viewers.map((id) => [id, { id }])),
        entities,
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

/** One distinct host snapshot per beat, alternating between the two arenas. */
function makeBeats(entityCount: number, viewers: readonly PlayerId[]): BaseGameSnapshot[] {
    const movedCount = Math.max(1, Math.round(entityCount / 20));
    const arenas = [
        makeArena(entityCount, viewers, 0, movedCount),
        makeArena(entityCount, viewers, 1, movedCount),
    ] as const;
    return Array.from({ length: WARM_UP_BEATS + TIMED_BEATS }, (_, beat) => ({
        ...arenas[beat % 2],
        tick: beat + 1,
    })) as BaseGameSnapshot[];
}

function makeTransport(reachable: boolean): HostTransport {
    const none = (): (() => void) => () => undefined;
    return {
        isReachable: () => reachable,
        sendSnapshot: () => undefined,
        sendSnapshotDelta: () => undefined,
        sendTick: () => undefined,
        broadcastLobbyState: () => undefined,
        sendSideChannel: () => undefined,
        sendReveal: () => undefined,
        onActionReceived: none,
        onReadyStateUpdate: none,
        onPlayerAttributeUpdate: none,
        onSpectateTargetUpdate: none,
        onSideChannelReceived: none,
        onPlayerJoined: none,
        onPlayerLeft: none,
        setProfileGate: () => undefined,
        setJoinClassifier: () => undefined,
    };
}

// ─── Measurement ──────────────────────────────────────────────────────────────

interface ArmStats {
    readonly median: number;
    readonly p95: number;
}

/** Run every beat through `wave`, timing all but the warm-up. */
function time(
    beats: readonly BaseGameSnapshot[],
    wave: (snapshot: BaseGameSnapshot) => void,
): ArmStats {
    const samples = new Float64Array(TIMED_BEATS);
    beats.forEach((snapshot, beat) => {
        const start = performance.now();
        wave(snapshot);
        if (beat >= WARM_UP_BEATS) samples[beat - WARM_UP_BEATS] = performance.now() - start;
    });
    const sorted = Array.from(samples).sort((a, b) => a - b);
    const pick = (p: number): number =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    return { median: pick(0.5), p95: pick(0.95) };
}

function log(arm: string, entityCount: number, viewerCount: number, stats: ArmStats): void {
    // `no-console` covers this whole package, tests included.
    process.stdout.write(
        `[perf] broadcaster wave ${entityCount.toString()} entities × ${viewerCount.toString()} viewers, ` +
            `${arm}: median=${stats.median.toFixed(3)}ms p95=${stats.p95.toFixed(3)}ms ` +
            `(n=${TIMED_BEATS.toString()})\n`,
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StateBroadcaster per-beat cost by recipient kind', () => {
    for (const [entityCount, viewerCount] of GRIDS) {
        it(`logs the three arms at ${entityCount.toString()} × ${viewerCount.toString()}`, () => {
            const viewers = seats(viewerCount);
            const beats = makeBeats(entityCount, viewers);
            expect(Object.keys(beats[0]?.entities ?? {})).toHaveLength(entityCount);
            // Every tick differs, so a beat is a delta beat however little moved;
            // count what actually moves between consecutive beats.
            const moved = Object.keys(beats[0]?.entities ?? {}).filter(
                (id) =>
                    JSON.stringify(beats[0]?.entities[id as EntityId]) !==
                    JSON.stringify(beats[1]?.entities[id as EntityId]),
            );
            expect(moved).toHaveLength(entityCount / 20);
            const projector = new DefaultStateProjector(identityRules);

            const runBroadcaster = (reachable: boolean): StateBroadcaster => {
                const broadcaster = new StateBroadcaster(
                    makeTransport(reachable),
                    projector,
                    createNoopLogger(),
                );
                log(
                    reachable ? 'reachable' : 'unreachable',
                    entityCount,
                    viewerCount,
                    time(beats, (snapshot) => {
                        for (const viewerId of viewers)
                            broadcaster.broadcastWave(snapshot, viewerId);
                    }),
                );
                return broadcaster;
            };

            const reachable = runBroadcaster(true);
            const unreachable = runBroadcaster(false);
            let sink = 0;
            log(
                'projection floor',
                entityCount,
                viewerCount,
                time(beats, (snapshot) => {
                    for (const viewerId of viewers)
                        sink ^= projector.project(snapshot, viewerId).tick;
                }),
            );
            expect(Number.isFinite(sink)).toBe(true);

            // What each arm was actually made to do. Over the 300 beats a
            // reachable seat is sent keyframes at beats 1, 61, 121, 181 and 241
            // and a delta on every other beat, with no size fallback; an
            // unreachable one is sent nothing, so it is diffed against nothing
            // either.
            expect(beats).toHaveLength(300);
            expect(reachable.deltaMetrics()).toEqual({
                keyframes: 5 * viewerCount,
                deltas: 295 * viewerCount,
                sizeFallbacks: 0,
            });
            expect(unreachable.deltaMetrics()).toEqual({
                keyframes: 0,
                deltas: 0,
                sizeFallbacks: 0,
            });
        });
    }
});
