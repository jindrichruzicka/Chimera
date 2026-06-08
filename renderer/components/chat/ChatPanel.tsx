'use client';

// renderer/components/chat/ChatPanel.tsx
//
// Shared chat UI (§4.29 — Chat System). Renders the renderer `chatStore`
// rolling buffer, hides muted senders at render time, subscribes to the host
// push channel (`window.__chimera.chat.onMessage`) and feeds it into the store,
// and provides a send box with a scope selector.
//
// This is a game-agnostic shared component: it imports nothing from `games/*` and
// never derives content from authoritative simulation state. Chat is a cosmetic
// side channel (Invariant #72) and is routed through the host relay (Invariant
// #73) — this component never messages peers directly.
//
// Scope selector:
//   - lobby   → sends directly.
//   - private → reveals a recipient picker built from the lobby roster (minus
//               self); the selection resolves to a branded `PlayerId`.
//   - team    → shown but disabled: no team-membership model exists in the
//               renderer yet and host-side `teamOf` defaults to "no team".
//
// Task: F45 / T05 (issue #683)

import React, { useEffect, useMemo, useState } from 'react';
import { IconButton } from '../ui/IconButton';
import { ScrollArea } from '../ui/ScrollArea';
import { Select } from '../ui/Select';
import type { SelectOption } from '../ui/Select';
import { TextInput } from '../ui/TextInput';
import { useChatStore } from '../../state/chatStore';
import { useLobbyStore } from '../../state/lobbyStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import type { ChatMessage, ChatRejectReason } from '@chimera/shared/chat.js';
import type { LobbyState } from '@chimera/shared/messages-schemas.js';
import { playerId, type ChatScope, type PlayerId } from '@chimera/electron/preload/api-types.js';
import styles from './ChatPanel.module.css';

type ScopeKind = ChatScope['kind'];

/** Scope-selector options; `team` is disabled until team membership is modelled. */
const SCOPE_OPTIONS: readonly SelectOption[] = [
    { value: 'lobby', label: 'Lobby' },
    { value: 'team', label: 'Team (coming soon)', disabled: true },
    { value: 'private', label: 'Private' },
];

/** Friendly, inline copy for a relay rejection (toast wiring is F46 #646). */
const REJECT_REASON_LABELS: Record<ChatRejectReason, string> = {
    too_long: 'Message is too long.',
    rate_limited: 'You are sending messages too quickly.',
    empty: 'Message cannot be empty.',
    invalid_scope: 'That recipient is unavailable.',
    no_session: 'You are not connected to a session.',
};

/** Stable empty roster reference so the selector default keeps a steady identity. */
const EMPTY_ROSTER: LobbyState['players'] = [];

export function ChatPanel(): React.ReactElement {
    const messages = useChatStore((state) => state.messages);
    const muted = useChatStore((state) => state.muted);
    const roster = useLobbyStore((state) => state.lobbyState?.players ?? EMPTY_ROSTER);
    const localPlayerId = useLobbyUiStore((state) => state.localPlayerId);

    const bridgeAvailable = Boolean(window.__chimera?.chat);
    const [isLoading, setIsLoading] = useState<boolean>(bridgeAvailable);
    const [scopeKind, setScopeKind] = useState<ScopeKind>('lobby');
    const [recipientId, setRecipientId] = useState<string>('');
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

    const recipientOptions = useMemo<readonly SelectOption[]>(() => {
        const others = roster.filter((player) => player.playerId !== localPlayerId);
        return [
            {
                value: '',
                label: others.length === 0 ? 'No recipients available' : 'Select recipient…',
                disabled: true,
            },
            ...others.map((player) => ({
                value: player.playerId,
                label: player.displayName || player.playerId,
            })),
        ];
    }, [roster, localPlayerId]);

    const visibleMessages = useMemo(
        () => messages.filter((message) => !muted.has(message.fromPlayerId)),
        [messages, muted],
    );
    const mutedSenders = useMemo(() => Array.from(muted), [muted]);

    function buildScope(): ChatScope | null {
        if (scopeKind === 'lobby') {
            return { kind: 'lobby' };
        }
        if (scopeKind === 'private') {
            const recipient = roster.find((player) => player.playerId === recipientId);
            // Roster `playerId` is a raw string (lobby Zod schema); promote it to
            // the branded `PlayerId` the scope requires via the authorised cast site.
            return recipient ? { kind: 'private', toPlayerId: playerId(recipient.playerId) } : null;
        }
        return null; // team is disabled / not yet routable
    }

    const trimmedBody = body.trim();
    const scope = buildScope();

    function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        void submit();
    }

    // Enter sends the message (there is no Send button). Route through the form's
    // submit handler so there is a single send path; skip while an IME candidate
    // is being composed. `submit()` guards empty/unaddressed messages internally.
    function handleBodyKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
        }
    }

    async function submit(): Promise<void> {
        const chat = window.__chimera?.chat;
        if (!chat || trimmedBody === '' || scope === null) {
            return;
        }
        setSendError(null);
        const result = await chat.send(trimmedBody, scope);
        if (result.ok) {
            setBody('');
        } else {
            setSendError(REJECT_REASON_LABELS[result.reason]);
        }
    }

    if (!bridgeAvailable) {
        return (
            <section aria-label="Chat" className={styles['root']} data-testid="chat-unavailable">
                <p className={styles['placeholder']}>Chat is unavailable.</p>
            </section>
        );
    }

    return (
        <section aria-label="Chat" className={styles['root']} data-testid="chat-panel">
            <div className={styles['messages']} data-testid="chat-messages">
                {isLoading ? (
                    <p className={styles['placeholder']} data-testid="chat-loading">
                        Loading messages…
                    </p>
                ) : visibleMessages.length === 0 ? (
                    <p className={styles['placeholder']} data-testid="chat-empty">
                        No messages yet.
                    </p>
                ) : (
                    <ScrollArea aria-label="Chat messages" className={styles['scroll']}>
                        <ul className={styles['list']}>
                            {visibleMessages.map((message) => (
                                <ChatMessageRow
                                    key={message.id}
                                    message={message}
                                    senderName={displayNameOf(message.fromPlayerId)}
                                    onMute={() => {
                                        useChatStore.getState().mute(message.fromPlayerId);
                                    }}
                                />
                            ))}
                        </ul>
                    </ScrollArea>
                )}
            </div>

            {mutedSenders.length > 0 ? (
                <div className={styles['mutedStrip']} data-testid="chat-muted-strip">
                    <span className={styles['mutedLabel']}>Muted:</span>
                    {mutedSenders.map((id) => (
                        <span className={styles['mutedChip']} key={id}>
                            {displayNameOf(id)}
                            <IconButton
                                aria-label={`Unmute ${displayNameOf(id)}`}
                                data-testid={`chat-unmute-${id}`}
                                onClick={() => {
                                    useChatStore.getState().unmute(id);
                                }}
                                variant="ghost"
                            >
                                Unmute
                            </IconButton>
                        </span>
                    ))}
                </div>
            ) : null}

            <form className={styles['composer']} onSubmit={handleSubmit}>
                <div className={styles['selectors']}>
                    <Select
                        className={styles['selector']}
                        data-testid="chat-scope-select"
                        label="Scope"
                        onValueChange={(value) => {
                            setScopeKind(value as ScopeKind);
                        }}
                        options={SCOPE_OPTIONS}
                        value={scopeKind}
                    />
                    {scopeKind === 'private' ? (
                        <Select
                            className={styles['selector']}
                            data-testid="chat-recipient-select"
                            label="Recipient"
                            onValueChange={setRecipientId}
                            options={recipientOptions}
                            value={recipientId}
                        />
                    ) : null}
                </div>
                <TextInput
                    autoComplete="off"
                    data-testid="chat-body-input"
                    label="Message"
                    onKeyDown={handleBodyKeyDown}
                    onValueChange={setBody}
                    placeholder="Type a message and press Enter…"
                    value={body}
                />
                {sendError ? (
                    <p className={styles['error']} data-testid="chat-send-error" role="alert">
                        {sendError}
                    </p>
                ) : null}
            </form>
        </section>
    );
}

interface ChatMessageRowProps {
    readonly message: ChatMessage;
    readonly senderName: string;
    readonly onMute: () => void;
}

function ChatMessageRow({ message, senderName, onMute }: ChatMessageRowProps): React.ReactElement {
    return (
        <li
            className={styles['message']}
            data-from={message.fromPlayerId}
            data-testid="chat-message"
        >
            <span className={styles['author']}>{senderName}</span>
            <span className={styles['body']}>{message.body}</span>
            <IconButton
                aria-label={`Mute ${senderName}`}
                data-testid={`chat-mute-${message.fromPlayerId}`}
                onClick={onMute}
                variant="ghost"
            >
                Mute
            </IconButton>
        </li>
    );
}
