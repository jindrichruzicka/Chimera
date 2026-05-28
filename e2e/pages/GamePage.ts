import { expect, type Locator, type Page } from '@playwright/test';

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

interface TacticsAttackPair {
    readonly localUnit: TacticsUnitProjection;
    readonly opponentUnit: TacticsUnitProjection;
}

type LocatorClickOptions = NonNullable<Parameters<Locator['click']>[0]>;

interface TacticsGridClickOptions {
    readonly modifiers?: LocatorClickOptions['modifiers'];
}

// Mirrors games/tactics/screens/tacticsCamera.ts without importing game rendering internals.
// Kept in sync by GamePage.test.ts (sync-guard tests import the source-of-truth directly).
export const TACTICS_CANVAS_WORLD_BOUNDS = {
    left: -2,
    right: 4,
    top: 2,
    bottom: -2,
} as const;

export const TACTICS_REVEAL_CENTER_X = 1;
const TACTICS_MOVE_RETRY_ATTEMPTS = 3;
const TACTICS_ATTACK_RETRY_ATTEMPTS = 3;
const PROJECTED_SNAPSHOT_TIMEOUT_MS = 30_000;
export const OLD_TACTICS_BUTTON_SELECTOR =
    '[data-testid="move-target"], [data-testid="reveal-target"], [data-testid="attack-target"]';

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
        await this.attackVisibleOpponent();
    }

    public async revealAdjacentTile(): Promise<void> {
        const localUnit = await this.findLocalUnit();
        await this.clickTacticsGridPoint({ x: localUnit.x, y: localUnit.y });
        await this.waitForCanvasInteractionFrame();
        await this.clickTacticsGridPoint(
            { x: localUnit.x + 1, y: localUnit.y },
            { modifiers: ['Shift'] },
        );
    }

    public async moveOwnedUnit(): Promise<void> {
        await this.selectOwnedPrimitive();
        await this.moveSelectedPrimitiveNearOpponent();
    }

    public async selectOwnedPrimitive(): Promise<void> {
        const localUnit = await this.findLocalUnit();
        await this.clickTacticsGridPoint(unitGridPoint(localUnit));
        await this.waitForCanvasInteractionFrame();
    }

    public async moveSelectedPrimitiveNearOpponent(): Promise<void> {
        const localUnit = await this.findLocalUnit();
        const targetGrid = tacticsRevealMoveTarget(localUnit);

        for (let attempt = 0; attempt < TACTICS_MOVE_RETRY_ATTEMPTS; attempt += 1) {
            await this.clickTacticsGridPoint(targetGrid);
            await this.waitForCanvasInteractionFrame();
            if (await this.isProjectedOwnedUnitAt(targetGrid)) {
                return;
            }

            await this.selectOwnedPrimitive();
        }

        await this.waitForProjectedOwnedUnitAt(targetGrid);
    }

    public async selectOpponentPrimitive(): Promise<void> {
        const opponentUnit = await this.findVisibleOpponentUnit();
        await this.clickTacticsGridPoint(unitGridPoint(opponentUnit));
        await this.waitForCanvasInteractionFrame();
    }

    public async attackVisibleOpponent(): Promise<void> {
        const { localUnit, opponentUnit } = await this.findVisibleAttackPair();

        for (let attempt = 0; attempt < TACTICS_ATTACK_RETRY_ATTEMPTS; attempt += 1) {
            await this.clickTacticsGridPoint(unitGridPoint(localUnit));
            await this.waitForCanvasInteractionFrame();
            await this.clickTacticsGridPoint(unitGridPoint(opponentUnit));
            await this.waitForCanvasInteractionFrame();
            if (await this.isProjectedUnitDefeated(opponentUnit.id)) {
                return;
            }
        }

        await this.waitForProjectedUnitDefeated(opponentUnit.id);
    }

    public async assertOldTacticsButtonsAbsent(): Promise<void> {
        const oldButtonCount = await this.page.locator(OLD_TACTICS_BUTTON_SELECTOR).count();
        if (oldButtonCount > 0) {
            throw new Error(
                `Removed tactics button controls are still present: ${oldButtonCount}.`,
            );
        }
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
        if (box === null || box.width <= 0 || box.height <= 0) {
            throw new Error(
                'Tactics WebGL canvas is not visible; cannot click tactics grid point.',
            );
        }

        const position = projectGridPointToCanvasPosition(grid, box);
        if (!isCanvasPositionInsideBox(position, box)) {
            throw new Error(
                `Projected tactics grid point (${grid.x}, ${grid.y}) is outside the visible tactics canvas bounds.`,
            );
        }

        const absoluteX = box.x + position.x;
        const absoluteY = box.y + position.y;

        if (options.modifiers === undefined || options.modifiers.length === 0) {
            await this.page.mouse.click(absoluteX, absoluteY);
            return;
        }

        try {
            for (const modifier of options.modifiers) {
                await this.page.keyboard.down(modifier);
            }
            await this.page.mouse.click(absoluteX, absoluteY);
        } finally {
            for (const modifier of [...options.modifiers].reverse()) {
                await this.page.keyboard.up(modifier);
            }
        }
    }

    private async findLocalUnit(): Promise<TacticsUnitProjection> {
        const snapshot = await this.readCurrentSnapshot();
        const unit = findLocalUnitInSnapshot(snapshot);

        if (unit === undefined) {
            throw new Error(`No visible local tactics unit for viewer ${snapshot.viewerId}.`);
        }

        return unit;
    }

    private async findVisibleOpponentUnit(): Promise<TacticsUnitProjection> {
        const snapshot = await this.readCurrentSnapshot();
        const unit = listProjectedUnits(snapshot).find((candidate) => {
            return candidate.ownerId !== snapshot.viewerId && candidate.hp > 0;
        });

        if (unit === undefined) {
            throw new Error(`No visible opponent tactics unit for viewer ${snapshot.viewerId}.`);
        }

        return unit;
    }

    private async findVisibleAttackPair(): Promise<TacticsAttackPair> {
        await this.waitForVisibleAdjacentOpponent();
        const snapshot = await this.readCurrentSnapshot();
        const localUnit = findLocalUnitInSnapshot(snapshot);
        if (localUnit === undefined) {
            throw new Error(`No visible local tactics unit for viewer ${snapshot.viewerId}.`);
        }

        const opponentUnit = findAdjacentOpponentUnitInSnapshot(snapshot, localUnit);
        if (opponentUnit === undefined) {
            throw new Error(`No visible adjacent opponent tactics unit for ${localUnit.id}.`);
        }

        return { localUnit, opponentUnit };
    }

    private async waitForProjectedOwnedUnitAt(grid: TacticsGridPoint): Promise<void> {
        try {
            await expect
                .poll(() => this.isProjectedOwnedUnitAt(grid), {
                    timeout: PROJECTED_SNAPSHOT_TIMEOUT_MS,
                })
                .toBe(true);
        } catch (error) {
            const snapshot = await this.readCurrentSnapshot();
            throw new Error(
                `Timed out waiting for owned tactics primitive at (${grid.x}, ${grid.y}). ${summarizeTacticsSnapshot(snapshot)}`,
                { cause: error },
            );
        }
    }

    private async waitForProjectedUnitDefeated(unitId: string): Promise<void> {
        try {
            await expect
                .poll(() => this.isProjectedUnitDefeated(unitId), {
                    timeout: PROJECTED_SNAPSHOT_TIMEOUT_MS,
                })
                .toBe(true);
        } catch (error) {
            const snapshot = await this.readCurrentSnapshot();
            throw new Error(
                `Timed out waiting for tactics primitive ${unitId} to be defeated. ${summarizeTacticsSnapshot(snapshot)}`,
                { cause: error },
            );
        }
    }

    private async isProjectedOwnedUnitAt(grid: TacticsGridPoint): Promise<boolean> {
        const snapshot = await this.readCurrentSnapshot();
        const localUnit = findLocalUnitInSnapshot(snapshot);
        return localUnit?.x === grid.x && localUnit.y === grid.y;
    }

    private async isProjectedUnitDefeated(unitId: string): Promise<boolean> {
        const snapshot = await this.readCurrentSnapshot();
        const unit = findProjectedUnitById(snapshot, unitId);
        return unit !== undefined && unit.hp <= 0;
    }

    private async waitForCanvasInteractionFrame(): Promise<void> {
        await this.page.waitForFunction(
            () =>
                new Promise<boolean>((resolve) => {
                    const scheduleFrame = (
                        globalThis as typeof globalThis & {
                            readonly requestAnimationFrame: (callback: () => void) => number;
                        }
                    ).requestAnimationFrame;
                    let framesRemaining = 3;
                    const waitForFrame = (): void => {
                        framesRemaining -= 1;
                        if (framesRemaining <= 0) {
                            resolve(true);
                            return;
                        }
                        scheduleFrame(waitForFrame);
                    };

                    scheduleFrame(waitForFrame);
                }),
            undefined,
            { timeout: 5_000 },
        );
    }

    private async waitForVisibleAdjacentOpponent(): Promise<void> {
        try {
            await expect
                .poll(
                    async () => {
                        const snapshot = await this.readCurrentSnapshot();
                        const localUnit = findLocalUnitInSnapshot(snapshot);
                        return (
                            localUnit !== undefined &&
                            findAdjacentOpponentUnitInSnapshot(snapshot, localUnit) !== undefined
                        );
                    },
                    { timeout: PROJECTED_SNAPSHOT_TIMEOUT_MS },
                )
                .toBe(true);
        } catch (error) {
            const snapshot = await this.readCurrentSnapshot();
            throw new Error(
                `Timed out waiting for visible adjacent opponent. ${summarizeTacticsSnapshot(snapshot)}`,
                { cause: error },
            );
        }
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

function unitGridPoint(unit: TacticsUnitProjection): TacticsGridPoint {
    return { x: unit.x, y: unit.y };
}

function tacticsRevealMoveTarget(localUnit: TacticsUnitProjection): TacticsGridPoint {
    const direction = localUnit.x < TACTICS_REVEAL_CENTER_X ? 1 : -1;
    return { x: localUnit.x + direction, y: localUnit.y };
}

function projectGridPointToCanvasPosition(
    grid: TacticsGridPoint,
    box: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
    const { left, right, top, bottom } = TACTICS_CANVAS_WORLD_BOUNDS;
    return {
        x: ((right - grid.x) / (right - left)) * box.width,
        y: ((top - grid.y) / (top - bottom)) * box.height,
    };
}

function isCanvasPositionInsideBox(
    position: { readonly x: number; readonly y: number },
    box: { readonly width: number; readonly height: number },
): boolean {
    return (
        position.x >= 0 && position.x <= box.width && position.y >= 0 && position.y <= box.height
    );
}

function listProjectedUnits(snapshot: TacticsSnapshotProjection): readonly TacticsUnitProjection[] {
    return Object.values(snapshot.entities).filter(isTacticsUnitProjection);
}

function findLocalUnitInSnapshot(
    snapshot: TacticsSnapshotProjection,
): TacticsUnitProjection | undefined {
    return listProjectedUnits(snapshot).find((candidate) => {
        return candidate.ownerId === snapshot.viewerId && candidate.hp > 0;
    });
}

function findAdjacentOpponentUnitInSnapshot(
    snapshot: TacticsSnapshotProjection,
    localUnit: TacticsUnitProjection,
): TacticsUnitProjection | undefined {
    return listProjectedUnits(snapshot).find((candidate) => {
        return (
            candidate.ownerId !== snapshot.viewerId &&
            candidate.hp > 0 &&
            Math.abs(candidate.x - localUnit.x) + Math.abs(candidate.y - localUnit.y) === 1
        );
    });
}

function findProjectedUnitById(
    snapshot: TacticsSnapshotProjection,
    unitId: string,
): TacticsUnitProjection | undefined {
    return listProjectedUnits(snapshot).find((unit) => unit.id === unitId);
}

function summarizeTacticsSnapshot(snapshot: TacticsSnapshotProjection): string {
    const snapshotRecord = snapshot as TacticsSnapshotProjection &
        Readonly<{ readonly tick?: unknown; readonly isMyTurn?: unknown }>;
    const units = listProjectedUnits(snapshot)
        .map((unit) => `${unit.id}:${unit.ownerId}@${unit.x},${unit.y}/hp${unit.hp}`)
        .join('; ');

    return `Snapshot viewer=${snapshot.viewerId} tick=${String(snapshotRecord.tick)} isMyTurn=${String(snapshotRecord.isMyTurn)} units=[${units}].`;
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
