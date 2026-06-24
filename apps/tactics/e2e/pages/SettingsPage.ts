import type { Locator, Page } from '@playwright/test';

type InputActionId = `engine:${string}` | `game:${string}`;

export class SettingsPage {
    readonly closeButton: Locator;
    readonly masterVolumeInput: Locator;
    readonly resetDefaultsButton: Locator;

    public constructor(private readonly page: Page) {
        this.closeButton = page.getByTestId('settings-close');
        this.masterVolumeInput = page.getByTestId('master-volume').filter({ visible: true });
        this.resetDefaultsButton = page.getByTestId('reset-to-defaults');
    }

    public async close(): Promise<void> {
        await this.closeButton.click();
    }

    public async setMasterVolume(value: number): Promise<void> {
        await this.masterVolumeInput.fill(String(value));
    }

    public async clickTab(label: string): Promise<void> {
        await this.page.getByRole('tab', { name: label, exact: true }).click();
    }

    public getControlByLabel(label: string): Locator {
        return this.page.getByLabel(label, { exact: true }).filter({ visible: true });
    }

    public async setSlider(label: string, value: number): Promise<void> {
        await this.getControlByLabel(label).fill(String(value));
    }

    public async resetToDefaults(): Promise<void> {
        await this.resetDefaultsButton.click();
    }

    public bindingValue(actionId: InputActionId): Locator {
        return this.bindingRow(actionId).getByTestId('binding-value');
    }

    public async readBinding(actionId: InputActionId): Promise<string> {
        return (await this.bindingValue(actionId).innerText()).trim();
    }

    public async startRebinding(actionId: InputActionId): Promise<void> {
        await this.bindingRow(actionId).getByTestId('binding-edit').click();
    }

    public async rebindAction(actionId: InputActionId, key: string): Promise<void> {
        await this.startRebinding(actionId);
        await this.page.keyboard.press(key);
    }

    public async resetBinding(actionId: InputActionId): Promise<void> {
        await this.bindingRow(actionId).getByTestId('binding-reset').click();
    }

    private bindingRow(actionId: InputActionId): Locator {
        return this.page
            .locator(
                `[data-testid="binding-action-row"][data-action-id="${escapeAttributeValue(actionId)}"]`,
            )
            .filter({ visible: true });
    }
}

function escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
