/**
 * electron/main/debug-bridge.test.ts
 *
 * TDD tests for the Runtime Debug Layer bridge (§4.12, F47 T5, issue #694).
 *
 * Everything runs with in-process doubles — fake ipcMain, fake Inspector
 * window factory, fake projector/replay — no real Electron windows.
 *
 * Invariants verified:
 *   #29 — `chimera:debug` validates `event.sender.id` against the Inspector
 *         window's `webContents.id` on EVERY request; foreign senders get
 *         `{ type: 'ERROR' }`.
 *   #30 — ring buffer capacity fixed; bridge log/memento stores are bounded.
 *   #31 — SnapshotRingBuffer/SnapshotInspector are instantiated by the
 *         bridge only (the bridge itself only ever loads under the
 *         IS_DEBUG_MODE dynamic-import gate — covered in index.test.ts).
 *
 * Tests written FIRST (red); implementation in `electron/main/debug-bridge.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    DEBUG_CHANNEL,
    DEBUG_TOGGLE_I18N_TOKEN_MODE_CHANNEL,
    DEBUG_TOGGLE_INSPECTOR_CHANNEL,
    DEBUG_PUSH_CHANNEL,
} from '@chimera-engine/simulation/foundation/constants.js';
import {
    createInspectorWindow,
    startDebugBridge,
    type DebugBridge,
    type DebugInvokeEvent,
    type DebugWebContentsLike,
    type InspectorWindowOptions,
    type StartDebugBridgeOptions,
} from './debug-bridge.js';
import type { HostSessionDebugPort } from './runtime/HostSessionPipeline.js';
import type { Logger } from './logging/logger.js';
import type { DebugResponse } from '@chimera-engine/simulation/debug/index.js';
import { playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { BaseGameSnapshot, PlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { ActionHistoryEntry } from '@chimera-engine/simulation/engine/UndoManager.js';
import type {
    PlayerSnapshot,
    StateProjector,
} from '@chimera-engine/simulation/projection/index.js';
import {
    FakeFullInspectorWindow,
    FakeInspectorWindow,
    FakeWebContents,
} from './__test-support__/debug-fakes.js';

// The bridge statically imports `electron` for its default window factory;
// tests always inject a fake factory, so a stub module suffices.
vi.mock('electron', () => ({ BrowserWindow: class MockBrowserWindow {} }));

// ─── Fakes ────────────────────────────────────────────────────────────────────

type InvokeHandler = (
    event: DebugInvokeEvent,
    request: unknown,
) => DebugResponse | Promise<DebugResponse>;

class FakeIpcMain {
    readonly handlers = new Map<string, InvokeHandler>();
    readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    readonly removedHandlers: string[] = [];

    handle(channel: string, handler: InvokeHandler): void {
        this.handlers.set(channel, handler);
    }

    on(channel: string, listener: (...args: unknown[]) => void): void {
        const existing = this.listeners.get(channel) ?? [];
        this.listeners.set(channel, [...existing, listener]);
    }

    removeHandler(channel: string): void {
        this.handlers.delete(channel);
        this.removedHandlers.push(channel);
    }

    removeListener(channel: string, listener: (...args: unknown[]) => void): void {
        const existing = this.listeners.get(channel) ?? [];
        this.listeners.set(
            channel,
            existing.filter((l) => l !== listener),
        );
    }

    invoke(sender: DebugWebContentsLike, request: unknown): DebugResponse | Promise<DebugResponse> {
        const handler = this.handlers.get(DEBUG_CHANNEL);
        if (handler === undefined) {
            throw new Error(`no handler registered for ${DEBUG_CHANNEL}`);
        }
        return handler({ sender }, request);
    }

    emitToggle(): void {
        for (const listener of this.listeners.get(DEBUG_TOGGLE_INSPECTOR_CHANNEL) ?? []) {
            listener();
        }
    }

    emitTokenModeToggle(): void {
        for (const listener of this.listeners.get(DEBUG_TOGGLE_I18N_TOKEN_MODE_CHANNEL) ?? []) {
            listener();
        }
    }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');

const makeSnapshot = (tick: number, turnNumber = 0): BaseGameSnapshot => ({
    tick,
    seed: 42,
    players: {},
    entities: {},
    phase: 'playing' as BaseGameSnapshot['phase'],
    events: [],
    turnNumber,
    timers: {},
    gameResult: null,
});

const makePlayerSnapshot = (tick: number, viewerId: PlayerId): PlayerSnapshot => ({
    tick,
    viewerId,
    phase: 'playing' as PlayerSnapshot['phase'],
    players: {},
    entities: {},
    events: [],
    gameResult: null,
    commitments: {},
    undoMeta: { canUndo: false, canRedo: false },
    isMyTurn: false,
});

const makeEntry = (
    tickApplied: number,
    type = 'game:advance',
    turnNumber = 0,
): ActionHistoryEntry => ({
    tickApplied,
    turnNumber,
    action: { type, playerId: P1, tick: tickApplied, payload: {} },
});

/** Mirrors the linear-history contract: each replayed entry advances tick by 1. */
const fakeReplay = (
    state: Readonly<BaseGameSnapshot>,
    entries: readonly ActionHistoryEntry[],
): BaseGameSnapshot => entries.reduce((acc) => ({ ...acc, tick: acc.tick + 1 }), state);

function makeFakeProjector(): {
    projector: StateProjector;
    calls: { tick: number; viewerId: PlayerId }[];
} {
    const calls: { tick: number; viewerId: PlayerId }[] = [];
    const projector: StateProjector = {
        project: (fullState, viewerId) => {
            calls.push({ tick: fullState.tick, viewerId });
            return makePlayerSnapshot(fullState.tick, viewerId);
        },
    };
    return { projector, calls };
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

// ─── Harness ──────────────────────────────────────────────────────────────────

interface Harness {
    readonly bridge: DebugBridge;
    readonly ipc: FakeIpcMain;
    readonly created: FakeInspectorWindow[];
    readonly logger: Logger;
}

function makeBridge(opts: Partial<StartDebugBridgeOptions> = {}): Harness {
    const ipc = new FakeIpcMain();
    const created: FakeInspectorWindow[] = [];
    const logger = makeSpyLogger();
    const bridge = startDebugBridge({
        ipcMain: ipc,
        logger,
        debugPreloadPath: '/tmp/debug-api.js',
        createWindow: () => {
            const win = new FakeInspectorWindow();
            created.push(win);
            return win;
        },
        ...opts,
    });
    return { bridge, ipc, created, logger };
}

/** Toggles the Inspector open and returns the freshly created window. */
function openInspector(h: Harness): FakeInspectorWindow {
    h.ipc.emitToggle();
    const win = h.created[h.created.length - 1];
    if (win === undefined) {
        throw new Error('toggle did not create an Inspector window');
    }
    return win;
}

function attach(h: Harness): {
    port: HostSessionDebugPort;
    projectorCalls: { tick: number; viewerId: PlayerId }[];
} {
    const { projector, calls } = makeFakeProjector();
    const port = h.bridge.attachSession({
        getProjector: () => projector,
        getReplay: () => fakeReplay,
    });
    return { port, projectorCalls: calls };
}

async function invoke(
    h: Harness,
    sender: DebugWebContentsLike,
    request: unknown,
): Promise<DebugResponse> {
    return h.ipc.invoke(sender, request);
}

/** Feeds one applied action: observer (in-pipeline) then onActionApplied. */
function feedAdvance(port: HostSessionDebugPort, fromTick: number, turnNumber = 0): void {
    const next = makeSnapshot(fromTick + 1, turnNumber);
    port.observer(next.tick, next);
    port.onActionApplied(makeEntry(fromTick, 'game:advance', turnNumber), next, 1);
}

function feedEndTurn(port: HostSessionDebugPort, fromTick: number, fromTurn: number): void {
    const next = makeSnapshot(fromTick + 1, fromTurn + 1);
    port.observer(next.tick, next);
    port.onActionApplied(makeEntry(fromTick, 'engine:end_turn', fromTurn), next, 1);
}

function feedUndo(
    port: HostSessionDebugPort,
    fromTick: number,
    toTick: number,
    turnNumber = 0,
): void {
    const next = makeSnapshot(toTick, turnNumber);
    port.observer(toTick, next);
    port.onActionApplied(makeEntry(fromTick, 'engine:undo', turnNumber), next, 1);
}

function feedRedo(
    port: HostSessionDebugPort,
    fromTick: number,
    toTick: number,
    turnNumber = 0,
): void {
    const next = makeSnapshot(toTick, turnNumber);
    port.observer(toTick, next);
    port.onActionApplied(makeEntry(fromTick, 'engine:redo', turnNumber), next, 1);
}

// ─── Startup ──────────────────────────────────────────────────────────────────

describe('startDebugBridge — startup', () => {
    it('creates NO Inspector window at startup (closed by default)', () => {
        const h = makeBridge();
        expect(h.created).toHaveLength(0);
    });

    it('registers the chimera:debug invoke handler and both toggle listeners', () => {
        const h = makeBridge();
        expect(h.ipc.handlers.has(DEBUG_CHANNEL)).toBe(true);
        expect(h.ipc.listeners.get(DEBUG_TOGGLE_INSPECTOR_CHANNEL) ?? []).toHaveLength(1);
        expect(h.ipc.listeners.get(DEBUG_TOGGLE_I18N_TOKEN_MODE_CHANNEL) ?? []).toHaveLength(1);
    });
});

// ─── Toggle window lifecycle ──────────────────────────────────────────────────

describe('debug-bridge — toggle-inspector window lifecycle', () => {
    it('first toggle creates the window; second toggle closes it', () => {
        const h = makeBridge();
        h.ipc.emitToggle();
        expect(h.created).toHaveLength(1);

        h.ipc.emitToggle();
        expect(h.created[0]?.closeCalls).toBe(1);
        expect(h.created).toHaveLength(1);
    });

    it('toggle after close creates a fresh window', () => {
        const h = makeBridge();
        h.ipc.emitToggle();
        h.ipc.emitToggle(); // closes
        h.ipc.emitToggle(); // re-creates
        expect(h.created).toHaveLength(2);
    });

    it('user-initiated close clears the window reference (next toggle re-creates)', () => {
        const h = makeBridge();
        const win = openInspector(h);
        win.emitClosed(); // user clicked X — no toggle involved
        h.ipc.emitToggle();
        expect(h.created).toHaveLength(2);
    });

    it('a stale closed event from an old window does not affect the new window', () => {
        const h = makeBridge();
        const first = openInspector(h);
        first.emitClosed();
        const second = openInspector(h);

        first.emitClosed(); // stray duplicate from the dead window

        h.ipc.emitToggle(); // must CLOSE second, not create a third
        expect(second.closeCalls).toBe(1);
        expect(h.created).toHaveLength(2);
    });

    it('user close clears live subscribers', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        const win = openInspector(h);
        await invoke(h, win.webContents, { type: 'SUBSCRIBE_LIVE' });

        win.emitClosed();
        feedAdvance(port, 0);

        expect(win.webContents.sent).toHaveLength(0);
    });
});

// ─── Sender validation (Invariant #29) ────────────────────────────────────────

describe('debug-bridge — chimera:debug sender validation', () => {
    it('rejects every request while no Inspector window is open', async () => {
        const h = makeBridge();
        attach(h);
        const foreign = new FakeWebContents();
        const response = await invoke(h, foreign, { type: 'GET_TICK_LIST' });
        expect(response.type).toBe('ERROR');
    });

    it('rejects a foreign sender id while the Inspector window is open', async () => {
        const h = makeBridge();
        attach(h);
        openInspector(h);
        const foreign = new FakeWebContents();

        expect((await invoke(h, foreign, { type: 'GET_TICK_LIST' })).type).toBe('ERROR');
        expect((await invoke(h, foreign, { type: 'SUBSCRIBE_LIVE' })).type).toBe('ERROR');
    });

    it('accepts the Inspector window sender', async () => {
        const h = makeBridge();
        attach(h);
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_TICK_LIST' });
        expect(response.type).toBe('TICK_LIST');
    });

    it('rejects the old window id after the window was closed and re-created', async () => {
        const h = makeBridge();
        attach(h);
        const first = openInspector(h);
        first.emitClosed();
        const second = openInspector(h);

        expect((await invoke(h, first.webContents, { type: 'GET_TICK_LIST' })).type).toBe('ERROR');
        expect((await invoke(h, second.webContents, { type: 'GET_TICK_LIST' })).type).toBe(
            'TICK_LIST',
        );
    });
});

// ─── Request validation and session gating ────────────────────────────────────

describe('debug-bridge — request validation', () => {
    it.each([
        ['null', null],
        ['not an object', 42],
        ['empty object', {}],
        ['unknown type', { type: 'LAUNCH_MISSILES' }],
        ['missing tick', { type: 'GET_SNAPSHOT' }],
        ['non-numeric tick', { type: 'GET_SNAPSHOT', tick: 'seven' }],
        ['missing playerId', { type: 'GET_PROJECTION', tick: 1 }],
        ['missing diff bounds', { type: 'GET_DIFF', fromTick: 1 }],
    ])('returns ERROR for malformed request: %s', async (_label, request) => {
        const h = makeBridge();
        attach(h);
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, request);
        expect(response.type).toBe('ERROR');
    });

    it.each([
        ['GET_SNAPSHOT float tick', { type: 'GET_SNAPSHOT', tick: 1.5 }],
        ['GET_PROJECTION float tick', { type: 'GET_PROJECTION', tick: 1.5, playerId: 'player-1' }],
        ['GET_DIFF float bound', { type: 'GET_DIFF', fromTick: 0.5, toTick: 2 }],
        ['GET_ACTION_LOG float bound', { type: 'GET_ACTION_LOG', fromTick: 0.5 }],
    ])('rejects a non-integer tick at the validation boundary: %s', async (_label, request) => {
        const h = makeBridge();
        const { port } = attach(h);
        feedAdvance(port, 0);
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, request);
        expect(response).toEqual({ type: 'ERROR', message: 'malformed debug request' });
    });

    it('returns ERROR for data queries when no session is attached', async () => {
        const h = makeBridge();
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_TICK_LIST' });
        expect(response).toEqual({ type: 'ERROR', message: 'no active session' });
    });

    it('SUBSCRIBE_LIVE and UNSUBSCRIBE_LIVE work without an attached session', async () => {
        const h = makeBridge();
        const win = openInspector(h);
        expect(await invoke(h, win.webContents, { type: 'SUBSCRIBE_LIVE' })).toEqual({
            type: 'ACK',
        });
        expect(await invoke(h, win.webContents, { type: 'UNSUBSCRIBE_LIVE' })).toEqual({
            type: 'ACK',
        });
    });

    it('toggle-i18n-token-mode flips the bridge-level flag and forwards each new value', () => {
        const tokenModeCalls: boolean[] = [];
        const h = makeBridge({ onI18nTokenModeChange: (enabled) => tokenModeCalls.push(enabled) });

        h.ipc.emitTokenModeToggle();
        h.ipc.emitTokenModeToggle();
        h.ipc.emitTokenModeToggle();

        expect(tokenModeCalls).toEqual([true, false, true]);
    });

    it('toggle-i18n-token-mode works without an Inspector window or attached session', () => {
        const tokenModeCalls: boolean[] = [];
        const h = makeBridge({ onI18nTokenModeChange: (enabled) => tokenModeCalls.push(enabled) });

        h.ipc.emitTokenModeToggle();

        expect(h.created).toHaveLength(0);
        expect(tokenModeCalls).toEqual([true]);
    });

    it('toggle-i18n-token-mode is a no-op when no game-renderer sink is wired', () => {
        const h = makeBridge();

        expect(() => h.ipc.emitTokenModeToggle()).not.toThrow();
    });

    it('rejects the retired SET_I18N_TOKEN_MODE request as malformed', async () => {
        const h = makeBridge();
        const win = openInspector(h);

        expect(
            (await invoke(h, win.webContents, { type: 'SET_I18N_TOKEN_MODE', enabled: true })).type,
        ).toBe('ERROR');
    });

    it('GET_NETWORK_DIAGNOSTICS returns the injected builder result without an attached session', async () => {
        const diagnostics = {
            localAddresses: ['192.168.0.10'],
            hostPort: 51234,
            isHosting: true,
        } as const;
        const h = makeBridge({ getNetworkDiagnostics: () => diagnostics });
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_NETWORK_DIAGNOSTICS' });
        expect(response).toEqual({ type: 'NETWORK_DIAGNOSTICS', diagnostics });
    });

    it('GET_NETWORK_DIAGNOSTICS returns ERROR when no builder is injected', async () => {
        const h = makeBridge();
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_NETWORK_DIAGNOSTICS' });
        expect(response).toEqual({ type: 'ERROR', message: 'network diagnostics unavailable' });
    });
});

// ─── Query dispatch — every DebugRequest type ─────────────────────────────────

describe('debug-bridge — query dispatch', () => {
    it('GET_TICK_LIST returns timeline rows with action metadata', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        feedAdvance(port, 0);
        feedAdvance(port, 1);
        const win = openInspector(h);

        const response = await invoke(h, win.webContents, { type: 'GET_TICK_LIST' });
        expect(response.type).toBe('TICK_LIST');
        if (response.type === 'TICK_LIST') {
            const ticks = response.ticks.map((t) => t.tick);
            expect(ticks).toContain(0);
            expect(ticks).toContain(1);
            const row0 = response.ticks.find((t) => t.tick === 0);
            expect(row0?.actionType).toBe('game:advance');
        }
    });

    it('GET_SNAPSHOT serves a ring-buffered tick', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        feedAdvance(port, 0);
        feedAdvance(port, 1);
        const win = openInspector(h);

        const response = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 2 });
        expect(response).toMatchObject({ type: 'SNAPSHOT', tick: 2 });
        if (response.type === 'SNAPSHOT') {
            expect(response.snapshot.tick).toBe(2);
        }
    });

    it('GET_SNAPSHOT reconstructs an evicted tick from the nearest memento', async () => {
        const h = makeBridge({ ringBufferCapacity: 2 });
        const { port } = attach(h);
        for (let tick = 0; tick < 6; tick++) {
            feedAdvance(port, tick);
        }
        // Buffer holds only ticks 5,6; tick 3 must be replayed from the
        // baseline memento (tick 1) + entries with tickApplied in [1, 3).
        const win = openInspector(h);

        const response = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 3 });
        expect(response).toMatchObject({ type: 'SNAPSHOT', tick: 3 });
    });

    it('GET_SNAPSHOT maps TickNotAvailableError to an ERROR response', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        feedAdvance(port, 0);
        const win = openInspector(h);

        const response = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 999 });
        expect(response.type).toBe('ERROR');
        if (response.type === 'ERROR') {
            expect(response.message).toContain('TickNotAvailableError');
        }
    });

    it('GET_PROJECTION projects through the lazily-resolved session projector', async () => {
        const h = makeBridge();
        const { port, projectorCalls } = attach(h);
        feedAdvance(port, 0);
        const win = openInspector(h);

        const response = await invoke(h, win.webContents, {
            type: 'GET_PROJECTION',
            tick: 1,
            playerId: 'player-1',
        });
        expect(response).toMatchObject({ type: 'PROJECTION', tick: 1, playerId: 'player-1' });
        expect(projectorCalls).toEqual([{ tick: 1, viewerId: P1 }]);
    });

    it('GET_DIFF returns the structural diff between two resolved ticks', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        feedAdvance(port, 0);
        feedAdvance(port, 1);
        const win = openInspector(h);

        const response = await invoke(h, win.webContents, {
            type: 'GET_DIFF',
            fromTick: 1,
            toTick: 2,
        });
        expect(response.type).toBe('DIFF');
        if (response.type === 'DIFF') {
            expect(response.diff.fromTick).toBe(1);
            expect(response.diff.toTick).toBe(2);
        }
    });

    it('GET_DIFF with an unavailable tick returns ERROR, never throws', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        feedAdvance(port, 0);
        const win = openInspector(h);

        const response = await invoke(h, win.webContents, {
            type: 'GET_DIFF',
            fromTick: 500,
            toTick: 501,
        });
        expect(response.type).toBe('ERROR');
    });

    it('GET_ACTION_LOG returns entries, honouring tick bounds', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        for (let tick = 0; tick < 5; tick++) {
            feedAdvance(port, tick);
        }
        const win = openInspector(h);

        const all = await invoke(h, win.webContents, { type: 'GET_ACTION_LOG' });
        expect(all.type).toBe('ACTION_LOG');
        if (all.type === 'ACTION_LOG') {
            expect(all.entries).toHaveLength(5);
        }

        const bounded = await invoke(h, win.webContents, {
            type: 'GET_ACTION_LOG',
            fromTick: 1,
            toTick: 2,
        });
        if (bounded.type === 'ACTION_LOG') {
            expect(bounded.entries.map((e) => e.tickApplied)).toEqual([1, 2]);
        }
    });

    it('GET_PERF_STATS aggregates the durations fed through onActionApplied', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        port.observer(1, makeSnapshot(1));
        port.onActionApplied(makeEntry(0), makeSnapshot(1), 2);
        port.observer(2, makeSnapshot(2));
        port.onActionApplied(makeEntry(1), makeSnapshot(2), 4);
        const win = openInspector(h);

        const response = await invoke(h, win.webContents, { type: 'GET_PERF_STATS' });
        expect(response.type).toBe('PERF_STATS');
        if (response.type === 'PERF_STATS') {
            expect(response.stats.sampleCount).toBe(2);
            expect(response.stats.avgTickDurationMs).toBe(3);
            expect(response.stats.maxTickDurationMs).toBe(4);
            expect(response.stats.ringBufferFill.used).toBe(2);
            expect(response.stats.totalActionCount).toBe(2);
        }
    });
});

// ─── Live subscription ────────────────────────────────────────────────────────

describe('debug-bridge — live subscription', () => {
    it('SUBSCRIBE_LIVE receives a LIVE_TICK push for every recorded tick', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        const win = openInspector(h);
        await invoke(h, win.webContents, { type: 'SUBSCRIBE_LIVE' });

        feedAdvance(port, 0);
        feedAdvance(port, 1);

        const pushes = win.webContents.sent.filter((s) => s.channel === DEBUG_PUSH_CHANNEL);
        expect(pushes).toHaveLength(2);
        expect(pushes[0]?.payload).toMatchObject({ type: 'LIVE_TICK', tick: 1 });
        expect(pushes[1]?.payload).toMatchObject({ type: 'LIVE_TICK', tick: 2 });
    });

    it('same-tick re-records push again (in-place replacement supersedes)', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        const win = openInspector(h);
        await invoke(h, win.webContents, { type: 'SUBSCRIBE_LIVE' });

        port.observer(1, makeSnapshot(1));
        port.observer(1, makeSnapshot(1));

        expect(win.webContents.sent).toHaveLength(2);
    });

    it('UNSUBSCRIBE_LIVE stops the pushes', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        const win = openInspector(h);
        await invoke(h, win.webContents, { type: 'SUBSCRIBE_LIVE' });
        feedAdvance(port, 0);
        await invoke(h, win.webContents, { type: 'UNSUBSCRIBE_LIVE' });
        feedAdvance(port, 1);

        expect(win.webContents.sent).toHaveLength(1);
    });

    it('a destroyed subscriber is skipped without throwing', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        const win = openInspector(h);
        await invoke(h, win.webContents, { type: 'SUBSCRIBE_LIVE' });

        win.webContents.destroyed = true;
        expect(() => feedAdvance(port, 0)).not.toThrow();
        expect(win.webContents.sent).toHaveLength(0);
    });

    it('subscribers survive a session re-attach and stream the new session', async () => {
        const h = makeBridge();
        attach(h);
        const win = openInspector(h);
        await invoke(h, win.webContents, { type: 'SUBSCRIBE_LIVE' });

        const { port: port2 } = attach(h); // new session
        feedAdvance(port2, 0);

        expect(win.webContents.sent).toHaveLength(1);
        expect(win.webContents.sent[0]?.payload).toMatchObject({ type: 'LIVE_TICK', tick: 1 });
    });
});

// ─── Session bookkeeping ──────────────────────────────────────────────────────

describe('debug-bridge — session bookkeeping', () => {
    it('captures a memento per turn boundary — reconstruction uses the nearest one', async () => {
        const h = makeBridge({ ringBufferCapacity: 2 });
        const { port } = attach(h);
        feedAdvance(port, 0); // turn 0, baseline memento @ tick 1
        feedAdvance(port, 1);
        feedEndTurn(port, 2, 0); // turn 0→1, memento @ tick 3
        feedAdvance(port, 3, 1);
        feedAdvance(port, 4, 1);
        feedAdvance(port, 5, 1);
        // Ring buffer holds 5,6 only. Tick 4 reconstructs from memento @3 +
        // the single entry with tickApplied 3.
        const win = openInspector(h);

        const response = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 4 });
        expect(response).toMatchObject({ type: 'SNAPSHOT', tick: 4 });
    });

    it('undo compacts the log — undone entries disappear, the undo itself is never logged', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        for (let tick = 0; tick < 5; tick++) {
            feedAdvance(port, tick); // entries 0..4, state at tick 5
        }
        feedUndo(port, 5, 2); // rewind to tick 2

        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_ACTION_LOG' });
        expect(response.type).toBe('ACTION_LOG');
        if (response.type === 'ACTION_LOG') {
            expect(response.entries.map((e) => e.tickApplied)).toEqual([0, 1]);
            expect(response.entries.every((e) => e.action.type !== 'engine:undo')).toBe(true);
        }
    });

    it('redo restores the stashed entries', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        for (let tick = 0; tick < 5; tick++) {
            feedAdvance(port, tick);
        }
        feedUndo(port, 5, 2);
        feedRedo(port, 2, 5); // forward to tick 5 again

        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_ACTION_LOG' });
        if (response.type === 'ACTION_LOG') {
            expect(response.entries.map((e) => e.tickApplied)).toEqual([0, 1, 2, 3, 4]);
        }
    });

    it('reconstruction succeeds at the rewound tick after undo', async () => {
        const h = makeBridge({ ringBufferCapacity: 2 });
        const { port } = attach(h);
        for (let tick = 0; tick < 5; tick++) {
            feedAdvance(port, tick);
        }
        feedUndo(port, 5, 3);
        feedAdvance(port, 3); // diverge: new entry at tickApplied 3

        const win = openInspector(h);
        // Tick 2: memento @1 + entry with tickApplied 1 → replay lands on 2.
        const response = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 2 });
        expect(response).toMatchObject({ type: 'SNAPSHOT', tick: 2 });
    });

    it('a new action after undo invalidates the redo stash', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        for (let tick = 0; tick < 5; tick++) {
            feedAdvance(port, tick);
        }
        feedUndo(port, 5, 2); // log: 0,1 — stash: 2,3,4
        feedAdvance(port, 2); // diverge — stash must be cleared
        feedRedo(port, 3, 5); // defensive: a redo that cannot happen in practice

        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_ACTION_LOG' });
        if (response.type === 'ACTION_LOG') {
            expect(response.entries.map((e) => e.tickApplied)).toEqual([0, 1, 2]);
        }
    });

    it('an out-of-band tick regression self-heals via append-time compaction', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        for (let tick = 0; tick < 5; tick++) {
            feedAdvance(port, tick);
        }
        // Save-load rewound the session to tick 1 without the pipeline firing.
        feedAdvance(port, 1);

        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_ACTION_LOG' });
        if (response.type === 'ACTION_LOG') {
            expect(response.entries.map((e) => e.tickApplied)).toEqual([0, 1]);
        }
        expect(h.logger.warn).toHaveBeenCalled();
    });

    it('the action log is bounded — oldest entries drop beyond capacity', async () => {
        const h = makeBridge({ actionLogCapacity: 10 });
        const { port } = attach(h);
        for (let tick = 0; tick < 15; tick++) {
            feedAdvance(port, tick);
        }

        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_ACTION_LOG' });
        if (response.type === 'ACTION_LOG') {
            expect(response.entries).toHaveLength(10);
            expect(response.entries[0]?.tickApplied).toBe(5);
        }
    });

    it('memento retention is bounded — reconstruction before the oldest memento errors', async () => {
        const h = makeBridge({ ringBufferCapacity: 2, mementoRetention: 2 });
        const { port } = attach(h);
        let tick = 0;
        for (let turn = 0; turn < 4; turn++) {
            feedAdvance(port, tick, turn);
            tick += 1;
            feedEndTurn(port, tick, turn);
            tick += 1;
        }
        // Mementos retained for the last 2 turn boundaries only; an early
        // evicted tick has no memento at-or-before it → explicit ERROR.
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 1 });
        expect(response.type).toBe('ERROR');
    });

    it('attachSession resets the previous session data', async () => {
        const h = makeBridge();
        const { port } = attach(h);
        feedAdvance(port, 0);
        attach(h); // new session

        const win = openInspector(h);
        const tickList = await invoke(h, win.webContents, { type: 'GET_TICK_LIST' });
        if (tickList.type === 'TICK_LIST') {
            expect(tickList.ticks).toHaveLength(0);
        }
    });

    it('a stale port from a detached session is inert', async () => {
        const h = makeBridge();
        const { port: stale } = attach(h);
        attach(h); // supersedes

        feedAdvance(stale, 41); // must not pollute the fresh session

        const win = openInspector(h);
        const tickList = await invoke(h, win.webContents, { type: 'GET_TICK_LIST' });
        if (tickList.type === 'TICK_LIST') {
            expect(tickList.ticks).toHaveLength(0);
        }
    });

    it('observer and onActionApplied never throw — failures are logged', () => {
        const h = makeBridge();
        const { port } = attach(h);
        port.observer(1, makeSnapshot(1));
        // recordTickDuration rejects negative durations; the bridge must
        // swallow and log rather than let it reach the pipeline.
        expect(() => port.onActionApplied(makeEntry(0), makeSnapshot(1), -5)).not.toThrow();
        expect(h.logger.error).toHaveBeenCalled();
    });
});

// ─── Superseded ticks after rewind (degraded, never wrong data) ───────────────

describe('debug-bridge — superseded ticks after rewind', () => {
    /** Feeds ticks 1..5, then undoes back to tick 2 — ticks 3..5 supersede. */
    function rewindHarness(): { h: Harness; port: HostSessionDebugPort } {
        const h = makeBridge();
        const { port } = attach(h);
        for (let tick = 0; tick < 5; tick++) {
            feedAdvance(port, tick); // entries 0..4, buffered ticks 1..5
        }
        feedUndo(port, 5, 2); // rewind to tick 2
        return { h, port };
    }

    it('GET_TICK_LIST omits buffered ticks above the rewound tick', async () => {
        const { h } = rewindHarness();
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_TICK_LIST' });
        expect(response.type).toBe('TICK_LIST');
        if (response.type === 'TICK_LIST') {
            expect(response.ticks.map((t) => t.tick)).toEqual([0, 1, 2]);
        }
    });

    it('GET_SNAPSHOT and GET_PROJECTION refuse a superseded tick', async () => {
        const { h } = rewindHarness();
        const win = openInspector(h);
        const snapshot = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 4 });
        expect(snapshot.type).toBe('ERROR');
        const projection = await invoke(h, win.webContents, {
            type: 'GET_PROJECTION',
            tick: 4,
            playerId: 'player-1',
        });
        expect(projection.type).toBe('ERROR');
    });

    it('GET_DIFF refuses when either bound is superseded', async () => {
        const { h } = rewindHarness();
        const win = openInspector(h);
        expect(
            (await invoke(h, win.webContents, { type: 'GET_DIFF', fromTick: 1, toTick: 4 })).type,
        ).toBe('ERROR');
        expect(
            (await invoke(h, win.webContents, { type: 'GET_DIFF', fromTick: 4, toTick: 1 })).type,
        ).toBe('ERROR');
    });

    it('redo re-exposes the previously superseded ticks', async () => {
        const { h, port } = rewindHarness();
        feedRedo(port, 2, 5);
        const win = openInspector(h);
        const tickList = await invoke(h, win.webContents, { type: 'GET_TICK_LIST' });
        if (tickList.type === 'TICK_LIST') {
            expect(tickList.ticks.map((t) => t.tick)).toEqual([0, 1, 2, 3, 4, 5]);
        }
        const snapshot = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 4 });
        expect(snapshot.type).toBe('SNAPSHOT');
    });

    it('post-undo divergence re-exposes the replaced tick but not the ticks beyond it', async () => {
        const { h, port } = rewindHarness();
        feedAdvance(port, 2); // diverge: tick 3 re-recorded in place
        const win = openInspector(h);
        expect((await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 3 })).type).toBe(
            'SNAPSHOT',
        );
        expect((await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 4 })).type).toBe(
            'ERROR',
        );
    });
});

// ─── Memento high-water rollback on rewind ────────────────────────────────────

describe('debug-bridge — turn memento re-capture after rewind', () => {
    it('re-captures a turn memento when play re-enters a turn after undo across the boundary', async () => {
        const h = makeBridge({ ringBufferCapacity: 2, actionLogCapacity: 3 });
        const { port } = attach(h);
        feedAdvance(port, 0); // turn 0 — baseline memento @ tick 1
        feedEndTurn(port, 1, 0); // turn 0→1 — memento @ tick 2
        feedUndo(port, 2, 1); // undo across the boundary back to tick 1 (turn 0)
        feedEndTurn(port, 1, 0); // re-enter turn 1 — must capture a FRESH memento @ tick 2
        feedAdvance(port, 2, 1);
        feedAdvance(port, 3, 1);
        feedAdvance(port, 4, 1);
        // Log capacity 3 pruned entries 0,1; ring buffer (capacity 2) holds
        // ticks 4,5 only. Tick 3 is reconstructable ONLY from the re-captured
        // memento @2 (+ the entry applied at tick 2) — a suppressed memento
        // forces replay from the stale baseline @1, which under-advances.
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 3 });
        expect(response).toMatchObject({ type: 'SNAPSHOT', tick: 3 });
    });

    it('re-captures a turn memento after an out-of-band rewind across the boundary', async () => {
        const h = makeBridge({ ringBufferCapacity: 2, actionLogCapacity: 3 });
        const { port } = attach(h);
        feedAdvance(port, 0); // baseline memento @ tick 1
        feedEndTurn(port, 1, 0); // memento @ tick 2 (turn 1)
        // Save-restore rewound the session to tick 0 (turn 0) without the
        // pipeline firing — append-time compaction drops ALL mementos.
        feedAdvance(port, 0);
        feedEndTurn(port, 1, 0); // re-enter turn 1 — must capture a fresh memento
        feedAdvance(port, 2, 1);
        feedAdvance(port, 3, 1);
        feedAdvance(port, 4, 1);
        const win = openInspector(h);
        const response = await invoke(h, win.webContents, { type: 'GET_SNAPSHOT', tick: 3 });
        expect(response).toMatchObject({ type: 'SNAPSHOT', tick: 3 });
    });
});

// ─── stop() ───────────────────────────────────────────────────────────────────

describe('debug-bridge — stop', () => {
    it('removes all IPC registrations and closes an open window', () => {
        const h = makeBridge();
        const win = openInspector(h);

        h.bridge.stop();

        expect(h.ipc.handlers.has(DEBUG_CHANNEL)).toBe(false);
        expect(h.ipc.listeners.get(DEBUG_TOGGLE_INSPECTOR_CHANNEL) ?? []).toHaveLength(0);
        expect(h.ipc.listeners.get(DEBUG_TOGGLE_I18N_TOKEN_MODE_CHANNEL) ?? []).toHaveLength(0);
        expect(win.closeCalls).toBe(1);
    });
});

// ─── Default Inspector window construction (#701) ─────────────────────────────
//
// The default factory was previously untested: it shipped without a
// backgroundColor (white flash / white-on-failure window) and silently showed
// the bare protocol 404 ("Not found") when the renderer static export predates
// the /debug route. Tests written FIRST (red).

describe('debug-bridge — default Inspector window construction', () => {
    interface FactoryHarness {
        readonly window: FakeFullInspectorWindow;
        readonly capturedOptions: InspectorWindowOptions[];
        readonly logger: Logger;
    }

    function makeInspectorWindow(): FactoryHarness {
        const capturedOptions: InspectorWindowOptions[] = [];
        const window = new FakeFullInspectorWindow();
        const logger = makeSpyLogger();
        const created = createInspectorWindow({
            newWindow: (options) => {
                capturedOptions.push(options);
                return window;
            },
            debugPreloadPath: '/tmp/debug-api.js',
            logger,
        });
        expect(created).toBe(window);
        return { window, capturedOptions, logger };
    }

    it('paints the bootstrap surface colour instead of default white', () => {
        const h = makeInspectorWindow();
        expect(h.capturedOptions[0]?.backgroundColor).toBe('#111113');
    });

    it('preserves the hardened webPreferences posture', () => {
        const h = makeInspectorWindow();
        expect(h.capturedOptions[0]?.webPreferences).toEqual({
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            preload: '/tmp/debug-api.js',
        });
    });

    it('loads the Inspector route on creation', () => {
        const h = makeInspectorWindow();
        expect(h.window.webContents.loadedUrls).toEqual(['chimera://renderer/debug/']);
    });

    it('replaces a failed document load (HTTP >= 400) with the dark diagnostic page', () => {
        const h = makeInspectorWindow();

        h.window.webContents.emitDidNavigate('chimera://renderer/debug/', 404, 'Not Found');

        const fallbackUrl = h.window.webContents.loadedUrls[1];
        expect(fallbackUrl).toMatch(/^data:text\/html/);
        const html = decodeURIComponent(fallbackUrl ?? '');
        expect(html).toContain('404');
        expect(html).toContain('chimera://renderer/debug/');
        expect(html).toContain('pnpm build:renderer');
        expect(html).toContain('#111113');
        expect(h.logger.warn).toHaveBeenCalled();
    });

    it('a successful document load keeps the Inspector page', () => {
        const h = makeInspectorWindow();

        h.window.webContents.emitDidNavigate('chimera://renderer/debug/', 200, 'OK');

        expect(h.window.webContents.loadedUrls).toHaveLength(1);
        expect(h.logger.warn).not.toHaveBeenCalled();
    });

    it('falls back on a main-frame did-fail-load and names the failure', () => {
        const h = makeInspectorWindow();

        h.window.webContents.emitDidFailLoad(
            -6,
            'ERR_FILE_NOT_FOUND',
            'chimera://renderer/debug/',
            true,
        );

        const fallbackUrl = h.window.webContents.loadedUrls[1];
        expect(fallbackUrl).toMatch(/^data:text\/html/);
        expect(decodeURIComponent(fallbackUrl ?? '')).toContain('ERR_FILE_NOT_FOUND');
        expect(h.logger.warn).toHaveBeenCalled();
    });

    it('ignores subframe and aborted-navigation load failures', () => {
        const h = makeInspectorWindow();

        h.window.webContents.emitDidFailLoad(-6, 'ERR_FILE_NOT_FOUND', 'chimera://x/', false);
        h.window.webContents.emitDidFailLoad(-3, 'ERR_ABORTED', 'chimera://renderer/debug/', true);

        expect(h.window.webContents.loadedUrls).toHaveLength(1);
    });

    it('the diagnostic page can never re-trigger itself', () => {
        const h = makeInspectorWindow();

        h.window.webContents.emitDidNavigate('chimera://renderer/debug/', 404, 'Not Found');
        const fallbackUrl = h.window.webContents.loadedUrls[1] ?? '';
        h.window.webContents.emitDidFailLoad(-2, 'ERR_FAILED', fallbackUrl, true);

        expect(h.window.webContents.loadedUrls).toHaveLength(2);
    });

    it('does not load into destroyed web contents', () => {
        const h = makeInspectorWindow();
        h.window.webContents.destroyed = true;

        h.window.webContents.emitDidNavigate('chimera://renderer/debug/', 404, 'Not Found');

        expect(h.window.webContents.loadedUrls).toHaveLength(1);
    });

    it('denies popups and blocks navigation outside the renderer protocol', () => {
        const h = makeInspectorWindow();

        expect(h.window.webContents.windowOpenHandler?.()).toEqual({ action: 'deny' });
        expect(h.window.webContents.emitWillNavigate('https://example.com/')).toBe(true);
        expect(h.window.webContents.emitWillNavigate('chimera://renderer/debug/')).toBe(false);
    });
});
