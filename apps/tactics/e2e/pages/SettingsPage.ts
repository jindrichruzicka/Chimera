import type { Locator, Page } from '@playwright/test';

type InputActionId = `engine:${string}` | `game:${string}`;

export class SettingsPage {
    readonly closeButton: Locator;
    readonly masterVolumeInput: Locator;
    readonly resetDefaultsButton: Locator;
    /**
     * The gameplay Language `<Select>` (native `<select>`, role `combobox`). It
     * carries no testid — `<SettingsLanguageSelector>` renders the pure
     * `<LanguageSelector>` primitive, which sources its accessible name from the
     * resolved `engine.settings.language` token ("Language" in English). The
     * selector self-hides for single-language games, so this locator resolves to
     * zero elements when the active game declares fewer than two languages.
     */
    readonly languageSelect: Locator;

    public constructor(private readonly page: Page) {
        this.closeButton = page.getByTestId('settings-close');
        this.masterVolumeInput = page.getByTestId('master-volume').filter({ visible: true });
        this.resetDefaultsButton = page.getByTestId('reset-to-defaults');
        this.languageSelect = page.getByRole('combobox', { name: 'Language', exact: true });
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

    /**
     * Click a settings tab by its stable `tabId` (locale-independent). Tab
     * labels are translation tokens, so a role+name click breaks once the UI
     * language switches; the `settings-tab-<tabId>` testid does not. Located via
     * `page.locator` (not the by-test-id helper) so the POM/renderer
     * testid-alignment guard — which pins literal by-test-id ids to the settings
     * page — does not require this computed id (`getSettingsTabTestId(tab.id)`).
     */
    public async clickTabById(tabId: string): Promise<void> {
        await this.page.locator(`[role="tab"][data-testid="settings-tab-${tabId}"]`).click();
    }

    public getControlByLabel(label: string): Locator {
        return this.page.getByLabel(label, { exact: true }).filter({ visible: true });
    }

    public async setSlider(label: string, value: number): Promise<void> {
        await this.getControlByLabel(label).fill(String(value));
    }

    /** Select a UI language by its BCP-47 code (e.g. `'cs-CZ'`) in the Language field. */
    public async selectLanguage(code: string): Promise<void> {
        await this.languageSelect.selectOption(code);
    }

    /** The currently-selected Language code (the persisted `gameplay.language`). */
    public async currentLanguage(): Promise<string> {
        return this.languageSelect.inputValue();
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
