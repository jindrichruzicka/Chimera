/**
 * simulation/debug/DebugProtocol.test.ts
 *
 * TDD tests for the DebugProtocol typed IPC message unions — the wire
 * contract between the Inspector Window and the main-process debug bridge.
 *
 * Architecture reference: §4.12 (runtime-debug-layer.md)
 * Task: F47 / T3 (issue #692)
 *
 * Tests are written FIRST (red) before DebugProtocol.ts exists. The module
 * is type-only, so these are construct-and-narrow value tests: each union
 * variant is constructed as a literal and narrowed through an exhaustive
 * `switch` whose `never` default proves the union is closed.
 */

import { describe, it, expect } from 'vitest';
import type {
    DebugRequest,
    DebugResponse,
    PerfStats,
    TickDurationSample,
    TickEntry,
} from './DebugProtocol.js';
import { entityId, gamePhase, playerId } from '../engine/types.js';
import type { BaseGameSnapshot, EntityId } from '../engine/types.js';
import type { ActionHistoryEntry } from '../engine/UndoManager.js';
import type { PlayerSnapshot } from '../projection/StateProjector.js';
import type { SnapshotDiff } from './SnapshotDiff.js';

// ─── Test fixtures ─────────────────────────────────────────────────────

interface TestSnapshot extends BaseGameSnapshot {
    readonly entities: Record<EntityId, { readonly id: EntityId; readonly hp: number }>;
}

const p1 = playerId('p1');
const u1 = entityId('unit-1');

const makeSnapshot = (tick = 0): BaseGameSnapshot => ({
    tick,
    seed: 1,
    players: {},
    entities: {},
    phase: gamePhase('test'),
    events: [],
    turnNumber: 0,
    timers: {},
    gameResult: null,
});

const makeTestSnapshot = (tick = 0): TestSnapshot => ({
    ...makeSnapshot(tick),
    entities: { [u1]: { id: u1, hp: 10 } },
});

const makePlayerSnapshot = (tick = 0): PlayerSnapshot => ({
    tick,
    viewerId: p1,
    phase: gamePhase('test'),
    players: {},
    entities: {},
    events: [],
    gameResult: null,
    commitments: {},
    undoMeta: { canUndo: false, canRedo: false },
    isMyTurn: true,
});

const makeHistoryEntry = (tickApplied = 0): ActionHistoryEntry => ({
    tickApplied,
    turnNumber: 0,
    action: { type: 'test:noop', playerId: p1, tick: tickApplied, payload: {} },
});

const makeDiff = (): SnapshotDiff => ({
    fromTick: 1,
    toTick: 2,
    entries: [],
    summary: { added: 0, removed: 0, changed: 0 },
});

const makePerfStats = (): PerfStats => ({
    avgTickDurationMs: 2.5,
    maxTickDurationMs: 4,
    sampleCount: 2,
    recentSamples: [
        { tick: 1, durationMs: 1 },
        { tick: 2, durationMs: 4 },
    ],
    ringBufferFill: { used: 2, capacity: 200 },
    totalActionCount: 2,
});

// ─── DebugRequest union ───────────────────────────────────────────────────────

describe('DebugProtocol — DebugRequest union', () => {
    /**
     * Exhaustive narrowing: the `never` default fails to compile if a
     * variant is missing from the switch, and assigning `request` to
     * `never` fails to compile if the union gains an unhandled member.
     */
    const classify = (request: DebugRequest): string => {
        switch (request.type) {
            case 'GET_TICK_LIST':
                return 'tick-list';
            case 'GET_SNAPSHOT':
                return `snapshot:${request.tick}`;
            case 'GET_PROJECTION':
                return `projection:${request.tick}:${request.playerId}`;
            case 'GET_DIFF':
                return `diff:${request.fromTick}:${request.toTick}`;
            case 'GET_ACTION_LOG':
                return `action-log:${request.fromTick ?? ''}:${request.toTick ?? ''}`;
            case 'GET_PERF_STATS':
                return 'perf-stats';
            case 'GET_NETWORK_DIAGNOSTICS':
                return 'network-diagnostics';
            case 'SUBSCRIBE_LIVE':
                return 'subscribe';
            case 'UNSUBSCRIBE_LIVE':
                return 'unsubscribe';
            case 'SET_I18N_TOKEN_MODE':
                return `i18n-token-mode:${request.enabled}`;
            default: {
                const exhaustive: never = request;
                return exhaustive;
            }
        }
    };

    it('narrows every request variant through an exhaustive switch', () => {
        const requests: DebugRequest[] = [
            { type: 'GET_TICK_LIST' },
            { type: 'GET_SNAPSHOT', tick: 7 },
            { type: 'GET_PROJECTION', tick: 7, playerId: p1 },
            { type: 'GET_DIFF', fromTick: 3, toTick: 7 },
            { type: 'GET_ACTION_LOG', fromTick: 3, toTick: 7 },
            { type: 'GET_PERF_STATS' },
            { type: 'GET_NETWORK_DIAGNOSTICS' },
            { type: 'SUBSCRIBE_LIVE' },
            { type: 'UNSUBSCRIBE_LIVE' },
            { type: 'SET_I18N_TOKEN_MODE', enabled: true },
        ];
        expect(requests.map(classify)).toEqual([
            'tick-list',
            'snapshot:7',
            'projection:7:p1',
            'diff:3:7',
            'action-log:3:7',
            'perf-stats',
            'network-diagnostics',
            'subscribe',
            'unsubscribe',
            'i18n-token-mode:true',
        ]);
    });

    it('GET_ACTION_LOG accepts omitted, partial, and full tick bounds', () => {
        const open: DebugRequest = { type: 'GET_ACTION_LOG' };
        const fromOnly: DebugRequest = { type: 'GET_ACTION_LOG', fromTick: 2 };
        const toOnly: DebugRequest = { type: 'GET_ACTION_LOG', toTick: 9 };
        expect(classify(open)).toBe('action-log::');
        expect(classify(fromOnly)).toBe('action-log:2:');
        expect(classify(toOnly)).toBe('action-log::9');
    });
});

// ─── DebugResponse union ──────────────────────────────────────────────────────

describe('DebugProtocol — DebugResponse union', () => {
    const classify = (response: DebugResponse): string => {
        switch (response.type) {
            case 'TICK_LIST':
                return `tick-list:${response.ticks.length}`;
            case 'SNAPSHOT':
                return `snapshot:${response.tick}:${response.snapshot.tick}`;
            case 'PROJECTION':
                return `projection:${response.tick}:${response.playerId}:${response.snapshot.viewerId}`;
            case 'DIFF':
                return `diff:${response.diff.fromTick}:${response.diff.toTick}`;
            case 'ACTION_LOG':
                return `action-log:${response.entries.length}`;
            case 'PERF_STATS':
                return `perf-stats:${response.stats.sampleCount}`;
            case 'NETWORK_DIAGNOSTICS':
                return `network-diagnostics:${response.diagnostics.localAddresses.length}:${response.diagnostics.hostPort}`;
            case 'LIVE_TICK':
                return `live:${response.tick}`;
            case 'ERROR':
                return `error:${response.message}`;
            case 'ACK':
                return 'ack';
            default: {
                const exhaustive: never = response;
                return exhaustive;
            }
        }
    };

    it('narrows every response variant through an exhaustive switch', () => {
        const responses: DebugResponse[] = [
            { type: 'TICK_LIST', ticks: [{ tick: 1, inRingBuffer: true, resolvable: true }] },
            { type: 'SNAPSHOT', tick: 4, snapshot: makeSnapshot(4) },
            { type: 'PROJECTION', tick: 4, playerId: p1, snapshot: makePlayerSnapshot(4) },
            { type: 'DIFF', diff: makeDiff() },
            { type: 'ACTION_LOG', entries: [makeHistoryEntry(1)] },
            { type: 'PERF_STATS', stats: makePerfStats() },
            {
                type: 'NETWORK_DIAGNOSTICS',
                diagnostics: { localAddresses: ['10.0.0.5'], hostPort: 51234, isHosting: true },
            },
            { type: 'LIVE_TICK', tick: 9, snapshot: makeSnapshot(9) },
            { type: 'ERROR', message: 'TickNotAvailableError: invalid_tick (tick 1.5)' },
            { type: 'ACK' },
        ];
        expect(responses.map(classify)).toEqual([
            'tick-list:1',
            'snapshot:4:4',
            'projection:4:p1:p1',
            'diff:1:2',
            'action-log:1',
            'perf-stats:2',
            'network-diagnostics:1:51234',
            'live:9',
            'error:TickNotAvailableError: invalid_tick (tick 1.5)',
            'ack',
        ]);
    });

    it('type: SNAPSHOT and LIVE_TICK carry the extended snapshot type when parameterized', () => {
        const snapshot: DebugResponse<TestSnapshot> = {
            type: 'SNAPSHOT',
            tick: 4,
            snapshot: makeTestSnapshot(4),
        };
        const live: DebugResponse<TestSnapshot> = {
            type: 'LIVE_TICK',
            tick: 9,
            snapshot: makeTestSnapshot(9),
        };
        if (snapshot.type === 'SNAPSHOT') {
            expect(snapshot.snapshot.entities[u1]?.hp).toBe(10);
        }
        if (live.type === 'LIVE_TICK') {
            expect(live.snapshot.entities[u1]?.hp).toBe(10);
        }
    });
});

// ─── TickEntry / PerfStats shapes ─────────────────────────────────────────────

describe('DebugProtocol — TickEntry and PerfStats shapes', () => {
    it('TickEntry carries action metadata when known from the action log', () => {
        const entry: TickEntry = {
            tick: 3,
            inRingBuffer: false,
            resolvable: true,
            actionType: 'test:add',
            playerId: p1,
            turnNumber: 1,
        };
        expect(entry.actionType).toBe('test:add');
        expect(entry.inRingBuffer).toBe(false);
    });

    it('TickEntry action fields are omittable for ring-buffer-only ticks', () => {
        const entry: TickEntry = { tick: 8, inRingBuffer: true, resolvable: true };
        expect(entry).not.toHaveProperty('actionType');
        expect(entry).not.toHaveProperty('playerId');
        expect(entry).not.toHaveProperty('turnNumber');
    });

    it('PerfStats nests the ring-buffer fill level and recent samples', () => {
        const sample: TickDurationSample = { tick: 1, durationMs: 1 };
        const stats = makePerfStats();
        expect(stats.ringBufferFill).toEqual({ used: 2, capacity: 200 });
        expect(stats.recentSamples[0]).toEqual(sample);
    });
});
