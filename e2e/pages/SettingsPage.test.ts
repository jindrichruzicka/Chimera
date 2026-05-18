import { describe, expect, it } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { SettingsPage } from './SettingsPage';

interface BuildPageDoubleResult {
    readonly page: Page;
    readonly requestedTestIds: string[];
    readonly requestedLocators: string[];
    readonly clickedTestIds: string[];
    readonly filledValues: { readonly testId: string; readonly value: string }[];
    readonly keyPresses: string[];
}

const buildPageDouble = (): BuildPageDoubleResult => {
    const requestedTestIds: string[] = [];
    const requestedLocators: string[] = [];
    const clickedTestIds: string[] = [];
    const filledValues: { readonly testId: string; readonly value: string }[] = [];
    const keyPresses: string[] = [];

    const createLocator = (testId: string): Locator => {
        const locatorLike = {
            click: async (): Promise<void> => {
                clickedTestIds.push(testId);
            },
            fill: async (value: string): Promise<void> => {
                filledValues.push({ testId, value });
            },
            innerText: async (): Promise<string> => `${testId}:text`,
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
        clickedTestIds,
        filledValues,
        keyPresses,
    };
};

describe('SettingsPage', () => {
    it('binds all settings locators using test ids', () => {
        const { page, requestedTestIds } = buildPageDouble();

        const settingsPage = new SettingsPage(page);

        expect(settingsPage.masterVolumeInput).toBeDefined();
        expect(settingsPage.resetDefaultsButton).toBeDefined();

        expect(requestedTestIds).toEqual(['master-volume', 'reset-to-defaults']);
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
