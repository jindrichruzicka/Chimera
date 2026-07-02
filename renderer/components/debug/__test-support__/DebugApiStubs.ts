// renderer/components/debug/__test-support__/DebugApiStubs.ts
//
// Test doubles for the `window.__chimeraDebug` Inspector bridge (§4.12).
// Mirrors `renderer/audio/__test-support__/AudioManagerStubs.ts`: spy
// factories only, consumed exclusively by co-located jsdom tests.
//
// Snapshot payloads are built through `SnapshotResult['snapshot']` indexed
// access — the simulation snapshot type itself is never named here
// (invariant check 6 bans that identifier under `renderer/`, and
// `__test-support__` is production-scanned unlike `*.test.tsx`).

import { vi, type Mock } from 'vitest';

import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    ActionHistoryEntry,
    ChimeraDebugApi,
    DiffEntry,
    LiveTickEvent,
    NetworkDiagnostics,
    PerfStats,
    ProjectionResult,
    SnapshotDiff,
    SnapshotResult,
    TickEntry,
} from '@chimera-engine/simulation/bridge/debug-api-types.js';

/**
 * A `ChimeraDebugApi` whose methods are all `vi.fn` spies, plus harness
 * helpers to drive the `onLiveTick` push channel from a test.
 */
export interface DebugApiMock extends ChimeraDebugApi {
    /** Fires every listener currently registered through {@link ChimeraDebugApi.onLiveTick}. */
    emitLiveTick(event: LiveTickEvent): void;
    /** The unsubscribe spy returned by the default `onLiveTick` implementation. */
    readonly liveTickUnsubscribe: Mock;
}

/** Build a `{ tick, snapshot }` result from a JSON-plain object. */
export function makeSnapshotResult(
    tick: number,
    snapshot: Record<string, unknown> = { tick, seed: 0 },
): SnapshotResult {
    return { tick, snapshot: snapshot as SnapshotResult['snapshot'] };
}

/** Live push fixture: `{ tick, snapshot }` with a minimal JSON-plain snapshot. */
export function makeLiveTickEvent(tick: number): LiveTickEvent {
    return { tick, snapshot: makeSnapshotResult(tick).snapshot };
}

/** Tick-list row fixture; metadata fields stay absent unless overridden. */
export function makeTickEntry(overrides: Partial<TickEntry> & Pick<TickEntry, 'tick'>): TickEntry {
    return { inRingBuffer: false, resolvable: true, ...overrides };
}

/** Action-log row fixture with a branded `PlayerId`. */
export function makeActionHistoryEntry(
    overrides: {
        readonly tickApplied?: number;
        readonly turnNumber?: number;
        readonly type?: string;
        readonly playerId?: string;
        readonly payload?: Record<string, unknown>;
    } = {},
): ActionHistoryEntry {
    const tickApplied = overrides.tickApplied ?? 1;
    return {
        tickApplied,
        turnNumber: overrides.turnNumber ?? 1,
        action: {
            type: overrides.type ?? 'engine:end_turn',
            playerId: playerId(overrides.playerId ?? 'player-a'),
            tick: tickApplied,
            payload: overrides.payload ?? {},
        },
    };
}

/** Projection fixture: `{ tick, playerId, snapshot }` from a JSON-plain object. */
export function makeProjectionResult(
    tick: number,
    playerIdRaw = 'player-a',
    snapshot: Record<string, unknown> = { tick, viewerId: playerIdRaw },
): ProjectionResult {
    return {
        tick,
        playerId: playerId(playerIdRaw),
        // @chimera-review: JSON-plain stand-in for the concrete projection
        // shape; tests only need an opaque tree, and building a full
        // PlayerSnapshot here would couple every panel test to its fields.
        snapshot: snapshot as unknown as ProjectionResult['snapshot'],
    };
}

/** Diff row fixture; `before`/`after` stay absent unless provided. */
export function makeDiffEntry(
    overrides: Partial<DiffEntry> & Pick<DiffEntry, 'path' | 'kind'>,
): DiffEntry {
    return { ...overrides };
}

/** Diff fixture whose summary is computed from `entries`. */
export function makeSnapshotDiff(
    fromTick: number,
    toTick: number,
    entries: readonly DiffEntry[] = [],
): SnapshotDiff {
    const summary = { added: 0, removed: 0, changed: 0 };
    for (const entry of entries) {
        summary[entry.kind] += 1;
    }
    return { fromTick, toTick, entries: [...entries], summary };
}

/** Perf aggregate fixture; `sampleCount` follows `recentSamples` unless overridden. */
export function makePerfStats(overrides: Partial<PerfStats> = {}): PerfStats {
    const recentSamples = overrides.recentSamples ?? [
        { tick: 1, durationMs: 1 },
        { tick: 2, durationMs: 1.5 },
        { tick: 3, durationMs: 2 },
    ];
    return {
        avgTickDurationMs: 1.5,
        maxTickDurationMs: 4,
        sampleCount: recentSamples.length,
        recentSamples,
        ringBufferFill: { used: 3, capacity: 128 },
        totalActionCount: 7,
        ...overrides,
    };
}

/** Connection-diagnostics fixture; not hosting unless overridden. */
export function makeNetworkDiagnostics(
    overrides: Partial<NetworkDiagnostics> = {},
): NetworkDiagnostics {
    const hostPort = overrides.hostPort ?? null;
    return {
        localAddresses: overrides.localAddresses ?? [],
        hostPort,
        isHosting: overrides.isHosting ?? hostPort !== null,
    };
}

/**
 * Every method is a `vi.fn` with a benign default; `getProjection`, `diff`,
 * and `getPerfStats` reject by default so a test that needs them must stub
 * them explicitly — an unexpected call surfaces as a test failure instead
 * of silent data.
 */
export function createDebugApiMock(overrides: Partial<ChimeraDebugApi> = {}): DebugApiMock {
    const listeners = new Set<(event: LiveTickEvent) => void>();
    const liveTickUnsubscribe = vi.fn();

    return {
        listTicks: vi.fn(() => Promise.resolve<readonly TickEntry[]>([])),
        getSnapshot: vi.fn((tick: number) => Promise.resolve(makeSnapshotResult(tick))),
        getProjection: vi.fn(() => Promise.reject(new Error('getProjection not stubbed'))),
        diff: vi.fn(() => Promise.reject(new Error('diff not stubbed'))),
        getActionLog: vi.fn(() => Promise.resolve<readonly ActionHistoryEntry[]>([])),
        getPerfStats: vi.fn(() => Promise.reject(new Error('getPerfStats not stubbed'))),
        getNetworkDiagnostics: vi.fn(() => Promise.resolve(makeNetworkDiagnostics())),
        subscribeLive: vi.fn(() => Promise.resolve()),
        unsubscribeLive: vi.fn(() => Promise.resolve()),
        onLiveTick: vi.fn((cb: (event: LiveTickEvent) => void) => {
            listeners.add(cb);
            return liveTickUnsubscribe;
        }),
        emitLiveTick: (event: LiveTickEvent): void => {
            for (const cb of listeners) {
                cb(event);
            }
        },
        liveTickUnsubscribe,
        ...overrides,
    };
}

/**
 * Expose the mock as `window.__chimeraDebug`. The augmentation declares the
 * property `readonly`, so plain assignment fails — `defineProperty` with
 * `configurable: true` is the repo convention for stubbing a `readonly` global.
 */
export function installDebugApi(api: ChimeraDebugApi): void {
    Object.defineProperty(window, '__chimeraDebug', { configurable: true, value: api });
}

/** Reverse {@link installDebugApi}; call from `afterEach`. */
export function uninstallDebugApi(): void {
    Reflect.deleteProperty(window, '__chimeraDebug');
}
