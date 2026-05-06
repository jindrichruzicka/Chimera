import type { Locator, Page } from '@playwright/test';

export class SettingsPage {
    readonly masterVolumeInput: Locator;
    readonly resetDefaultsButton: Locator;
    readonly saveButton: Locator;
    readonly closeButton: Locator;

    public constructor(private readonly page: Page) {
        this.masterVolumeInput = page.getByTestId('settings-master-volume');
        this.resetDefaultsButton = page.getByTestId('settings-reset-defaults');
        this.saveButton = page.getByTestId('settings-save');
        this.closeButton = page.getByTestId('settings-close');
    }

    public async setMasterVolume(value: number): Promise<void> {
        await this.masterVolumeInput.fill(String(value));
    }

    public async resetToDefaults(): Promise<void> {
        await this.resetDefaultsButton.click();
    }

    public async save(): Promise<void> {
        await this.saveButton.click();
    }

    public async close(): Promise<void> {
        await this.closeButton.click();
    }
}
