import { describe, expect, it } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { GamePage } from './GamePage';

interface WaitForFunctionCall {
    readonly tick: number;
    readonly timeout: number | undefined;
}

interface BuildPageDoubleResult {
    readonly page: Page;
    readonly requestedTestIds: string[];
    readonly waitForFunctionCalls: WaitForFunctionCall[];
}

const buildPageDouble = (tickText = '0'): BuildPageDoubleResult => {
    const requestedTestIds: string[] = [];
    const waitForFunctionCalls: WaitForFunctionCall[] = [];

    const createLocator = (): Locator => {
        const locatorLike = {
            innerText: async (): Promise<string> => tickText,
        };

        return locatorLike as Locator;
    };

    const page = {} as Page;

    page.getByTestId = (testId: string): Locator => {
        requestedTestIds.push(testId);
        return createLocator();
    };

    page.waitForFunction = (async (
        _pageFunction: Parameters<Page['waitForFunction']>[0],
        arg?: Parameters<Page['waitForFunction']>[1],
        options?: Parameters<Page['waitForFunction']>[2],
    ): ReturnType<Page['waitForFunction']> => {
        const tick = typeof arg === 'number' ? arg : 0;
        waitForFunctionCalls.push({ tick, timeout: options?.timeout });
        return {} as Awaited<ReturnType<Page['waitForFunction']>>;
    }) as Page['waitForFunction'];

    return {
        page,
        requestedTestIds,
        waitForFunctionCalls,
    };
};

describe('GamePage', () => {
    it('binds all game locators using test ids', () => {
        const { page, requestedTestIds } = buildPageDouble();

        const gamePage = new GamePage(page);

        expect(gamePage.canvas).toBeDefined();
        expect(gamePage.undoButton).toBeDefined();
        expect(gamePage.redoButton).toBeDefined();
        expect(gamePage.endTurnButton).toBeDefined();
        expect(gamePage.gameResultBanner).toBeDefined();
        expect(gamePage.gameResultText).toBeDefined();
        expect(gamePage.selectableUnit).toBeDefined();
        expect(gamePage.moveTarget).toBeDefined();
        expect(gamePage.revealTarget).toBeDefined();
        expect(gamePage.attackTarget).toBeDefined();
        expect(gamePage.hudTick).toBeDefined();
        expect(gamePage.sceneRouter).toBeDefined();
        expect(gamePage.transitionOverlay).toBeDefined();
        expect(gamePage.postGameSummary).toBeDefined();
        expect(gamePage.perfHud).toBeDefined();
        expect(requestedTestIds).toEqual([
            'game-canvas',
            'undo',
            'redo',
            'end-turn',
            'game-result-banner',
            'game-result-text',
            'selectable-unit',
            'move-target',
            'reveal-target',
            'attack-target',
            'hud-tick',
            'scene-router',
            'transition-overlay',
            'post-game-summary',
            'perf-hud',
        ]);
    });

    it('parses the current HUD tick as an integer', async () => {
        const { page } = buildPageDouble('42');
        const gamePage = new GamePage(page);

        const tick = await gamePage.currentTick();

        expect(tick).toBe(42);
    });

    it('waits for a target tick with a default timeout of 30 seconds', async () => {
        const { page, waitForFunctionCalls } = buildPageDouble();
        const gamePage = new GamePage(page);

        await gamePage.waitForTick(12);

        expect(waitForFunctionCalls).toEqual([{ tick: 12, timeout: 30_000 }]);
    });

    it('waits for a target tick with a custom timeout', async () => {
        const { page, waitForFunctionCalls } = buildPageDouble();
        const gamePage = new GamePage(page);

        await gamePage.waitForTick(17, 5_000);

        expect(waitForFunctionCalls).toEqual([{ tick: 17, timeout: 5_000 }]);
    });
});
