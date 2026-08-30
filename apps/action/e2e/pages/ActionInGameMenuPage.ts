import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The Escape-toggled in-game menu.
 *
 * This app registers NO `inGameMenu` screen, so what opens is the engine's own
 * default Resume/Leave dialog — which carries no test ids of its own, hence the
 * role+name locators below. That is the surface under test: the game omitting
 * the slot is what selects it, and a game that registered one would be asserting
 * against something else entirely.
 *
 * "Leave match" is the ONLY exit this app has. A quick-started session has no
 * lobby to return to, so the engine's role-aware leave takes the `closeSession`
 * fork — capture and teardown in one call, with the autosave on by default.
 */
export class ActionInGameMenuPage {
    readonly dialog: Locator;
    readonly resumeButton: Locator;
    readonly leaveButton: Locator;

    public constructor(private readonly page: Page) {
        this.dialog = page.getByRole('dialog', { name: 'Menu' });
        this.resumeButton = this.dialog.getByRole('button', { name: 'Resume', exact: true });
        this.leaveButton = this.dialog.getByRole('button', { name: 'Leave match', exact: true });
    }

    /** Press Escape (the default `engine:toggle-menu` binding) and wait for it. */
    public async openViaEscape(): Promise<void> {
        await this.page.keyboard.press('Escape');
        await expect(this.dialog).toBeVisible();
    }

    /** Confirm Leave — ends the session, autosaving on the way out. */
    public async leave(): Promise<void> {
        await this.leaveButton.click();
    }
}
