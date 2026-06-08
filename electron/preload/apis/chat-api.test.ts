import { describe, expect, it, vi } from 'vitest';

import {
    CHAT_HISTORY_CHANNEL,
    CHAT_MESSAGE_CHANNEL,
    CHAT_MUTE_CHANNEL,
    CHAT_SEND_CHANNEL,
    CHAT_UNMUTE_CHANNEL,
    createChatApi,
    type ChatApiIpcPort,
} from './chat-api.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';
import type { ChatMessage, ChatScope, RelayResult } from '../api-types.js';
import { playerId } from '../api-types.js';
import type { IpcListener } from '../shared/listener.js';

// ─── IPC stub ─────────────────────────────────────────────────────────────────

function makeIpcStub(): {
    readonly port: ChatApiIpcPort;
    readonly invocations: { channel: string; args: readonly unknown[] }[];
    readonly sends: { channel: string; args: readonly unknown[] }[];
    readonly listeners: Map<string, Set<IpcListener>>;
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const sends: { channel: string; args: readonly unknown[] }[] = [];
    const listeners = new Map<string, Set<IpcListener>>();
    const invokeResults = new Map<string, unknown>();

    const port: ChatApiIpcPort = {
        invoke: (channel, ...args) => {
            invocations.push({ channel, args });
            return Promise.resolve(invokeResults.get(channel));
        },
        send: (channel, ...args) => {
            sends.push({ channel, args });
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

    return { port, invocations, sends, listeners, invokeResults };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        id: 'msg-1',
        fromPlayerId: playerId('p1'),
        scope: { kind: 'lobby' },
        body: 'hello',
        serverTime: 1,
        ...overrides,
    };
}

const LOBBY_SCOPE: ChatScope = { kind: 'lobby' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createChatApi', () => {
    describe('send()', () => {
        it('invokes chimera:chat:send with { body, scope }', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(CHAT_SEND_CHANNEL, { ok: true });
            const api = createChatApi(stub.port);

            await api.send('hi', LOBBY_SCOPE);

            expect(stub.invocations).toEqual([
                { channel: CHAT_SEND_CHANNEL, args: [{ body: 'hi', scope: LOBBY_SCOPE }] },
            ]);
        });

        it('resolves to the RelayResult returned by main', async () => {
            const stub = makeIpcStub();
            const expected: RelayResult = { ok: false, reason: 'rate_limited' };
            stub.invokeResults.set(CHAT_SEND_CHANNEL, expected);
            const api = createChatApi(stub.port);

            const result = await api.send('spam', LOBBY_SCOPE);

            expect(result).toStrictEqual(expected);
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed result', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(CHAT_SEND_CHANNEL, { ok: false, reason: 'nonsense' });
            const api = createChatApi(stub.port);

            await expect(api.send('x', LOBBY_SCOPE)).rejects.toBeInstanceOf(
                PreloadIpcValidationError,
            );
        });
    });

    describe('onMessage()', () => {
        it('registers a listener on chimera:chat:message', () => {
            const stub = makeIpcStub();
            const api = createChatApi(stub.port);

            api.onMessage(vi.fn());

            expect(stub.listeners.get(CHAT_MESSAGE_CHANNEL)?.size).toBe(1);
        });

        it('forwards a validated message to the callback', () => {
            const stub = makeIpcStub();
            const api = createChatApi(stub.port);
            const cb = vi.fn<(message: ChatMessage) => void>();
            api.onMessage(cb);

            const message = makeMessage();
            const listener = [...(stub.listeners.get(CHAT_MESSAGE_CHANNEL) ?? [])][0];
            listener?.({ sender: 'fake' }, message);

            expect(cb).toHaveBeenCalledOnce();
            expect(cb).toHaveBeenCalledWith(message);
        });

        it('throws PreloadIpcValidationError when main pushes a malformed message', () => {
            const stub = makeIpcStub();
            const api = createChatApi(stub.port);
            api.onMessage(vi.fn());

            const listener = [...(stub.listeners.get(CHAT_MESSAGE_CHANNEL) ?? [])][0];

            expect(() => listener?.({ sender: 'fake' }, { id: 'broken' })).toThrow(
                PreloadIpcValidationError,
            );
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createChatApi(stub.port);

            const unsubscribe = api.onMessage(vi.fn());
            expect(stub.listeners.get(CHAT_MESSAGE_CHANNEL)?.size).toBe(1);
            unsubscribe();
            expect(stub.listeners.get(CHAT_MESSAGE_CHANNEL)?.size).toBe(0);
        });
    });

    describe('history()', () => {
        it('invokes chimera:chat:history with the requested bound', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(CHAT_HISTORY_CHANNEL, []);
            const api = createChatApi(stub.port);

            await api.history(10);

            expect(stub.invocations).toEqual([
                { channel: CHAT_HISTORY_CHANNEL, args: [{ maxEntries: 10 }] },
            ]);
        });

        it('invokes chimera:chat:history with no bound when maxEntries is omitted', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(CHAT_HISTORY_CHANNEL, []);
            const api = createChatApi(stub.port);

            await api.history();

            expect(stub.invocations[0]?.channel).toBe(CHAT_HISTORY_CHANNEL);
        });

        it('resolves to the message list returned by main', async () => {
            const stub = makeIpcStub();
            const list = [makeMessage({ id: 'a' }), makeMessage({ id: 'b' })];
            stub.invokeResults.set(CHAT_HISTORY_CHANNEL, list);
            const api = createChatApi(stub.port);

            const result = await api.history();

            expect(result).toStrictEqual(list);
        });

        it('rejects with PreloadIpcValidationError when main returns a non-array', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(CHAT_HISTORY_CHANNEL, 'not-a-list');
            const api = createChatApi(stub.port);

            await expect(api.history()).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('mute() / unmute()', () => {
        it('mute sends chimera:chat:mute with { playerId }', () => {
            const stub = makeIpcStub();
            const api = createChatApi(stub.port);

            api.mute(playerId('p2'));

            expect(stub.sends).toEqual([
                { channel: CHAT_MUTE_CHANNEL, args: [{ playerId: playerId('p2') }] },
            ]);
        });

        it('unmute sends chimera:chat:unmute with { playerId }', () => {
            const stub = makeIpcStub();
            const api = createChatApi(stub.port);

            api.unmute(playerId('p2'));

            expect(stub.sends).toEqual([
                { channel: CHAT_UNMUTE_CHANNEL, args: [{ playerId: playerId('p2') }] },
            ]);
        });

        it('mute / unmute return void', () => {
            const stub = makeIpcStub();
            const api = createChatApi(stub.port);

            expect(api.mute(playerId('p2'))).toBeUndefined();
            expect(api.unmute(playerId('p2'))).toBeUndefined();
        });
    });
});
