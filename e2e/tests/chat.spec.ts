/**
 * F45 / M8 — chat.spec.ts (#685)
 * §13.8 Core E2E Test Specifications · §4.29 Chat System
 *
 * End-to-end coverage of the Tactics chat lifecycle through the real renderer +
 * main IPC + host-relay path (not mocks), in both a lobby and a live match:
 *   - lobby-scope send/receive across host and client;
 *   - mute hides a sender's messages, unmute restores them;
 *   - rate-limit rejection once messagesPerMinute is exceeded;
 *   - the 500-entry rolling-buffer cap;
 *   - in-match send/receive across clients (chat drawer);
 *   - Invariant #72: chat never advances `tick` and is absent from the replay.
 *
 * Cross-client chat rides the LocalWebSocketProvider side-channel: the client
 * sends a CHAT frame to the host, the host ChatRelay is the sole gate
 * (Invariant #73), and accepted messages fan back out to recipients. The host is
 * not in the PlayerDirectory (it never JOINs); it is added as a lobby-scope
 * recipient at the delivery layer (LobbyManager.deliverChat), so it sees its own
 * and clients' lobby messages.
 *
 * Invariants asserted:
 *   #72 — chat does not advance `tick` and never enters ActionHistory / replays.
 *   #73 — exercised implicitly: all delivery flows through the host relay.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Page, ElectronApplication } from '@playwright/test';
import { test as lobbyTest, expect } from '../fixtures/lobby.fixture';
import { test as gameTest } from '../fixtures/game.fixture';
import { ChatPanelPage } from '../pages/ChatPanelPage';
import { LobbyPage } from '../pages/LobbyPage';
import { GamePage } from '../pages/GamePage';
import { getSimulationTick } from '../helpers/ipc-spy';

const TACTICS_GAME_ID = 'tactics';

// ── Renderer / main bridge shapes (typed locally; the e2e tsconfig is DOM-less) ──

interface RelayResultShape {
    readonly ok: boolean;
    readonly reason?: string;
}

interface ChatScopeShape {
    readonly kind: string;
    readonly toPlayerId?: string;
    readonly teamId?: string;
}

interface ChimeraChatGlobal {
    readonly __chimera: {
        readonly chat: {
            send(body: string, scope: ChatScopeShape): Promise<RelayResultShape>;
        };
    };
}

interface DeliverChatMessage {
    readonly id: string;
    readonly fromPlayerId: string;
    readonly scope: { readonly kind: 'lobby' };
    readonly body: string;
    readonly serverTime: number;
}

interface E2eHookChatGlobal {
    readonly __e2eHooks?: {
        deliverChat(message: DeliverChatMessage): void;
    };
}

interface ReplayListEntry {
    readonly path: string;
}

interface ChimeraReplayGlobal {
    readonly __chimera: {
        readonly replay: {
            list(gameId: string): Promise<readonly ReplayListEntry[]>;
        };
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Host creates a lobby and the client joins; returns both resolved PlayerIds. */
async function openSharedLobby(
    hostWindow: Page,
    clientWindow: Page,
): Promise<{ readonly hostId: string; readonly clientId: string }> {
    const hostLobby = new LobbyPage(hostWindow);
    const clientLobby = new LobbyPage(clientWindow);

    await hostLobby.hostLobby();
    const lobbyCode = await hostLobby.lobbyCode();
    await clientLobby.joinLobby(lobbyCode);
    await hostLobby.waitForPlayerCount(2);
    await clientLobby.waitForPlayerCount(2);

    const hostId = await hostLobby.localPlayerId();
    const clientId = await clientLobby.localPlayerId();
    if (!hostId || !clientId) {
        throw new Error('Could not resolve host/client player IDs from the lobby roster');
    }
    return { hostId, clientId };
}

/** Drive the host to game-over through the canonical move + attack flow. */
async function playToGameOver(hostGame: GamePage): Promise<void> {
    await hostGame.assertOwnedSelectionFeedbackChangesCanvas();
    await hostGame.moveSelectedPrimitiveNearOpponent();
    await hostGame.attackAdjacentEnemy();
    await expect(hostGame.gameResultBanner).toBeVisible({ timeout: 60_000 });
}

/** Reach the post-game summary (Enter acts as "continue" once the match resolves). */
async function goToPostGameSummary(hostWindow: Page, hostGame: GamePage): Promise<void> {
    await expect.poll(() => hostGame.activeSceneId(), { timeout: 15_000 }).toBe('engine:game');
    await hostWindow.keyboard.press('Enter');
    await expect.poll(() => hostGame.activeScreenKey(), { timeout: 15_000 }).toBe('summary');
    await expect(hostGame.postGameSummary).toBeVisible();
}

/** Send chat through the renderer IPC bridge without opening the in-match drawer. */
async function sendChatViaBridge(window: Page, body: string): Promise<RelayResultShape> {
    return window.evaluate(
        (text) =>
            (globalThis as unknown as ChimeraChatGlobal).__chimera.chat.send(text, {
                kind: 'lobby',
            }),
        body,
    );
}

/**
 * Read a saved deterministic replay: the recorded EngineAction `type`s and the
 * raw serialized text. Each `actions` entry is a `RecordedAction` that wraps the
 * EngineAction — `{ tick, playerId, action: { type, ... } }` — so the type lives
 * at `entry.action.type`.
 */
function readDeterministicReplay(filePath: string): {
    readonly actionTypes: readonly string[];
    readonly raw: string;
} {
    let buffer = readFileSync(filePath);
    if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
        buffer = gunzipSync(buffer);
    }
    const raw = buffer.toString('utf8');
    const json = JSON.parse(raw) as { readonly actions?: unknown };
    const actions = Array.isArray(json.actions) ? json.actions : [];
    const actionTypes = actions
        .map((entry) => {
            const action =
                typeof entry === 'object' && entry !== null && 'action' in entry
                    ? (entry as { readonly action?: unknown }).action
                    : undefined;
            return typeof action === 'object' && action !== null && 'type' in action
                ? String((action as { readonly type: unknown }).type)
                : '';
        })
        .filter((type) => type.length > 0);
    return { actionTypes, raw };
}

// ── Lobby-scope chat ─────────────────────────────────────────────────────────

lobbyTest.describe('Tactics chat — lobby', () => {
    lobbyTest(
        'lobby-scope messages are delivered across host and client',
        async ({ hostWindow, clientWindow }) => {
            await openSharedLobby(hostWindow, clientWindow);
            const hostChat = new ChatPanelPage(hostWindow);
            const clientChat = new ChatPanelPage(clientWindow);
            await hostChat.waitForReady();
            await clientChat.waitForReady();

            await hostChat.sendLobby('hello from host');
            await clientChat.waitForMessage('hello from host');

            await clientChat.sendLobby('hi from client');
            await hostChat.waitForMessage('hi from client');
        },
    );

    lobbyTest(
        'muting a sender hides their messages; unmuting restores them',
        async ({ hostWindow, clientWindow }) => {
            const { clientId } = await openSharedLobby(hostWindow, clientWindow);
            const hostChat = new ChatPanelPage(hostWindow);
            const clientChat = new ChatPanelPage(clientWindow);
            await hostChat.waitForReady();
            await clientChat.waitForReady();

            await clientChat.sendLobby('mute me please');
            await hostChat.waitForMessage('mute me please');

            await hostChat.muteSender(clientId);
            await expect.poll(() => hostChat.messagesFrom(clientId).count()).toBe(0);

            await hostChat.unmuteSender(clientId);
            await hostChat.waitForMessage('mute me please');
        },
    );

    lobbyTest(
        'the sender receives rate_limited once messagesPerMinute is exceeded',
        async ({ hostWindow }) => {
            // Host-only lobby: the host is both sender and a lobby-scope recipient.
            const hostLobby = new LobbyPage(hostWindow);
            await hostLobby.hostLobby();
            const hostChat = new ChatPanelPage(hostWindow);
            await hostChat.waitForReady();

            // Default token bucket is 20/min; the 21st send is rejected.
            const results = await hostWindow.evaluate(async () => {
                const chat = (globalThis as unknown as ChimeraChatGlobal).__chimera.chat;
                const out: { ok: boolean; reason?: string }[] = [];
                for (let i = 0; i < 21; i += 1) {
                    // Sequential so the bucket drains deterministically.
                    out.push(await chat.send(`rate-limit probe ${i}`, { kind: 'lobby' }));
                }
                return out;
            });

            expect(results.slice(0, 20).every((r) => r.ok)).toBe(true);
            expect(results[20]).toEqual({ ok: false, reason: 'rate_limited' });
        },
    );

    lobbyTest(
        'the rolling buffer caps at 500 entries (oldest dropped)',
        async ({ hostApp, hostWindow }) => {
            const hostLobby = new LobbyPage(hostWindow);
            await hostLobby.hostLobby();
            const hostChat = new ChatPanelPage(hostWindow);
            await hostChat.waitForReady();

            // Drive the cap through the real ChatHub → IPC → chatStore → ChatPanel
            // path via the CHIMERA_E2E deliverChat hook, bypassing the relay + rate
            // limit (both irrelevant to the downstream buffer cap).
            await hostApp.evaluate(() => {
                const hooks = (globalThis as unknown as E2eHookChatGlobal).__e2eHooks;
                if (hooks === undefined) {
                    throw new Error('CHIMERA_E2E hooks are not available in the host process');
                }
                for (let i = 0; i < 520; i += 1) {
                    hooks.deliverChat({
                        id: `cap-${i}`,
                        fromPlayerId: 'cap-probe',
                        scope: { kind: 'lobby' },
                        body: `cap message ${i}`,
                        serverTime: i,
                    });
                }
            });

            await expect.poll(() => hostChat.messageCount(), { timeout: 15_000 }).toBe(500);
        },
    );
});

// ── In-match chat ─────────────────────────────────────────────────────────────

gameTest.describe('Tactics chat — in-match', () => {
    gameTest(
        'in-match chat is delivered across host and client',
        async ({ hostWindow, clientWindow }) => {
            const hostChat = new ChatPanelPage(hostWindow);
            const clientChat = new ChatPanelPage(clientWindow);
            await hostChat.openInMatchChat();
            await clientChat.openInMatchChat();

            await hostChat.sendLobby('gg from host');
            await clientChat.waitForMessage('gg from host');
        },
    );

    gameTest(
        'chat is a side-channel: never advances tick and is absent from the replay (Invariant #72)',
        async ({ hostWindow, hostApp }: { hostWindow: Page; hostApp: ElectronApplication }) => {
            const hostGame = new GamePage(hostWindow);

            // Send chat (via the bridge, no drawer so the board stays clickable)
            // before any game action and assert the simulation tick never moves.
            const tickBefore = await getSimulationTick(hostApp);
            const first = await sendChatViaBridge(hostWindow, 'chatter one');
            const second = await sendChatViaBridge(hostWindow, 'chatter two');
            expect(first.ok).toBe(true);
            expect(second.ok).toBe(true);
            const tickAfter = await getSimulationTick(hostApp);
            expect(tickAfter).toBe(tickBefore);

            // Resolve the match through the real pipeline and save the
            // deterministic replay, then assert no chat ever entered ActionHistory.
            await playToGameOver(hostGame);
            await goToPostGameSummary(hostWindow, hostGame);
            await hostGame.saveReplayButton.click();
            await expect(hostGame.replaySavedStatus).toHaveText('Replay saved');

            const replays = await hostWindow.evaluate(
                (gameId) =>
                    (globalThis as unknown as ChimeraReplayGlobal).__chimera.replay.list(gameId),
                TACTICS_GAME_ID,
            );
            const [firstReplay] = replays;
            if (firstReplay === undefined) {
                throw new Error('expected at least one saved deterministic replay');
            }

            const { actionTypes, raw } = readDeterministicReplay(firstReplay.path);
            // The replay recorded real gameplay through the ActionPipeline...
            expect(actionTypes.length).toBeGreaterThan(0);
            // ...but no chat action type and no chat body ever leaked into it.
            expect(actionTypes.some((type) => type.toLowerCase().includes('chat'))).toBe(false);
            expect(raw).not.toContain('chatter one');
            expect(raw).not.toContain('chatter two');
        },
    );
});
