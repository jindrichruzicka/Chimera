// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@chimera/simulation/foundation/chat.js';
import type { PlayerId } from '@chimera/electron/preload/api-types.js';

import { createChatStore, MAX_CHAT_MESSAGES, useChatStore } from './chatStore';

const p = (raw: string): PlayerId => raw as PlayerId;

/** Build a ChatMessage with sensible defaults and per-call overrides. */
function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        id: 'm-0',
        fromPlayerId: p('p1'),
        scope: { kind: 'lobby' },
        body: 'hello',
        serverTime: 0,
        ...overrides,
    };
}

describe('chatStore', () => {
    it('exposes 500 as the rolling-buffer cap', () => {
        expect(MAX_CHAT_MESSAGES).toBe(500);
    });

    it('starts with an empty buffer and no muted players', () => {
        const store = createChatStore();

        expect(store.getState().messages).toEqual([]);
        expect(store.getState().muted.size).toBe(0);
    });

    describe('addMessage', () => {
        it('appends messages in arrival order', () => {
            const store = createChatStore();

            store.getState().addMessage(makeMessage({ id: 'm-1', serverTime: 10 }));
            store.getState().addMessage(makeMessage({ id: 'm-2', serverTime: 20 }));
            store.getState().addMessage(makeMessage({ id: 'm-3', serverTime: 30 }));

            expect(store.getState().messages.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3']);
        });

        it('caps the buffer at 500 entries, dropping the oldest from the head', () => {
            const store = createChatStore();

            for (let i = 0; i < MAX_CHAT_MESSAGES; i++) {
                store.getState().addMessage(makeMessage({ id: `m-${i}`, serverTime: i }));
            }
            expect(store.getState().messages).toHaveLength(MAX_CHAT_MESSAGES);

            store.getState().addMessage(makeMessage({ id: 'm-overflow', serverTime: 1_000 }));

            const { messages } = store.getState();
            expect(messages).toHaveLength(MAX_CHAT_MESSAGES);
            // The original head (m-0) is dropped; the next entry becomes the head.
            expect(messages[0]?.id).toBe('m-1');
            // The newest entry sits at the tail.
            expect(messages[messages.length - 1]?.id).toBe('m-overflow');
        });

        it('does not mutate the previous messages array reference', () => {
            const store = createChatStore();
            store.getState().addMessage(makeMessage({ id: 'm-1' }));
            const before = store.getState().messages;

            store.getState().addMessage(makeMessage({ id: 'm-2' }));

            expect(store.getState().messages).not.toBe(before);
            expect(before.map((m) => m.id)).toEqual(['m-1']);
        });
    });

    describe('mute / unmute', () => {
        it('mute adds the player to the muted set immutably', () => {
            const store = createChatStore();
            const before = store.getState().muted;

            store.getState().mute(p('p1'));

            const after = store.getState().muted;
            expect(after.has(p('p1'))).toBe(true);
            expect(after).not.toBe(before);
            expect(before.size).toBe(0);
        });

        it('muting the same player twice is idempotent', () => {
            const store = createChatStore();

            store.getState().mute(p('p1'));
            store.getState().mute(p('p1'));

            expect(store.getState().muted.size).toBe(1);
            expect(store.getState().muted.has(p('p1'))).toBe(true);
        });

        it('unmute removes the player from the muted set immutably', () => {
            const store = createChatStore();
            store.getState().mute(p('p1'));
            store.getState().mute(p('p2'));
            const before = store.getState().muted;

            store.getState().unmute(p('p1'));

            const after = store.getState().muted;
            expect(after.has(p('p1'))).toBe(false);
            expect(after.has(p('p2'))).toBe(true);
            expect(after).not.toBe(before);
            expect(before.has(p('p1'))).toBe(true);
        });

        it('unmuting a player who is not muted is a no-op', () => {
            const store = createChatStore();

            store.getState().unmute(p('p1'));

            expect(store.getState().muted.size).toBe(0);
        });

        it('mute and unmute leave the message buffer untouched', () => {
            const store = createChatStore();
            store.getState().addMessage(makeMessage({ id: 'm-1', fromPlayerId: p('p1') }));
            const messagesBefore = store.getState().messages;

            store.getState().mute(p('p1'));
            store.getState().unmute(p('p1'));

            expect(store.getState().messages).toBe(messagesBefore);
            expect(store.getState().messages.map((m) => m.id)).toEqual(['m-1']);
        });
    });

    describe('useChatStore hook', () => {
        beforeEach(() => {
            useChatStore.setState({ messages: [], muted: new Set<PlayerId>() });
        });

        it('returns an empty buffer on initial render', () => {
            const { result } = renderHook(() => useChatStore((s) => s.messages));

            expect(result.current).toEqual([]);
        });

        it('re-renders the consumer when a message is added', () => {
            const { result } = renderHook(() => useChatStore((s) => s.messages));

            act(() => {
                useChatStore.getState().addMessage(makeMessage({ id: 'm-1' }));
            });

            expect(result.current).toHaveLength(1);
            expect(result.current[0]?.id).toBe('m-1');
        });

        it('re-renders the consumer when a player is muted and unmuted', () => {
            const { result } = renderHook(() => useChatStore((s) => s.muted));

            act(() => {
                useChatStore.getState().mute(p('p1'));
            });
            expect(result.current.has(p('p1'))).toBe(true);

            act(() => {
                useChatStore.getState().unmute(p('p1'));
            });
            expect(result.current.has(p('p1'))).toBe(false);
        });
    });
});
