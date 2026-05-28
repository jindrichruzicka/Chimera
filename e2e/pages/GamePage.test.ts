import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import {
    TACTICS_CAMERA_POSITION,
    TACTICS_CAMERA_WORLD_BOUNDS,
} from '@chimera/games/tactics/screens/tacticsCamera.js';
import {
    GamePage,
    OLD_TACTICS_BUTTON_SELECTOR,
    TACTICS_CANVAS_WORLD_BOUNDS,
    TACTICS_REVEAL_CENTER_X,
} from './GamePage';

interface WaitForFunctionCall {
    readonly tick: number;
    readonly timeout: number | undefined;
}

interface LocatorCountBySelector {
    readonly selector: string;
    readonly count: number;
}

interface LocatorBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

interface KeyboardDownFailure {
    readonly modifier: string;
    readonly message: string;
}

interface BuildPageDoubleOptions {
    readonly canvasBox?: LocatorBox | null;
    readonly keyboardDownFailure?: KeyboardDownFailure;
    readonly locatorCounts?: readonly LocatorCountBySelector[];
    readonly snapshots?: readonly unknown[];
}

interface BuildPageDoubleResult {
    readonly page: Page;
    readonly requestedTestIds: string[];
    readonly locatorQueries: string[];
    readonly pageLocatorQueries: string[];
    readonly waitForFunctionCalls: WaitForFunctionCall[];
    readonly clickCalls: {
        readonly position: unknown;
        readonly modifiers?: unknown;
    }[];
}

const buildPageDouble = (
    tickText = '0',
    snapshot: unknown = makeProjectedSnapshot({ localX: 0, enemyX: 2 }),
    options: BuildPageDoubleOptions = {},
): BuildPageDoubleResult => {
    const requestedTestIds: string[] = [];
    const locatorQueries: string[] = [];
    const pageLocatorQueries: string[] = [];
    const waitForFunctionCalls: WaitForFunctionCall[] = [];
    const clickCalls: {
        readonly position: unknown;
        readonly modifiers?: unknown;
    }[] = [];
    const activeModifiers: string[] = [];
    const snapshots = options.snapshots ?? [snapshot];
    let evaluateCallCount = 0;
    const canvasBox =
        options.canvasBox === undefined
            ? {
                  x: 10,
                  y: 20,
                  width: 600,
                  height: 400,
              }
            : options.canvasBox;

    const createLocator = (testId: string): Locator => {
        const locatorLike = {
            boundingBox: async (): Promise<LocatorBox | null> => canvasBox,
            click: async (options?: {
                readonly position?: unknown;
                readonly modifiers?: unknown;
            }): Promise<void> => {
                clickCalls.push({
                    position: options?.position,
                    ...(options?.modifiers === undefined ? {} : { modifiers: options.modifiers }),
                });
            },
            innerText: async (): Promise<string> => tickText,
            locator: (selector: string): Locator => {
                locatorQueries.push(`${testId} ${selector}`);
                return createLocator(`${testId} ${selector}`);
            },
            count: async (): Promise<number> => 0,
            first: (): Locator => locatorLike as Locator,
        };

        return locatorLike as Locator;
    };

    const page = {} as Page;

    Object.assign(page, {
        keyboard: {
            down: async (modifier: string): Promise<void> => {
                activeModifiers.push(modifier);
                if (options.keyboardDownFailure?.modifier === modifier) {
                    throw new Error(options.keyboardDownFailure.message);
                }
            },
            up: async (modifier: string): Promise<void> => {
                const index = activeModifiers.lastIndexOf(modifier);
                if (index >= 0) activeModifiers.splice(index, 1);
            },
        },
        mouse: {
            click: async (x: number, y: number): Promise<void> => {
                clickCalls.push({
                    position: { x, y },
                    ...(activeModifiers.length === 0 ? {} : { modifiers: [...activeModifiers] }),
                });
            },
        },
    });

    page.getByTestId = (testId: string): Locator => {
        requestedTestIds.push(testId);
        return createLocator(testId);
    };

    page.locator = (selector: string): Locator => {
        pageLocatorQueries.push(selector);
        const match = options.locatorCounts?.find((entry) => entry.selector === selector);
        return {
            count: async (): Promise<number> => match?.count ?? 0,
        } as Locator;
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

    page.evaluate = (async (): Promise<unknown> => {
        const fallbackSnapshot = snapshots[snapshots.length - 1] ?? snapshot;
        const nextSnapshot = snapshots[evaluateCallCount] ?? fallbackSnapshot;
        evaluateCallCount += 1;
        return nextSnapshot;
    }) as Page['evaluate'];

    return {
        page,
        requestedTestIds,
        locatorQueries,
        pageLocatorQueries,
        waitForFunctionCalls,
        clickCalls,
    };
};

afterEach(() => {
    vi.doUnmock('@playwright/test');
    vi.restoreAllMocks();
});

function makeProjectedSnapshot(options: {
    readonly localX: number;
    readonly enemyX?: number;
    readonly enemyHp?: number;
}): unknown {
    const enemy =
        options.enemyX === undefined
            ? {}
            : {
                  'unit-2': {
                      id: 'unit-2',
                      kind: 'unit',
                      ownerId: 'p2',
                      x: options.enemyX,
                      y: 0,
                      hp: options.enemyHp ?? 1,
                  },
              };

    return {
        viewerId: 'p1',
        entities: {
            'unit-1': { id: 'unit-1', kind: 'unit', ownerId: 'p1', x: options.localX, y: 0, hp: 1 },
            ...enemy,
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
        expect(gamePage.selectOwnedPrimitive).toBeDefined();
        expect(gamePage.moveSelectedPrimitiveNearOpponent).toBeDefined();
        expect(gamePage.selectOpponentPrimitive).toBeDefined();
        expect(gamePage.attackVisibleOpponent).toBeDefined();
        expect(gamePage.assertOldTacticsButtonsAbsent).toBeDefined();
        expect(Object.prototype.hasOwnProperty.call(gamePage, 'moveTargetButton')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(gamePage, 'revealTargetButton')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(gamePage, 'attackTargetButton')).toBe(false);
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
        expect(requestedTestIds).not.toContain('move-target');
        expect(requestedTestIds).not.toContain('reveal-target');
        expect(requestedTestIds).not.toContain('attack-target');
        expect(locatorQueries).toEqual(['game-canvas canvas']);
    });

    it('parses the current HUD tick as an integer', async () => {
        const { page } = buildPageDouble('42');
        const gamePage = new GamePage(page);

        const tick = await gamePage.currentTick();

        expect(tick).toBe(42);
    });

    it('selects the owned primitive by clicking the projected local unit grid point', async () => {
        const { page, clickCalls } = buildPageDouble();
        const gamePage = new GamePage(page);

        await gamePage.selectOwnedPrimitive();

        expect(clickCalls).toEqual([{ position: { x: 410, y: 220 } }]);
    });

    it('moves the selected primitive near the hidden opponent through a canvas point', async () => {
        const initialSnapshot = makeProjectedSnapshot({ localX: 0 });
        const { page, clickCalls } = buildPageDouble('0', initialSnapshot, {
            snapshots: [initialSnapshot, initialSnapshot, makeProjectedSnapshot({ localX: 1 })],
        });
        const gamePage = new GamePage(page);

        await gamePage.selectOwnedPrimitive();
        await gamePage.moveSelectedPrimitiveNearOpponent();

        expect(clickCalls).toEqual([
            { position: { x: 410, y: 220 } },
            { position: { x: 310, y: 220 } },
        ]);
    });

    it('reselects the owned primitive when the first move click does not update the projection', async () => {
        const initialSnapshot = makeProjectedSnapshot({ localX: 0 });
        const { page, clickCalls } = buildPageDouble('0', initialSnapshot, {
            snapshots: [
                initialSnapshot,
                initialSnapshot,
                initialSnapshot,
                initialSnapshot,
                makeProjectedSnapshot({ localX: 1 }),
            ],
        });
        const gamePage = new GamePage(page);

        await gamePage.selectOwnedPrimitive();
        await gamePage.moveSelectedPrimitiveNearOpponent();

        expect(clickCalls).toEqual([
            { position: { x: 410, y: 220 } },
            { position: { x: 310, y: 220 } },
            { position: { x: 410, y: 220 } },
            { position: { x: 310, y: 220 } },
        ]);
    });

    it('moves an owned unit by selecting the local primitive and moving near the opponent', async () => {
        const initialSnapshot = makeProjectedSnapshot({ localX: 0, enemyX: 2 });
        const { page, clickCalls } = buildPageDouble('0', initialSnapshot, {
            snapshots: [
                initialSnapshot,
                initialSnapshot,
                makeProjectedSnapshot({ localX: 1, enemyX: 2 }),
            ],
        });
        const gamePage = new GamePage(page);

        await gamePage.moveOwnedUnit();

        expect(clickCalls).toEqual([
            { position: { x: 410, y: 220 } },
            { position: { x: 310, y: 220 } },
        ]);
    });

    it('selects a visible opponent primitive through its canvas point', async () => {
        const { page, clickCalls } = buildPageDouble(
            '0',
            makeProjectedSnapshot({ localX: 1, enemyX: 2 }),
        );
        const gamePage = new GamePage(page);

        await gamePage.selectOpponentPrimitive();

        expect(clickCalls).toEqual([{ position: { x: 210, y: 220 } }]);
    });

    it('reveals an adjacent tile by clicking the local unit grid point and the target grid point', async () => {
        const { page, clickCalls } = buildPageDouble();
        const gamePage = new GamePage(page);

        await gamePage.revealAdjacentTile();

        expect(clickCalls).toEqual([
            { position: { x: 410, y: 220 } },
            {
                position: { x: 310, y: 220 },
                modifiers: ['Shift'],
            },
        ]);
    });

    it('releases held keyboard modifiers when a modified grid click fails before the mouse click', async () => {
        const { page, clickCalls } = buildPageDouble('0', makeProjectedSnapshot({ localX: 0 }), {
            keyboardDownFailure: { modifier: 'Alt', message: 'keyboard down failed' },
        });
        const gamePage = new GamePage(page);

        await expect(
            gamePage.clickTacticsGridPoint({ x: 0, y: 0 }, { modifiers: ['Shift', 'Alt'] }),
        ).rejects.toThrow('keyboard down failed');
        await gamePage.clickTacticsGridPoint({ x: 0, y: 0 });

        expect(clickCalls).toEqual([{ position: { x: 410, y: 220 } }]);
    });

    it('attacks the visible opponent by clicking local and opponent primitive grid points', async () => {
        const initialSnapshot = makeProjectedSnapshot({ localX: 1, enemyX: 2 });
        const { page, clickCalls } = buildPageDouble('0', initialSnapshot, {
            snapshots: [
                initialSnapshot,
                initialSnapshot,
                makeProjectedSnapshot({ localX: 1, enemyX: 2, enemyHp: 0 }),
            ],
        });
        const gamePage = new GamePage(page);

        await gamePage.attackVisibleOpponent();

        expect(clickCalls).toEqual([
            { position: { x: 310, y: 220 } },
            { position: { x: 210, y: 220 } },
        ]);
    });

    it('includes snapshot context when waiting for an adjacent opponent times out', async () => {
        vi.resetModules();
        vi.doMock('@playwright/test', async (importOriginal) => {
            const actual = await importOriginal<Record<string, unknown>>();
            return {
                ...actual,
                expect: {
                    poll: () => ({
                        toBe: async (): Promise<void> => {
                            throw new Error('poll timed out');
                        },
                    }),
                },
            };
        });
        const { GamePage: GamePageWithPollFailure } = await import('./GamePage');
        const { page } = buildPageDouble('0', makeProjectedSnapshot({ localX: 0 }));
        const gamePage = new GamePageWithPollFailure(page);

        await expect(gamePage.attackVisibleOpponent()).rejects.toThrow(
            'Timed out waiting for visible adjacent opponent. Snapshot viewer=p1 tick=undefined isMyTurn=undefined units=[unit-1:p1@0,0/hp1].',
        );
    });

    it('reselects the local primitive when the first attack click does not defeat the opponent', async () => {
        const initialSnapshot = makeProjectedSnapshot({ localX: 1, enemyX: 2 });
        const { page, clickCalls } = buildPageDouble('0', initialSnapshot, {
            snapshots: [
                initialSnapshot,
                initialSnapshot,
                initialSnapshot,
                makeProjectedSnapshot({ localX: 1, enemyX: 2, enemyHp: 0 }),
            ],
        });
        const gamePage = new GamePage(page);

        await gamePage.attackVisibleOpponent();

        expect(clickCalls).toEqual([
            { position: { x: 310, y: 220 } },
            { position: { x: 210, y: 220 } },
            { position: { x: 310, y: 220 } },
            { position: { x: 210, y: 220 } },
        ]);
    });

    it('keeps the old attack wrapper backed by the visible-opponent canvas action', async () => {
        const initialSnapshot = makeProjectedSnapshot({ localX: 1, enemyX: 2 });
        const { page, clickCalls } = buildPageDouble('0', initialSnapshot, {
            snapshots: [
                initialSnapshot,
                initialSnapshot,
                makeProjectedSnapshot({ localX: 1, enemyX: 2, enemyHp: 0 }),
            ],
        });
        const gamePage = new GamePage(page);

        await gamePage.attackAdjacentEnemy();

        expect(clickCalls).toEqual([
            { position: { x: 310, y: 220 } },
            { position: { x: 210, y: 220 } },
        ]);
    });

    it('rejects grid clicks outside the visible canvas bounds', async () => {
        const { page, clickCalls } = buildPageDouble();
        const gamePage = new GamePage(page);

        await expect(gamePage.clickTacticsGridPoint({ x: 5, y: 0 })).rejects.toThrow(
            'outside the visible tactics canvas bounds',
        );

        expect(clickCalls).toEqual([]);
    });

    it('rejects tactics grid clicks when the WebGL canvas has no visible box', async () => {
        const { page, clickCalls } = buildPageDouble('0', makeProjectedSnapshot({ localX: 0 }), {
            canvasBox: null,
        });
        const gamePage = new GamePage(page);

        await expect(gamePage.clickTacticsGridPoint({ x: 0, y: 0 })).rejects.toThrow(
            'Tactics WebGL canvas is not visible',
        );

        expect(clickCalls).toEqual([]);
    });

    it('asserts removed tactics button controls are absent without binding them as locators', async () => {
        const { page, requestedTestIds, pageLocatorQueries } = buildPageDouble();
        const gamePage = new GamePage(page);

        await gamePage.assertOldTacticsButtonsAbsent();

        expect(pageLocatorQueries).toEqual([OLD_TACTICS_BUTTON_SELECTOR]);
        expect(requestedTestIds).not.toContain('move-target');
        expect(requestedTestIds).not.toContain('reveal-target');
        expect(requestedTestIds).not.toContain('attack-target');
    });

    it('fails the old tactics button assertion when removed controls are present', async () => {
        const { page } = buildPageDouble('0', makeProjectedSnapshot({ localX: 0 }), {
            locatorCounts: [{ selector: OLD_TACTICS_BUTTON_SELECTOR, count: 1 }],
        });
        const gamePage = new GamePage(page);

        await expect(gamePage.assertOldTacticsButtonsAbsent()).rejects.toThrow(
            'Removed tactics button controls are still present',
        );
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

describe('GamePage mirrored constants stay in sync with tacticsCamera', () => {
    it('TACTICS_CANVAS_WORLD_BOUNDS matches the computed camera world bounds', () => {
        expect(TACTICS_CANVAS_WORLD_BOUNDS).toEqual(TACTICS_CAMERA_WORLD_BOUNDS);
    });

    it('TACTICS_REVEAL_CENTER_X matches the camera x-axis position', () => {
        expect(TACTICS_REVEAL_CENTER_X).toBe(TACTICS_CAMERA_POSITION[0]);
    });
});
