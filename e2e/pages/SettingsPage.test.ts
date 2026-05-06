import { describe, expect, it } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { SettingsPage } from './SettingsPage';

interface BuildPageDoubleResult {
    readonly page: Page;
    readonly requestedTestIds: string[];
    readonly clickedTestIds: string[];
    readonly filledValues: { readonly testId: string; readonly value: string }[];
}

const buildPageDouble = (): BuildPageDoubleResult => {
    const requestedTestIds: string[] = [];
    const clickedTestIds: string[] = [];
    const filledValues: { readonly testId: string; readonly value: string }[] = [];

    const createLocator = (testId: string): Locator => {
        const locatorLike = {
            click: async (): Promise<void> => {
                clickedTestIds.push(testId);
            },
            fill: async (value: string): Promise<void> => {
                filledValues.push({ testId, value });
            },
        };

        return locatorLike as Locator;
    };

    const page = {
        getByTestId: (testId: string): Locator => {
            requestedTestIds.push(testId);
            return createLocator(testId);
        },
    };

    return {
        page: page as Page,
        requestedTestIds,
        clickedTestIds,
        filledValues,
    };
};

describe('SettingsPage', () => {
    it('binds all settings locators using test ids', () => {
        const { page, requestedTestIds } = buildPageDouble();

        const settingsPage = new SettingsPage(page);

        expect(settingsPage.masterVolumeInput).toBeDefined();
        expect(settingsPage.resetDefaultsButton).toBeDefined();
        expect(settingsPage.saveButton).toBeDefined();
        expect(settingsPage.closeButton).toBeDefined();

        expect(requestedTestIds).toEqual([
            'settings-master-volume',
            'settings-reset-defaults',
            'settings-save',
            'settings-close',
        ]);
    });

    it('fills master volume input with the provided value', async () => {
        const { page, filledValues } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.setMasterVolume(73);

        expect(filledValues).toEqual([{ testId: 'settings-master-volume', value: '73' }]);
    });

    it('clicks reset to defaults', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.resetToDefaults();

        expect(clickedTestIds).toEqual(['settings-reset-defaults']);
    });

    it('clicks save and close actions', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const settingsPage = new SettingsPage(page);

        await settingsPage.save();
        await settingsPage.close();

        expect(clickedTestIds).toEqual(['settings-save', 'settings-close']);
    });
});
