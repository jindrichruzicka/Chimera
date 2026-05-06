import type { Locator, Page } from '@playwright/test';

export class SettingsPage {
    readonly masterVolumeInput: Locator;
    readonly resetDefaultsButton: Locator;

    public constructor(private readonly page: Page) {
        this.masterVolumeInput = page.getByTestId('master-volume');
        this.resetDefaultsButton = page.getByTestId('reset-to-defaults');
    }

    public async setMasterVolume(value: number): Promise<void> {
        await this.masterVolumeInput.fill(String(value));
    }

    public async resetToDefaults(): Promise<void> {
        await this.resetDefaultsButton.click();
    }
}
