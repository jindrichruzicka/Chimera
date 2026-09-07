// @vitest-environment jsdom

/**
 * renderer/bridge/ipcClient.test.ts
 *
 * Unit tests for the ipcClient bridge module.
 * Covers sendAction() dispatch and onSnapshot bootstrapping.
 *
 * Architecture: §4.4 — Renderer State Stores, renderer/bridge/ipcClient.ts
 *
 * Rules:
 *  - No real Electron IPC — all port interactions use test doubles.
 *  - The bridge only calls the store's `apply*` methods.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createConditionalFrameScheduler,
    createIpcClient,
    defaultFrameScheduler,
    immediateFrameScheduler,
    type FrameScheduler,
    type IpcGamePort,
    type IpcSnapshotStore,
} from './ipcClient.js';
import type { EngineAction, PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import {
    toSnapshotDelta,
    type SnapshotDelta,
} from '@chimera-engine/simulation/foundation/snapshot-delta.js';
import { diffSnapshots } from '@chimera-engine/simulation/foundation/snapshot-diff.js';
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
    capturedDeltaListener: ((delta: SnapshotDelta) => void) | null;
} {
    let capturedListener: ((snapshot: PlayerSnapshot) => void) | null = null;
    let capturedTickListener: ((tick: number) => void) | null = null;
    let capturedDeltaListener: ((delta: SnapshotDelta) => void) | null = null;
    const sendActionSpy = vi.fn<(action: EngineAction) => void>();
    const onSnapshotSpy = vi.fn<(cb: (snapshot: PlayerSnapshot) => void) => () => void>((cb) => {
        capturedListener = cb;
        return vi.fn();
    });
    const onTickSpy = vi.fn<(cb: (tick: number) => void) => () => void>((cb) => {
        capturedTickListener = cb;
        return vi.fn();
    });
    const onSnapshotDeltaSpy = vi.fn<(cb: (delta: SnapshotDelta) => void) => () => void>((cb) => {
        capturedDeltaListener = cb;
        return vi.fn();
    });
    return {
        port: {
            sendAction: sendActionSpy,
            onSnapshot: onSnapshotSpy,
            onSnapshotDelta: onSnapshotDeltaSpy,
            onTick: onTickSpy,
        },
        sendActionSpy,
        onSnapshotSpy,
        onTickSpy,
        get capturedListener() {
            return capturedListener;
        },
        get capturedTickListener() {
            return capturedTickListener;
        },
        get capturedDeltaListener() {
            return capturedDeltaListener;
        },
    };
}

function makeStore(): {
    store: IpcSnapshotStore;
    applySnapshotSpy: ReturnType<typeof vi.fn>;
    applyTickSpy: ReturnType<typeof vi.fn>;
} {
    const applySnapshotSpy = vi.fn<(snapshot: PlayerSnapshot) => void>();
    const applyTickSpy = vi.fn<(tick: number) => void>();
    return {
        store: {
            applySnapshot: applySnapshotSpy,
            applyTick: applyTickSpy,
        },
        applySnapshotSpy,
        applyTickSpy,
    };
}

// ── createIpcClient — sendAction() ────────────────────────────────────────────

describe('createIpcClient.sendAction()', () => {
    it('dispatches the action via the port', () => {
        const { port, sendActionSpy } = makePort();
        const { store } = makeStore();
        const client = createIpcClient(port, store);
        const action = makeAction(3);

        client.sendAction(action);

        expect(sendActionSpy).toHaveBeenCalledOnce();
        expect(sendActionSpy).toHaveBeenCalledWith(action);
    });
});

// ── createIpcClient — bootstrap() ────────────────────────────────────────────

describe('createIpcClient.bootstrap()', () => {
    it('registers an onSnapshot listener on the port', () => {
        const { port, onSnapshotSpy } = makePort();
        const { store } = makeStore();
        const client = createIpcClient(port, store);

        client.bootstrap();

        expect(onSnapshotSpy).toHaveBeenCalledOnce();
    });

    it('registers an onTick listener on the port', () => {
        const { port, onTickSpy } = makePort();
        const { store } = makeStore();
        const client = createIpcClient(port, store);

        client.bootstrap();

        expect(onTickSpy).toHaveBeenCalledOnce();
    });

    it('calls applySnapshot when a snapshot arrives', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        // Under the immediate scheduler — the off switch — the bridge behaves
        // exactly as it did before it was paced.
        const client = createIpcClient(portFixture.port, store, immediateFrameScheduler);
        client.bootstrap();
        const snap = makeSnapshot(10);

        portFixture.capturedListener?.(snap);

        expect(applySnapshotSpy).toHaveBeenCalledOnce();
        expect(applySnapshotSpy).toHaveBeenCalledWith(snap);
    });

    it('calls applyTick when a tick-only update arrives', () => {
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const client = createIpcClient(portFixture.port, store);
        client.bootstrap();

        portFixture.capturedTickListener?.(88);

        expect(applyTickSpy).toHaveBeenCalledOnce();
        expect(applyTickSpy).toHaveBeenCalledWith(88);
    });

    it('releases every push listener it registered', () => {
        // One per CHANNEL, read back individually. A shared or anonymous stub
        // lets any one of the three releases disappear unnoticed, and what is
        // left behind is a live `ipcRenderer.on` listener per teardown — per
        // match, per route change — for the rest of the session.
        const unsubSnapshot = vi.fn();
        const unsubDelta = vi.fn();
        const unsubTick = vi.fn();
        const port: IpcGamePort = {
            sendAction: vi.fn(),
            onSnapshot: vi.fn(() => unsubSnapshot),
            onSnapshotDelta: vi.fn(() => unsubDelta),
            onTick: vi.fn(() => unsubTick),
        };
        const { store } = makeStore();
        const client = createIpcClient(port, store);

        const unsub = client.bootstrap();
        unsub();

        expect(unsubSnapshot).toHaveBeenCalledOnce();
        expect(unsubDelta).toHaveBeenCalledOnce();
        expect(unsubTick).toHaveBeenCalledOnce();
    });
});

// ── createIpcClient — frame coalescing ───────────────────────────────────────

describe('createIpcClient — snapshot coalescing', () => {
    it('collapses two arrivals inside one frame into ONE store update carrying the NEWER snapshot', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        frames.runFrame();
        portFixture.capturedListener?.(makeSnapshot(11));
        frames.runFrame();

        expect(applySnapshotSpy).toHaveBeenCalledTimes(2);
    });

    it('does not write the store from a frame that fires after unsubscribe', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
        const unsubscribe = client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        unsubscribe();
        // Belt and braces: the cancel should have taken the frame off the
        // clock, but a scheduler that fires it anyway must still find nothing
        // to write — the store it would write to is torn down.
        frames.runFrame();

        expect(frames.cancelled).toBe(1);
        expect(applySnapshotSpy).not.toHaveBeenCalled();
    });

    it('writes nothing from a frame a scheduler fires DESPITE the cancel', () => {
        // Belt and braces for the assertion above: cancelling is a request, and
        // a scheduler that honours it is not something this bridge can check.
        // Dropping the pending snapshot is what makes a fired-anyway frame
        // harmless — the store it would write to is being torn down.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeUncancellableScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const store: IpcSnapshotStore = {
            applySnapshot: vi.fn((snapshot: PlayerSnapshot) => {
                applied.push(`snapshot:${String(snapshot.tick)}`);
            }),
            applyTick: vi.fn((tick: number) => {
                applied.push(`tick:${String(tick)}`);
            }),
        };
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store, immediateFrameScheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));
        portFixture.capturedListener?.(makeSnapshot(11));

        expect(applySnapshotSpy).toHaveBeenCalledTimes(2);
    });

    it('flush() applies a pending snapshot immediately and takes the frame off the clock', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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
        const client = createIpcClient(portFixture.port, store);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(10));

        expect(applySnapshotSpy).toHaveBeenCalledOnce();
    });

    it('paces against the HOST frame clock under defaultFrameScheduler()', async () => {
        // What the paced arm resolves to in a real renderer.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const client = createIpcClient(portFixture.port, store, defaultFrameScheduler());
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
            const client = createIpcClient(portFixture.port, store, defaultFrameScheduler());
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
            const client = createIpcClient(portFixture.port, store, defaultFrameScheduler());
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
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
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

// ── Snapshot deltas ───────────────────────────────────────────────────────────

/** A snapshot with one entity, so a delta can move exactly one path. */
function makeEntitySnapshot(tick: number, x: number, hp = 10): PlayerSnapshot {
    return {
        ...makeSnapshot(tick),
        entities: {
            'unit-1': { id: 'unit-1', x, hp },
            'unit-2': { id: 'unit-2', x: 99, hp: 1 },
        } as unknown as PlayerSnapshot['entities'],
    };
}

/**
 * Reads a branded-keyed entity record by its raw id — the read side of the cast
 * the fixtures above are built with.
 */
const entityAt = (snapshot: PlayerSnapshot, id: string): unknown =>
    (snapshot.entities as Record<string, unknown>)[id];

const deltaBetween = (from: PlayerSnapshot, to: PlayerSnapshot): SnapshotDelta =>
    toSnapshotDelta(diffSnapshots(from, to));

describe('createIpcClient — snapshot deltas', () => {
    it('applies a delta onto the held snapshot and writes the result', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        createIpcClient(portFixture.port, store).bootstrap();

        const baseline = makeEntitySnapshot(1, 0);
        const next = makeEntitySnapshot(2, 5);
        portFixture.capturedListener?.(baseline);
        portFixture.capturedDeltaListener?.(deltaBetween(baseline, next));

        expect(applySnapshotSpy).toHaveBeenCalledTimes(2);
        expect(applySnapshotSpy).toHaveBeenLastCalledWith(next);
    });

    it('produces a NEW snapshot object with the untouched subtrees shared by reference', () => {
        // Structural sharing is the whole reason a delta is worth applying in
        // the renderer rather than replacing the snapshot: a memoised selector
        // over an untouched subtree must see the same object it saw last frame.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        createIpcClient(portFixture.port, store).bootstrap();

        const baseline = makeEntitySnapshot(1, 0);
        portFixture.capturedListener?.(baseline);
        portFixture.capturedDeltaListener?.(deltaBetween(baseline, makeEntitySnapshot(2, 5)));

        const applied = applySnapshotSpy.mock.calls[1]?.[0] as PlayerSnapshot;
        expect(applied).not.toBe(baseline);
        expect(applied.entities).not.toBe(baseline.entities);
        expect(entityAt(applied, 'unit-1')).not.toBe(entityAt(baseline, 'unit-1'));
        // Untouched: the same object, not a structural copy.
        expect(entityAt(applied, 'unit-2')).toBe(entityAt(baseline, 'unit-2'));
        expect(applied.players).toBe(baseline.players);
        expect(applied.undoMeta).toBe(baseline.undoMeta);
    });

    it('never mutates the snapshot it was holding', () => {
        const portFixture = makePort();
        const { store } = makeStore();
        createIpcClient(portFixture.port, store).bootstrap();

        const baseline = makeEntitySnapshot(1, 0);
        const before = structuredClone(baseline);
        portFixture.capturedListener?.(baseline);
        portFixture.capturedDeltaListener?.(deltaBetween(baseline, makeEntitySnapshot(2, 5)));

        expect(baseline).toEqual(before);
    });

    it('applies an entity removal, so a viewer stops seeing what left its projection', () => {
        // A fog-hidden entity is ABSENT from a projection, never null: the
        // renderer has to lose the key, not hold a null under it.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        createIpcClient(portFixture.port, store).bootstrap();

        const baseline = makeEntitySnapshot(1, 0);
        const withoutUnit2: PlayerSnapshot = {
            ...makeSnapshot(2),
            entities: {
                'unit-1': entityAt(baseline, 'unit-1'),
            } as unknown as PlayerSnapshot['entities'],
        };
        portFixture.capturedListener?.(baseline);
        portFixture.capturedDeltaListener?.(deltaBetween(baseline, withoutUnit2));

        const applied = applySnapshotSpy.mock.calls[1]?.[0] as PlayerSnapshot;
        expect(Object.keys(applied.entities)).toEqual(['unit-1']);
        expect(applied.entities).not.toHaveProperty('unit-2');
    });

    it('asks the host for a full snapshot when a delta will not apply, and writes nothing', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        createIpcClient(portFixture.port, store).bootstrap();

        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        applySnapshotSpy.mockClear();
        // A baseline tick that is not the held one — the common desync.
        portFixture.capturedDeltaListener?.({
            fromTick: 99,
            toTick: 100,
            entries: [{ path: 'tick', kind: 'changed', after: 100 }],
        });

        expect(applySnapshotSpy).not.toHaveBeenCalled();
        expect(portFixture.sendActionSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'engine:sync_request', playerId: playerId('p1') }),
        );
    });

    it('asks once per broken chain, not once per beat', () => {
        // `engine:sync_request` makes the host broadcast to every viewer, not
        // only to the asker, so an unlatched request turns one renderer's desync
        // into a cost the whole session pays.
        const portFixture = makePort();
        const { store } = makeStore();
        createIpcClient(portFixture.port, store).bootstrap();

        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        const stale = (tick: number): SnapshotDelta => ({
            fromTick: 99,
            toTick: tick,
            entries: [{ path: 'tick', kind: 'changed', after: tick }],
        });
        portFixture.capturedDeltaListener?.(stale(100));
        portFixture.capturedDeltaListener?.(stale(101));
        portFixture.capturedDeltaListener?.(stale(102));

        expect(portFixture.sendActionSpy).toHaveBeenCalledTimes(1);
    });

    it('asks again once a full snapshot has answered the previous request', () => {
        const portFixture = makePort();
        const { store } = makeStore();
        createIpcClient(portFixture.port, store).bootstrap();

        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        const stale: SnapshotDelta = {
            fromTick: 99,
            toTick: 100,
            entries: [{ path: 'tick', kind: 'changed', after: 100 }],
        };
        portFixture.capturedDeltaListener?.(stale);
        portFixture.capturedListener?.(makeEntitySnapshot(50, 0));
        portFixture.capturedDeltaListener?.(stale);

        expect(portFixture.sendActionSpy).toHaveBeenCalledTimes(2);
    });

    it('drops a delta it has no baseline for without asking, since it cannot name a viewer', () => {
        // Before any snapshot there is no `viewerId` to put on the action, and
        // an action with a guessed one is worse than none. The host's periodic
        // keyframe is what recovers this.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        createIpcClient(portFixture.port, store).bootstrap();

        portFixture.capturedDeltaListener?.({
            fromTick: 1,
            toTick: 2,
            entries: [{ path: 'tick', kind: 'changed', after: 2 }],
        });

        expect(applySnapshotSpy).not.toHaveBeenCalled();
        expect(portFixture.sendActionSpy).not.toHaveBeenCalled();
    });
});

describe('createIpcClient — deltas under frame coalescing', () => {
    it('applies every delta in order, and writes the store once per frame', () => {
        // Newest-wins is safe for whole snapshots and WRONG for deltas: a delta
        // dropped inside a frame is one the next delta was measured against. The
        // deltas are therefore applied ON ARRIVAL, and only the STORE WRITE is
        // paced — one write per frame carrying the accumulated result.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        createIpcClient(portFixture.port, store, frames.scheduler).bootstrap();

        const s1 = makeEntitySnapshot(1, 0);
        const s2 = makeEntitySnapshot(2, 1);
        const s3 = makeEntitySnapshot(3, 2);
        const s4 = makeEntitySnapshot(4, 3);
        portFixture.capturedListener?.(s1);
        frames.runFrame();
        applySnapshotSpy.mockClear();

        portFixture.capturedDeltaListener?.(deltaBetween(s1, s2));
        portFixture.capturedDeltaListener?.(deltaBetween(s2, s3));
        portFixture.capturedDeltaListener?.(deltaBetween(s3, s4));
        expect(applySnapshotSpy).not.toHaveBeenCalled();

        frames.runFrame();
        expect(applySnapshotSpy).toHaveBeenCalledTimes(1);
        expect(applySnapshotSpy).toHaveBeenCalledWith(s4);
    });

    it('keeps applying deltas measured against ones it coalesced away', () => {
        // The mid-frame deltas never reached the store, but the LAST one was
        // measured against what they produced — so if any had been dropped
        // rather than applied, this one would not fit.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        createIpcClient(portFixture.port, store, frames.scheduler).bootstrap();

        const beats = [1, 2, 3, 4, 5].map((tick) => makeEntitySnapshot(tick, tick));
        portFixture.capturedListener?.(beats[0]!);
        frames.runFrame();
        for (let index = 1; index < beats.length; index++) {
            portFixture.capturedDeltaListener?.(deltaBetween(beats[index - 1]!, beats[index]!));
        }
        frames.runFrame();

        expect(applySnapshotSpy).toHaveBeenLastCalledWith(beats[4]);
    });

    it('writes a snapshot that arrives after a delta, superseding it', () => {
        // A keyframe REPLACES: newest-wins is still right between a delta and a
        // whole snapshot, because the snapshot is not measured against anything.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        createIpcClient(portFixture.port, store, frames.scheduler).bootstrap();

        const s1 = makeEntitySnapshot(1, 0);
        portFixture.capturedListener?.(s1);
        frames.runFrame();
        portFixture.capturedDeltaListener?.(deltaBetween(s1, makeEntitySnapshot(2, 1)));
        const keyframe = makeEntitySnapshot(9, 9);
        portFixture.capturedListener?.(keyframe);
        frames.runFrame();

        expect(applySnapshotSpy).toHaveBeenLastCalledWith(keyframe);
    });

    it('adopt() seeds the baseline, so the delta measured against it applies', () => {
        // The bootstrap catch-up reads the host's current snapshot over a ROUND
        // TRIP rather than off the push channel. A snapshot that reaches the
        // store without passing through here leaves the bridge with no baseline,
        // and the very next delta — measured by the host against exactly that
        // snapshot — is refused. On a turn-based game that is every beat until
        // the periodic keyframe.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const client = createIpcClient(portFixture.port, store);
        client.bootstrap();

        const caughtUp = makeEntitySnapshot(7, 3);
        client.adopt(caughtUp);
        expect(applySnapshotSpy).toHaveBeenCalledWith(caughtUp);

        const next = makeEntitySnapshot(8, 4);
        portFixture.capturedDeltaListener?.(deltaBetween(caughtUp, next));

        expect(applySnapshotSpy).toHaveBeenLastCalledWith(next);
    });

    it('adopt() supersedes a snapshot still waiting on a frame, and that frame then writes nothing', () => {
        // The frame is left ON the clock deliberately — the next arrival reuses
        // it. What makes that safe is that `adopt` leaves nothing owed, so the
        // frame finds no write to make. Asserting the last call alone cannot see
        // that: the frame would write the adopted snapshot a second time and the
        // last call would look identical.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        const caughtUp = makeEntitySnapshot(7, 3);
        client.adopt(caughtUp);
        expect(applySnapshotSpy).toHaveBeenCalledTimes(1);
        expect(applySnapshotSpy).toHaveBeenCalledWith(caughtUp);

        frames.runFrame();
        expect(applySnapshotSpy).toHaveBeenCalledTimes(1);
    });

    it('adopt() re-asserts a clock beat its snapshot would have rewound', () => {
        // `applySnapshot` writes `currentTick`, and the store clock is what
        // stamps every dispatched action — so adopting a snapshot older than a
        // beat that already arrived would send the host an envelope from its own
        // past. The paced write guards this; `adopt` writes the same surface.
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        portFixture.capturedTickListener?.(40);
        applyTickSpy.mockClear();
        client.adopt(makeEntitySnapshot(7, 3));

        expect(applyTickSpy).toHaveBeenCalledWith(40);
    });

    it('adopt() leaves the clock alone when the beat is exactly its own tick', () => {
        // ON the boundary. `>` and `>=` differ only here, and re-asserting a
        // beat the snapshot already carries is a redundant store write on a
        // surface every dispatched action is stamped from.
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        portFixture.capturedTickListener?.(7);
        applyTickSpy.mockClear();
        client.adopt(makeEntitySnapshot(7, 3));

        expect(applyTickSpy).not.toHaveBeenCalled();
    });

    it('adopt() spends the beat it re-asserted, so a later frame cannot re-assert it again', () => {
        // The beat belongs to the write that consumed it. Left behind, it is
        // re-asserted by the NEXT write — after a newer snapshot has arrived —
        // and the store clock jumps back to a beat older than the snapshot the
        // renderer is holding.
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        portFixture.capturedTickListener?.(40);
        client.adopt(makeEntitySnapshot(7, 3));
        applyTickSpy.mockClear();

        portFixture.capturedListener?.(makeEntitySnapshot(8, 4));
        frames.runFrame();

        expect(applyTickSpy).not.toHaveBeenCalled();
    });

    it('adopt() leaves the clock alone when its snapshot is the newer of the two', () => {
        const portFixture = makePort();
        const { store, applyTickSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        portFixture.capturedTickListener?.(4);
        applyTickSpy.mockClear();
        client.adopt(makeEntitySnapshot(7, 3));

        expect(applyTickSpy).not.toHaveBeenCalled();
    });

    it('adopt() answers an outstanding re-sync request, as a pushed snapshot does', () => {
        // A fresh baseline is a fresh baseline however it arrived. Leaving the
        // latch raised would mean the NEXT broken chain never asks.
        const portFixture = makePort();
        const { store } = makeStore();
        const client = createIpcClient(portFixture.port, store);
        client.bootstrap();

        const stale: SnapshotDelta = {
            fromTick: 99,
            toTick: 100,
            entries: [{ path: 'tick', kind: 'changed', after: 100 }],
        };
        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        portFixture.capturedDeltaListener?.(stale);
        expect(portFixture.sendActionSpy).toHaveBeenCalledTimes(1);

        client.adopt(makeEntitySnapshot(7, 3));
        portFixture.capturedDeltaListener?.(stale);

        expect(portFixture.sendActionSpy).toHaveBeenCalledTimes(2);
    });

    it('flush() with nothing owed writes nothing, so a caller may flush freely', () => {
        // `bootstrapGameStore` flushes to order its own write against this
        // one's. A flush that re-wrote the held snapshot every time would put an
        // identical snapshot back through the store — and through React — for
        // every caller that flushed defensively.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
        client.bootstrap();

        portFixture.capturedListener?.(makeEntitySnapshot(1, 0));
        client.flush();
        expect(applySnapshotSpy).toHaveBeenCalledTimes(1);

        client.flush();
        client.flush();
        expect(applySnapshotSpy).toHaveBeenCalledTimes(1);
    });

    it('forgets the held snapshot on unsubscribe, so a re-bootstrap differences nothing', () => {
        // The held snapshot is a match's. A client re-bootstrapped onto the next
        // one must not accept a delta measured against the last one's
        // projection — the tick check alone would let it through whenever the
        // ticks happen to line up.
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const client = createIpcClient(portFixture.port, store);

        const unsubscribe = client.bootstrap();
        const stale = makeEntitySnapshot(1, 0);
        portFixture.capturedListener?.(stale);
        unsubscribe();

        client.bootstrap();
        applySnapshotSpy.mockClear();
        portFixture.capturedDeltaListener?.(deltaBetween(stale, makeEntitySnapshot(2, 5)));

        expect(applySnapshotSpy).not.toHaveBeenCalled();
    });

    it('flush() writes the accumulated result immediately', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const frames = makeManualScheduler();
        const client = createIpcClient(portFixture.port, store, frames.scheduler);
        client.bootstrap();

        const s1 = makeEntitySnapshot(1, 0);
        const s2 = makeEntitySnapshot(2, 1);
        portFixture.capturedListener?.(s1);
        frames.runFrame();
        portFixture.capturedDeltaListener?.(deltaBetween(s1, s2));
        client.flush();

        expect(applySnapshotSpy).toHaveBeenLastCalledWith(s2);
        // And the frame it took off the clock writes nothing more.
        applySnapshotSpy.mockClear();
        frames.runFrame();
        expect(applySnapshotSpy).not.toHaveBeenCalled();
    });
});
