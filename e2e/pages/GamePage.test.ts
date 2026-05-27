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
    readonly locatorQueries: string[];
    readonly waitForFunctionCalls: WaitForFunctionCall[];
    readonly clickCalls: {
        readonly testId: string;
        readonly position: unknown;
        readonly modifiers?: unknown;
    }[];
}

const buildPageDouble = (
    tickText = '0',
    snapshot: unknown = makeProjectedSnapshot({ localX: 0, enemyX: 2 }),
): BuildPageDoubleResult => {
    const requestedTestIds: string[] = [];
    const locatorQueries: string[] = [];
    const waitForFunctionCalls: WaitForFunctionCall[] = [];
    const clickCalls: {
        readonly testId: string;
        readonly position: unknown;
        readonly modifiers?: unknown;
    }[] = [];

    const createLocator = (testId: string): Locator => {
        const locatorLike = {
            boundingBox: async (): Promise<{
                x: number;
                y: number;
                width: number;
                height: number;
            }> => ({
                x: 10,
                y: 20,
                width: 600,
                height: 400,
            }),
            click: async (options?: {
                readonly position?: unknown;
                readonly modifiers?: unknown;
            }): Promise<void> => {
                clickCalls.push({
                    testId,
                    position: options?.position,
                    ...(options?.modifiers === undefined ? {} : { modifiers: options.modifiers }),
                });
            },
            innerText: async (): Promise<string> => tickText,
            locator: (selector: string): Locator => {
                locatorQueries.push(`${testId} ${selector}`);
                return createLocator(`${testId} ${selector}`);
            },
            first: (): Locator => locatorLike as Locator,
        };

        return locatorLike as Locator;
    };

    const page = {} as Page;

    page.getByTestId = (testId: string): Locator => {
        requestedTestIds.push(testId);
        return createLocator(testId);
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

    page.evaluate = (async (): Promise<unknown> => snapshot) as Page['evaluate'];

    return {
        page,
        requestedTestIds,
        locatorQueries,
        waitForFunctionCalls,
        clickCalls,
    };
};

function makeProjectedSnapshot(options: {
    readonly localX: number;
    readonly enemyX: number;
}): unknown {
    return {
        viewerId: 'p1',
        entities: {
            'unit-1': { id: 'unit-1', kind: 'unit', ownerId: 'p1', x: options.localX, y: 0, hp: 1 },
            'unit-2': { id: 'unit-2', kind: 'unit', ownerId: 'p2', x: options.enemyX, y: 0, hp: 1 },
        },
    };
}

describe('GamePage', () => {
    it('binds all game locators using test ids', () => {
        const { page, requestedTestIds, locatorQueries } = buildPageDouble();

        const gamePage = new GamePage(page);

        expect(gamePage.canvas).toBeDefined();
        expect(gamePage.undoButton).toBeDefined();
        expect(gamePage.redoButton).toBeDefined();
        expect(gamePage.endTurnButton).toBeDefined();
        expect(gamePage.gameResultBanner).toBeDefined();
        expect(gamePage.gameResultText).toBeDefined();
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
            'hud-tick',
            'scene-router',
            'transition-overlay',
            'post-game-summary',
            'perf-hud',
        ]);
        expect(locatorQueries).toEqual(['game-canvas canvas']);
    });

    it('parses the current HUD tick as an integer', async () => {
        const { page } = buildPageDouble('42');
        const gamePage = new GamePage(page);

        const tick = await gamePage.currentTick();

        expect(tick).toBe(42);
    });

    it('moves an owned unit by clicking the local unit grid point and the target grid point', async () => {
        const { page, clickCalls } = buildPageDouble();
        const gamePage = new GamePage(page);

        await gamePage.moveOwnedUnit();

        expect(clickCalls).toEqual([
            { testId: 'game-canvas canvas', position: { x: 400, y: 200 } },
            { testId: 'game-canvas canvas', position: { x: 300, y: 200 } },
        ]);
    });

    it('reveals an adjacent tile by clicking the local unit grid point and the target grid point', async () => {
        const { page, clickCalls } = buildPageDouble();
        const gamePage = new GamePage(page);

        await gamePage.revealAdjacentTile();

        expect(clickCalls).toEqual([
            { testId: 'game-canvas canvas', position: { x: 400, y: 200 } },
            {
                testId: 'game-canvas canvas',
                position: { x: 300, y: 200 },
                modifiers: ['Shift'],
            },
        ]);
    });

    it('attacks the adjacent enemy by clicking the moved local unit and enemy grid points', async () => {
        const { page, clickCalls } = buildPageDouble(
            '0',
            makeProjectedSnapshot({ localX: 1, enemyX: 2 }),
        );
        const gamePage = new GamePage(page);

        await gamePage.attackAdjacentEnemy();

        expect(clickCalls).toEqual([
            { testId: 'game-canvas canvas', position: { x: 300, y: 200 } },
            { testId: 'game-canvas canvas', position: { x: 200, y: 200 } },
        ]);
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
