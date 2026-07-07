import { expect, type Locator, type Page } from '@playwright/test';
import {
    analyzeCanvasPixels,
    decodePngToRgbaFrame,
    formatCanvasPixelStats,
    summarizeOpaqueColor,
    type CanvasColor,
    type CanvasPixelStats,
} from '../helpers/canvas-pixels';

/**
 * Host-authored game setup as carried on the projected PlayerSnapshot
 * (`snapshot.setup`). Identical for host and client (not obfuscated), so a deep
 * comparison across both windows proves the lobby configuration synced into the
 * match.
 */
export interface GameSetupProjection {
    readonly matchSettings: Readonly<Record<string, string>>;
    readonly playerAttributes: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface TacticsGridPoint {
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

// Mirrors apps/tactics/scene/tacticsCamera.ts without importing game rendering internals.
// Kept in sync by GamePage.test.ts (sync-guard tests import the source-of-truth directly).
// These are the camera frustum world bounds — used to project a grid point to a canvas
// pixel. Since #710 widened the frustum past the board so corner units render whole, this
// is wider than the playable board and must NOT be used to decide which tiles are clickable.
export const TACTICS_CANVAS_WORLD_BOUNDS = {
    left: -2.75,
    right: 4.75,
    top: 2.5,
    bottom: -2.5,
} as const;

// The playable board-plane extents (TacticsGroundPlane: 6×4 centred on (1, 0)), distinct
// from the now-wider camera frustum. Generated move targets are tested against these so they
// stay on the board, away from the canvas margin the frustum now shows beyond the edge.
const TACTICS_MOVE_AREA_WORLD_BOUNDS = {
    left: -2,
    right: 4,
    top: 2,
    bottom: -2,
} as const;

export const TACTICS_REVEAL_CENTER_X = 1;
const TACTICS_MOVE_RETRY_ATTEMPTS = 3;
const TACTICS_ATTACK_RETRY_ATTEMPTS = 3;
const PROJECTED_SNAPSHOT_TIMEOUT_MS = 30_000;
// Commitment mode: a buffered move updates the optimistic HUD stamina via a local
// (synchronous) store write, so a registered click is reflected within a frame.
// This window only needs to outlast canvas/render settle on a slow CI runner; it
// is the per-attempt budget for detecting whether a select+click actually buffered.
const TACTICS_OPTIMISTIC_BUFFER_TIMEOUT_MS = 10_000;
// One pixel read = rAF settle + locator.screenshot(); on CI runners (2-core,
// Xvfb + software GL) a single screenshot alone was measured at 6–11s, so the
// poll budget must fit several worst-case iterations or the predicate never
// gets evaluated at all.
const TACTICS_CANVAS_PIXEL_TIMEOUT_MS = 45_000;
const TACTICS_MIN_NONBLANK_PIXEL_RATIO = 0.05;
const TACTICS_MIN_COLOR_PIXEL_RATIO = 0.0001;
const TACTICS_MIN_COLOR_PIXELS = 2;
const TACTICS_MAX_ABSENT_COLOR_PIXEL_RATIO = 0.00002;
const TACTICS_MAX_ABSENT_COLOR_PIXELS = 1;

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
    readonly replayButton: Locator;
    readonly staminaReadout: Locator;
    readonly turnStatus: Locator;
    readonly commitStatus: Locator;
    readonly revealOverlay: Locator;
    readonly saveButton: Locator;
    readonly saveNameDialog: Locator;
    readonly saveNameInput: Locator;
    readonly saveNameConfirm: Locator;

    public constructor(
        private readonly page: Page,
        private readonly pixelPollTimeoutMs = TACTICS_CANVAS_PIXEL_TIMEOUT_MS,
    ) {
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
        // Post-game summary replay action (F44 / T8). Saving moved into the replay
        // player's compact save icon — see `ReplayPlayerPage.saveButton`.
        this.replayButton = page.getByTestId('post-game-replay-btn');
        // Stamina / turn-gating / commitment HUD surfaces (F54). In commitment mode
        // End Turn IS the commit; `commitStatus` is the pulsing "waiting for other
        // player(s)" message shown only while a committed seat awaits the rest.
        this.staminaReadout = page.getByTestId('hud-stamina');
        this.turnStatus = page.getByTestId('tactics-turn-status');
        this.commitStatus = page.getByTestId('tactics-commit-status');
        this.revealOverlay = page.getByTestId('tactics-reveal');
        // HUD save flow (F68). The trigger is host-only (client shells receive
        // no `saveGame` capability) and disabled while the commitment buffer
        // holds unsent moves; the name dialog is a `SaveGameButton` Modal.
        this.saveButton = page.getByTestId('hud-save-btn');
        this.saveNameDialog = page.getByTestId('save-name-dialog');
        this.saveNameInput = page.getByTestId('save-name-input');
        this.saveNameConfirm = page.getByTestId('save-name-confirm');
    }

    /** HUD save flow: open the name dialog, fill it, confirm, wait for close. */
    public async saveGame(label: string): Promise<void> {
        await expect(this.saveButton).toBeEnabled();
        await this.saveButton.click();
        await expect(this.saveNameDialog).toBeVisible();
        await this.saveNameInput.fill(label);
        await this.saveNameConfirm.click();
        // Modal actions always close the dialog after onClick; it unmounts.
        await expect(this.saveNameDialog).toHaveCount(0);
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

    public async moveOwnedUnitToOpenTile(): Promise<void> {
        await this.selectOwnedPrimitive();
        await this.moveSelectedPrimitiveToOpenTile();
    }

    public async selectOwnedPrimitive(): Promise<void> {
        const localUnit = await this.findLocalUnit();
        await this.clickTacticsGridPoint(unitGridPoint(localUnit));
        await this.waitForCanvasInteractionFrame();
    }

    /** The local unit's current grid position from the projected snapshot. */
    public async localUnitGrid(): Promise<TacticsGridPoint> {
        return unitGridPoint(await this.findLocalUnit());
    }

    /**
     * Move the local unit to an explicit, caller-chosen grid tile: select it, then
     * click the target, polling until the projected snapshot shows it arrived.
     * Lets a spec drive deterministic moves between central, well-projected tiles
     * (more robust than letting the unit drift toward edge tiles). Retries the
     * select+click a few times to absorb canvas-click imprecision.
     */
    public async moveOwnedUnitTo(grid: TacticsGridPoint): Promise<void> {
        for (let attempt = 0; attempt < TACTICS_MOVE_RETRY_ATTEMPTS; attempt += 1) {
            await this.selectOwnedPrimitive();
            await this.clickTacticsGridPoint(grid);
            await this.waitForCanvasInteractionFrame();
            if (await this.isProjectedOwnedUnitAt(grid)) {
                return;
            }
        }
        await this.waitForProjectedOwnedUnitAt(grid);
    }

    /**
     * Commitment mode: buffer an optimistic move onto `grid` and confirm it
     * registered by waiting for the HUD stamina readout to reach `expectedStamina`.
     *
     * A buffered move is NEVER dispatched to the host — the projected snapshot keeps
     * the unit at its origin (secrecy), so the position-polling retry used by
     * {@link moveOwnedUnitTo} cannot detect it. The only observable signal is the
     * optimistic stamina decrement (a local store write), so this retries the
     * select+click until that stamina value appears, absorbing canvas-click
     * imprecision the same way the projected-move helpers do.
     *
     * The top-of-loop guard makes the retry safe against double-buffering: once the
     * stamina already shows `expectedStamina`, no further click is issued.
     */
    public async bufferOptimisticMoveTo(
        grid: TacticsGridPoint,
        expectedStamina: string,
    ): Promise<void> {
        for (let attempt = 0; attempt < TACTICS_MOVE_RETRY_ATTEMPTS; attempt += 1) {
            // Guard: a prior attempt may already have buffered the move. Never
            // click again once stamina reflects it, or we'd buffer a second move.
            if ((await this.staminaText()) === expectedStamina) {
                return;
            }
            await this.selectOwnedPrimitive();
            await this.clickTacticsGridPoint(grid);
            await this.waitForCanvasInteractionFrame();
            if (await this.staminaSettlesTo(expectedStamina)) {
                return;
            }
        }

        // Every attempt missed: assert once more for a clean failure that reports
        // the actual stamina value rather than a bare retry-exhausted error.
        await expect
            .poll(() => this.staminaText(), { timeout: TACTICS_OPTIMISTIC_BUFFER_TIMEOUT_MS })
            .toBe(expectedStamina);
    }

    /**
     * Poll the HUD stamina readout until it equals `expected`, returning whether it
     * settled within {@link TACTICS_OPTIMISTIC_BUFFER_TIMEOUT_MS}. Never throws — the
     * caller decides whether a miss warrants a retry.
     */
    private async staminaSettlesTo(expected: string): Promise<boolean> {
        try {
            await expect
                .poll(() => this.staminaText(), {
                    timeout: TACTICS_OPTIMISTIC_BUFFER_TIMEOUT_MS,
                })
                .toBe(expected);
            return true;
        } catch {
            return false;
        }
    }

    public async assertOwnedSelectionFeedbackChangesCanvas(): Promise<void> {
        await this.waitForCanvasInteractionFrame();
        const beforeSelection = await this.tacticsCanvas.screenshot();

        await this.selectOwnedPrimitive();
        await this.waitForCanvasInteractionFrame();

        const afterSelection = await this.tacticsCanvas.screenshot();
        if (beforeSelection.equals(afterSelection)) {
            throw new Error(
                'Selecting the owned tactics primitive did not change the rendered canvas.',
            );
        }
    }

    public async assertTacticsCanvasIsNonBlank(): Promise<void> {
        await this.waitForTacticsCanvasPixelExpectation(
            (stats) => stats.nonBlankPixels >= minimumNonBlankPixels(stats),
            'Tactics canvas did not render enough nonblank pixels',
        );
    }

    public async assertTacticsCanvasHasBluePrimitive(): Promise<void> {
        await this.waitForTacticsCanvasPixelExpectation(
            (stats) => stats.bluePixels >= minimumColorPixels(stats),
            'Tactics canvas did not render the expected blue local primitive pixels',
        );
    }

    public async assertTacticsCanvasHasNoRedPrimitive(): Promise<void> {
        const stats = await this.readTacticsCanvasPixelStats();
        if (stats.redPixels > maximumAbsentColorPixels(stats)) {
            // Retry once: a single transitional render frame may contain stray
            // anti-aliased red pixels even before the opponent is revealed.
            const retryStats = await this.readTacticsCanvasPixelStats();
            if (retryStats.redPixels > maximumAbsentColorPixels(retryStats)) {
                throw new Error(
                    `Tactics canvas rendered red opponent primitive pixels before reveal. ${formatCanvasPixelStats(retryStats)}.`,
                );
            }
        }
    }

    public async assertTacticsCanvasHasRedPrimitive(): Promise<void> {
        await this.waitForTacticsCanvasPixelExpectation(
            (stats) => stats.redPixels >= minimumColorPixels(stats),
            'Tactics canvas did not render the expected red opponent primitive pixels after reveal',
        );
    }

    public async assertTacticsCanvasHasGreenPrimitive(): Promise<void> {
        await this.waitForTacticsCanvasPixelExpectation(
            (stats) => stats.greenPixels >= minimumColorPixels(stats),
            'Tactics canvas did not render the expected green primitive pixels',
        );
    }

    public async assertTacticsCanvasHasAmberPrimitive(): Promise<void> {
        await this.waitForTacticsCanvasPixelExpectation(
            (stats) => stats.amberPixels >= minimumColorPixels(stats),
            'Tactics canvas did not render the expected amber primitive pixels',
        );
    }

    /**
     * Mean opaque colour of the tactics canvas — a stable proxy for the rendered
     * board colour (units occupy <1% of pixels). Used to assert board-colour
     * parity between the host and client windows.
     */
    public async readTacticsCanvasBackgroundColor(): Promise<CanvasColor> {
        await this.waitForCanvasInteractionFrame();
        const screenshot = await this.tacticsCanvas.screenshot({ type: 'png' });
        return summarizeOpaqueColor(decodePngToRgbaFrame(screenshot));
    }

    /**
     * Poll the projected snapshot until its host-authored `setup` is present,
     * returning it. After Start the first snapshot can lag the visible canvas by
     * a frame, so this gates on `setup` rather than assuming it immediately.
     */
    public async waitForGameSetup(): Promise<GameSetupProjection> {
        let lastSetup: GameSetupProjection | null = null;
        await expect
            .poll(
                async () => {
                    lastSetup = await this.readGameSetup();
                    return lastSetup !== null;
                },
                { timeout: PROJECTED_SNAPSHOT_TIMEOUT_MS },
            )
            .toBe(true);

        if (lastSetup === null) {
            throw new Error('Projected game setup was not available before the timeout.');
        }

        return lastSetup;
    }

    public async moveSelectedPrimitiveNearOpponent(): Promise<void> {
        const snapshot = await this.readCurrentSnapshot();
        const localUnit = findLocalUnitInSnapshot(snapshot);
        if (localUnit === undefined) {
            throw new Error(`No visible local tactics unit for viewer ${snapshot.viewerId}.`);
        }
        const targetGrid = tacticsMoveTarget(snapshot, localUnit);

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

    public async moveSelectedPrimitiveToOpenTile(): Promise<void> {
        const snapshot = await this.readCurrentSnapshot();
        const localUnit = findLocalUnitInSnapshot(snapshot);
        if (localUnit === undefined) {
            throw new Error(`No visible local tactics unit for viewer ${snapshot.viewerId}.`);
        }
        const targetGrid =
            tacticsOpenMoveTarget(snapshot, localUnit) ?? tacticsMoveTarget(snapshot, localUnit);

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

    /**
     * Attempt to move the local unit to an adjacent open tile and assert the move
     * is REJECTED — the unit stays at its origin. Proves a further action is
     * blocked (e.g. a 4th move at 0 stamina). Throws if the unit moved.
     */
    public async expectOwnedMoveRejected(): Promise<void> {
        const snapshot = await this.readCurrentSnapshot();
        const localUnit = findLocalUnitInSnapshot(snapshot);
        if (localUnit === undefined) {
            throw new Error(`No visible local tactics unit for viewer ${snapshot.viewerId}.`);
        }
        const origin = { x: localUnit.x, y: localUnit.y };
        const target =
            tacticsOpenMoveTarget(snapshot, localUnit) ?? tacticsMoveTarget(snapshot, localUnit);

        await this.selectOwnedPrimitive();
        await this.clickTacticsGridPoint(target);
        await this.waitForCanvasInteractionFrame();

        if (await this.isProjectedOwnedUnitAt(target)) {
            throw new Error(
                `Expected the move to ${JSON.stringify(target)} to be rejected, but the unit moved.`,
            );
        }
        if (!(await this.isProjectedOwnedUnitAt(origin))) {
            throw new Error(
                `Expected the unit to remain at ${JSON.stringify(origin)} after a rejected move.`,
            );
        }
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

    public async currentTick(): Promise<number> {
        const text = await this.hudTick.innerText();
        return parseInt(text, 10);
    }

    /** The HUD stamina readout text, e.g. `"3/3"` (commitment mode is optimistic). */
    public async staminaText(): Promise<string> {
        return (await this.staminaReadout.innerText()).trim();
    }

    /** The turn-status badge text, e.g. `"Your turn"` / `"Waiting"`. */
    public async turnStatusText(): Promise<string> {
        return (await this.turnStatus.innerText()).trim();
    }

    /** The commit status state attribute: `"pending"` | `"waiting"` | `"committed"`. */
    public async commitStatusState(): Promise<string | null> {
        return this.commitStatus.getAttribute('data-state');
    }

    /** The committer id shown on the latest reveal overlay (`data-player`). */
    public async revealPlayer(): Promise<string | null> {
        return this.revealOverlay.getAttribute('data-player');
    }

    /** Whether the latest revealed turn contained an attack (`data-has-attack`). */
    public async revealHasAttack(): Promise<string | null> {
        return this.revealOverlay.getAttribute('data-has-attack');
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

    private async waitForTacticsCanvasPixelExpectation(
        predicate: (stats: CanvasPixelStats) => boolean,
        failureMessage: string,
    ): Promise<void> {
        let lastStats: CanvasPixelStats | null = null;
        try {
            await expect
                .poll(
                    async () => {
                        lastStats = await this.readTacticsCanvasPixelStats();
                        return predicate(lastStats);
                    },
                    { timeout: this.pixelPollTimeoutMs },
                )
                .toBe(true);
        } catch (error) {
            const stats = lastStats ?? (await this.readTacticsCanvasPixelStats());
            throw new Error(`${failureMessage}. ${formatCanvasPixelStats(stats)}.`, {
                cause: error,
            });
        }
    }

    private async readTacticsCanvasPixelStats(): Promise<CanvasPixelStats> {
        await this.waitForCanvasInteractionFrame();
        const screenshot = await this.tacticsCanvas.screenshot({ type: 'png' });
        // Decode and analyze in the test process (pngjs) — never via
        // page.evaluate. On CI the renderer main thread is saturated by
        // software-GL R3F rendering, and a CDP round-trip with the decoded
        // pixel payload was measured at ~8s per read, blowing the poll budget.
        return analyzeCanvasPixels(decodePngToRgbaFrame(screenshot));
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

    private async readGameSetup(): Promise<GameSetupProjection | null> {
        const setup = await this.page.evaluate(async () => {
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

            const snapshot = await gameApi.getCurrentSnapshot();
            if (typeof snapshot !== 'object' || snapshot === null) {
                return null;
            }

            return (snapshot as Readonly<Record<string, unknown>>)['setup'] ?? null;
        });

        return isGameSetupProjection(setup) ? setup : null;
    }
}

function unitGridPoint(unit: TacticsUnitProjection): TacticsGridPoint {
    return { x: unit.x, y: unit.y };
}

function tacticsRevealMoveTarget(localUnit: TacticsUnitProjection): TacticsGridPoint {
    const direction = localUnit.x < TACTICS_REVEAL_CENTER_X ? 1 : -1;
    return { x: localUnit.x + direction, y: localUnit.y };
}

function tacticsMoveTarget(
    snapshot: TacticsSnapshotProjection,
    localUnit: TacticsUnitProjection,
): TacticsGridPoint {
    const revealTarget = tacticsRevealMoveTarget(localUnit);
    if (!isGridOccupiedByOtherUnit(snapshot, revealTarget, localUnit.id)) {
        return revealTarget;
    }

    const opponentUnit = listProjectedUnits(snapshot).find((candidate) => {
        return candidate.ownerId !== snapshot.viewerId && candidate.hp > 0;
    });
    const targetAnchor = opponentUnit ?? findProjectedUnitAt(snapshot, revealTarget);
    if (targetAnchor === undefined) {
        return revealTarget;
    }

    return findUnoccupiedAdjacentTarget(snapshot, localUnit, targetAnchor) ?? revealTarget;
}

function tacticsOpenMoveTarget(
    snapshot: TacticsSnapshotProjection,
    localUnit: TacticsUnitProjection,
): TacticsGridPoint | undefined {
    const awayFromCenter = localUnit.x < TACTICS_REVEAL_CENTER_X ? -1 : 1;
    const candidates: readonly TacticsGridPoint[] = [
        { x: localUnit.x + awayFromCenter, y: localUnit.y },
        { x: localUnit.x, y: localUnit.y - 1 },
        { x: localUnit.x, y: localUnit.y + 1 },
        { x: localUnit.x - awayFromCenter, y: localUnit.y },
    ];

    return candidates.find((candidate) => {
        return (
            isGridPointInsideTacticsMoveArea(candidate) &&
            !isGridOccupiedByOtherUnit(snapshot, candidate, localUnit.id)
        );
    });
}

function findUnoccupiedAdjacentTarget(
    snapshot: TacticsSnapshotProjection,
    localUnit: TacticsUnitProjection,
    anchor: TacticsUnitProjection,
): TacticsGridPoint | undefined {
    const candidates: readonly TacticsGridPoint[] = [
        { x: anchor.x - 1, y: anchor.y },
        { x: anchor.x + 1, y: anchor.y },
        { x: anchor.x, y: anchor.y - 1 },
        { x: anchor.x, y: anchor.y + 1 },
    ];

    return candidates.find((candidate) => {
        return (
            !isSameGridPoint(candidate, unitGridPoint(localUnit)) &&
            isGridPointInsideTacticsMoveArea(candidate) &&
            !isGridOccupiedByOtherUnit(snapshot, candidate, localUnit.id)
        );
    });
}

function findProjectedUnitAt(
    snapshot: TacticsSnapshotProjection,
    grid: TacticsGridPoint,
): TacticsUnitProjection | undefined {
    return listProjectedUnits(snapshot).find((unit) => {
        return unit.x === grid.x && unit.y === grid.y && unit.hp > 0;
    });
}

function isGridOccupiedByOtherUnit(
    snapshot: TacticsSnapshotProjection,
    grid: TacticsGridPoint,
    unitId: string,
): boolean {
    return listProjectedUnits(snapshot).some((unit) => {
        return unit.id !== unitId && unit.hp > 0 && unit.x === grid.x && unit.y === grid.y;
    });
}

function isGridPointInsideTacticsMoveArea(grid: TacticsGridPoint): boolean {
    const { left, right, top, bottom } = TACTICS_MOVE_AREA_WORLD_BOUNDS;
    return grid.x > left && grid.x < right && grid.y > bottom && grid.y < top;
}

function isSameGridPoint(first: TacticsGridPoint, second: TacticsGridPoint): boolean {
    return first.x === second.x && first.y === second.y;
}

function projectGridPointToCanvasPosition(
    grid: TacticsGridPoint,
    box: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
    const { left, right, top, bottom } = TACTICS_CANVAS_WORLD_BOUNDS;
    // Multiply before dividing: the #710 frustum range (7.5 × 5) makes a divide-first
    // ratio non-terminating in binary (e.g. 2.75 / 7.5), so grid points that land on exact
    // pixels would otherwise carry float dust and fail the deep-equality assertions.
    return {
        x: ((right - grid.x) * box.width) / (right - left),
        y: ((top - grid.y) * box.height) / (top - bottom),
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

function minimumNonBlankPixels(stats: CanvasPixelStats): number {
    return Math.max(1, Math.floor(stats.totalPixels * TACTICS_MIN_NONBLANK_PIXEL_RATIO));
}

function minimumColorPixels(stats: CanvasPixelStats): number {
    return Math.max(
        TACTICS_MIN_COLOR_PIXELS,
        Math.floor(stats.totalPixels * TACTICS_MIN_COLOR_PIXEL_RATIO),
    );
}

function maximumAbsentColorPixels(stats: CanvasPixelStats): number {
    return Math.max(
        TACTICS_MAX_ABSENT_COLOR_PIXELS,
        Math.floor(stats.totalPixels * TACTICS_MAX_ABSENT_COLOR_PIXEL_RATIO),
    );
}

function isTacticsSnapshotProjection(value: unknown): value is TacticsSnapshotProjection {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Readonly<Record<string, unknown>>;
    return typeof candidate['viewerId'] === 'string' && isRecord(candidate['entities']);
}

function isGameSetupProjection(value: unknown): value is GameSetupProjection {
    if (!isRecord(value)) {
        return false;
    }

    return isRecord(value['matchSettings']) && isRecord(value['playerAttributes']);
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
