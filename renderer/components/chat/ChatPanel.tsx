'use client';

// renderer/components/chat/ChatPanel.tsx
//
// Shared chat UI (§4.29 — Chat System). Renders the renderer `chatStore`
// rolling buffer, subscribes to the host push channel
// (`window.__chimera.chat.onMessage`) and feeds it into the store, and provides
// a send box. Every message is lobby-scoped.
//
// This panel is a single lobby-scoped send/receive surface: no per-message
// scope selector, no mute/unmute controls. The underlying API deliberately
// keeps more than the UI exposes, available for a future UI: the host relay
// still routes by `ChatScope` (Invariant #73), `window.__chimera.chat.mute`/
// `unmute` still suppress host-side delivery and filter `history()` backfill,
// and the renderer `chatStore` still tracks the `muted` set.
//
// This is a game-agnostic shared component: it imports nothing from `games/*` and
// never derives content from authoritative simulation state. Chat is a cosmetic
// side channel (Invariant #72) and is routed through the host relay (Invariant
// #73) — this component never messages peers directly.
//
// The `title` prop sets the panel's accessible label (default `'Chat'`); games
// override it to name the panel for their context (Tactics → `'Match chat'`). It
// is the accessible name, not a visible heading — a host wrapper (e.g. `Drawer`)
// renders its own visible caption.

import React, { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '../ui/ScrollArea';
import { TextInput } from '../ui/TextInput';
import { CHAT_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import type { TranslationKey } from '../../i18n/translation-bundle';
import { useChatStore } from '../../state/chatStore';
import { useLobbyStore } from '../../state/lobbyStore';
import { useToastStore } from '../../state/toastStore';
import type { ChatMessage, ChatRejectReason } from '@chimera-engine/simulation/foundation/chat.js';
import type { LobbyState } from '@chimera-engine/simulation/foundation/messages-schemas.js';
import type { ChatScope, PlayerId } from '@chimera-engine/simulation/bridge/api-types.js';
import styles from './ChatPanel.module.css';

/**
 * Maps a relay rejection reason to its engine translation token. The resolved
 * English copy is shown next to the composer for every rejection reason;
 * `rate_limited` additionally raises a toast (§4.30 engine-wired source) so the
 * throttle is noticed even if the user has looked away from the composer.
 */
const REJECT_REASON_KEYS: Record<ChatRejectReason, TranslationKey> = {
    too_long: CHAT_KEYS.rejectTooLong,
    rate_limited: CHAT_KEYS.rejectRateLimited,
    empty: CHAT_KEYS.rejectEmpty,
    invalid_scope: CHAT_KEYS.rejectInvalidScope,
    no_session: CHAT_KEYS.rejectNoSession,
};

/** Stable empty roster reference so the selector default keeps a steady identity. */
const EMPTY_ROSTER: LobbyState['players'] = [];

/** Every message sent from this panel is lobby-scoped (stable identity). */
const LOBBY_SCOPE: ChatScope = { kind: 'lobby' };

export interface ChatPanelProps {
    /**
     * Accessible label for the panel's root region. Defaults to `'Chat'`. Games
     * override it to name the panel for their context (e.g. Tactics →
     * `'Match chat'`); this is the panel's accessible name, not a visible
     * heading — a host that wraps the panel (e.g. in a `Drawer`) renders its own
     * visible caption.
     */
    readonly title?: string;
}

export function ChatPanel({ title }: ChatPanelProps = {}): React.ReactElement {
    const t = useTranslate();
    // An explicit `title` prop still wins; otherwise fall back to the engine
    // token so a game can relabel the panel by re-keying `engine.chat.title`.
    const label = title ?? t(CHAT_KEYS.title);
    const messages = useChatStore((state) => state.messages);
    const roster = useLobbyStore((state) => state.lobbyState?.players ?? EMPTY_ROSTER);

    const bridgeAvailable = Boolean(window.__chimera?.chat);
    const [isLoading, setIsLoading] = useState<boolean>(bridgeAvailable);
    const [body, setBody] = useState<string>('');
    const [sendError, setSendError] = useState<string | null>(null);

    // Backfill from history (the loading window), then subscribe to live pushes.
    //
    // We subscribe *before* awaiting history() so no live message can slip
    // through the gap. But history entries are strictly older than anything
    // pushed after we subscribed, and the store never re-sorts (it trusts host
    // delivery order). So pushes that arrive while history() is still pending are
    // parked in `pending` and flushed *after* the backfill, keeping the buffer in
    // `serverTime` order. Id-based dedup guards against a message that is both in
    // history and re-pushed at the boundary.
    useEffect(() => {
        const chat = window.__chimera?.chat;
        if (!chat) {
            return undefined;
        }

        let active = true;
        let backfilled = false;
        const pending: ChatMessage[] = [];

        const append = (incoming: Iterable<ChatMessage>): void => {
            const store = useChatStore.getState();
            const seen = new Set(store.messages.map((m) => m.id));
            for (const message of incoming) {
                if (!seen.has(message.id)) {
                    seen.add(message.id);
                    store.addMessage(message);
                }
            }
        };

        const unsubscribe = chat.onMessage((message) => {
            if (backfilled) {
                append([message]);
            } else {
                pending.push(message);
            }
        });

        const finish = (history: readonly ChatMessage[]): void => {
            if (!active) {
                return;
            }
            append([...history, ...pending]);
            pending.length = 0;
            backfilled = true;
            setIsLoading(false);
        };

        void chat
            .history()
            .then((history) => {
                finish(history);
            })
            .catch(() => {
                // Backfill failed; still flush any live pushes we parked so they
                // are not dropped, and leave the loading state.
                finish([]);
            });

        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    const displayNameOf = (id: PlayerId): string =>
        roster.find((player) => player.playerId === id)?.displayName ?? id;

    // Pin the view to the newest message: whenever one lands (live push or
    // history backfill), scroll the message region to the bottom.
    const messageListRef = useRef<HTMLUListElement | null>(null);
    const lastMessageId = messages[messages.length - 1]?.id;
    useEffect(() => {
        const scroller = messageListRef.current?.closest('[data-ch-scroll-area]');
        if (scroller instanceof HTMLElement) {
            scroller.scrollTop = scroller.scrollHeight;
        }
    }, [lastMessageId]);

    const trimmedBody = body.trim();

    function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        void submit();
    }

    // Enter sends the message (there is no Send button). Route through the form's
    // submit handler so there is a single send path; skip while an IME candidate
    // is being composed. `submit()` guards empty messages internally.
    function handleBodyKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
        }
    }

    async function submit(): Promise<void> {
        const chat = window.__chimera?.chat;
        if (!chat || trimmedBody === '') {
            return;
        }
        setSendError(null);
        const result = await chat.send(trimmedBody, LOBBY_SCOPE);
        if (result.ok) {
            setBody('');
        } else {
            setSendError(t(REJECT_REASON_KEYS[result.reason]));
            if (result.reason === 'rate_limited') {
                // §4.30 engine-wired source: the relay throttled us. Duration is
                // the severity default (Invariant #74); title is a static token.
                useToastStore
                    .getState()
                    .push({ severity: 'warning', title: t(CHAT_KEYS.rateLimitedToast) });
            }
        }
    }

    if (!bridgeAvailable) {
        return (
            <section aria-label={label} className={styles['root']} data-testid="chat-unavailable">
                <p className={styles['placeholder']}>{t(CHAT_KEYS.unavailable)}</p>
            </section>
        );
    }

    return (
        <section aria-label={label} className={styles['root']} data-testid="chat-panel">
            <div className={styles['messages']} data-testid="chat-messages">
                {isLoading ? (
                    <p className={styles['placeholder']} data-testid="chat-loading">
                        {t(CHAT_KEYS.loading)}
                    </p>
                ) : messages.length === 0 ? (
                    <p className={styles['placeholder']} data-testid="chat-empty">
                        {t(CHAT_KEYS.empty)}
                    </p>
                ) : (
                    <ScrollArea
                        aria-label={t(CHAT_KEYS.messagesAriaLabel)}
                        className={styles['scroll']}
                    >
                        <ul className={styles['list']} ref={messageListRef}>
                            {messages.map((message) => (
                                <ChatMessageRow
                                    key={message.id}
                                    message={message}
                                    senderName={displayNameOf(message.fromPlayerId)}
                                />
                            ))}
                        </ul>
                    </ScrollArea>
                )}
            </div>

            <form className={styles['composer']} onSubmit={handleSubmit}>
                {/* The error sits above the input, not below it, so the input
                    keeps its bottom-anchored position when an error appears. */}
                {sendError ? (
                    <p className={styles['error']} data-testid="chat-send-error" role="alert">
                        {sendError}
                    </p>
                ) : null}
                <TextInput
                    autoComplete="off"
                    data-testid="chat-body-input"
                    // The placeholder already names the field, so the label is
                    // kept for assistive tech but hidden from view.
                    hideLabel
                    label={t(CHAT_KEYS.inputLabel)}
                    onKeyDown={handleBodyKeyDown}
                    onValueChange={setBody}
                    placeholder={t(CHAT_KEYS.inputPlaceholder)}
                    value={body}
                />
            </form>
        </section>
    );
}

interface ChatMessageRowProps {
    readonly message: ChatMessage;
    readonly senderName: string;
}

function ChatMessageRow({ message, senderName }: ChatMessageRowProps): React.ReactElement {
    return (
        <li
            className={styles['message']}
            data-from={message.fromPlayerId}
            data-testid="chat-message"
        >
            <span className={styles['author']}>{senderName}</span>
            <span className={styles['body']}>{message.body}</span>
        </li>
    );
}
