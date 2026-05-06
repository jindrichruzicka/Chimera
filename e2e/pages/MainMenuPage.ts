import type { Locator, Page } from '@playwright/test';

export class MainMenuPage {
    readonly playButton: Locator;
    readonly settingsButton: Locator;

    public constructor(private readonly page: Page) {
        this.playButton = page.getByTestId('main-menu-play');
        this.settingsButton = page.getByTestId('main-menu-settings');
    }

    public async goto(): Promise<void> {
        await this.page.goto('/');
    }

    public async navigateToLobby(): Promise<void> {
        await this.playButton.click();
    }

    public async navigateToSettings(): Promise<void> {
        await this.settingsButton.click();
    }
}
