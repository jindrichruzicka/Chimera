import { describe, expect, it } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { MatchPage } from './MatchPage';

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

describe('MatchPage', () => {
    it('binds all match locators using test ids', () => {
        const { page, requestedTestIds } = buildPageDouble();

        const matchPage = new MatchPage(page);

        expect(matchPage.canvas).toBeDefined();
        expect(matchPage.undoButton).toBeDefined();
        expect(matchPage.redoButton).toBeDefined();
        expect(matchPage.endTurnButton).toBeDefined();
        expect(matchPage.gameOverBanner).toBeDefined();
        expect(matchPage.matchResultBanner).toBeDefined();
        expect(matchPage.matchResultText).toBeDefined();
        expect(matchPage.selectableUnit).toBeDefined();
        expect(matchPage.attackTarget).toBeDefined();
        expect(matchPage.hudTick).toBeDefined();
        expect(requestedTestIds).toEqual([
            'match-canvas',
            'undo',
            'redo',
            'end-turn',
            'game-over-banner',
            'match-result-banner',
            'match-result-text',
            'selectable-unit',
            'attack-target',
            'hud-tick',
        ]);
    });

    it('parses the current HUD tick as an integer', async () => {
        const { page } = buildPageDouble('42');
        const matchPage = new MatchPage(page);

        const tick = await matchPage.currentTick();

        expect(tick).toBe(42);
    });

    it('waits for a target tick with a default timeout of 30 seconds', async () => {
        const { page, waitForFunctionCalls } = buildPageDouble();
        const matchPage = new MatchPage(page);

        await matchPage.waitForTick(12);

        expect(waitForFunctionCalls).toEqual([{ tick: 12, timeout: 30_000 }]);
    });

    it('waits for a target tick with a custom timeout', async () => {
        const { page, waitForFunctionCalls } = buildPageDouble();
        const matchPage = new MatchPage(page);

        await matchPage.waitForTick(17, 5_000);

        expect(waitForFunctionCalls).toEqual([{ tick: 17, timeout: 5_000 }]);
    });
});
