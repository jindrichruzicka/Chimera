import { describe, expect, it, vi } from 'vitest';
import {
    GAME_ACTION_REJECTED_CHANNEL,
    GAME_REVEAL_CHANNEL,
    GAME_SEND_ACTION_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_TICK_CHANNEL,
    GAME_PREDICTABLE_TYPES_CHANNEL,
    GAME_GET_CURRENT_SNAPSHOT_CHANNEL,
    createGameApi,
    type GameApiIpcPort,
    type GameApiListener,
} from './game-api.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';
import type {
    ActionRejection,
    CommitmentReveal,
    EngineAction,
    PlayerSnapshot,
} from '../api-types.js';
import { playerId, gamePhase } from '../api-types.js';
import { toCommitmentId } from '@chimera/simulation/projection/index.js';

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
        playerId: playerId('p1'),
        tick: 0,
        payload: {},
    };
}

/** Build a `PlayerSnapshot` stub for transport-level tests. */
function makeSnapshot(): PlayerSnapshot {
    return {
        tick: 7,
        viewerId: playerId('p1'),
        players: {},
        entities: {},
        phase: gamePhase('setup'),
        events: [],
        matchResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function makeReveal(): CommitmentReveal {
    return {
        id: toCommitmentId('commitment-1'),
        value: { card: 'ace-of-stars' },
        nonce: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
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

    describe('onTick()', () => {
        it('registers a listener on chimera:game:tick and forwards only the tick payload', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(tick: number) => void>();

            api.onTick(callback);

            const registered = stub.listeners.get(GAME_TICK_CHANNEL);
            expect(registered?.size).toBe(1);

            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, 23);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(23);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(tick: number) => void>();

            const unsubscribe = api.onTick(callback);
            const beforeUnsub = stub.listeners.get(GAME_TICK_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(GAME_TICK_CHANNEL)?.size).toBe(0);
        });
    });

    describe('onActionRejected()', () => {
        const validRejection: ActionRejection = {
            reason: 'ipc-validation:chimera:game:send-action',
            tick: 7,
            actionType: 'noop',
        };

        it('registers a listener on chimera:game:action-rejected and forwards the validated payload', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(rejection: ActionRejection) => void>();

            api.onActionRejected(callback);

            const registered = stub.listeners.get(GAME_ACTION_REJECTED_CHANNEL);
            expect(registered?.size).toBe(1);

            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, validRejection);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(validRejection);
        });

        it('accepts a rejection without the optional actionType field', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(rejection: ActionRejection) => void>();

            api.onActionRejected(callback);
            const listener = [...(stub.listeners.get(GAME_ACTION_REJECTED_CHANNEL) ?? [])][0];
            listener?.({}, { reason: 'pipeline:rejected', tick: -1 });

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith({ reason: 'pipeline:rejected', tick: -1 });
        });

        it('throws PreloadIpcValidationError if main pushes a malformed rejection payload', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(rejection: ActionRejection) => void>();

            api.onActionRejected(callback);
            const listener = [...(stub.listeners.get(GAME_ACTION_REJECTED_CHANNEL) ?? [])][0];

            // Missing required `reason`.
            expect(() => listener?.({}, { tick: 0 })).toThrow(PreloadIpcValidationError);
            // Empty `reason` is rejected (schema enforces non-empty).
            expect(() => listener?.({}, { reason: '', tick: 0 })).toThrow(
                PreloadIpcValidationError,
            );
            // Non-integer tick is rejected.
            expect(() => listener?.({}, { reason: 'x', tick: 1.5 })).toThrow(
                PreloadIpcValidationError,
            );
            // Payload is not an object.
            expect(() => listener?.({}, null)).toThrow(PreloadIpcValidationError);

            // None of the malformed pushes reached the consumer.
            expect(callback).not.toHaveBeenCalled();
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(rejection: ActionRejection) => void>();

            const unsubscribe = api.onActionRejected(callback);
            expect(stub.listeners.get(GAME_ACTION_REJECTED_CHANNEL)?.size).toBe(1);
            unsubscribe();
            expect(stub.listeners.get(GAME_ACTION_REJECTED_CHANNEL)?.size).toBe(0);
        });

        it('supports multiple independent subscriptions', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const cbA = vi.fn<(rejection: ActionRejection) => void>();
            const cbB = vi.fn<(rejection: ActionRejection) => void>();

            const unsubA = api.onActionRejected(cbA);
            api.onActionRejected(cbB);

            for (const listener of stub.listeners.get(GAME_ACTION_REJECTED_CHANNEL) ?? []) {
                listener({}, validRejection);
            }
            expect(cbA).toHaveBeenCalledOnce();
            expect(cbB).toHaveBeenCalledOnce();

            cbA.mockClear();
            cbB.mockClear();
            unsubA();
            for (const listener of stub.listeners.get(GAME_ACTION_REJECTED_CHANNEL) ?? []) {
                listener({}, validRejection);
            }
            expect(cbA).not.toHaveBeenCalled();
            expect(cbB).toHaveBeenCalledOnce();
        });
    });

    describe('onReveal()', () => {
        it('registers a listener on chimera:game:reveal and forwards the validated payload', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(reveal: CommitmentReveal) => void>();

            api.onReveal(callback);

            const registered = stub.listeners.get(GAME_REVEAL_CHANNEL);
            expect(registered?.size).toBe(1);

            const reveal = makeReveal();
            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, reveal);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(reveal);
        });

        it('throws PreloadIpcValidationError if main pushes a malformed reveal payload', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(reveal: CommitmentReveal) => void>();

            api.onReveal(callback);
            const listener = [...(stub.listeners.get(GAME_REVEAL_CHANNEL) ?? [])][0];

            expect(() => listener?.({}, { value: 42, nonce: 'abc' })).toThrow(
                PreloadIpcValidationError,
            );
            expect(() => listener?.({}, { id: 'commitment-1', value: 42 })).toThrow(
                PreloadIpcValidationError,
            );
            expect(() => listener?.({}, null)).toThrow(PreloadIpcValidationError);
            expect(callback).not.toHaveBeenCalled();
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);
            const callback = vi.fn<(reveal: CommitmentReveal) => void>();

            const unsubscribe = api.onReveal(callback);
            expect(stub.listeners.get(GAME_REVEAL_CHANNEL)?.size).toBe(1);
            unsubscribe();
            expect(stub.listeners.get(GAME_REVEAL_CHANNEL)?.size).toBe(0);
        });
    });

    describe('getPredictableActionTypes()', () => {
        it('invokes chimera:game:predictable-action-types with no argument', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(GAME_PREDICTABLE_TYPES_CHANNEL, []);
            const api = createGameApi(stub.port);

            await api.getPredictableActionTypes();

            expect(stub.invocations).toEqual([
                { channel: GAME_PREDICTABLE_TYPES_CHANNEL, arg: undefined },
            ]);
        });

        it('resolves to the string array returned by main', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(GAME_PREDICTABLE_TYPES_CHANNEL, [
                'tactics:move',
                'tactics:rotate',
            ]);
            const api = createGameApi(stub.port);

            const result = await api.getPredictableActionTypes();

            expect(result).toEqual(['tactics:move', 'tactics:rotate']);
        });

        it('resolves to an empty array when main returns nothing (no registry)', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(GAME_PREDICTABLE_TYPES_CHANNEL, []);
            const api = createGameApi(stub.port);

            const result = await api.getPredictableActionTypes();

            expect(result).toEqual([]);
        });

        it('throws PreloadIpcValidationError when main returns a non-array', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(GAME_PREDICTABLE_TYPES_CHANNEL, 42);
            const api = createGameApi(stub.port);

            await expect(api.getPredictableActionTypes()).rejects.toThrow(
                PreloadIpcValidationError,
            );
        });

        it('throws PreloadIpcValidationError when main returns an array containing non-strings', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(GAME_PREDICTABLE_TYPES_CHANNEL, ['ok', 99, null]);
            const api = createGameApi(stub.port);

            await expect(api.getPredictableActionTypes()).rejects.toThrow(
                PreloadIpcValidationError,
            );
        });
    });

    describe('getCurrentSnapshot()', () => {
        it('invokes chimera:game:get-current-snapshot with no argument', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(GAME_GET_CURRENT_SNAPSHOT_CHANNEL, null);
            const api = createGameApi(stub.port);

            await api.getCurrentSnapshot();

            expect(stub.invocations).toEqual([
                { channel: GAME_GET_CURRENT_SNAPSHOT_CHANNEL, arg: undefined },
            ]);
        });

        it('returns the PlayerSnapshot supplied by main', async () => {
            const stub = makeIpcStub();
            const snapshot = makeSnapshot();
            stub.invokeResults.set(GAME_GET_CURRENT_SNAPSHOT_CHANNEL, snapshot);
            const api = createGameApi(stub.port);

            const result = await api.getCurrentSnapshot();

            expect(result).toBe(snapshot);
        });

        it('returns null when main replies null', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(GAME_GET_CURRENT_SNAPSHOT_CHANNEL, null);
            const api = createGameApi(stub.port);

            const result = await api.getCurrentSnapshot();

            expect(result).toBeNull();
        });

        it('returns null when main replies undefined', async () => {
            const stub = makeIpcStub();
            const api = createGameApi(stub.port);

            const result = await api.getCurrentSnapshot();

            expect(result).toBeNull();
        });
    });
});
