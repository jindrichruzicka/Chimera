import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the multiplayer lobby. Since the customizable-lobby feature
 * (#702), a hosted Tactics lobby renders the registry-loaded `TacticsLobbyScreen`
 * (testids `tactics-lobby-screen`, `tactics-lobby-player`, `tactics-ready-toggle`)
 * in place of the engine-default `ActiveLobbyPanel`. The pre-lobby host/join
 * controls (`host-lobby`, `join-lobby`, `address-input`, `confirm-join`) and the
 * global `connection-status` indicator are panel-independent.
 *
 * The host-issued lobby code and the local player id are read through
 * `window.__chimera.lobby` rather than the DOM: `TacticsLobbyScreen` does not
 * render a session-id element, and the bridge is the same source the renderer
 * itself uses (cf. reconnect.spec.ts).
 */
export class LobbyPage {
    readonly hostButton: Locator;
    readonly joinButton: Locator;
    readonly readyButton: Locator;
    readonly startButton: Locator;
    readonly lobbyScreen: Locator;
    readonly playerListItems: Locator;
    readonly connectionStatus: Locator;
    readonly addressInput: Locator;
    readonly hostPasswordInput: Locator;
    readonly joinPasswordInput: Locator;
    readonly errorBanner: Locator;
    readonly confirmJoinButton: Locator;
    readonly leaveButton: Locator;
    readonly closeButton: Locator;

    public constructor(protected readonly page: Page) {
        this.hostButton = page.getByTestId('host-lobby');
        this.joinButton = page.getByTestId('join-lobby');
        this.readyButton = page.getByTestId('tactics-ready-toggle');
        this.startButton = page.getByTestId('start-game');
        this.lobbyScreen = page.getByTestId('tactics-lobby-screen');
        this.playerListItems = page.getByTestId('tactics-lobby-player');
        this.connectionStatus = page.getByTestId('connection-status');
        this.addressInput = page.getByTestId('address-input');
        this.hostPasswordInput = page.getByTestId('host-password-input');
        this.joinPasswordInput = page.getByTestId('join-password-input');
        this.errorBanner = page.getByTestId('lobby-error');
        this.confirmJoinButton = page.getByTestId('confirm-join');
        this.leaveButton = page.getByTestId('lobby-leave-btn');
        // Pre-lobby Close (shown only while no lobby is active); returns to
        // the main menu.
        this.closeButton = page.getByTestId('lobby-close');
    }

    /** Host a lobby, optionally protecting it with a password (F56). */
    public async hostLobby(password?: string): Promise<void> {
        if (password !== undefined) {
            await this.hostPasswordInput.fill(password);
        }
        await this.hostButton.click();
        await this.lobbyScreen.waitFor({ state: 'visible' });
    }

    /** Join a lobby and wait for the lobby screen (the join is expected to succeed). */
    public async joinLobby(address: string, password?: string): Promise<void> {
        await this.fillJoinForm(address, password);
        await this.confirmJoinButton.click();
        await this.lobbyScreen.waitFor({ state: 'visible' });
    }

    /**
     * Submit a join without waiting for success (F56). Use when the join may be
     * rejected — the caller asserts on the error banner / pre-lobby screen.
     */
    public async attemptJoin(address: string, password?: string): Promise<void> {
        await this.fillJoinForm(address, password);
        await this.confirmJoinButton.click();
    }

    private async fillJoinForm(address: string, password?: string): Promise<void> {
        await this.joinButton.click();
        await this.addressInput.fill(address);
        if (password !== undefined) {
            await this.joinPasswordInput.fill(password);
        }
    }

    public async toggleReady(): Promise<void> {
        await this.readyButton.click();
    }

    public async playerReadyStatus(index: number): Promise<string | null> {
        const item = this.playerListItems.nth(index);
        await item.waitFor({ state: 'visible' });
        return item.getAttribute('data-ready');
    }

    public async localPlayerId(): Promise<string | null> {
        return this.page.evaluate(async () => {
            const lobby = (
                globalThis as {
                    readonly __chimera?: {
                        readonly lobby?: {
                            readonly getLocalPlayerId?: () => Promise<string | null>;
                        };
                    };
                }
            ).__chimera?.lobby;

            if (typeof lobby?.getLocalPlayerId !== 'function') {
                return null;
            }

            return (await lobby.getLocalPlayerId()) ?? null;
        });
    }

    public async playerReadyStatusById(playerId: string): Promise<string | null> {
        const item = this.page.locator(
            `[data-testid="tactics-lobby-player"][data-player-id="${playerId}"]`,
        );
        await item.waitFor({ state: 'visible' });
        return item.getAttribute('data-ready');
    }

    public async waitForPlayerCount(count: number): Promise<void> {
        if (count < 1) throw new Error('waitForPlayerCount requires count >= 1');
        await this.playerListItems.nth(count - 1).waitFor({ state: 'visible' });
    }

    public async lobbyCode(): Promise<string> {
        const sessionId = await this.page.evaluate(async () => {
            const lobby = (
                globalThis as {
                    readonly __chimera?: {
                        readonly lobby?: {
                            readonly getCurrentState?: () => Promise<{
                                readonly info?: { readonly sessionId?: string };
                            } | null>;
                        };
                    };
                }
            ).__chimera?.lobby;

            if (typeof lobby?.getCurrentState !== 'function') {
                return null;
            }

            const state = await lobby.getCurrentState();
            return state?.info?.sessionId ?? null;
        });

        if (sessionId === null || sessionId === undefined) {
            throw new Error('Lobby code is unavailable; no active hosted lobby was found.');
        }

        return sessionId;
    }

    public async leaveLobby(): Promise<void> {
        await this.leaveButton.click();
        await this.waitForPreLobbyScreen();
    }

    public async waitForPreLobbyScreen(): Promise<void> {
        await this.hostButton.waitFor({ state: 'visible' });
    }
}
