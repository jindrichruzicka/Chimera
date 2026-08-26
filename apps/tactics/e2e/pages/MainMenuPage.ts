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
    /** Game-contributed "Continue" — resumes the active game's autosave. */
    readonly continueButton: Locator;
    /** Game-contributed "Quick Match" — host versus one AI, no lobby screen. */
    readonly quickMatchButton: Locator;
    readonly menu: Locator;

    public constructor(private readonly page: Page) {
        this.playButton = page.getByTestId('main-menu-play');
        this.settingsButton = page.getByTestId('main-menu-settings');
        this.quitButton = page.getByTestId('main-menu-quit');
        this.componentGalleryButton = page.getByTestId('main-menu-component-gallery');
        // Game-contributed "Load Game" action; navigates to /saves carrying ?gameId=.
        this.loadGameButton = page.getByTestId('main-menu-load-game');
        // Game-contributed "Replays" menu button, located by its accessible name.
        // Disabled until at least one perspective replay exists for the active game.
        this.replaysButton = page.getByRole('button', { name: 'Replays' });
        // The two lobby-less match entries. Their testids come from different
        // places — `main-menu-continue` is the engine's own derivation for a
        // `continue` action, `main-menu-quick-match` is the slug the tactics
        // definition declares — and the alignment guard beside this file resolves
        // each against its own source.
        this.continueButton = page.getByTestId('main-menu-continue');
        this.quickMatchButton = page.getByTestId('main-menu-quick-match');
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

    /**
     * Start a lobby-less match. Neither this nor {@link continueLastMatch}
     * navigates — see the header of `renderer/shell/renderMainMenuDefinition.tsx`
     * for what carries the window into the match.
     */
    public async startQuickMatch(): Promise<void> {
        await this.quickMatchButton.click();
    }

    /** Resume the active game's autosave. */
    public async continueLastMatch(): Promise<void> {
        await this.continueButton.click();
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
