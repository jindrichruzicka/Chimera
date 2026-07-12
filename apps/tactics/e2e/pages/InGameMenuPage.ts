import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the Escape-toggled in-game menu on Tactics (§4.33–§4.34).
 * The engine `InGameMenuHost` (`renderer/components/shell/InGameMenuHost.tsx`)
 * opens the game-supplied menu; Tactics registers `TacticsInGameMenu`
 * (`apps/tactics/screens/TacticsInGameMenu.tsx`) — a single-step Leave-game
 * confirmation built on the design-system `Modal` (title "Leave the battle?",
 * so `role="dialog"` named accordingly) with `tactics-leave-*` test-ids.
 *
 * Escape (the default `engine:toggle-menu` binding) opens the dialog when
 * nothing else is on the shared Escape stack; a second Escape — or Cancel —
 * closes it. {@link confirmButton} ("Leave battle") routes through the
 * role-aware `useLeaveGame` hook; the {@link prompt} copy differs for host vs
 * client (host returns everyone to the lobby; client disconnects to main menu).
 */
export class InGameMenuPage {
    /** The leave dialog — named "Leave the battle?" to disambiguate it from the chat drawer. */
    readonly dialog: Locator;
    /** The role-aware leave warning (host vs client copy). */
    readonly prompt: Locator;
    readonly cancelButton: Locator;
    /** The "Leave battle" confirm button — abandons the match. */
    readonly confirmButton: Locator;

    public constructor(private readonly page: Page) {
        this.dialog = page.getByRole('dialog', { name: 'Leave the battle?' });
        this.prompt = page.getByTestId('tactics-leave-prompt');
        this.cancelButton = page.getByTestId('tactics-leave-cancel');
        this.confirmButton = page.getByTestId('tactics-leave-confirm');
    }

    /** Press Escape (default `engine:toggle-menu`) and wait for the menu to open. */
    public async openViaEscape(): Promise<void> {
        await this.page.keyboard.press('Escape');
        await expect(this.dialog).toBeVisible();
    }

    /** Press Escape and wait for the menu to close. */
    public async closeViaEscape(): Promise<void> {
        await this.page.keyboard.press('Escape');
        await expect(this.dialog).toBeHidden();
    }

    /** Confirm Leave game — abandons the match through the role-aware leave path. */
    public async confirmLeave(): Promise<void> {
        await this.confirmButton.click();
    }
}
