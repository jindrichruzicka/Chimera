// @vitest-environment jsdom

/**
 * renderer/state/gameStoreBootstrap.test.ts
 *
 * Unit tests for bootstrapGameStore.
 * Verifies that bootstrapGameStore registers the onSnapshot callback and
 * routes incoming PlayerSnapshot pushes into gameStore via confirmPrediction
 * and applySnapshot.
 *
 * Architecture reference: §4.4 — Renderer State Stores;
 *                         §6  — simulation/engine/prediction · Client Prediction
 *
 * Invariants upheld:
 *   #3 — GameSnapshot never crosses any IPC boundary; only PlayerSnapshot.
 *   #4 — Renderer never writes simulation state directly; writes go via ipcClient,
 *        and addPrediction / confirmPrediction are ipcClient only.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type {
    GameAPI,
    Unsubscribe,
    PlayerSnapshot,
    EngineAction,
    ActionRejection,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { playerId, gamePhase } from '@chimera-engine/simulation/bridge/api-types.js';
import { bootstrapGameStore } from './gameStoreBootstrap.js';
import { createGameStore } from './gameStore.js';
import { setSnapshotPacingEnabled } from './snapshotPacing.js';
import { createIpcClient } from '../bridge/ipcClient.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

function makeAction(tick: number, type = 'test:move'): EngineAction {
    return { type, playerId: playerId('p1'), tick, payload: {} };
}

type SnapshotListener = (snapshot: PlayerSnapshot) => void;

function makeApi(
    options: {
        captureSnapshotListener?: (cb: SnapshotListener) => void;
        predictableTypes?: readonly string[];
    } = {},
): {
    api: GameAPI;
    sendActionSpy: ReturnType<typeof vi.fn>;
    onSnapshotSpy: ReturnType<typeof vi.fn>;
    onTickSpy: ReturnType<typeof vi.fn>;
    onActionRejectedSpy: ReturnType<typeof vi.fn>;
    getPredictableActionTypesSpy: ReturnType<typeof vi.fn>;
} {
    const sendActionSpy = vi.fn<(action: EngineAction) => void>();
    const onSnapshotSpy = vi.fn<(cb: SnapshotListener) => Unsubscribe>((cb) => {
        options.captureSnapshotListener?.(cb);
        return vi.fn();
    });
    const onTickSpy = vi.fn<(cb: (tick: number) => void) => Unsubscribe>(() => vi.fn());
    const onActionRejectedSpy = vi.fn<(cb: (r: ActionRejection) => void) => Unsubscribe>(() =>
        vi.fn(),
    );
    const onRevealSpy = vi.fn(() => vi.fn());
    const getPredictableActionTypesSpy = vi.fn<() => Promise<readonly string[]>>(() =>
        Promise.resolve(options.predictableTypes ?? []),
    );

    const api: GameAPI = {
        sendAction: sendActionSpy,
        onSnapshot: onSnapshotSpy,
        onTick: onTickSpy,
        onActionRejected: onActionRejectedSpy,
        onReveal: onRevealSpy,
        getPredictableActionTypes: getPredictableActionTypesSpy,
        getCurrentSnapshot: vi.fn<() => Promise<PlayerSnapshot | null>>(() =>
            Promise.resolve(null),
        ),
    };

    return {
        api,
        sendActionSpy,
        onSnapshotSpy,
        onTickSpy,
        onActionRejectedSpy,
        getPredictableActionTypesSpy,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bootstrapGameStore()', () => {
    // The PACED arm, deliberately. `bootstrapGameStore` builds a scheduler that
    // asks `snapshotPacing` whenever it requests a frame, and that module reads `false`
    // until a game declares otherwise — so a suite that left it alone would
    // apply every snapshot on arrival and could not tell a frame-paced bridge
    // from an un-paced one. The un-paced arm is measured in the last case of
    // this block, and the scheduler's own two arms in `ipcClient.test.ts`.
    beforeEach(() => {
        setSnapshotPacingEnabled(true);
    });

    afterEach(() => {
        setSnapshotPacingEnabled(false);
    });

    it('registers an onSnapshot callback with the bridge', async () => {
        const { api, onSnapshotSpy } = makeApi();
        await bootstrapGameStore(api, createGameStore().getState());
        expect(onSnapshotSpy).toHaveBeenCalledOnce();
    });

    it('returns an Unsubscribe function', async () => {
        const { api } = makeApi();
        const result = await bootstrapGameStore(api, createGameStore().getState());
        expect(typeof result).toBe('function');
    });

    it('calling the returned unsubscribe forwards to the bridge unsubscribe', async () => {
        const unsubscribe = vi.fn();
        const { api } = makeApi();
        (api.onSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(
            (_cb: SnapshotListener) => unsubscribe,
        );
        const stop = await bootstrapGameStore(api, createGameStore().getState());
        stop();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('routes snapshot push into applySnapshot on the store', async () => {
        let captured: SnapshotListener | undefined;
        const { api } = makeApi({ captureSnapshotListener: (cb) => (captured = cb) });
        const store = createGameStore();
        await bootstrapGameStore(api, store.getState());

        expect(captured).toBeDefined();
        const snap = makeSnapshot(7);
        captured!(snap);
        await nextFrame();

        expect(store.getState().snapshot).toBe(snap);
    });

    it('calls confirmPrediction(tick) evicting predictions at or before the snapshot tick', async () => {
        let captured: SnapshotListener | undefined;
        const { api } = makeApi({ captureSnapshotListener: (cb) => (captured = cb) });
        const store = createGameStore();
        // Pre-seed a prediction with tick=7 so we can observe eviction
        store.getState().addPrediction(makeAction(7));
        expect(store.getState().predictedActions).toHaveLength(1);

        await bootstrapGameStore(api, store.getState());
        captured!(makeSnapshot(7));
        await nextFrame();

        // tick=7 prediction should be evicted (confirmed)
        expect(store.getState().predictedActions).toHaveLength(0);
    });

    it('does not call sendAction on the api during bootstrap', async () => {
        const { api, sendActionSpy } = makeApi();
        await bootstrapGameStore(api, createGameStore().getState());
        expect(sendActionSpy).not.toHaveBeenCalled();
    });

    it('canUndo and canRedo mirror the incoming snapshot undoMeta', async () => {
        let captured: SnapshotListener | undefined;
        const { api } = makeApi({ captureSnapshotListener: (cb) => (captured = cb) });
        const store = createGameStore();
        await bootstrapGameStore(api, store.getState());

        const snap = { ...makeSnapshot(1), undoMeta: { canUndo: true, canRedo: false } };
        captured!(snap);
        await nextFrame();

        expect(store.getState().canUndo).toBe(true);
        expect(store.getState().canRedo).toBe(false);
    });

    it('calls getPredictableActionTypes() exactly once during bootstrap', async () => {
        const { api, getPredictableActionTypesSpy } = makeApi();
        await bootstrapGameStore(api, createGameStore().getState());
        expect(getPredictableActionTypesSpy).toHaveBeenCalledOnce();
    });

    it('registers the snapshot listener before predictable action types resolve', async () => {
        let resolvePredictableTypes: (value: readonly string[]) => void = () => undefined;
        const predictableTypesPromise = new Promise<readonly string[]>((resolve) => {
            resolvePredictableTypes = resolve;
        });
        const { api, onSnapshotSpy, getPredictableActionTypesSpy } = makeApi();
        getPredictableActionTypesSpy.mockReturnValueOnce(predictableTypesPromise);

        const bootstrapPromise = bootstrapGameStore(api, createGameStore().getState());

        expect(onSnapshotSpy).toHaveBeenCalledOnce();
        resolvePredictableTypes([]);
        await bootstrapPromise;
    });

    it('enqueues addPrediction for predictable types but not for others (predicate wiring)', async () => {
        // Capture the isPredictable predicate that bootstrapGameStore constructs
        // from the getPredictableActionTypes() response and passes to createIpcClient.
        let capturedPredicate: ((type: string) => boolean) | undefined;
        const factory: Parameters<typeof bootstrapGameStore>[2] = (port, store, isPredictable) => {
            capturedPredicate = isPredictable;
            return createIpcClient(port, store, isPredictable);
        };
        const { api } = makeApi({ predictableTypes: ['tactics:move', 'tactics:rotate'] });
        await bootstrapGameStore(api, createGameStore().getState(), factory);

        expect(capturedPredicate).toBeDefined();
        // Types returned by getPredictableActionTypes must be recognised as predictable.
        expect(capturedPredicate!('tactics:move')).toBe(true);
        expect(capturedPredicate!('tactics:rotate')).toBe(true);
        // Types NOT in the list must not be recognised as predictable.
        expect(capturedPredicate!('tactics:chat')).toBe(false);
        expect(capturedPredicate!('engine:end_turn')).toBe(false);
    });

    it('applies a snapshot from getCurrentSnapshot() when it returns non-null', async () => {
        const replaySnap = makeSnapshot(99);
        const { api } = makeApi();
        (api.getCurrentSnapshot as ReturnType<typeof vi.fn>).mockResolvedValueOnce(replaySnap);
        const store = createGameStore();

        await bootstrapGameStore(api, store.getState());

        expect(store.getState().snapshot).toBe(replaySnap);
    });

    it('does not overwrite a newer live snapshot with an older replay snapshot', async () => {
        let captured: SnapshotListener | undefined;
        let resolveCurrentSnapshot: (snapshot: PlayerSnapshot | null) => void = () => undefined;
        const currentSnapshotPromise = new Promise<PlayerSnapshot | null>((resolve) => {
            resolveCurrentSnapshot = resolve;
        });
        const { api } = makeApi({ captureSnapshotListener: (cb) => (captured = cb) });
        (api.getCurrentSnapshot as ReturnType<typeof vi.fn>).mockReturnValueOnce(
            currentSnapshotPromise,
        );
        const store = createGameStore();

        const bootstrapPromise = bootstrapGameStore(api, store.getState());
        const newerLiveSnapshot = makeSnapshot(11);
        captured!(newerLiveSnapshot);
        resolveCurrentSnapshot(makeSnapshot(10));
        await bootstrapPromise;

        expect(store.getState().snapshot).toBe(newerLiveSnapshot);
    });

    it('does not let a snapshot still waiting on a frame land on top of the catch-up', async () => {
        // The same rule as the test above, but with the live snapshot NEWER
        // and still waiting on a frame when the catch-up resolves — the shape
        // frame pacing introduced. Without the flush, the catch-up sees
        // nothing newer than what it has APPLIED, writes tick 10, and the
        // pending frame then puts tick 11's predecessor ordering in reverse.
        let captured: SnapshotListener | undefined;
        let resolveCurrentSnapshot: (snapshot: PlayerSnapshot | null) => void = () => undefined;
        const currentSnapshotPromise = new Promise<PlayerSnapshot | null>((resolve) => {
            resolveCurrentSnapshot = resolve;
        });
        const { api } = makeApi({ captureSnapshotListener: (cb) => (captured = cb) });
        (api.getCurrentSnapshot as ReturnType<typeof vi.fn>).mockReturnValueOnce(
            currentSnapshotPromise,
        );
        const store = createGameStore();

        const bootstrapPromise = bootstrapGameStore(api, store.getState());
        const liveSnapshot = makeSnapshot(11);
        captured!(liveSnapshot);
        resolveCurrentSnapshot(makeSnapshot(10));
        await bootstrapPromise;
        // No frame has run yet, and pacing is on for this block — so the flush
        // inside bootstrap is the only thing that can have applied it.
        expect(store.getState().snapshot).toBe(liveSnapshot);

        // And the frame that was cancelled must not re-apply it afterwards.
        await nextFrame();
        expect(store.getState().snapshot).toBe(liveSnapshot);
    });

    it('flushes AFTER the catch-up round trip, not before it', async () => {
        // The window the flush's position exists for: the snapshot arrives
        // while `getCurrentSnapshot()` is still in flight, so a flush placed
        // ahead of that await has already run and cannot see it. The catch-up
        // would then find nothing newer than what it has APPLIED, write the
        // older tick, and the pending frame would put the newer one back —
        // ordering reversed, with the store ending on the older.
        let captured: SnapshotListener | undefined;
        const liveSnapshot = makeSnapshot(11);
        const { api } = makeApi({ captureSnapshotListener: (cb) => (captured = cb) });
        (api.getCurrentSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
            // Delivered from INSIDE the round trip: bootstrap is suspended on
            // this promise, past any flush that ran before it.
            captured!(liveSnapshot);
            return makeSnapshot(10);
        });
        const store = createGameStore();

        await bootstrapGameStore(api, store.getState());

        expect(store.getState().snapshot).toBe(liveSnapshot);
    });

    it('applies on ARRIVAL when the active game declared no pacing', async () => {
        // The other arm of the scheduler this bootstrap builds. A turn-based
        // game must keep the un-paced behaviour it had before the pacing
        // existed — and a bootstrap wired to a fixed frame-paced scheduler
        // would defer its snapshots too.
        setSnapshotPacingEnabled(false);
        let captured: SnapshotListener | undefined;
        const { api } = makeApi({ captureSnapshotListener: (cb) => (captured = cb) });
        const store = createGameStore();
        await bootstrapGameStore(api, store.getState());

        const snap = makeSnapshot(7);
        captured!(snap);

        expect(store.getState().snapshot).toBe(snap);
    });

    it('leaves the store empty when getCurrentSnapshot() returns null', async () => {
        const { api } = makeApi();
        const store = createGameStore();

        await bootstrapGameStore(api, store.getState());

        expect(store.getState().snapshot).toBeNull();
    });
});

/** Waits for the frame the bridge paces snapshot application against. */
async function nextFrame(): Promise<void> {
    await new Promise<void>((resolve) => {
        globalThis.requestAnimationFrame(() => {
            resolve();
        });
    });
}
