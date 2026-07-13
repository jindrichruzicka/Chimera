// renderer/components/chat/ChatPanel.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import {
    act,
    cleanup,
    fireEvent,
    render as baseRender,
    screen,
    waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import chatPanelCss from './ChatPanel.module.css?raw';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TranslationBundle } from '../../i18n/translation-bundle';
import { useChatStore } from '../../state/chatStore';
import { useLobbyStore } from '../../state/lobbyStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { useToastStore } from '../../state/toastStore';
import type { ChatMessage } from '@chimera-engine/simulation/foundation/chat.js';
import type { PlayerId } from '@chimera-engine/simulation/bridge/api-types.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

// ChatPanel reads its strings through useTranslate(), which throws outside an
// I18nProvider. Mount it inert (engine English, en-US) for every render so the
// default-locale text assertions below stay identical to the ship strings. A
// `gameOverride` bundle can be passed to prove the game-override seam.
function render(
    ui: React.ReactElement,
    gameOverride?: TranslationBundle,
): ReturnType<typeof baseRender> {
    // Spread `gameOverride` only when supplied: I18nProviderProps declares it
    // optional and the tree compiles with exactOptionalPropertyTypes, so an
    // explicit `undefined` is rejected.
    const providerProps = gameOverride !== undefined ? { gameOverride } : {};
    return baseRender(<I18nProvider {...providerProps}>{ui}</I18nProvider>);
}

/** Cast a raw string to the branded {@link PlayerId} (test-only). */
function pid(raw: string): PlayerId {
    return raw as unknown as PlayerId;
}

/** Pull the declaration block for `selector` out of a raw CSS module source. */
function extractDeclarations(source: string, selector: string): string {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(source);

    if (match?.[1] === undefined) {
        throw new Error(`Missing rule for selector "${selector}"`);
    }

    return match[1];
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

    // ── Caption (accessible label) ──────────────────────────────────────────────

    it("defaults the panel's accessible label to 'Chat'", async () => {
        render(<ChatPanel />);
        await waitUntilReady();

        expect(screen.getByTestId('chat-panel')).toHaveAttribute('aria-label', 'Chat');
    });

    it('uses the provided title as the panel accessible label', async () => {
        render(<ChatPanel title="Match chat" />);
        await waitUntilReady();

        expect(screen.getByTestId('chat-panel')).toHaveAttribute('aria-label', 'Match chat');
    });

    it('applies the title to the unavailable placeholder too', () => {
        delete (window as unknown as { __chimera?: unknown }).__chimera;

        render(<ChatPanel title="Match chat" />);

        expect(screen.getByTestId('chat-unavailable')).toHaveAttribute('aria-label', 'Match chat');
    });

    it("uses a game's engine.chat.title override as the default accessible label", async () => {
        // No `title` prop: the label falls back to the engine.chat.title token,
        // which a game bundle re-keys — proving the override seam (Invariant
        // #80/#94: the override arrives via the provider, not a game import).
        render(<ChatPanel />, { 'engine.chat.title': 'Comms' });
        await waitUntilReady();

        expect(screen.getByTestId('chat-panel')).toHaveAttribute('aria-label', 'Comms');
    });

    it("lets an explicit title prop win over a game's engine.chat.title override", async () => {
        render(<ChatPanel title="Match chat" />, { 'engine.chat.title': 'Comms' });
        await waitUntilReady();

        expect(screen.getByTestId('chat-panel')).toHaveAttribute('aria-label', 'Match chat');
    });

    it('reads the messages region accessible label from engine.chat.messagesAriaLabel', async () => {
        useChatStore.setState({
            messages: [makeMessage({ id: 'm-1', body: 'hi' })],
            muted: new Set<PlayerId>(),
        });

        render(<ChatPanel />, { 'engine.chat.messagesAriaLabel': 'Match log' });
        await waitUntilReady();

        expect(screen.getByRole('region', { name: 'Match log' })).toBeInTheDocument();
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

    // ── Auto-scroll ────────────────────────────────────────────────────────────

    it('scrolls the message list to the bottom when a new message arrives', async () => {
        useChatStore.setState({
            messages: [makeMessage({ id: 'm-1', body: 'first' })],
            muted: new Set<PlayerId>(),
        });

        render(<ChatPanel />);
        await waitUntilReady();

        // jsdom has no layout, so give the scroller a synthetic content height.
        const scroller = screen.getByRole('region', { name: 'Chat messages' });
        Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 480 });
        const push = chatMock.onMessage.mock.calls[0]![0] as (msg: ChatMessage) => void;

        act(() => {
            push(makeMessage({ id: 'm-2', fromPlayerId: pid('player-b'), body: 'second' }));
        });

        expect(scroller.scrollTop).toBe(480);
    });

    // ── Layout contract (ChatPanel.module.css) ─────────────────────────────────
    //
    // The panel is height-agnostic: it stretches to whatever block size the host
    // container hands it, the composer pins to the bottom, and the messages
    // region absorbs the leftover space and scrolls internally.

    it('stretches to the host container and delegates leftover space to messages', () => {
        const root = extractDeclarations(chatPanelCss, '.root');
        expect(root).toContain('block-size: 100%');
        expect(root).toContain('flex-direction: column');

        const messages = extractDeclarations(chatPanelCss, '.messages');
        expect(messages).toContain('flex: 1 1 auto');
        expect(messages).toContain('min-block-size: 0');
    });

    it('lets the messages scroller fill its region instead of the shared ScrollArea cap', () => {
        expect(extractDeclarations(chatPanelCss, '.messages .scroll')).toContain(
            'max-block-size: 100%',
        );
    });
});
