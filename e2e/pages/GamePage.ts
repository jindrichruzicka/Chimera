import type { Locator, Page } from '@playwright/test';
import { TACTICS_CAMERA_WORLD_BOUNDS } from '../../games/tactics/screens/tacticsCamera.js';

interface TacticsGridPoint {
    readonly x: number;
    readonly y: number;
}

interface TacticsUnitProjection {
    readonly id: string;
    readonly ownerId: string;
    readonly x: number;
    readonly y: number;
    readonly hp: number;
}

interface TacticsSnapshotProjection {
    readonly viewerId: string;
    readonly entities: Readonly<Record<string, unknown>>;
}

type LocatorClickOptions = NonNullable<Parameters<Locator['click']>[0]>;

interface TacticsGridClickOptions {
    readonly modifiers?: LocatorClickOptions['modifiers'];
}

export class GamePage {
    readonly canvas: Locator;
    private readonly tacticsCanvas: Locator;
    readonly undoButton: Locator;
    readonly redoButton: Locator;
    readonly endTurnButton: Locator;
    readonly gameResultBanner: Locator;
    readonly gameResultText: Locator;
    readonly hudTick: Locator;
    readonly sceneRouter: Locator;
    readonly transitionOverlay: Locator;
    readonly postGameSummary: Locator;
    readonly perfHud: Locator;

    public constructor(private readonly page: Page) {
        this.canvas = page.getByTestId('game-canvas');
        this.tacticsCanvas = this.canvas.locator('canvas').first();
        this.undoButton = page.getByTestId('undo');
        this.redoButton = page.getByTestId('redo');
        this.endTurnButton = page.getByTestId('end-turn');
        this.gameResultBanner = page.getByTestId('game-result-banner');
        this.gameResultText = page.getByTestId('game-result-text');
        this.hudTick = page.getByTestId('hud-tick');
        this.sceneRouter = page.getByTestId('scene-router');
        this.transitionOverlay = page.getByTestId('transition-overlay');
        this.postGameSummary = page.getByTestId('post-game-summary');
        this.perfHud = page.getByTestId('perf-hud');
    }

    public async attackAdjacentEnemy(): Promise<void> {
        const localUnit = await this.findLocalUnit();
        const enemyUnit = await this.findAdjacentOpponentUnit(localUnit);
        await this.clickTacticsGridPoint({ x: localUnit.x, y: localUnit.y });
        await this.clickTacticsGridPoint({ x: enemyUnit.x, y: enemyUnit.y });
    }

    public async revealAdjacentTile(): Promise<void> {
        const localUnit = await this.findLocalUnit();
        await this.clickTacticsGridPoint({ x: localUnit.x, y: localUnit.y });
        await this.clickTacticsGridPoint(
            { x: localUnit.x + 1, y: localUnit.y },
            { modifiers: ['Shift'] },
        );
    }

    public async moveOwnedUnit(): Promise<void> {
        const localUnit = await this.findLocalUnit();
        await this.clickTacticsGridPoint({ x: localUnit.x, y: localUnit.y });
        await this.clickTacticsGridPoint({ x: localUnit.x + 1, y: localUnit.y });
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

    public async clickTacticsGridPoint(
        grid: TacticsGridPoint,
        options: TacticsGridClickOptions = {},
    ): Promise<void> {
        const box = await this.tacticsCanvas.boundingBox();
        if (box === null) {
            throw new Error(
                'Tactics WebGL canvas is not visible; cannot click tactics grid point.',
            );
        }

        const clickOptions: LocatorClickOptions = {
            position: projectGridPointToCanvasPosition(grid, box),
        };
        if (options.modifiers !== undefined) {
            clickOptions.modifiers = options.modifiers;
        }

        await this.tacticsCanvas.click(clickOptions);
    }

    private async findLocalUnit(): Promise<TacticsUnitProjection> {
        const snapshot = await this.readCurrentSnapshot();
        const unit = listProjectedUnits(snapshot).find((candidate) => {
            return candidate.ownerId === snapshot.viewerId && candidate.hp > 0;
        });

        if (unit === undefined) {
            throw new Error(`No visible local tactics unit for viewer ${snapshot.viewerId}.`);
        }

        return unit;
    }

    private async findAdjacentOpponentUnit(
        localUnit: TacticsUnitProjection,
    ): Promise<TacticsUnitProjection> {
        const snapshot = await this.readCurrentSnapshot();
        const unit = listProjectedUnits(snapshot).find((candidate) => {
            return (
                candidate.ownerId !== snapshot.viewerId &&
                candidate.hp > 0 &&
                Math.abs(candidate.x - localUnit.x) + Math.abs(candidate.y - localUnit.y) === 1
            );
        });

        if (unit === undefined) {
            throw new Error(`No visible adjacent opponent tactics unit for ${localUnit.id}.`);
        }

        return unit;
    }

    private async readCurrentSnapshot(): Promise<TacticsSnapshotProjection> {
        const snapshot = await this.page.evaluate(async () => {
            const gameApi = (
                globalThis as {
                    readonly __chimera?: {
                        readonly game?: {
                            readonly getCurrentSnapshot?: () => Promise<unknown>;
                        };
                    };
                }
            ).__chimera?.game;

            if (typeof gameApi?.getCurrentSnapshot !== 'function') {
                return null;
            }

            return gameApi.getCurrentSnapshot();
        });

        if (!isTacticsSnapshotProjection(snapshot)) {
            throw new Error('Current projected tactics snapshot is unavailable.');
        }

        return snapshot;
    }
}

function projectGridPointToCanvasPosition(
    grid: TacticsGridPoint,
    box: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
    const { left, right, top, bottom } = TACTICS_CAMERA_WORLD_BOUNDS;
    return {
        x: ((right - grid.x) / (right - left)) * box.width,
        y: ((top - grid.y) / (top - bottom)) * box.height,
    };
}

function listProjectedUnits(snapshot: TacticsSnapshotProjection): readonly TacticsUnitProjection[] {
    return Object.values(snapshot.entities).filter(isTacticsUnitProjection);
}

function isTacticsSnapshotProjection(value: unknown): value is TacticsSnapshotProjection {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Readonly<Record<string, unknown>>;
    return typeof candidate['viewerId'] === 'string' && isRecord(candidate['entities']);
}

function isTacticsUnitProjection(value: unknown): value is TacticsUnitProjection {
    if (!isRecord(value)) {
        return false;
    }

    return (
        value['kind'] === 'unit' &&
        typeof value['id'] === 'string' &&
        typeof value['ownerId'] === 'string' &&
        Number.isInteger(value['x']) &&
        Number.isInteger(value['y']) &&
        Number.isInteger(value['hp'])
    );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}
