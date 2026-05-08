import type { Locator, Page } from '@playwright/test';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from '../../electron/main/renderer-url';

const MAIN_MENU_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/main-menu/`;

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
        await this.page.goto(MAIN_MENU_URL);
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
