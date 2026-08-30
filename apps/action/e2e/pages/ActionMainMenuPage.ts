import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The action app's main menu.
 *
 * Four entries, and the testids come from two different places — which is why
 * each is spelled here rather than derived: `main-menu-continue` and
 * `main-menu-settings` are the engine's own derivations (from the action type
 * and the navigation target), while `main-menu-start` is the slug the game's
 * own definition declares through `GameMainMenuButton.id`, because a navigation
 * to a GAME-owned route is exactly the case the engine derivation cannot name.
 */
export class ActionMainMenuPage {
    readonly menu: Locator;
    /**
     * The buttons the game's menu DEFINITION produced, and only those.
     *
     * Scoped tighter than `main-menu` on purpose: the page also mounts the
     * engine's component-gallery icon button, whose accessible name is an
     * `aria-label` and whose text content is empty — so a label list read off
     * the whole page carries a stray `''` that says nothing about the
     * definition.
     */
    readonly definitionButtons: Locator;
    /** Engine-gated: enabled only while this game has an autosave. */
    readonly continueButton: Locator;
    /** Navigates to the game's own `/select` page, behind the overwrite confirm. */
    readonly startButton: Locator;
    readonly settingsButton: Locator;
    readonly quitButton: Locator;

    public constructor(private readonly page: Page) {
        this.menu = page.getByTestId('main-menu');
        this.definitionButtons = page.getByTestId('menu-container');
        this.continueButton = page.getByTestId('main-menu-continue');
        this.startButton = page.getByTestId('main-menu-start');
        this.settingsButton = page.getByTestId('main-menu-settings');
        this.quitButton = page.getByTestId('main-menu-quit');
    }

    /**
     * Wait until the GAME's menu is on screen, not the engine default.
     *
     * The page renders `main-menu` with no buttons while the shell payload is
     * still resolving, so a spec that waited on the container alone would assert
     * against an empty menu.
     */
    public async waitForGameMenu(timeout: number): Promise<void> {
        await expect(this.startButton).toBeVisible({ timeout });
    }

    /** The declared entries' labels, in the order the definition lists them. */
    public async buttonLabels(): Promise<string[]> {
        await this.definitionButtons.waitFor({ state: 'visible' });
        return this.definitionButtons.getByRole('button').allTextContents();
    }
}
