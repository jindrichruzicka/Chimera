// @vitest-environment jsdom

/**
 * renderer/bridge/ipcClient.test.ts
 *
 * Unit tests for the ipcClient bridge module.
 * Covers sendAction() prediction wiring and onSnapshot bootstrapping.
 *
 * Architecture: §4.4 — Renderer State Stores, renderer/bridge/ipcClient.ts
 * Task: issue #368
 *
 * Rules:
 *  - No real Electron IPC — all port interactions use test doubles.
 *  - `ClientPredictor` and `ReconcileBuffer` are NOT imported here;
 *    the bridge only calls PredictionStore methods.
 */

import { describe, it, expect, vi } from 'vitest';
import { createIpcClient, type IpcGamePort, type IpcPredictionStore } from './ipcClient.js';
import type { EngineAction, PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import { playerId, gamePhase } from '@chimera/electron/preload/api-types.js';

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
        matchResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function makePort(): {
    port: IpcGamePort;
    sendActionSpy: ReturnType<typeof vi.fn>;
    onSnapshotSpy: ReturnType<typeof vi.fn>;
    capturedListener: ((snapshot: PlayerSnapshot) => void) | null;
} {
    let capturedListener: ((snapshot: PlayerSnapshot) => void) | null = null;
    const sendActionSpy = vi.fn<(action: EngineAction) => void>();
    const onSnapshotSpy = vi.fn<(cb: (snapshot: PlayerSnapshot) => void) => () => void>((cb) => {
        capturedListener = cb;
        return vi.fn();
    });
    return {
        port: { sendAction: sendActionSpy, onSnapshot: onSnapshotSpy },
        sendActionSpy,
        onSnapshotSpy,
        get capturedListener() {
            return capturedListener;
        },
    };
}

function makeStore(): {
    store: IpcPredictionStore;
    addPredictionSpy: ReturnType<typeof vi.fn>;
    confirmPredictionSpy: ReturnType<typeof vi.fn>;
    applySnapshotSpy: ReturnType<typeof vi.fn>;
} {
    const addPredictionSpy = vi.fn<(action: EngineAction) => void>();
    const confirmPredictionSpy = vi.fn<(tick: number) => void>();
    const applySnapshotSpy = vi.fn<(snapshot: PlayerSnapshot) => void>();
    return {
        store: {
            addPrediction: addPredictionSpy,
            confirmPrediction: confirmPredictionSpy,
            applySnapshot: applySnapshotSpy,
        },
        addPredictionSpy,
        confirmPredictionSpy,
        applySnapshotSpy,
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

    it('calls applySnapshot when a snapshot arrives', () => {
        const portFixture = makePort();
        const { store, applySnapshotSpy } = makeStore();
        const client = createIpcClient(portFixture.port, store, () => false);
        client.bootstrap();
        const snap = makeSnapshot(10);

        portFixture.capturedListener?.(snap);

        expect(applySnapshotSpy).toHaveBeenCalledOnce();
        expect(applySnapshotSpy).toHaveBeenCalledWith(snap);
    });

    it('calls confirmPrediction with snapshot.tick when a snapshot arrives', () => {
        const portFixture = makePort();
        const { store, confirmPredictionSpy } = makeStore();
        const client = createIpcClient(portFixture.port, store, () => false);
        client.bootstrap();
        const snap = makeSnapshot(7);

        portFixture.capturedListener?.(snap);

        expect(confirmPredictionSpy).toHaveBeenCalledOnce();
        expect(confirmPredictionSpy).toHaveBeenCalledWith(7);
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
        };
        const client = createIpcClient(portFixture.port, store, () => false);
        client.bootstrap();

        portFixture.capturedListener?.(makeSnapshot(3));

        expect(callOrder).toEqual(['confirm', 'apply']);
    });

    it('returns an unsubscribe function from the port', () => {
        const unsubSpy = vi.fn();
        const port: IpcGamePort = {
            sendAction: vi.fn(),
            onSnapshot: vi.fn(() => unsubSpy),
        };
        const { store } = makeStore();
        const client = createIpcClient(port, store, () => false);

        const unsub = client.bootstrap();
        unsub();

        expect(unsubSpy).toHaveBeenCalledOnce();
    });
});
