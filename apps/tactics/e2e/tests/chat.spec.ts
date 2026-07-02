/**
 * F45 / M8 — chat.spec.ts (#685)
 * §13.8 Core E2E Test Specifications · §4.29 Chat System
 *
 * End-to-end coverage of the Tactics chat lifecycle through the real renderer +
 * main IPC + host-relay path (not mocks). The ChatPanel UI is in-match only —
 * the lobby screen mounts no chat UI — so all UI-driven cases run in a live
 * match through the collapsed-by-default chat drawer:
 *   - in-match send/receive across host and client (chat drawer);
 *   - the 500-entry rolling-buffer cap;
 *   - rate-limit rejection once messagesPerMinute is exceeded (sent through the
 *     IPC bridge from a hosted lobby session — the relay is UI-independent);
 *   - Invariant #72: chat never advances `tick` and is absent from the replay.
 *
 * Cross-client chat rides the LocalWebSocketProvider side-channel: the client
 * sends a CHAT frame to the host, the host ChatRelay is the sole gate
 * (Invariant #73), and accepted messages fan back out to recipients. The host is
 * not in the PlayerDirectory (it never JOINs); it is added as a lobby-scope
 * recipient at the delivery layer (LobbyManager.deliverChat), so it sees its own
 * and clients' lobby-scope messages ("lobby" names the recipient set — every
 * connected player — not the lobby screen).
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
import { ReplayPlayerPage } from '../pages/ReplayPlayerPage';
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

// ── Relay rate limit (bridge-driven; the lobby screen mounts no chat UI) ─────

lobbyTest.describe('Tactics chat — relay rate limit', () => {
    lobbyTest(
        'the sender receives rate_limited once messagesPerMinute is exceeded',
        async ({ hostWindow }) => {
            // Host-only lobby session: the relay is live as soon as a lobby is
            // hosted, so sends go through the IPC bridge — no chat UI involved.
            const hostLobby = new LobbyPage(hostWindow);
            await hostLobby.hostLobby();

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
        'the rolling buffer caps at 500 entries (oldest dropped)',
        async ({ hostApp, hostWindow }) => {
            // CI renderers (2-core, software GL) need well over the default
            // budgets to chew through 520 IPC pushes that each re-render the
            // growing message list; locally this completes in a few seconds.
            gameTest.slow();
            const hostChat = new ChatPanelPage(hostWindow);
            // Open the drawer first: ChatPanel subscribes to the push channel on
            // mount, and the cap is asserted on rendered message rows.
            await hostChat.openInMatchChat();

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

            // The CI trace for this test showed a single locator.count() call
            // queued for 26s+ behind renderer work, so the budget must absorb
            // the full chew-through, not just one query.
            await expect.poll(() => hostChat.messageCount(), { timeout: 120_000 }).toBe(500);
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

            // Resolve the match through the real pipeline, then assert no chat ever
            // entered ActionHistory. The match is no longer written at game-over —
            // the replay player's save icon is the sole persistence gate — so open
            // the just-finished match and save it before reading it off disk.
            await playToGameOver(hostGame);
            await goToPostGameSummary(hostWindow, hostGame);
            await hostGame.replayButton.click();
            const player = new ReplayPlayerPage(hostWindow);
            await expect(player.playButton).toBeVisible({ timeout: 30_000 });
            await player.save();

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
