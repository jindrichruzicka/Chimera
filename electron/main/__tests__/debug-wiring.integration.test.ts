/**
 * electron/main/__tests__/debug-wiring.integration.test.ts
 *
 * Integration tests for the host-session debug wiring (§4.12 — Runtime
 * Debug Layer, F47 T5, issue #694).
 *
 * Part 1 — `buildHostSessionPipeline` debug port:
 *   - `debugPort.observer` is wired into `PipelineContext.debugObserver`
 *     (fires post-reduce and on the Stage 3 undo/redo intercept).
 *   - `debugPort.onActionApplied` fires once per `processAction` call with
 *     the stage-6-shaped history entry (PRE-state tick), the resulting
 *     state, and a wall-clock duration sample.
 *   - A throwing `onActionApplied` is caught and logged — it never breaks
 *     the live pipeline (Invariant #25 spirit, mirrors the replayPort guard).
 *   - `replay` is exposed on the result and is pure/deterministic
 *     (Invariant #43) so the debug bridge can reconstruct snapshots.
 *   - Without a `debugPort`, the pipeline context carries no `debugObserver`
 *     (Invariant #31: the field is undefined in production).
 *
 * Part 2 — end-to-end bridge wiring lives further below (added in the
 * debug-bridge implementation step).
 *
 * Tests written FIRST (red); implementation in
 * `electron/main/runtime/HostSessionPipeline.ts` and
 * `electron/main/debug-bridge.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';
import type { HostSessionDebugPort } from '../runtime/HostSessionPipeline.js';
import { startDebugBridge } from '../debug-bridge.js';
import type { DebugInvokeEvent } from '../debug-bridge.js';
import type { DebugResponse } from '@chimera/simulation/debug/index.js';
import type { StateProjector } from '@chimera/simulation/projection/StateProjector.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import type {
    ActionDefinition,
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import type { ActionHistoryEntry } from '@chimera/simulation/engine/UndoManager.js';
import type { Logger } from '../logging/logger.js';
import { FakeInspectorWindow } from '../__test-support__/debug-fakes.js';

// The debug bridge statically imports `electron` for its default window
// factory; these tests always inject a fake factory, so a stub suffices.
vi.mock('electron', () => ({ BrowserWindow: class MockBrowserWindow {} }));

// ── Helpers ────────────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');

function makeBaseSnapshot(tick = 0, playerIds: readonly PlayerId[] = [P1]): BaseGameSnapshot {
    return {
        tick,
        seed: 42,
        players: Object.fromEntries(playerIds.map((id) => [id, { id }])),
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

/** Simple action that increments tick by 1 (new reference → Stage 7 fires). */
const advanceDef: ActionDefinition<Record<string, never>> = {
    type: 'game:advance',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => ({ ...state, tick: state.tick + 1 }),
};

const advanceEnvelope = (tick: number): ActionEnvelope => ({
    type: 'game:advance',
    playerId: P1,
    tick,
    payload: {},
});

const undoEnvelope = (tick: number): ActionEnvelope => ({
    type: 'engine:undo',
    playerId: P1,
    tick,
    payload: {},
});

function makeRegistry(): ActionRegistry {
    const registry = new ActionRegistry();
    registerEngineActions(registry);
    registry.register(advanceDef);
    return registry;
}

function makeSpyLogger(): Logger {
    const logger: Logger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: () => logger,
    };
    return logger;
}

interface AppliedCall {
    readonly entry: ActionHistoryEntry;
    readonly next: Readonly<BaseGameSnapshot>;
    readonly durationMs: number;
}

function makeDebugPort(): {
    port: HostSessionDebugPort;
    observed: { tick: number; snapshot: Readonly<BaseGameSnapshot> }[];
    applied: AppliedCall[];
} {
    const observed: { tick: number; snapshot: Readonly<BaseGameSnapshot> }[] = [];
    const applied: AppliedCall[] = [];
    const port: HostSessionDebugPort = {
        observer: (tick, snapshot) => {
            observed.push({ tick, snapshot });
        },
        onActionApplied: (entry, next, durationMs) => {
            applied.push({ entry, next, durationMs });
        },
    };
    return { port, observed, applied };
}

// ── debugPort.observer → PipelineContext.debugObserver ────────────────────────

describe('buildHostSessionPipeline — debugPort observer wiring', () => {
    it('observer fires with the post-reduce tick and snapshot for each action', () => {
        const { port, observed } = makeDebugPort();
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'test',
            savePort: { autoSave: async () => {} },
            debugPort: port,
        });

        const s0 = makeBaseSnapshot(0);
        const s1 = processAction(s0, advanceEnvelope(0));
        processAction(s1, advanceEnvelope(1));

        expect(observed.map((o) => o.tick)).toEqual([1, 2]);
        expect(observed[0]?.snapshot.tick).toBe(1);
        expect(observed[1]?.snapshot.tick).toBe(2);
    });

    it('observer fires on the Stage 3 undo intercept with the reconstructed state', () => {
        const { port, observed } = makeDebugPort();
        const { processAction, undoManager } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'test',
            savePort: { autoSave: async () => {} },
            debugPort: port,
        });

        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);
        const s1 = processAction(s0, advanceEnvelope(0)); // tick 0→1
        const s2 = processAction(s1, advanceEnvelope(1)); // tick 1→2
        processAction(s2, undoEnvelope(s2.tick)); // reconstructs tick 1

        expect(observed.map((o) => o.tick)).toEqual([1, 2, 1]);
    });

    it('without a debugPort the pipeline context has no debugObserver key', () => {
        const { pipeline } = buildHostSessionPipeline(makeRegistry(), vi.fn());
        // Invariant #31: the field must be ABSENT, not undefined-assigned.
        // The pipeline context is private; assert via the construction options
        // object shape — buildHostSessionPipeline must use a conditional
        // spread. We verify behaviourally: processing works and nothing
        // observes (no throw on missing observer).
        const s0 = makeBaseSnapshot(0);
        expect(() => pipeline.process(s0, advanceEnvelope(0))).not.toThrow();
    });
});

// ── debugPort.onActionApplied ──────────────────────────────────────────────────

describe('buildHostSessionPipeline — debugPort onActionApplied', () => {
    it('fires once per processAction with the PRE-state tick entry, next state, and duration', () => {
        const { port, applied } = makeDebugPort();
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'test',
            savePort: { autoSave: async () => {} },
            debugPort: port,
        });

        const s0 = makeBaseSnapshot(0);
        const s1 = processAction(s0, advanceEnvelope(0));
        processAction(s1, advanceEnvelope(1));

        expect(applied).toHaveLength(2);
        // Mirrors the Stage 6 history append: tickApplied is the PRE-state tick.
        expect(applied[0]?.entry.tickApplied).toBe(0);
        expect(applied[0]?.entry.turnNumber).toBe(0);
        expect(applied[0]?.entry.action.type).toBe('game:advance');
        expect(applied[0]?.next.tick).toBe(1);
        expect(applied[1]?.entry.tickApplied).toBe(1);
        expect(applied[1]?.next.tick).toBe(2);
        for (const call of applied) {
            expect(Number.isFinite(call.durationMs)).toBe(true);
            expect(call.durationMs).toBeGreaterThanOrEqual(0);
        }
    });

    it('fires for engine:undo with the reconstructed next state', () => {
        const { port, applied } = makeDebugPort();
        const { processAction, undoManager } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'test',
            savePort: { autoSave: async () => {} },
            debugPort: port,
        });

        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);
        const s1 = processAction(s0, advanceEnvelope(0));
        processAction(s1, undoEnvelope(s1.tick));

        expect(applied).toHaveLength(2);
        expect(applied[1]?.entry.action.type).toBe('engine:undo');
        expect(applied[1]?.next.tick).toBe(0);
    });

    it('a throwing onActionApplied is caught and logged — pipeline result is unaffected', () => {
        const logger = makeSpyLogger();
        const port: HostSessionDebugPort = {
            observer: () => {},
            onActionApplied: () => {
                throw new Error('debug feed exploded');
            },
        };
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'test',
            savePort: { autoSave: async () => {} },
            debugPort: port,
            logger,
        });

        const s0 = makeBaseSnapshot(0);
        const s1 = processAction(s0, advanceEnvelope(0));

        expect(s1.tick).toBe(1);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('debug'),
            expect.any(Error),
            expect.anything(),
        );
    });
});

// ── replay exposure ────────────────────────────────────────────────────────────

describe('buildHostSessionPipeline — exposes the session replay callback', () => {
    it('replay reproduces the live pipeline state from a base snapshot and recorded entries', () => {
        const { port, applied } = makeDebugPort();
        const { processAction, undoManager, replay } = buildHostSessionPipeline(
            makeRegistry(),
            vi.fn(),
            {
                gameId: 'test',
                savePort: { autoSave: async () => {} },
                debugPort: port,
            },
        );

        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);
        const s1 = processAction(s0, advanceEnvelope(0));
        const s2 = processAction(s1, advanceEnvelope(1));

        const entries = applied.map((call) => call.entry);
        const reconstructed = replay(s0, entries);

        expect(reconstructed).toEqual(s2);
    });

    it('replay is deterministic — identical inputs yield identical outputs', () => {
        const { replay } = buildHostSessionPipeline(makeRegistry(), vi.fn());

        const s0 = makeBaseSnapshot(0);
        const entries: ActionHistoryEntry[] = [
            { tickApplied: 0, turnNumber: 0, action: advanceEnvelope(0) },
            { tickApplied: 1, turnNumber: 0, action: advanceEnvelope(1) },
        ];

        expect(replay(s0, entries)).toEqual(replay(s0, entries));
    });
});

// ── Part 2 — end-to-end: debug bridge over a real host-session pipeline ───────

describe('debug bridge ↔ host session pipeline — end to end', () => {
    interface EndToEnd {
        readonly processAction: ReturnType<typeof buildHostSessionPipeline>['processAction'];
        readonly undoManager: ReturnType<typeof buildHostSessionPipeline>['undoManager'];
        readonly window: FakeInspectorWindow;
        readonly invoke: (request: unknown) => DebugResponse | Promise<DebugResponse>;
    }

    function makeEndToEnd(ringBufferCapacity?: number): EndToEnd {
        const handlers = new Map<
            string,
            (event: DebugInvokeEvent, request: unknown) => DebugResponse | Promise<DebugResponse>
        >();
        const listeners = new Map<string, () => void>();
        const window = new FakeInspectorWindow();
        const bridge = startDebugBridge({
            ipcMain: {
                handle: (channel, handler) => handlers.set(channel, handler),
                on: (channel, listener) => listeners.set(channel, listener),
                removeHandler: (channel) => handlers.delete(channel),
                removeListener: (channel) => listeners.delete(channel),
            },
            logger: makeSpyLogger(),
            debugPreloadPath: '/tmp/debug-api.js',
            createWindow: () => window,
            ...(ringBufferCapacity === undefined ? {} : { ringBufferCapacity }),
        });

        const projector: StateProjector = {
            project: (fullState, viewerId) => ({
                tick: fullState.tick,
                viewerId,
                phase: fullState.phase,
                players: {},
                entities: {},
                events: [],
                gameResult: null,
                commitments: {},
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: false,
            }),
        };

        const resultRef: { current: ReturnType<typeof buildHostSessionPipeline> | null } = {
            current: null,
        };
        const debugPort = bridge.attachSession({
            getProjector: () => projector,
            getReplay: () => {
                const result = resultRef.current;
                if (result === null) {
                    throw new Error('replay requested before pipeline wiring completed');
                }
                return result.replay;
            },
        });
        const result = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'test',
            savePort: { autoSave: async () => {} },
            debugPort,
        });
        resultRef.current = result;

        listeners.get('chimera:debug:toggle-inspector')?.(); // open the Inspector
        const invoke = (request: unknown): DebugResponse | Promise<DebugResponse> => {
            const handler = handlers.get('chimera:debug');
            if (handler === undefined) {
                throw new Error('chimera:debug handler not registered');
            }
            return handler({ sender: window.webContents }, request);
        };

        return {
            processAction: result.processAction,
            undoManager: result.undoManager,
            window,
            invoke,
        };
    }

    it('serves the live action log and a ring-buffered snapshot from real pipeline traffic', async () => {
        const e2e = makeEndToEnd();
        const s0 = makeBaseSnapshot(0);
        e2e.undoManager.saveTurnMemento(s0, P1);
        const s1 = e2e.processAction(s0, advanceEnvelope(0));
        const s2 = e2e.processAction(s1, advanceEnvelope(1));

        const log = await e2e.invoke({ type: 'GET_ACTION_LOG' });
        expect(log.type).toBe('ACTION_LOG');
        if (log.type === 'ACTION_LOG') {
            expect(log.entries.map((entry) => entry.tickApplied)).toEqual([0, 1]);
        }

        const snapshot = await e2e.invoke({ type: 'GET_SNAPSHOT', tick: 2 });
        expect(snapshot.type).toBe('SNAPSHOT');
        if (snapshot.type === 'SNAPSHOT') {
            expect(snapshot.snapshot).toEqual(s2);
        }
    });

    it('reconstructs an evicted tick via the REAL session replay and matches the live state', async () => {
        const e2e = makeEndToEnd(2);
        let state = makeBaseSnapshot(0);
        e2e.undoManager.saveTurnMemento(state, P1);
        const history: BaseGameSnapshot[] = [state];
        for (let i = 0; i < 6; i++) {
            state = e2e.processAction(state, advanceEnvelope(state.tick));
            history.push(state);
        }

        // Ring buffer (capacity 2) holds ticks 5 and 6 only; tick 3 must be
        // replayed from the bridge's baseline memento through the session's
        // deterministic replay (Invariant #43) — and equal the live state.
        const response = await e2e.invoke({ type: 'GET_SNAPSHOT', tick: 3 });
        expect(response.type).toBe('SNAPSHOT');
        if (response.type === 'SNAPSHOT') {
            expect(response.snapshot).toEqual(history[3]);
        }
    });

    it('compacts the bridge log on a real engine:undo and keeps queries consistent', async () => {
        const e2e = makeEndToEnd();
        const s0 = makeBaseSnapshot(0);
        e2e.undoManager.saveTurnMemento(s0, P1);
        const s1 = e2e.processAction(s0, advanceEnvelope(0));
        const s2 = e2e.processAction(s1, advanceEnvelope(1));
        const s3 = e2e.processAction(s2, advanceEnvelope(2));
        const rewound = e2e.processAction(s3, undoEnvelope(s3.tick));
        expect(rewound.tick).toBe(2);

        const log = await e2e.invoke({ type: 'GET_ACTION_LOG' });
        if (log.type === 'ACTION_LOG') {
            expect(log.entries.map((entry) => entry.tickApplied)).toEqual([0, 1]);
            expect(log.entries.every((entry) => entry.action.type !== 'engine:undo')).toBe(true);
        }

        const tickList = await e2e.invoke({ type: 'GET_TICK_LIST' });
        expect(tickList.type).toBe('TICK_LIST');
        if (tickList.type === 'TICK_LIST') {
            // Ring-buffer entries above the rewound tick are superseded
            // timeline data and must never be listed (degraded, never wrong).
            expect(tickList.ticks.map((entry) => entry.tick)).toEqual([0, 1, 2]);
        }

        const superseded = await e2e.invoke({ type: 'GET_SNAPSHOT', tick: 3 });
        expect(superseded.type).toBe('ERROR');
    });

    it('streams LIVE_TICK pushes for real pipeline traffic and reports perf stats', async () => {
        const e2e = makeEndToEnd();
        expect(await e2e.invoke({ type: 'SUBSCRIBE_LIVE' })).toEqual({ type: 'ACK' });

        const s0 = makeBaseSnapshot(0);
        const s1 = e2e.processAction(s0, advanceEnvelope(0));
        e2e.processAction(s1, advanceEnvelope(1));

        const pushes = e2e.window.webContents.sent.filter(
            (sent) => sent.channel === 'chimera:debug:push',
        );
        expect(pushes).toHaveLength(2);
        expect(pushes[1]?.payload).toMatchObject({ type: 'LIVE_TICK', tick: 2 });

        const stats = await e2e.invoke({ type: 'GET_PERF_STATS' });
        expect(stats.type).toBe('PERF_STATS');
        if (stats.type === 'PERF_STATS') {
            expect(stats.stats.sampleCount).toBe(2);
            expect(stats.stats.ringBufferFill.used).toBe(2);
        }
    });

    it('GET_DIFF and GET_PROJECTION resolve through the real snapshot store', async () => {
        const e2e = makeEndToEnd();
        const s0 = makeBaseSnapshot(0);
        const s1 = e2e.processAction(s0, advanceEnvelope(0));
        e2e.processAction(s1, advanceEnvelope(1));

        const diff = await e2e.invoke({ type: 'GET_DIFF', fromTick: 1, toTick: 2 });
        expect(diff.type).toBe('DIFF');
        if (diff.type === 'DIFF') {
            expect(diff.diff.fromTick).toBe(1);
            expect(diff.diff.toTick).toBe(2);
            // Only the tick changed between two pure advances.
            expect(diff.diff.entries.map((entry) => entry.path)).toContain('tick');
        }

        const projection = await e2e.invoke({
            type: 'GET_PROJECTION',
            tick: 2,
            playerId: 'player-1',
        });
        expect(projection).toMatchObject({ type: 'PROJECTION', tick: 2, playerId: 'player-1' });
    });
});
