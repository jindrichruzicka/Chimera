import type { Locator, Page } from '@playwright/test';

export class LobbyPage {
    readonly hostButton: Locator;
    readonly joinButton: Locator;
    readonly readyButton: Locator;
    readonly startButton: Locator;
    readonly playerList: Locator;
    readonly playerListItems: Locator;
    readonly connectionStatus: Locator;
    readonly addressInput: Locator;
    readonly confirmJoinButton: Locator;

    public constructor(private readonly page: Page) {
        this.hostButton = page.getByTestId('host-lobby');
        this.joinButton = page.getByTestId('join-lobby');
        this.readyButton = page.getByTestId('ready-toggle');
        this.startButton = page.getByTestId('start-match');
        this.playerList = page.getByTestId('player-list');
        this.playerListItems = page.getByTestId('player-list-item');
        this.connectionStatus = page.getByTestId('connection-status');
        this.addressInput = page.getByTestId('address-input');
        this.confirmJoinButton = page.getByTestId('confirm-join');
    }

    public async hostLobby(): Promise<void> {
        await this.hostButton.click();
        await this.connectionStatus.waitFor({ state: 'visible' });
    }

    public async joinLobby(address: string): Promise<void> {
        await this.joinButton.click();
        await this.addressInput.fill(address);
        await this.confirmJoinButton.click();
        await this.connectionStatus.waitFor({ state: 'visible' });
    }

    public async waitForPlayerCount(count: number): Promise<void> {
        if (count < 1) throw new Error('waitForPlayerCount requires count >= 1');
        await this.playerListItems.nth(count - 1).waitFor({ state: 'visible' });
    }
}
