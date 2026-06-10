// renderer/components/chat/ChatPanel.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import { useChatStore } from '../../state/chatStore';
import { useLobbyStore } from '../../state/lobbyStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { useToastStore } from '../../state/toastStore';
import type { ChatMessage } from '@chimera/shared/chat.js';
import type { LobbyState } from '@chimera/shared/messages-schemas.js';
import type { PlayerId } from '@chimera/electron/preload/api-types.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

/** Cast a raw string to the branded {@link PlayerId} (test-only). */
function pid(raw: string): PlayerId {
    return raw as unknown as PlayerId;
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        id: 'm-1',
        fromPlayerId: pid('player-a'),
        scope: { kind: 'lobby' },
        body: 'hello',
        serverTime: 1,
        ...overrides,
    };
}

function makeLobby(players: LobbyState['players']): LobbyState {
    return {
        info: { sessionId: 'session-1', hostId: pid('player-self'), gameId: 'tactics' },
        players,
    };
}

interface ChatMock {
    send: ReturnType<typeof vi.fn>;
    onMessage: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
    mute: ReturnType<typeof vi.fn>;
    unmute: ReturnType<typeof vi.fn>;
}

/** Install a `window.__chimera.chat` double and return it. */
function installChat(overrides: Partial<ChatMock> = {}): ChatMock {
    const mock: ChatMock = {
        send: vi.fn().mockResolvedValue({ ok: true }),
        onMessage: vi.fn().mockReturnValue(vi.fn()),
        history: vi.fn().mockResolvedValue([]),
        mute: vi.fn(),
        unmute: vi.fn(),
        ...overrides,
    };
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: { chat: mock },
    });
    return mock;
}

async function waitUntilReady(): Promise<void> {
    await waitFor(() => expect(screen.queryByTestId('chat-loading')).not.toBeInTheDocument());
}

/** Simulate the user pressing Enter inside the message input to send. */
function pressEnter(input: HTMLElement): void {
    fireEvent.keyDown(input, { key: 'Enter' });
}

let chatMock: ChatMock;

beforeEach(() => {
    useChatStore.setState({ messages: [], muted: new Set<PlayerId>() });
    useLobbyStore.getState().applyLobbyState(null);
    useLobbyUiStore.getState().clearLocalLobbyContext();
    useToastStore.getState().dismissAll();
    chatMock = installChat();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as unknown as { __chimera?: unknown }).__chimera;
});

describe('ChatPanel', () => {
    // ── Loading ──────────────────────────────────────────────────────────────

    it('shows a loading indicator while history is pending', () => {
        installChat({ history: vi.fn(() => new Promise<readonly ChatMessage[]>(() => {})) });

        render(<ChatPanel />);

        expect(screen.getByTestId('chat-loading')).toBeInTheDocument();
    });

    it('renders an unavailable placeholder when the chat bridge is missing', () => {
        delete (window as unknown as { __chimera?: unknown }).__chimera;

        render(<ChatPanel />);

        expect(screen.getByTestId('chat-unavailable')).toBeInTheDocument();
        expect(screen.queryByTestId('chat-loading')).not.toBeInTheDocument();
    });

    // ── Resolved + muted filtering ────────────────────────────────────────────

    it('renders buffered messages from the store once history resolves', async () => {
        useChatStore.setState({
            messages: [
                makeMessage({ id: 'm-1', fromPlayerId: pid('player-a'), body: 'from A' }),
                makeMessage({ id: 'm-2', fromPlayerId: pid('player-b'), body: 'from B' }),
            ],
            muted: new Set<PlayerId>(),
        });

        render(<ChatPanel />);
        await waitUntilReady();

        expect(screen.getByText('from A')).toBeInTheDocument();
        expect(screen.getByText('from B')).toBeInTheDocument();
    });

    it('hides messages from muted senders at render time', async () => {
        useChatStore.setState({
            messages: [
                makeMessage({ id: 'm-1', fromPlayerId: pid('player-a'), body: 'from A' }),
                makeMessage({ id: 'm-2', fromPlayerId: pid('player-b'), body: 'from B' }),
            ],
            muted: new Set<PlayerId>([pid('player-a')]),
        });

        render(<ChatPanel />);
        await waitUntilReady();

        expect(screen.queryByText('from A')).not.toBeInTheDocument();
        expect(screen.getByText('from B')).toBeInTheDocument();
    });

    // ── onMessage subscription ─────────────────────────────────────────────────

    it('subscribes to chat.onMessage and appends pushed messages into the store', async () => {
        render(<ChatPanel />);
        await waitUntilReady();

        expect(chatMock.onMessage).toHaveBeenCalledTimes(1);
        const push = chatMock.onMessage.mock.calls[0]![0] as (msg: ChatMessage) => void;

        act(() => {
            push(makeMessage({ id: 'pushed-1', fromPlayerId: pid('player-c'), body: 'pushed!' }));
        });

        expect(screen.getByText('pushed!')).toBeInTheDocument();
        expect(useChatStore.getState().messages.some((m) => m.id === 'pushed-1')).toBe(true);
    });

    it('unsubscribes from chat.onMessage on unmount', async () => {
        const unsubscribe = vi.fn();
        installChat({ onMessage: vi.fn().mockReturnValue(unsubscribe) });

        const { unmount } = render(<ChatPanel />);
        await waitUntilReady();

        unmount();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    // ── History backfill ───────────────────────────────────────────────────────

    it('backfills history without duplicating messages already in the store', async () => {
        useChatStore.setState({
            messages: [makeMessage({ id: 'h-1', fromPlayerId: pid('player-a'), body: 'existing' })],
            muted: new Set<PlayerId>(),
        });
        installChat({
            history: vi.fn().mockResolvedValue([
                makeMessage({ id: 'h-1', fromPlayerId: pid('player-a'), body: 'existing' }),
                makeMessage({
                    id: 'h-2',
                    fromPlayerId: pid('player-b'),
                    body: 'new from history',
                    serverTime: 2,
                }),
            ]),
        });

        render(<ChatPanel />);
        await waitUntilReady();

        expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['h-1', 'h-2']);
        expect(screen.getByText('new from history')).toBeInTheDocument();
    });

    it('clears the loading state when history() rejects', async () => {
        installChat({ history: vi.fn().mockRejectedValue(new Error('ipc failed')) });

        render(<ChatPanel />);
        await waitUntilReady();

        expect(screen.getByTestId('chat-empty')).toBeInTheDocument();
    });

    it('orders backfilled history before live pushes that arrive during loading', async () => {
        let resolveHistory!: (messages: readonly ChatMessage[]) => void;
        const pending = new Promise<readonly ChatMessage[]>((resolve) => {
            resolveHistory = resolve;
        });
        const mock = installChat({ history: vi.fn(() => pending) });

        render(<ChatPanel />);
        const push = mock.onMessage.mock.calls[0]![0] as (msg: ChatMessage) => void;

        // A live push lands while history() is still in flight.
        act(() => {
            push(
                makeMessage({
                    id: 'live-1',
                    fromPlayerId: pid('player-c'),
                    body: 'live',
                    serverTime: 10,
                }),
            );
        });

        // The (older) history then resolves — it must sort ahead of the live push.
        await act(async () => {
            resolveHistory([
                makeMessage({ id: 'h-1', fromPlayerId: pid('player-a'), serverTime: 1 }),
                makeMessage({ id: 'h-2', fromPlayerId: pid('player-b'), serverTime: 2 }),
            ]);
            await pending;
        });
        await waitUntilReady();

        expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['h-1', 'h-2', 'live-1']);
    });

    // ── Send dispatch ────────────────────────────────────────────────────────

    it('renders no send button (Enter submits the composer)', async () => {
        render(<ChatPanel />);
        await waitUntilReady();

        expect(screen.queryByTestId('chat-send')).not.toBeInTheDocument();
    });

    it('sends a lobby-scoped message on Enter and clears the input on success', async () => {
        render(<ChatPanel />);
        await waitUntilReady();

        const input = screen.getByTestId('chat-body-input');
        fireEvent.change(input, { target: { value: 'hi everyone' } });
        pressEnter(input);

        expect(chatMock.send).toHaveBeenCalledWith('hi everyone', { kind: 'lobby' });
        await waitFor(() => expect(input).toHaveValue(''));
    });

    it('sends a private-scoped message to the selected recipient', async () => {
        useLobbyUiStore.getState().setLocalLobbyContext(pid('player-self'), [pid('player-self')]);
        useLobbyStore.getState().applyLobbyState(
            makeLobby([
                { playerId: pid('player-self'), displayName: 'Me', ready: true },
                { playerId: pid('player-b'), displayName: 'Bob', ready: true },
            ]),
        );

        render(<ChatPanel />);
        await waitUntilReady();

        fireEvent.change(screen.getByTestId('chat-scope-select'), { target: { value: 'private' } });
        fireEvent.change(screen.getByTestId('chat-recipient-select'), {
            target: { value: 'player-b' },
        });
        const input = screen.getByTestId('chat-body-input');
        fireEvent.change(input, { target: { value: 'psst' } });
        pressEnter(input);

        expect(chatMock.send).toHaveBeenCalledWith('psst', {
            kind: 'private',
            toPlayerId: 'player-b',
        });
    });

    it('does not dispatch when the body is empty', async () => {
        render(<ChatPanel />);
        await waitUntilReady();

        pressEnter(screen.getByTestId('chat-body-input'));

        expect(chatMock.send).not.toHaveBeenCalled();
    });

    it('surfaces the rejection reason inline when send is rejected', async () => {
        const mock = installChat({
            send: vi.fn().mockResolvedValue({ ok: false, reason: 'too_long' }),
        });

        render(<ChatPanel />);
        await waitUntilReady();

        const input = screen.getByTestId('chat-body-input');
        fireEvent.change(input, { target: { value: 'a very long message' } });
        pressEnter(input);

        expect(mock.send).toHaveBeenCalled();
        expect(await screen.findByTestId('chat-send-error')).toHaveTextContent(/too long/i);
    });

    // ── Rate-limit toast (§4.30 engine-wired source) ───────────────────────────

    it('pushes a warning toast when a send is rate-limited', async () => {
        installChat({
            send: vi.fn().mockResolvedValue({ ok: false, reason: 'rate_limited' }),
        });

        render(<ChatPanel />);
        await waitUntilReady();

        const input = screen.getByTestId('chat-body-input');
        fireEvent.change(input, { target: { value: 'spam spam spam' } });
        pressEnter(input);

        await waitFor(() => expect(useToastStore.getState().queue).toHaveLength(1));
        const toast = useToastStore.getState().queue[0]!;
        expect(toast.severity).toBe('warning');
        expect(toast.title).toBe('Sending messages too quickly');
    });

    it('does not push a toast for non-rate-limit send rejections', async () => {
        installChat({
            send: vi.fn().mockResolvedValue({ ok: false, reason: 'too_long' }),
        });

        render(<ChatPanel />);
        await waitUntilReady();

        const input = screen.getByTestId('chat-body-input');
        fireEvent.change(input, { target: { value: 'a very long message' } });
        pressEnter(input);

        expect(await screen.findByTestId('chat-send-error')).toBeInTheDocument();
        expect(useToastStore.getState().queue).toHaveLength(0);
    });

    // ── Scope selector ─────────────────────────────────────────────────────────

    it('renders the team scope option as disabled', async () => {
        render(<ChatPanel />);
        await waitUntilReady();

        const teamOption = screen.getByRole('option', { name: /team/i });
        expect(teamOption).toBeDisabled();
    });

    // ── Mute toggle ──────────────────────────────────────────────────────────

    it('mutes a sender from the message list, hiding their messages', async () => {
        useChatStore.setState({
            messages: [
                makeMessage({ id: 'm-1', fromPlayerId: pid('player-a'), body: 'from A' }),
                makeMessage({ id: 'm-2', fromPlayerId: pid('player-b'), body: 'from B' }),
            ],
            muted: new Set<PlayerId>(),
        });

        render(<ChatPanel />);
        await waitUntilReady();

        expect(screen.getByText('from A')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('chat-mute-player-a'));

        expect(screen.queryByText('from A')).not.toBeInTheDocument();
        expect(screen.getByText('from B')).toBeInTheDocument();
        expect(useChatStore.getState().muted.has(pid('player-a'))).toBe(true);
        // Mute also propagates to the main-process ChatHub over IPC so it
        // suppresses further delivery and filters history() — not only a
        // renderer-side render filter.
        expect(chatMock.mute).toHaveBeenCalledWith(pid('player-a'));
    });

    it('unmutes a sender from the muted strip, restoring their messages', async () => {
        useChatStore.setState({
            messages: [makeMessage({ id: 'm-1', fromPlayerId: pid('player-a'), body: 'from A' })],
            muted: new Set<PlayerId>([pid('player-a')]),
        });

        render(<ChatPanel />);
        await waitUntilReady();

        expect(screen.queryByText('from A')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('chat-unmute-player-a'));

        expect(screen.getByText('from A')).toBeInTheDocument();
        expect(useChatStore.getState().muted.has(pid('player-a'))).toBe(false);
        // Unmute is mirrored to the main-process ChatHub over IPC so delivery
        // and history() are restored there too.
        expect(chatMock.unmute).toHaveBeenCalledWith(pid('player-a'));
    });
});
