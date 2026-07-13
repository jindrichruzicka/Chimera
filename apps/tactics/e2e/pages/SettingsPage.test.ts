import { describe, expect, it } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { SettingsPage } from './SettingsPage';

interface BuildPageDoubleResult {
    readonly page: Page;
    readonly requestedTestIds: string[];
    readonly requestedLocators: string[];
    readonly requestedLabels: RequestedLabel[];
    readonly requestedRoles: RequestedRole[];
    readonly clickedTestIds: string[];
    readonly filledValues: { readonly testId: string; readonly value: string }[];
    readonly selectedOptions: { readonly locator: string; readonly value: string }[];
    readonly keyPresses: string[];
}

interface RequestedLabel {
    readonly exact?: boolean;
    readonly text: Parameters<Page['getByLabel']>[0];
}

interface RequestedRole {
    readonly exact?: boolean;
    readonly name?: string | RegExp;
    readonly role: Parameters<Page['getByRole']>[0];
}

const buildPageDouble = (): BuildPageDoubleResult => {
    const requestedTestIds: string[] = [];
    const requestedLocators: string[] = [];
    const requestedLabels: RequestedLabel[] = [];
    const requestedRoles: RequestedRole[] = [];
    const clickedTestIds: string[] = [];
    const filledValues: { readonly testId: string; readonly value: string }[] = [];
    const selectedOptions: { readonly locator: string; readonly value: string }[] = [];
    const keyPresses: string[] = [];

    const createLocator = (testId: string): Locator => {
        const locatorLike = {
            click: async (): Promise<void> => {
                clickedTestIds.push(testId);
            },
            fill: async (value: string): Promise<void> => {
                filledValues.push({ testId, value });
            },
            selectOption: async (value: string): Promise<string[]> => {
                selectedOptions.push({ locator: testId, value });
                return [value];
            },
            inputValue: async (): Promise<string> => `${testId}:value`,
            innerText: async (): Promise<string> => `${testId}:text`,
            filter: (): Locator => locatorLike as Locator,
            getByTestId: (childTestId: string): Locator => {
                requestedTestIds.push(childTestId);
                return createLocator(`${testId} >> ${childTestId}`);
            },
        };

        return locatorLike as Locator;
    };

    const page = {
        getByTestId: (testId: string): Locator => {
            requestedTestIds.push(testId);
            return createLocator(testId);
        },
        locator: (selector: string): Locator => {
            requestedLocators.push(selector);
            return createLocator(selector);
        },
        getByLabel: (
            text: Parameters<Page['getByLabel']>[0],
            options?: Parameters<Page['getByLabel']>[1],
        ): Locator => {
            requestedLabels.push({
                text,
                ...(options?.exact !== undefined ? { exact: options.exact } : {}),
            });
            return createLocator(`label:${String(text)}`);
        },
        getByRole: (
            role: Parameters<Page['getByRole']>[0],
            options?: Parameters<Page['getByRole']>[1],
        ): Locator => {
            requestedRoles.push({
                role,
                ...(options?.name !== undefined ? { name: options.name } : {}),
                ...(options?.exact !== undefined ? { exact: options.exact } : {}),
            });
            return createLocator(`${role}:${String(options?.name ?? '')}`);
        },
        keyboard: {
            press: async (key: string): Promise<void> => {
                keyPresses.push(key);
            },
        },
    };

    return {
        page: page as Page,
        requestedTestIds,
        requestedLocators,
        requestedLabels,
        requestedRoles,
        clickedTestIds,
        filledValues,
        selectedOptions,
        keyPresses,
    };
};

describe('SettingsPage', () => {
    it('binds all settings locators using test ids', () => {
        const { page, requestedTestIds } = buildPageDouble();

        const settingsPage = new SettingsPage(page);

        expect(settingsPage.closeButton).toBeDefined();
        expect(settingsPage.masterVolumeInput).toBeDefined();
        expect(settingsPage.resetDefaultsButton).toBeDefined();
        expect(settingsPage.languageSelect).toBeDefined();

        expect(requestedTestIds).toEqual([
            'settings-close',
            'master-volume',
            'reset-to-defaults',
            'settings-language',
        ]);
    });

    it('clicks close', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.close();

        expect(clickedTestIds).toEqual(['settings-close']);
    });

    it('fills master volume input with the provided value', async () => {
        const { page, filledValues } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.setMasterVolume(73);

        expect(filledValues).toEqual([{ testId: 'master-volume', value: '73' }]);
    });

    it('clicks reset to defaults', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.resetToDefaults();

        expect(clickedTestIds).toEqual(['reset-to-defaults']);
    });

    it('clicks a settings tab by accessible label', async () => {
        const { page, clickedTestIds, requestedRoles } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.clickTab('Display');

        expect(requestedRoles).toContainEqual({ role: 'tab', name: 'Display', exact: true });
        expect(clickedTestIds).toContain('tab:Display');
    });

    it('clicks a settings tab by its locale-independent testid', async () => {
        const { page, clickedTestIds, requestedLocators } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.clickTabById('gameplay');

        expect(requestedLocators).toContain('[role="tab"][data-testid="settings-tab-gameplay"]');
        expect(clickedTestIds).toContain('[role="tab"][data-testid="settings-tab-gameplay"]');
    });

    it('returns a control by accessible label', () => {
        const { page, requestedLabels } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        expect(settingsPage.getControlByLabel('Animation Speed')).toBeDefined();

        expect(requestedLabels).toContainEqual({ text: 'Animation Speed', exact: true });
    });

    it('sets a slider by accessible label', async () => {
        const { page, filledValues, requestedLabels } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.setSlider('AI Thinking Delay', 1200);

        expect(requestedLabels).toContainEqual({ text: 'AI Thinking Delay', exact: true });
        expect(filledValues).toEqual([{ testId: 'label:AI Thinking Delay', value: '1200' }]);
    });

    it('selects a UI language by its BCP-47 code', async () => {
        const { page, selectedOptions } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.selectLanguage('cs-CZ');

        expect(selectedOptions).toEqual([{ locator: 'settings-language', value: 'cs-CZ' }]);
    });

    it('reads the current Language code', async () => {
        const { page } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        expect(await settingsPage.currentLanguage()).toBe('settings-language:value');
    });

    it('locates the action-row description by its testid', () => {
        const { page, requestedLocators, requestedTestIds } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        expect(settingsPage.bindingDescription('game:end-turn')).toBeDefined();
        expect(requestedLocators).toContain(
            '[data-testid="binding-action-row"][data-action-id="game:end-turn"]',
        );
        expect(requestedTestIds).toContain('binding-description');
    });

    it('reads a binding value from the action row', async () => {
        const { page, requestedLocators, requestedTestIds } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        const text = await settingsPage.readBinding('game:end-turn');

        expect(requestedLocators).toContain(
            '[data-testid="binding-action-row"][data-action-id="game:end-turn"]',
        );
        expect(requestedTestIds).toContain('binding-value');
        expect(text).toBe(
            '[data-testid="binding-action-row"][data-action-id="game:end-turn"] >> binding-value:text',
        );
    });

    it('starts action rebinding from the action row edit button', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.startRebinding('game:end-turn');

        expect(clickedTestIds).toContain(
            '[data-testid="binding-action-row"][data-action-id="game:end-turn"] >> binding-edit',
        );
    });

    it('presses the requested key after starting action rebinding', async () => {
        const { page, keyPresses } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.rebindAction('game:end-turn', 'KeyK');

        expect(keyPresses).toEqual(['KeyK']);
    });

    it('clicks the action row reset button', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.resetBinding('game:end-turn');

        expect(clickedTestIds).toContain(
            '[data-testid="binding-action-row"][data-action-id="game:end-turn"] >> binding-reset',
        );
    });
});
