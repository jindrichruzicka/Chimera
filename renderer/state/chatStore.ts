/**
 * renderer/state/chatStore.ts
 *
 * Renderer-only Zustand store for the chat message buffer and local mute set.
 *
 * It holds a rolling buffer hard-capped at {@link MAX_CHAT_MESSAGES} entries: when
 * `addMessage` would exceed the cap, the oldest entry is dropped from the head.
 * Ordering follows the host-assigned `serverTime` — messages are appended in the
 * order the host relay delivers them over the single ordered chat channel; the
 * store never sorts and never uses client-local timestamps for ordering. This
 * mirrors the host-side sink `electron/main/ChatHub.ts`.
 *
 * `mute` / `unmute` maintain a separate `muted` set; they are a reversible view
 * filter applied by the UI at render time, not a buffer mutation. The buffer
 * always retains every delivered message, so unmuting restores visibility.
 *
 * Chat is a cosmetic communication channel: this store is renderer-only and its
 * contents are NEVER derived from authoritative simulation state
 * (`GameSnapshot` / `PlayerSnapshot` / `SaveFile`). It is not persisted.
 *
 * Architecture reference: §4.29 — Chat System
 * Task: F45 / T04 (issue #682)
 *
 * Invariants upheld:
 *   #72 — Chat is a cosmetic side channel; chatStore contents are never derived
 *         from authoritative simulation state and never enter ticks/replays/saves.
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { ChatMessage } from '@chimera/shared/chat.js';
import type { PlayerId } from '@chimera/electron/preload/api-types.js';

/** Rolling-buffer hard cap — matches §4.29 (max 500 entries). */
export const MAX_CHAT_MESSAGES = 500;

export interface ChatStore {
    /** Server-ordered rolling buffer, never longer than {@link MAX_CHAT_MESSAGES}. */
    readonly messages: readonly ChatMessage[];
    /** Locally-muted senders; a reversible view filter applied by the UI. */
    readonly muted: ReadonlySet<PlayerId>;
    /** Append a delivered message, trimming the oldest from the head past the cap. */
    addMessage(this: void, msg: ChatMessage): void;
    /** Mute a sender (idempotent). */
    mute(this: void, id: PlayerId): void;
    /** Unmute a sender (no-op when not muted). */
    unmute(this: void, id: PlayerId): void;
}

export function createChatStore(): StoreApi<ChatStore> {
    return createStore<ChatStore>()((set) => ({
        messages: [],
        muted: new Set<PlayerId>(),

        addMessage(msg: ChatMessage): void {
            set((state) => {
                const next = [...state.messages, msg];
                return {
                    messages:
                        next.length > MAX_CHAT_MESSAGES
                            ? next.slice(next.length - MAX_CHAT_MESSAGES)
                            : next,
                };
            });
        },

        mute(id: PlayerId): void {
            set((state) => ({ muted: new Set(state.muted).add(id) }));
        },

        unmute(id: PlayerId): void {
            set((state) => {
                const next = new Set(state.muted);
                next.delete(id);
                return { muted: next };
            });
        },
    }));
}

const chatStoreInstance = createChatStore();

export function useChatStore<TSelected>(selector: (state: ChatStore) => TSelected): TSelected {
    return useStore(chatStoreInstance, selector);
}

useChatStore.getState = chatStoreInstance.getState.bind(chatStoreInstance);
useChatStore.setState = chatStoreInstance.setState.bind(chatStoreInstance);
useChatStore.subscribe = chatStoreInstance.subscribe.bind(chatStoreInstance);
