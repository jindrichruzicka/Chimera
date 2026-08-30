import type { Locator, Page } from '@playwright/test';

/** A rebindable action id, in either namespace the engine accepts. */
export type InputActionId = `engine:${string}` | `game:${string}`;

/**
 * The engine settings screen, as this suite drives it: the Controls tab and the
 * binding rows the game's `inputActions` table contributes.
 *
 * Tabs are clicked by their stable `settings-tab-<id>` testid rather than by
 * label, so the locator does not depend on the copy.
 */
export class ActionSettingsPage {
    readonly closeButton: Locator;
    readonly masterVolumeInput: Locator;

    public constructor(private readonly page: Page) {
        this.closeButton = this.page.getByTestId('settings-close');
        this.masterVolumeInput = this.page.getByTestId('master-volume').filter({ visible: true });
    }

    public async close(): Promise<void> {
        await this.closeButton.click();
    }

    public async openControlsTab(): Promise<void> {
        await this.page.locator('[role="tab"][data-testid="settings-tab-controls"]').click();
    }

    public bindingRow(actionId: InputActionId): Locator {
        return this.page
            .locator(`[data-testid="binding-action-row"][data-action-id="${actionId}"]`)
            .filter({ visible: true });
    }

    public bindingValue(actionId: InputActionId): Locator {
        return this.bindingRow(actionId).getByTestId('binding-value');
    }

    /** Start a rebind and press `key` — the shipped two-step the UI requires. */
    public async rebind(actionId: InputActionId, key: string): Promise<void> {
        await this.bindingRow(actionId).getByTestId('binding-edit').click();
        await this.page.keyboard.press(key);
    }

    /** Every action id the Controls tab currently lists, in DOM order. */
    public async listedActionIds(): Promise<string[]> {
        const rows = await this.page.locator('[data-testid="binding-action-row"]').all();
        const ids = await Promise.all(rows.map((row) => row.getAttribute('data-action-id')));
        return ids.map((id) => id ?? '');
    }
}
