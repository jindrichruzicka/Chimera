import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { MainMenuPage } from './MainMenuPage';

interface ClickableLocator {
    click: () => Promise<void>;
    allTextContents: () => Promise<string[]>;
}

interface LocatorWithChildren {
    click: () => Promise<void>;
    isVisible: () => Promise<boolean>;
    waitFor: (options: { state: string }) => Promise<void>;
    getByRole: (role: string, options?: { name?: string; exact?: boolean }) => ClickableLocator;
    allTextContents: () => Promise<string[]>;
}

interface TestPage {
    goto: (url: string) => Promise<null>;
    getByTestId: (testId: string) => LocatorWithChildren;
    getByRole: (role: string, options?: { name?: string; exact?: boolean }) => ClickableLocator;
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

    const makeLocator = (id: string): LocatorWithChildren => ({
        click: async (): Promise<void> => {
            clickedTestIds.push(id);
        },
        isVisible: async (): Promise<boolean> => true,
        waitFor: async (): Promise<void> => {},
        getByRole: (_role: string, options?: { name?: string }): ClickableLocator => ({
            click: async (): Promise<void> => {
                if (options?.name !== undefined) {
                    clickedTestIds.push(`${id}[role=${options.name}]`);
                }
            },
            allTextContents: async (): Promise<string[]> => [],
        }),
        allTextContents: async (): Promise<string[]> => [],
    });

    const page: TestPage = {
        goto: async (url: string): Promise<null> => {
            visitedUrls.push(url);
            return null;
        },
        getByTestId: (testId: string): LocatorWithChildren => {
            requestedTestIds.push(testId);
            return makeLocator(testId);
        },
        getByRole: (role: string, options?: { name?: string }): ClickableLocator => ({
            click: async (): Promise<void> => {
                clickedTestIds.push(`role=${role}${options?.name ? `[${options.name}]` : ''}`);
            },
            allTextContents: async (): Promise<string[]> => [],
        }),
    };

    return { page: page as Page, clickedTestIds, requestedTestIds, visitedUrls };
};

describe('MainMenuPage', () => {
    it('binds play, settings, quit, component gallery, and menu locators using test ids', () => {
        const { page, requestedTestIds } = buildPageDouble();

        const mainMenu = new MainMenuPage(page);

        expect(mainMenu.playButton).toBeDefined();
        expect(mainMenu.settingsButton).toBeDefined();
        expect(mainMenu.quitButton).toBeDefined();
        expect(mainMenu.componentGalleryButton).toBeDefined();
        expect(mainMenu.replaysButton).toBeDefined();
        expect(mainMenu.loadGameButton).toBeDefined();
        expect(mainMenu.menu).toBeDefined();
        expect(requestedTestIds).toContain('main-menu-play');
        expect(requestedTestIds).toContain('main-menu-settings');
        expect(requestedTestIds).toContain('main-menu-quit');
        expect(requestedTestIds).toContain('main-menu-component-gallery');
        expect(requestedTestIds).toContain('main-menu-load-game');
        expect(requestedTestIds).toContain('main-menu');
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

    it('clicks the quit button when quit() is called', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const mainMenu = new MainMenuPage(page);

        await mainMenu.quit();

        expect(clickedTestIds).toEqual(['main-menu-quit']);
    });

    it('clicks the component gallery button when openComponentGallery() is called', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const mainMenu = new MainMenuPage(page);

        await mainMenu.openComponentGallery();

        expect(clickedTestIds).toEqual(['main-menu-component-gallery']);
    });

    it('navigates to the main menu through the Electron renderer protocol', async () => {
        const { page, visitedUrls } = buildPageDouble();
        const mainMenu = new MainMenuPage(page);

        await mainMenu.goto();

        expect(visitedUrls).toEqual(['chimera://renderer/main-menu/']);
    });

    it('isVisible() delegates to the menu locator', async () => {
        const { page } = buildPageDouble();
        const mainMenu = new MainMenuPage(page);

        const result = await mainMenu.isVisible();

        expect(result).toBe(true);
    });

    it('getButtonLabels() waits for menu visibility and returns button texts', async () => {
        const { page } = buildPageDouble();
        const mainMenu = new MainMenuPage(page);

        const labels = await mainMenu.getButtonLabels();

        expect(Array.isArray(labels)).toBe(true);
    });

    it('clickButtonByLabel() clicks the button with the matching accessible name', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const mainMenu = new MainMenuPage(page);

        await mainMenu.clickButtonByLabel('Settings');

        expect(clickedTestIds).toContain('main-menu[role=Settings]');
    });
});
