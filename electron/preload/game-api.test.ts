import { describe, expect, it, vi } from 'vitest';
import {
    GAME_SEND_ACTION_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_SWITCH_SEAT_CHANNEL,
    createGameApi,
    type GameApiIpcPort,
    type GameApiListener,
} from './game-api.js';
import type { EngineAction, PlayerSnapshot } from './api.js';

/**
 * Recording stub for the narrow `GameApiIpcPort` slice. Captures every call
 * the game API factory makes so tests can assert the exact channel / payload
 * protocol without pulling in a real Electron `ipcRenderer`.
 */
function makeIpcStub(): {
    readonly port: GameApiIpcPort;
    readonly invocations: { channel: string; arg: unknown }[];
    readonly sends: { channel: string; payload: unknown }[];
    readonly listeners: Map<string, Set<GameApiListener>>;
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: { channel: string; arg: unknown }[] = [];
    const sends: { channel: string; payload: unknown }[] = [];
    const listeners = new Map<string, Set<GameApiListener>>();
    const invokeResults = new Map<string, unknown>();

    const port: GameApiIpcPort = {
        invoke: (channel, arg) => {
            invocations.push({ channel, arg });
            return Promise.resolve(invokeResults.get(channel));
        },
        send: (channel, payload) => {
            sends.push({ channel, payload });
        },
        on: (channel, listener) => {
            const set = listeners.get(channel) ?? new Set<GameApiListener>();
            set.add(listener);
            listeners.set(channel, set);
        },
        removeListener: (channel, listener) => {
            listeners.get(channel)?.delete(listener);
        },
    };

    return { port, invocations, sends, listeners, invokeResults };
}

/** Build an `EngineAction` stub for transport-level tests. */
function makeAction(): EngineAction {
    return {
        type: 'noop',
        playerId: 'p1',
        tick: 0,
        payload: {},
    };
}

/** Build a `PlayerSnapshot` stub for transport-level tests. */
function makeSnapshot(): PlayerSnapshot {
    return {
        tick: 7,
        viewerId: 'p1',
        players: {},
        entities: {},
        phase: 'setup',
        events: [],
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
    };
}

describe('createGameApi', () => {
    describe('sendAction()', () => {
        it('sends on the chimera:game:send-action channel with the action payload', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const action = makeAction();

            api.sendAction(action);

            expect(stub.sends).toEqual([{ channel: GAME_SEND_ACTION_CHANNEL, payload: action }]);
        });

        it('returns void (fire-and-forget; no Promise)', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);

            const result = api.sendAction(makeAction());

            expect(result).toBeUndefined();
        });
    });

    describe('switchActiveSeat()', () => {
        it('invokes chimera:game:switch-seat with the playerId argument', async () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);

            await api.switchActiveSeat('p2');

            expect(stub.invocations).toEqual([{ channel: GAME_SWITCH_SEAT_CHANNEL, arg: 'p2' }]);
        });

        it('resolves to void once the main-side handler replies', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(GAME_SWITCH_SEAT_CHANNEL, undefined);
            const api = createGameApi(stub.port);

            await expect(api.switchActiveSeat('p1')).resolves.toBeUndefined();
        });
    });

    describe('onSnapshot()', () => {
        it('registers a listener on chimera:game:snapshot and forwards only the PlayerSnapshot payload', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(snapshot: PlayerSnapshot) => void>();

            api.onSnapshot(callback);

            const registered = stub.listeners.get(GAME_SNAPSHOT_CHANNEL);
            expect(registered?.size).toBe(1);

            // Main emits via `webContents.send(channel, snapshot)`; the preload
            // listener receives `(event, snapshot)`. Verify the event is
            // stripped before the callback runs.
            const snapshot = makeSnapshot();
            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, snapshot);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(snapshot);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(snapshot: PlayerSnapshot) => void>();

            const unsubscribe = api.onSnapshot(callback);
            const beforeUnsub = stub.listeners.get(GAME_SNAPSHOT_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(GAME_SNAPSHOT_CHANNEL)?.size).toBe(0);
        });

        it('supports multiple independent subscriptions', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const cbA = vi.fn<(snapshot: PlayerSnapshot) => void>();
            const cbB = vi.fn<(snapshot: PlayerSnapshot) => void>();

            const unsubA = api.onSnapshot(cbA);
            api.onSnapshot(cbB);

            const snap = makeSnapshot();
            for (const listener of stub.listeners.get(GAME_SNAPSHOT_CHANNEL) ?? []) {
                listener({}, snap);
            }
            expect(cbA).toHaveBeenCalledOnce();
            expect(cbA).toHaveBeenCalledWith(snap);
            expect(cbB).toHaveBeenCalledOnce();
            expect(cbB).toHaveBeenCalledWith(snap);

            cbA.mockClear();
            cbB.mockClear();
            unsubA();
            for (const listener of stub.listeners.get(GAME_SNAPSHOT_CHANNEL) ?? []) {
                listener({}, snap);
            }
            expect(cbA).not.toHaveBeenCalled();
            expect(cbB).toHaveBeenCalledOnce();
        });
    });
});
