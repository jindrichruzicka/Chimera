import type { Locator, Page } from '@playwright/test';

export class GamePage {
    readonly canvas: Locator;
    readonly undoButton: Locator;
    readonly redoButton: Locator;
    readonly endTurnButton: Locator;
    readonly gameResultBanner: Locator;
    readonly gameResultText: Locator;
    readonly selectableUnit: Locator;
    readonly moveTarget: Locator;
    readonly revealTarget: Locator;
    readonly attackTarget: Locator;
    readonly hudTick: Locator;
    readonly sceneRouter: Locator;
    readonly transitionOverlay: Locator;
    readonly postGameSummary: Locator;

    public constructor(private readonly page: Page) {
        this.canvas = page.getByTestId('game-canvas');
        this.undoButton = page.getByTestId('undo');
        this.redoButton = page.getByTestId('redo');
        this.endTurnButton = page.getByTestId('end-turn');
        this.gameResultBanner = page.getByTestId('game-result-banner');
        this.gameResultText = page.getByTestId('game-result-text');
        this.selectableUnit = page.getByTestId('selectable-unit');
        this.moveTarget = page.getByTestId('move-target');
        this.revealTarget = page.getByTestId('reveal-target');
        this.attackTarget = page.getByTestId('attack-target');
        this.hudTick = page.getByTestId('hud-tick');
        this.sceneRouter = page.getByTestId('scene-router');
        this.transitionOverlay = page.getByTestId('transition-overlay');
        this.postGameSummary = page.getByTestId('post-game-summary');
    }

    public async attackAdjacentEnemy(): Promise<void> {
        await this.selectableUnit.click();
        await this.attackTarget.click();
    }

    public async revealAdjacentTile(): Promise<void> {
        await this.selectableUnit.click();
        await this.revealTarget.click();
    }

    public async moveOwnedUnit(): Promise<void> {
        await this.selectableUnit.first().click();
        await this.moveTarget.first().click();
    }

    public async currentTick(): Promise<number> {
        const text = await this.hudTick.innerText();
        return parseInt(text, 10);
    }

    public async waitForTick(tick: number, timeout = 30_000): Promise<void> {
        await this.page.waitForFunction(
            (targetTick: number) => {
                const text =
                    (
                        globalThis as {
                            readonly document?: {
                                querySelector(
                                    s: string,
                                ): { readonly textContent: string | null } | null;
                            };
                        }
                    ).document?.querySelector('[data-testid=hud-tick]')?.textContent ?? '0';
                return parseInt(text, 10) >= targetTick;
            },
            tick,
            { timeout },
        );
    }

    public async activeSceneId(): Promise<string | null> {
        return this.sceneRouter.getAttribute('data-active-scene-id');
    }

    public async activeScreenKey(): Promise<string | null> {
        return this.sceneRouter.getAttribute('data-active-screen-key');
    }
}
