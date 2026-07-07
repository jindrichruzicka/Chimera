import type { Locator, Page } from '@playwright/test';
import {
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_PROTOCOL,
} from '../../../../electron/main/renderer-url';

const MAIN_MENU_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/main-menu/`;

export interface MainMenuGotoOptions {
    readonly gameId?: string;
}

export class MainMenuPage {
    readonly playButton: Locator;
    readonly settingsButton: Locator;
    readonly quitButton: Locator;
    readonly componentGalleryButton: Locator;
    readonly replaysButton: Locator;
    readonly loadGameButton: Locator;
    readonly menu: Locator;

    public constructor(private readonly page: Page) {
        this.playButton = page.getByTestId('main-menu-play');
        this.settingsButton = page.getByTestId('main-menu-settings');
        this.quitButton = page.getByTestId('main-menu-quit');
        this.componentGalleryButton = page.getByTestId('main-menu-component-gallery');
        // Game-contributed "Load Game" action (F68 #824); navigates to /saves
        // carrying ?gameId=.
        this.loadGameButton = page.getByTestId('main-menu-load-game');
        // Game-contributed "Replays" menu button (F44 / T7), located by its
        // accessible name. Disabled until at least one perspective replay exists
        // for the active game.
        this.replaysButton = page.getByRole('button', { name: 'Replays' });
        this.menu = page.getByTestId('main-menu');
    }

    public async goto(options: MainMenuGotoOptions = {}): Promise<void> {
        const url = new URL(MAIN_MENU_URL);
        if (options.gameId !== undefined) {
            url.searchParams.set('gameId', options.gameId);
        }

        await this.page.goto(url.toString());
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

    public async openComponentGallery(): Promise<void> {
        await this.componentGalleryButton.click();
    }

    /** True when the main-menu container is attached and visible in the DOM. */
    public async isVisible(): Promise<boolean> {
        return this.menu.isVisible();
    }

    /**
     * Returns the text labels of all buttons rendered inside the main-menu
     * container. Uses accessible role so the result is order-stable.
     */
    public async getButtonLabels(): Promise<string[]> {
        await this.menu.waitFor({ state: 'visible' });
        return this.menu.getByRole('button').allTextContents();
    }

    /** Clicks the button whose accessible name matches `label`. */
    public async clickButtonByLabel(label: string): Promise<void> {
        await this.menu.waitFor({ state: 'visible' });
        await this.menu.getByRole('button', { name: label, exact: true }).click();
    }
}
