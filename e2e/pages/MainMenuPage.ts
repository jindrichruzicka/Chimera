import type { Locator, Page } from '@playwright/test';

export class MainMenuPage {
    readonly playButton: Locator;
    readonly settingsButton: Locator;
    readonly quitButton: Locator;

    public constructor(private readonly page: Page) {
        this.playButton = page.getByTestId('main-menu-play');
        this.settingsButton = page.getByTestId('main-menu-settings');
        this.quitButton = page.getByTestId('main-menu-quit');
    }

    public async goto(): Promise<void> {
        await this.page.goto('/main-menu');
    }

    public async navigateToLobby(): Promise<void> {
        await this.playButton.click();
    }

    public async navigateToSettings(): Promise<void> {
        await this.settingsButton.click();
    }

    public async quit(): Promise<void> {
        await this.quitButton.click();
    }
}
