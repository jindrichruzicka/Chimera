// electron/preload/debug-api.test.ts
//
// Unit tests for the Inspector window preload (`debug-api.ts`) — the one and
// only module exposing `window.__chimeraDebug` (Invariant 28). Written first
// (red) per TDD mandate — `debug-api.ts` / `debug-api-types.ts` do not exist
// yet.
//
// Two layers, mirroring the game preload's test split:
//   1. Entry tests — `vi.mock('electron')` + fresh dynamic import per test so
//      the import-time `contextBridge.exposeInMainWorld` side effect is
//      observed (pattern: `api.test.ts`).
//   2. Factory tests — `createDebugApi` driven through a hand-rolled
//      recording stub port (pattern: `apis/system-api.test.ts`), asserting
//      the exact `DebugRequest` payload sent on `chimera:debug` and the
//      unwrap of each matching `DebugResponse`.
//
// Request payloads are pinned with `toStrictEqual` because the bridge's Zod
// schema distinguishes absent keys from `undefined`-valued keys
// (`GET_ACTION_LOG` bounds are "absent, not undefined").

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEBUG_CHANNEL, DEBUG_PUSH_CHANNEL } from '@chimera/shared/constants.js';
import { playerId } from './api-types.js';
import { createDebugApi, type DebugApiIpcPort } from './debug-api.js';
import type { ChimeraDebugApi, LiveTickEvent } from './debug-api-types.js';
import type { IpcListener } from './shared/listener.js';

// ─── Electron module mock ────────────────────────────────────────────────────
// Importing `./debug-api.js` runs its import-time expose side effect, so the
// mock is required even for the stub-port factory tests below. `vi.hoisted`
// is needed (unlike in `api.test.ts`) because this file statically imports
// the module under test, so the hoisted mock factory runs before ordinary
// module-level `const` declarations would initialize.

const {
    exposeInMainWorld,
    ipcRendererInvoke,
    ipcRendererSend,
    ipcRendererOn,
    ipcRendererRemoveListener,
} = vi.hoisted(() => ({
    exposeInMainWorld: vi.fn<(key: string, api: Record<string, unknown>) => void>(),
    ipcRendererInvoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(() =>
        Promise.resolve(undefined),
    ),
    ipcRendererSend: vi.fn<(channel: string, ...args: unknown[]) => void>(),
    ipcRendererOn: vi.fn<(channel: string, listener: (...args: unknown[]) => void) => void>(),
    ipcRendererRemoveListener:
        vi.fn<(channel: string, listener: (...args: unknown[]) => void) => void>(),
}));

vi.mock('electron', () => ({
    contextBridge: {
        exposeInMainWorld,
    },
    ipcRenderer: {
        invoke: ipcRendererInvoke,
        send: ipcRendererSend,
        on: ipcRendererOn,
        removeListener: ipcRendererRemoveListener,
    },
}));

// ─── Recording stub port ─────────────────────────────────────────────────────

interface InvokeCall {
    readonly channel: string;
    readonly args: readonly unknown[];
}

/**
 * Minimal recording stub capturing every port call `createDebugApi` makes,
 * so the channel/payload contract can be asserted without Electron.
 */
function makeIpcStub(): {
    readonly port: DebugApiIpcPort;
    readonly invocations: InvokeCall[];
    readonly listeners: Map<string, Set<IpcListener>>;
    readonly invokeResults: Map<string, unknown>;
    emitPush(channel: string, payload: unknown): void;
} {
    const invocations: InvokeCall[] = [];
    const listeners = new Map<string, Set<IpcListener>>();
    const invokeResults = new Map<string, unknown>();

    const port: DebugApiIpcPort = {
        invoke: (channel, ...args) => {
            invocations.push({ channel, args });
            return Promise.resolve(invokeResults.get(channel));
        },
        on: (channel, listener) => {
            const set = listeners.get(channel) ?? new Set<IpcListener>();
            set.add(listener);
            listeners.set(channel, set);
        },
        removeListener: (channel, listener) => {
            listeners.get(channel)?.delete(listener);
        },
    };

    return {
        port,
        invocations,
        listeners,
        invokeResults,
        emitPush: (channel, payload) => {
            for (const listener of listeners.get(channel) ?? []) {
                listener({}, payload);
            }
        },
    };
}

// ─── Entry: import-time contextBridge exposure ───────────────────────────────

describe('preload/debug-api.ts entry', () => {
    beforeEach(() => {
        exposeInMainWorld.mockClear();
        ipcRendererInvoke.mockClear();
        ipcRendererOn.mockClear();
        ipcRendererRemoveListener.mockClear();
    });

    async function importDebugPreload(): Promise<void> {
        vi.resetModules();
        await import('./debug-api.js');
    }

    it('calls contextBridge.exposeInMainWorld exactly once', async () => {
        await importDebugPreload();
        expect(exposeInMainWorld).toHaveBeenCalledOnce();
    });

    it("exposes the debug surface under the key '__chimeraDebug' and never '__chimera' (invariant 28)", async () => {
        await importDebugPreload();
        const keys = exposeInMainWorld.mock.calls.map(([k]) => k);
        expect(keys).toEqual(['__chimeraDebug']);
    });

    it('wires the surface against the real ipcRenderer port (smoke: listTicks → invoke on chimera:debug)', async () => {
        await importDebugPreload();
        ipcRendererInvoke.mockResolvedValueOnce({ type: 'TICK_LIST', ticks: [] });
        const [, api] = exposeInMainWorld.mock.calls[0] ?? [];
        const listTicks = api?.['listTicks'] as () => Promise<unknown>;
        await listTicks();
        expect(ipcRendererInvoke).toHaveBeenCalledOnce();
        expect(ipcRendererInvoke.mock.calls[0]).toStrictEqual([
            DEBUG_CHANNEL,
            { type: 'GET_TICK_LIST' },
        ]);
    });
});

// ─── Factory: request/response contract per method ───────────────────────────

describe('createDebugApi', () => {
    it('satisfies the ChimeraDebugApi contract (compile-time check)', () => {
        const stub = makeIpcStub();
        const api: ChimeraDebugApi = createDebugApi(stub.port);
        expect(typeof api.listTicks).toBe('function');
    });

    describe('listTicks()', () => {
        it('sends GET_TICK_LIST on chimera:debug and unwraps the tick list verbatim', async () => {
            const stub = makeIpcStub();
            const ticks = [{ tick: 1, inRingBuffer: true }];
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'TICK_LIST', ticks });
            const api = createDebugApi(stub.port);

            const result = await api.listTicks();

            expect(stub.invocations).toStrictEqual([
                { channel: DEBUG_CHANNEL, args: [{ type: 'GET_TICK_LIST' }] },
            ]);
            expect(result).toBe(ticks);
        });
    });

    describe('getSnapshot()', () => {
        it('sends GET_SNAPSHOT with the tick and unwraps { tick, snapshot }', async () => {
            const stub = makeIpcStub();
            const snapshot = { tick: 7, players: {}, entities: {} };
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'SNAPSHOT', tick: 7, snapshot });
            const api = createDebugApi(stub.port);

            const result = await api.getSnapshot(7);

            expect(stub.invocations).toStrictEqual([
                { channel: DEBUG_CHANNEL, args: [{ type: 'GET_SNAPSHOT', tick: 7 }] },
            ]);
            expect(result.tick).toBe(7);
            expect(result.snapshot).toBe(snapshot);
        });
    });

    describe('getProjection()', () => {
        it('sends GET_PROJECTION with tick and playerId and unwraps { tick, playerId, snapshot }', async () => {
            const stub = makeIpcStub();
            const viewer = playerId('p1');
            const snapshot = { tick: 3, viewerId: viewer };
            stub.invokeResults.set(DEBUG_CHANNEL, {
                type: 'PROJECTION',
                tick: 3,
                playerId: viewer,
                snapshot,
            });
            const api = createDebugApi(stub.port);

            const result = await api.getProjection(3, viewer);

            expect(stub.invocations).toStrictEqual([
                {
                    channel: DEBUG_CHANNEL,
                    args: [{ type: 'GET_PROJECTION', tick: 3, playerId: viewer }],
                },
            ]);
            expect(result.tick).toBe(3);
            expect(result.playerId).toBe(viewer);
            expect(result.snapshot).toBe(snapshot);
        });
    });

    describe('diff()', () => {
        it('sends GET_DIFF with both ticks and unwraps the diff', async () => {
            const stub = makeIpcStub();
            const diff = { fromTick: 2, toTick: 5, entries: [] };
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'DIFF', diff });
            const api = createDebugApi(stub.port);

            const result = await api.diff(2, 5);

            expect(stub.invocations).toStrictEqual([
                { channel: DEBUG_CHANNEL, args: [{ type: 'GET_DIFF', fromTick: 2, toTick: 5 }] },
            ]);
            expect(result).toBe(diff);
        });
    });

    describe('getActionLog()', () => {
        it('omits absent bounds entirely — absent, not undefined (zero-arg call)', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'ACTION_LOG', entries: [] });
            const api = createDebugApi(stub.port);

            await api.getActionLog();

            expect(stub.invocations).toStrictEqual([
                { channel: DEBUG_CHANNEL, args: [{ type: 'GET_ACTION_LOG' }] },
            ]);
        });

        it('includes only fromTick when toTick is absent', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'ACTION_LOG', entries: [] });
            const api = createDebugApi(stub.port);

            await api.getActionLog(4);

            expect(stub.invocations).toStrictEqual([
                { channel: DEBUG_CHANNEL, args: [{ type: 'GET_ACTION_LOG', fromTick: 4 }] },
            ]);
        });

        it('sends both bounds and unwraps the entries verbatim', async () => {
            const stub = makeIpcStub();
            const entries = [{ tickApplied: 2 }];
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'ACTION_LOG', entries });
            const api = createDebugApi(stub.port);

            const result = await api.getActionLog(1, 9);

            expect(stub.invocations).toStrictEqual([
                {
                    channel: DEBUG_CHANNEL,
                    args: [{ type: 'GET_ACTION_LOG', fromTick: 1, toTick: 9 }],
                },
            ]);
            expect(result).toBe(entries);
        });
    });

    describe('getPerfStats()', () => {
        it('sends GET_PERF_STATS and unwraps the stats', async () => {
            const stub = makeIpcStub();
            const stats = {
                avgTickDurationMs: 1,
                maxTickDurationMs: 2,
                sampleCount: 3,
                recentSamples: [],
                ringBufferFill: { used: 0, capacity: 64 },
                totalActionCount: 0,
            };
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'PERF_STATS', stats });
            const api = createDebugApi(stub.port);

            const result = await api.getPerfStats();

            expect(stub.invocations).toStrictEqual([
                { channel: DEBUG_CHANNEL, args: [{ type: 'GET_PERF_STATS' }] },
            ]);
            expect(result).toBe(stats);
        });
    });

    describe('subscribeLive() / unsubscribeLive()', () => {
        it('subscribeLive sends SUBSCRIBE_LIVE and resolves to undefined on ACK', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'ACK' });
            const api = createDebugApi(stub.port);

            await expect(api.subscribeLive()).resolves.toBeUndefined();
            expect(stub.invocations).toStrictEqual([
                { channel: DEBUG_CHANNEL, args: [{ type: 'SUBSCRIBE_LIVE' }] },
            ]);
        });

        it('unsubscribeLive sends UNSUBSCRIBE_LIVE and resolves to undefined on ACK', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'ACK' });
            const api = createDebugApi(stub.port);

            await expect(api.unsubscribeLive()).resolves.toBeUndefined();
            expect(stub.invocations).toStrictEqual([
                { channel: DEBUG_CHANNEL, args: [{ type: 'UNSUBSCRIBE_LIVE' }] },
            ]);
        });
    });

    describe('error propagation', () => {
        it('rejects with the bridge message when main returns an ERROR response', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'ERROR', message: 'no active session' });
            const api = createDebugApi(stub.port);

            await expect(api.listTicks()).rejects.toThrow(/no active session/);
        });

        it('names the request type in the ERROR rejection', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'ERROR', message: 'invalid_tick' });
            const api = createDebugApi(stub.port);

            await expect(api.getSnapshot(99)).rejects.toThrow(/GET_SNAPSHOT/);
        });

        it('rejects on a discriminant mismatch (ACK where TICK_LIST expected)', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(DEBUG_CHANNEL, { type: 'ACK' });
            const api = createDebugApi(stub.port);

            await expect(api.listTicks()).rejects.toThrow(/TICK_LIST/);
        });

        it('rejects when main returns undefined (no handler wired)', async () => {
            const stub = makeIpcStub();
            const api = createDebugApi(stub.port);

            await expect(api.getPerfStats()).rejects.toThrow();
        });

        it('propagates transport rejections as-is', async () => {
            const stub = makeIpcStub();
            const transportError = new Error('ipc transport down');
            const port: DebugApiIpcPort = {
                ...stub.port,
                invoke: () => Promise.reject(transportError),
            };
            const api = createDebugApi(port);

            await expect(api.listTicks()).rejects.toBe(transportError);
        });
    });

    describe('onLiveTick()', () => {
        it('registers a listener on chimera:debug:push and forwards LIVE_TICK as { tick, snapshot }', () => {
            const stub = makeIpcStub();
            const api = createDebugApi(stub.port);
            const events: LiveTickEvent[] = [];

            api.onLiveTick((event) => events.push(event));

            expect(stub.listeners.get(DEBUG_PUSH_CHANNEL)?.size).toBe(1);

            const snapshot = { tick: 9, players: {} };
            stub.emitPush(DEBUG_PUSH_CHANNEL, { type: 'LIVE_TICK', tick: 9, snapshot });

            expect(events).toHaveLength(1);
            expect(events[0]?.tick).toBe(9);
            expect(events[0]?.snapshot).toBe(snapshot);
        });

        it('ignores pushes that are not LIVE_TICK responses', () => {
            const stub = makeIpcStub();
            const api = createDebugApi(stub.port);
            const cb = vi.fn();

            api.onLiveTick(cb);

            stub.emitPush(DEBUG_PUSH_CHANNEL, { type: 'ACK' });
            stub.emitPush(DEBUG_PUSH_CHANNEL, { type: 'ERROR', message: 'x' });
            stub.emitPush(DEBUG_PUSH_CHANNEL, { type: 'SNAPSHOT', tick: 1, snapshot: {} });
            stub.emitPush(DEBUG_PUSH_CHANNEL, undefined);

            expect(cb).not.toHaveBeenCalled();
        });

        it('unsubscribe removes exactly the registered listener; other subscriptions stay live', () => {
            const stub = makeIpcStub();
            const api = createDebugApi(stub.port);
            const first = vi.fn();
            const second = vi.fn();

            const unsubscribeFirst = api.onLiveTick(first);
            api.onLiveTick(second);
            expect(stub.listeners.get(DEBUG_PUSH_CHANNEL)?.size).toBe(2);

            unsubscribeFirst();
            expect(stub.listeners.get(DEBUG_PUSH_CHANNEL)?.size).toBe(1);

            stub.emitPush(DEBUG_PUSH_CHANNEL, { type: 'LIVE_TICK', tick: 2, snapshot: {} });
            expect(first).not.toHaveBeenCalled();
            expect(second).toHaveBeenCalledOnce();
        });
    });
});
