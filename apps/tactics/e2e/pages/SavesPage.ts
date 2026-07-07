import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the saves screen (`/saves`, F68 #824). Rows are the
 * per-slot load buttons (`save-load-btn`); each row has a sibling delete
 * `IconButton` that opens a confirm dialog. Loading a save does NOT navigate
 * from here — `GameStoreBootstrap` routes `/saves → /game` once the restored
 * snapshot lands, so callers wait on the game canvas, not on this page.
 *
 * The empty state carries no testid; it is located via its aria-label
 * (`No saves yet`), which the saves screen renders only after loading
 * resolves with zero slots.
 */
export class SavesPage {
    readonly pageRoot: Locator;
    readonly closeButton: Locator;
    readonly rows: Locator;
    readonly deleteButtons: Locator;
    readonly deleteDialog: Locator;
    readonly deleteCancelButton: Locator;
    readonly deleteConfirmButton: Locator;
    readonly emptyState: Locator;

    public constructor(page: Page) {
        this.pageRoot = page.getByTestId('saves-page');
        this.closeButton = page.getByTestId('saves-close-btn');
        this.rows = page.getByTestId('save-load-btn');
        this.deleteButtons = page.getByTestId('save-delete-btn');
        this.deleteDialog = page.getByTestId('save-delete-dialog');
        this.deleteCancelButton = page.getByTestId('save-delete-cancel');
        this.deleteConfirmButton = page.getByTestId('save-delete-confirm');
        this.emptyState = page.getByLabel('No saves yet');
    }

    /**
     * Count rows only after the first one is visible. The page container
     * renders during the async loading state too, so a one-shot `count()`
     * there returns 0 (the replay-delete flake). Callers expecting zero rows
     * must assert on {@link emptyState} instead.
     */
    public async rowCount(): Promise<number> {
        await expect(this.rows.first()).toBeVisible({ timeout: 15_000 });
        return this.rows.count();
    }

    public async loadFirstSave(): Promise<void> {
        await this.rows.first().click();
    }

    public async requestDeleteFirstSave(): Promise<void> {
        await this.deleteButtons.first().click();
        await expect(this.deleteDialog).toBeVisible();
    }

    public async cancelDelete(): Promise<void> {
        await this.deleteCancelButton.click();
        await expect(this.deleteDialog).toHaveCount(0);
    }

    public async confirmDelete(): Promise<void> {
        await this.deleteConfirmButton.click();
        await expect(this.deleteDialog).toHaveCount(0);
    }

    public async close(): Promise<void> {
        await this.closeButton.click();
    }
}
