// @vitest-environment jsdom

/**
 * renderer/bridge/ipcClient.test.ts
 *
 * Unit tests for the ipcClient bridge module.
 * Covers sendAction() prediction wiring and onSnapshot bootstrapping.
 *
 * Architecture: §4.4 — Renderer State Stores, renderer/bridge/ipcClient.ts
 *
 * Rules:
 *  - No real Electron IPC — all port interactions use test doubles.
 *  - `ClientPredictor` and `ReconcileBuffer` are NOT imported here;
 *    the bridge only calls PredictionStore methods.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createConditionalFrameScheduler,
    createIpcClient,
    defaultFrameScheduler,
    immediateFrameScheduler,
    type FrameScheduler,
    type IpcGamePort,
    type IpcPredictionStore,
} from './ipcClient.js';
import type { EngineAction, PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import { playerId, gamePhase } from '@chimera-engine/simulation/bridge/api-types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAction(tick: number, type = 'test:move'): EngineAction {
    return { type, playerId: playerId('p1'), tick, payload: {} };
}

function makeSnapshot(tick: number): PlayerSnapshot {
    return {
        tick,
        viewerId: playerId('p1'),
        players: {},
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function makePort(): {
    port: IpcGamePort;
    sendActionSpy: ReturnType<typeof vi.fn>;
    onSnapshotSpy: ReturnType<typeof vi.fn>;
    onTickSpy: ReturnType<typeof vi.fn>;
    capturedListener: ((snapshot: PlayerSnapshot) => void) | null;
    capturedTickListener: ((tick: number) => void) | null;
} {
    let capturedListener: ((snapshot: PlayerSnapshot) => void) | null = null;
    let capturedTickListener: ((tick: number) => void) | null = null;
    const sendActionSpy = vi.fn<(action: EngineAction) => void>();
    const onSnapshotSpy = vi.fn<(cb: (snapshot: PlayerSnapshot) => void) => () => void>((cb) => {
        capturedListener = cb;
        return vi.fn();
    });
    const onTickSpy = vi.fn<(cb: (tick: number) => void) => () => void>((cb) => {
        capturedTickListener = cb;
        return vi.fn();
    });
    return {
        port: { sendAction: sendActionSpy, onSnapshot: onSnapshotSpy, onTick: onTickSpy },
        sendActionSpy,
        onSnapshotSpy,
        onTickSpy,
        get capturedListener() {
            return capturedListener;
        },
        get capturedTickListener() {
            return capturedTickListener;
        },
    };
}

function makeStore(): {
    store: IpcPredictionStore;
    addPredictionSpy: ReturnType<typeof vi.fn>;
    confirmPredictionSpy: ReturnType<typeof vi.fn>;
    applySnapshotSpy: ReturnType<typeof vi.fn>;
    applyTickSpy: ReturnType<typeof vi.fn>;
} {
    const addPredictionSpy = vi.fn<(action: EngineAction) => void>();
    const confirmPredictionSpy = vi.fn<(tick: number) => void>();
    const applySnapshotSpy = vi.fn<(snapshot: PlayerSnapshot) => void>();
    const applyTickSpy = vi.fn<(tick: number) => void>();
    return {
        store: {
            addPrediction: addPredictionSpy,
            confirmPrediction: confirmPredictionSpy,
            applySnapshot: applySnapshotSpy,
            applyTick: applyTickSpy,
        },
        addPredictionSpy,
        confirmPredictionSpy,
        applySnapshotSpy,
        applyTickSpy,
    };
}

// ── createIpcClient — sendAction() ────────────────────────────────────────────

describe('createIpcClient.sendAction()', () => {
    it('dispatches the action via the port regardless of predictability', () => {
        const { port, sendActionSpy } = makePort();
        const { store } = makeStore();
        const client = createIpcClient(port, store, () => false);
        const action = makeAction(3);

        client.sendAction(action);

        expect(sendActionSpy).toHaveBeenCalledOnce();
        expect(sendActionSpy).toHaveBeenCalledWith(action);
    });

    it('calls addPrediction when isPredictable returns true', () => {
        const { port } = makePort();
        const { store, addPredictionSpy } = makeStore();
        const client = createIpcClient(port, store, () => true);
        const action = makeAction(4);

        client.sendAction(action);

        expect(addPredictionSpy).toHaveBeenCalledOnce();
        expect(addPredictionSpy).toHaveBeenCalledWith(action);
    });

    it('does NOT call addPrediction when isPredictable returns false', () => {
        const { port } = makePort();
        const { store, addPredictionSpy } = makeStore();
        const client = createIpcClient(port, store, () => false);

        client.sendAction(makeAction(4));

        expect(addPredictionSpy).not.toHaveBeenCalled();
    });

    it('does NOT call addPrediction for actions where isPredictable is type-specific and returns false', () => {
        const { port } = makePort();
        const { store, addPredictionSpy } = makeStore();
        const predictableTypes = new Set(['game:move_unit']);
        const client = createIpcClient(port, store, (t) => predictableTypes.has(t));

        client.sendAction(makeAction(5, 'game:end_turn'));

        expect(addPredictionSpy).not.toHaveBeenCalled();
    });

    it('calls addPrediction only for the predictable action type', () => {
        const { port } = makePort();
        const { store, addPredictionSpy } = makeStore();
        const predictableTypes = new Set(['game:move_unit']);
        const client = createIpcClient(port, store, (t) => predictableTypes.has(t));

        client.sendAction(makeAction(5, 'game:move_unit'));
        client.sendAction(makeAction(6, 'game:end_turn'));

        expect(addPredictionSpy).toHaveBeenCalledOnce();
        expect(addPredictionSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'game:move_unit' }),
        );
    });

    it('still dispatches via port even when addPrediction is called', () => {
        const { port, sendActionSpy } = makePort();
        const { store } = makeStore();
        const client = createIpcClient(port, store, () => true);
        const action = makeAction(7);

        client.sendAction(action);

        expect(sendActionSpy).toHaveBeenCalledWith(action);
    });
});

// ── createIpcClient — bootstrap() ────────────────────────────────────────────

describe('createIpcClient.bootstrap()', () => {
    it('registers an onSnapshot listener on the port', () => {
        const { port, onSnapshotSpy } = makePort();
        const { store } = makeStore();
        const client = createIpcClient(port, store, () => false);

        client.bootstrap();

        expect(onSnapshotSpy).toHaveBeenCalledOnce();
    });

    it('registers an onTick listener on the port', () => {
        const { port, onTickSpy } = makePort();
        const { store } = makeStore();
        const client = createIpcClient(port, store, () => false);

        client.bootstrap();

        expect(onTickSpy).toHaveBeenCalledOnce();
    });

    it('calls applySnapshot when a snapshot arrives', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        // Under the immediate scheduler — the off switch — the bridge behaves
        // exactly as it did before it was paced.
        const client = createIpcClient(
            portFixture.port,
            store,
            () => false,
            immediateFrameScheduler,
        );
        client.bootstrap();
        const snap = makeSnapshot(10);

        portFixture.capturedListener?.(snap);

        expect(applySnapshotSpy).toHaveBeenCalledOnce();
        expect(applySnapshotSpy).toHaveBeenCalledWith(snap);
    });

    it('calls confirmPrediction with snapshot.tick when a snapshot arrives', () => {
        const portFixture = makePort();
        const { store, confirmPredictionSpy } = makeStore();
        const client = createIpcClient(
            portFixture.port,
            store,
            () => false,
            immediateFrameScheduler,
        );
        client.bootstrap();
        const snap = makeSnapshot(7);

        portFixture.capturedListener?.(snap);

        expect(confirmPredictionSpy).toHaveBeenCalledOnce();
        expect(confirmPredictionSpy).toHaveBeenCalledWith(7);
    });

    it('calls applyTick when a tick-only update arrives', () => {
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const client = createIpcClient(portFixture.port, store, () => false);
        client.bootstrap();

        portFixture.capturedTickListener?.(88);

        expect(applyTickSpy).toHaveBeenCalledOnce();
        expect(applyTickSpy).toHaveBeenCalledWith(88);
    });

    it('calls confirmPrediction before applySnapshot (evict first, then apply)', () => {
        const portFixture = makePort();
        const callOrder: string[] = [];
        const store: IpcPredictionStore = {
            addPrediction: vi.fn(),
            confirmPrediction: vi.fn(() => {
                callOrder.push('confirm');
            }),
            applySnapshot: vi.fn(() => {
                callOrder.push('apply');
            }),
            applyTick: vi.fn(),
        };
        const client = createIpcClient(
            portFixture.port,
            store,
            () => false,
            immediateFrameScheduler,
        );
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(3));

        expect(callOrder).toEqual(['confirm', 'apply']);
    });

    it('returns an unsubscribe function from the port', () => {
        const unsubSpy = vi.fn();
        const port: IpcGamePort = {
            sendAction: vi.fn(),
            onSnapshot: vi.fn(() => unsubSpy),
            onTick: vi.fn(() => vi.fn()),
        };
        const { store } = makeStore();
        const client = createIpcClient(port, store, () => false);

        const unsub = client.bootstrap();
        unsub();

        expect(unsubSpy).toHaveBeenCalledOnce();
    });
});

// ── createIpcClient — frame coalescing ───────────────────────────────────────

describe('createIpcClient — snapshot coalescing', () => {
    it('collapses two arrivals inside one frame into ONE store update carrying the NEWER snapshot', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        portFixture.capturedListener?.(makeSnapshot(11));
        frames.runFrame();

        expect(applySnapshotSpy).toHaveBeenCalledOnce();
        expect(applySnapshotSpy.mock.calls[0]?.[0]).toMatchObject({ tick: 11 });
    });

    it('supersedes the older arrival rather than QUEUEING it — a later frame replays nothing', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        portFixture.capturedListener?.(makeSnapshot(11));
        frames.runFrame();
        frames.runFrame();

        // A queue would have drained the superseded tick 10 on the second
        // frame, one whole frame behind the host.
        expect(applySnapshotSpy).toHaveBeenCalledOnce();
    });

    it('asks for ONE frame however many snapshots arrive inside it', () => {
        const portFixture = makePort();
        const { store } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        portFixture.capturedListener?.(makeSnapshot(11));
        portFixture.capturedListener?.(makeSnapshot(12));

        expect(frames.requests).toBe(1);
    });

    it('schedules again for the NEXT frame after one has flushed', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        frames.runFrame();
        portFixture.capturedListener?.(makeSnapshot(11));
        frames.runFrame();

        expect(applySnapshotSpy).toHaveBeenCalledTimes(2);
    });

    it('keeps confirmPrediction before applySnapshot across the frame boundary', () => {
        const portFixture = makePort();
        const callOrder: string[] = [];
        const store: IpcPredictionStore = {
            addPrediction: vi.fn(),
            confirmPrediction: vi.fn(() => {
                callOrder.push('confirm');
            }),
            applySnapshot: vi.fn(() => {
                callOrder.push('apply');
            }),
            applyTick: vi.fn(),
        };
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(3));
        frames.runFrame();

        expect(callOrder).toEqual(['confirm', 'apply']);
    });

    it('confirms only the SURVIVING snapshot tick when two arrive in one frame', () => {
        // `confirmPrediction` evicts everything at or below the tick it is
        // given, so the newer tick's eviction is a superset of the older's —
        // dropping the superseded confirm loses nothing.
        const portFixture = makePort();
        const { store, confirmPredictionSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        portFixture.capturedListener?.(makeSnapshot(11));
        frames.runFrame();

        expect(confirmPredictionSpy).toHaveBeenCalledOnce();
        expect(confirmPredictionSpy).toHaveBeenCalledWith(11);
    });

    it('does not write the store from a frame that fires after unsubscribe', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy, confirmPredictionSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        const unsubscribe = client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        unsubscribe();
        // Belt and braces: the cancel should have taken the frame off the
        // clock, but a scheduler that fires it anyway must still find nothing
        // to write — the store it would write to is torn down.
        frames.runFrame();

        expect(frames.cancelled).toBe(1);
        expect(applySnapshotSpy).not.toHaveBeenCalled();
        expect(confirmPredictionSpy).not.toHaveBeenCalled();
    });

    it('writes nothing from a frame a scheduler fires DESPITE the cancel', () => {
        // Belt and braces for the assertion above: cancelling is a request, and
        // a scheduler that honours it is not something this bridge can check.
        // Dropping the pending snapshot is what makes a fired-anyway frame
        // harmless — the store it would write to is being torn down.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeUncancellableScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        const unsubscribe = client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        unsubscribe();
        frames.runFrame();

        expect(applySnapshotSpy).not.toHaveBeenCalled();
    });

    it('never asks a synchronous scheduler to cancel a frame it has already run', () => {
        // A scheduler that finishes before returning a handle has nothing
        // outstanding, so recording that handle would leave every later cancel
        // firing against a frame that no longer exists.
        const portFixture = makePort();
        const { store } = makeStore();
        const frames = makeSynchronousScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        const unsubscribe = client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        client.flush();
        unsubscribe();

        expect(frames.cancelled).toBe(0);
    });

    it('never lets a paced snapshot rewind the clock below a beat already applied', () => {
        // Pacing separates the two channels: the clock is applied on arrival
        // and the snapshot a frame later, so a snapshot carrying tick 10 lands
        // AFTER a clock-only beat already moved the store to 11 — and
        // `applySnapshot` writes `currentTick: snapshot.tick`. Un-paced, this
        // could not happen: arrival order was tick order. The store clock is
        // what stamps every dispatched action, so a rewind sends the host an
        // envelope from its own past.
        const portFixture = makePort();
        const applied: string[] = [];
        const store: IpcPredictionStore = {
            addPrediction: vi.fn(),
            confirmPrediction: vi.fn(),
            applySnapshot: vi.fn((snapshot: PlayerSnapshot) => {
                applied.push(`snapshot:${String(snapshot.tick)}`);
            }),
            applyTick: vi.fn((tick: number) => {
                applied.push(`tick:${String(tick)}`);
            }),
        };
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        portFixture.capturedTickListener?.(11);
        frames.runFrame();

        expect(applied).toEqual(['tick:11', 'snapshot:10', 'tick:11']);
    });

    it('re-asserts the NEWEST beat of the window, not the first', () => {
        // Two beats inside one frame is the ordinary sequence for the rate this
        // pacing exists for, not a corner case. Keeping the first would put the
        // clock back one beat behind the host — the same rewind the repair is
        // for, one tick smaller.
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        portFixture.capturedTickListener?.(11);
        portFixture.capturedTickListener?.(12);
        applyTickSpy.mockClear();
        frames.runFrame();

        expect(applyTickSpy).toHaveBeenCalledOnce();
        expect(applyTickSpy).toHaveBeenCalledWith(12);
    });

    it('does not re-assert a beat the paced snapshot already caught up with', () => {
        // The repair is for a clock the snapshot LAGS, not a second store write
        // on every frame. The beat lands WHILE the snapshot waits — the window
        // the repair watches — but carries the tick the snapshot itself
        // carries, so there is nothing to put back.
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        portFixture.capturedTickListener?.(10);
        frames.runFrame();

        expect(applyTickSpy).toHaveBeenCalledTimes(1);
        expect(applyTickSpy).toHaveBeenCalledWith(10);
    });

    it('lets a snapshot that legitimately REWINDS the clock stand', () => {
        // A restore replaces the match with an earlier checkpoint, so its
        // snapshot carries a lower tick than the clock on purpose. Only a beat
        // that arrived while THIS snapshot was waiting is evidence the host has
        // moved past it; a beat from before it says nothing, and re-asserting
        // one would drag the restored match back to the session it replaced.
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedTickListener?.(90);
        applyTickSpy.mockClear();
        portFixture.capturedListener?.(makeSnapshot(3));
        frames.runFrame();

        expect(applyTickSpy).not.toHaveBeenCalled();
    });

    it('does not carry a beat past the frame that already spent it', () => {
        // A restore landing after a paced beat. The window closes when the
        // frame applies it: a beat kept beyond that would be re-asserted over
        // the restored checkpoint, dragging the match back to the session it
        // replaced — the same defect as the test above, reached through a beat
        // that WAS legitimately recorded.
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(5));
        portFixture.capturedTickListener?.(9);
        frames.runFrame();
        applyTickSpy.mockClear();

        portFixture.capturedListener?.(makeSnapshot(3));
        frames.runFrame();

        expect(applyTickSpy).not.toHaveBeenCalled();
    });

    it('re-asserts a beat across a SUPERSEDED snapshot in the same frame', () => {
        // The window is not reset by a second arrival: the store's clock is
        // already at the beat, so whichever snapshot survives the frame is the
        // one that may lag it.
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(5));
        portFixture.capturedTickListener?.(9);
        applyTickSpy.mockClear();
        portFixture.capturedListener?.(makeSnapshot(8));
        frames.runFrame();

        expect(applyTickSpy).toHaveBeenCalledWith(9);
    });

    it('leaves tick-only updates uncoalesced — the clock is not deferred a frame', () => {
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedTickListener?.(88);

        expect(applyTickSpy).toHaveBeenCalledWith(88);
        expect(frames.requests).toBe(0);
    });

    it('applies every arrival synchronously under the immediate scheduler', () => {
        // The disable switch. A scheduler that runs its callback before
        // returning a handle must not leave the client believing a frame is
        // still outstanding, or the SECOND arrival would never be scheduled.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const client = createIpcClient(
            portFixture.port,
            store,
            () => false,
            immediateFrameScheduler,
        );
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        portFixture.capturedListener?.(makeSnapshot(11));

        expect(applySnapshotSpy).toHaveBeenCalledTimes(2);
    });

    it('flush() applies a pending snapshot immediately and takes the frame off the clock', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        client.flush();

        expect(applySnapshotSpy).toHaveBeenCalledOnce();
        expect(frames.cancelled).toBe(1);

        frames.runFrame();
        expect(applySnapshotSpy).toHaveBeenCalledOnce();
    });

    it('applies on ARRIVAL when no scheduler is injected', () => {
        // Pacing is opted into, never inherited: a caller that says nothing gets
        // the behaviour every game had before the pacing existed.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const client = createIpcClient(portFixture.port, store, () => false);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));

        expect(applySnapshotSpy).toHaveBeenCalledOnce();
    });

    it('paces against the HOST frame clock under defaultFrameScheduler()', async () => {
        // What the paced arm resolves to in a real renderer.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const client = createIpcClient(
            portFixture.port,
            store,
            () => false,
            defaultFrameScheduler(),
        );
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        expect(applySnapshotSpy).not.toHaveBeenCalled();

        await new Promise<void>((resolve) => {
            globalThis.requestAnimationFrame(() => {
                resolve();
            });
        });

        expect(applySnapshotSpy).toHaveBeenCalledOnce();
    });

    it('applies on arrival when the host can request a frame but not CANCEL one', () => {
        // Both halves of the clock are needed, not just the one that schedules:
        // a scheduler that can request but not withdraw would throw on the
        // first unsubscribe or flush, in a teardown path with nothing to catch
        // it.
        vi.stubGlobal('cancelAnimationFrame', undefined);
        try {
            const portFixture = makePort();
            const { store, applySnapshotSpy } = makeStore();
            const client = createIpcClient(
                portFixture.port,
                store,
                () => false,
                defaultFrameScheduler(),
            );
            client.bootstrap();

            portFixture.capturedListener?.(makeSnapshot(10));

            expect(applySnapshotSpy).toHaveBeenCalledOnce();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('applies on arrival when the host has no frame clock at all', () => {
        // A renderer bundle evaluated with no DOM must not silently stop
        // applying snapshots while it waits for a frame that never comes.
        vi.stubGlobal('requestAnimationFrame', undefined);
        vi.stubGlobal('cancelAnimationFrame', undefined);
        try {
            const portFixture = makePort();
            const { store, applySnapshotSpy } = makeStore();
            const client = createIpcClient(
                portFixture.port,
                store,
                () => false,
                defaultFrameScheduler(),
            );
            client.bootstrap();

            portFixture.capturedListener?.(makeSnapshot(10));

            expect(applySnapshotSpy).toHaveBeenCalledOnce();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('flush() is a no-op when nothing is pending', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, () => false, frames.scheduler);
        client.bootstrap();

        client.flush();

        expect(applySnapshotSpy).not.toHaveBeenCalled();
    });
});

/**
 * A frame clock the test drives by hand.
 *
 * jsdom's `requestAnimationFrame` has no real display timing, so a spec that
 * leaned on it would be asserting against a timer, not against a frame.
 */
function makeManualScheduler(): {
    readonly scheduler: FrameScheduler;
    runFrame(): void;
    readonly requests: number;
    readonly cancelled: number;
} {
    let callback: (() => void) | null = null;
    let requests = 0;
    let cancelled = 0;
    return {
        scheduler: {
            request(cb: () => void): number {
                requests += 1;
                callback = cb;
                return requests;
            },
            cancel(): void {
                cancelled += 1;
                callback = null;
            },
        },
        runFrame(): void {
            const due = callback;
            callback = null;
            due?.();
        },
        get requests() {
            return requests;
        },
        get cancelled() {
            return cancelled;
        },
    };
}

/** A frame clock whose `cancel` is recorded and then ignored. */
function makeUncancellableScheduler(): {
    readonly scheduler: FrameScheduler;
    runFrame(): void;
} {
    let callback: (() => void) | null = null;
    return {
        scheduler: {
            request(cb: () => void): number {
                callback = cb;
                return 1;
            },
            cancel(): void {
                // Deliberately keeps the frame on the clock.
            },
        },
        runFrame(): void {
            callback?.();
        },
    };
}

/** A frame clock that finishes the work before it returns a handle. */
function makeSynchronousScheduler(): {
    readonly scheduler: FrameScheduler;
    readonly cancelled: number;
} {
    let cancelled = 0;
    return {
        scheduler: {
            request(cb: () => void): number {
                cb();
                return 1;
            },
            cancel(): void {
                cancelled += 1;
            },
        },
        get cancelled() {
            return cancelled;
        },
    };
}

// ── createConditionalFrameScheduler ──────────────────────────────────────────

describe('createConditionalFrameScheduler', () => {
    it('paces against the frame clock while the predicate holds', () => {
        const frames = makeManualScheduler();
        const scheduler = createConditionalFrameScheduler(() => true, frames.scheduler);
        const ran = vi.fn();

        scheduler.request(ran);

        expect(frames.requests).toBe(1);
        expect(ran).not.toHaveBeenCalled();
        frames.runFrame();
        expect(ran).toHaveBeenCalledOnce();
    });

    it('applies on arrival while the predicate does not hold', () => {
        const frames = makeManualScheduler();
        const scheduler = createConditionalFrameScheduler(() => false, frames.scheduler);
        const ran = vi.fn();

        scheduler.request(ran);

        expect(ran).toHaveBeenCalledOnce();
        expect(frames.requests).toBe(0);
    });

    it('answers the predicate at EACH request, not once at construction', () => {
        // The client is built at app start; the declaration that decides pacing
        // arrives when a match loads. A predicate read once would freeze the
        // answer at "no game yet".
        const frames = makeManualScheduler();
        let paced = false;
        const scheduler = createConditionalFrameScheduler(() => paced, frames.scheduler);

        scheduler.request(vi.fn());
        expect(frames.requests).toBe(0);

        paced = true;
        scheduler.request(vi.fn());
        expect(frames.requests).toBe(1);
    });

    it('takes a paced frame off the clock when cancelled', () => {
        // The only arm that can leave a frame outstanding. A cancel that did
        // not reach the frame clock would let a torn-down store be written.
        const frames = makeManualScheduler();
        const scheduler = createConditionalFrameScheduler(() => true, frames.scheduler);
        const ran = vi.fn();

        const handle = scheduler.request(ran);
        scheduler.cancel(handle);

        expect(frames.cancelled).toBe(1);
        frames.runFrame();
        expect(ran).not.toHaveBeenCalled();
    });
});
