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
 *                         §6  — simulation/prediction · Client Prediction
 *
 * Invariants upheld:
 *   #1 — GameSnapshot never crosses any IPC boundary; only PlayerSnapshot.
 *   #3 — Renderer never writes simulation state directly; writes go via ipcClient.
 *   #4 — addPrediction / confirmPrediction are ipcClient only.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
    GameAPI,
    Unsubscribe,
    PlayerSnapshot,
    EngineAction,
    ActionRejection,
} from '@chimera/electron/preload/api-types.js';
import { playerId, gamePhase } from '@chimera/electron/preload/api-types.js';
import { bootstrapGameStore } from './gameStoreBootstrap.js';
import { createGameStore } from './gameStore.js';
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

    it('leaves the store empty when getCurrentSnapshot() returns null', async () => {
        const { api } = makeApi();
        const store = createGameStore();

        await bootstrapGameStore(api, store.getState());

        expect(store.getState().snapshot).toBeNull();
    });
});
