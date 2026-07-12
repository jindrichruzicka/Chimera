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
 *
 * Invariants upheld:
 *   #72 — Chat is a cosmetic side channel; chatStore contents are never derived
 *         from authoritative simulation state and never enter ticks/replays/saves.
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { ChatMessage } from '@chimera-engine/simulation/foundation/chat.js';
import type { PlayerId } from '@chimera-engine/simulation/bridge/api-types.js';

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

let chatStoreInstance: StoreApi<ChatStore> | undefined;

/**
 * Lazily instantiate the singleton on first access. Importing this module — and
 * the `@chimera-engine/renderer/components/chat` barrel that pulls it through
 * `ChatPanel` — therefore creates no store, keeping the barrel side-effect-free
 * (Invariant #96). Behaviour is otherwise identical to an eager
 * module-level singleton: the same instance is returned on every access.
 */
function getChatStore(): StoreApi<ChatStore> {
    return (chatStoreInstance ??= createChatStore());
}

export function useChatStore<TSelected>(selector: (state: ChatStore) => TSelected): TSelected {
    return useStore(getChatStore(), selector);
}

useChatStore.getState = (): ChatStore => getChatStore().getState();
useChatStore.setState = ((...args: unknown[]): void => {
    (getChatStore().setState as (...a: unknown[]) => void)(...args);
}) as StoreApi<ChatStore>['setState'];
useChatStore.subscribe = ((
    listener: Parameters<StoreApi<ChatStore>['subscribe']>[0],
): (() => void) => getChatStore().subscribe(listener)) as StoreApi<ChatStore>['subscribe'];
