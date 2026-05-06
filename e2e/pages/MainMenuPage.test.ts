import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { MainMenuPage } from './MainMenuPage';

interface ClickableLocator {
    click: () => Promise<void>;
}

interface TestPage {
    goto: (url: string) => Promise<null>;
    getByTestId: (testId: string) => ClickableLocator;
}

const buildPageDouble = (): {
    readonly page: Page;
    readonly clickedTestIds: string[];
    readonly requestedTestIds: string[];
    readonly visitedUrls: string[];
} => {
    const clickedTestIds: string[] = [];
    const requestedTestIds: string[] = [];
    const visitedUrls: string[] = [];

    const page: TestPage = {
        goto: async (url: string): Promise<null> => {
            visitedUrls.push(url);
            return null;
        },
        getByTestId: (testId: string): ClickableLocator => {
            requestedTestIds.push(testId);
            return {
                click: async (): Promise<void> => {
                    clickedTestIds.push(testId);
                },
            };
        },
    };

    return { page: page as Page, clickedTestIds, requestedTestIds, visitedUrls };
};

describe('MainMenuPage', () => {
    it('binds lobby and settings locators using test ids', () => {
        const { page, requestedTestIds } = buildPageDouble();

        const mainMenu = new MainMenuPage(page);

        expect(mainMenu.playButton).toBeDefined();
        expect(mainMenu.settingsButton).toBeDefined();
        expect(requestedTestIds).toEqual(['main-menu-play', 'main-menu-settings']);
    });

    it('navigates to lobby via play button', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const mainMenu = new MainMenuPage(page);

        await mainMenu.navigateToLobby();

        expect(clickedTestIds).toEqual(['main-menu-play']);
    });

    it('navigates to settings via settings button', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const mainMenu = new MainMenuPage(page);

        await mainMenu.navigateToSettings();

        expect(clickedTestIds).toEqual(['main-menu-settings']);
    });

    it('navigates to the main menu root when goto is called', async () => {
        const { page, visitedUrls } = buildPageDouble();
        const mainMenu = new MainMenuPage(page);

        await mainMenu.goto();

        expect(visitedUrls).toEqual(['/']);
    });
});
