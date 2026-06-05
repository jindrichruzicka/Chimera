import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the replay player route (`/replays/player`). Wraps the
 * `ReplayControls` transport (Play/Pause, scrubber, speed) and the
 * `<current> / <total>` tick counter so a test can drive playback and assert it
 * reaches the final tick (F44 / T9, #663).
 */
export class ReplayPlayerPage {
    readonly playButton: Locator;
    readonly pauseButton: Locator;
    readonly tickCounter: Locator;
    readonly scrubber: Locator;
    readonly speedSelect: Locator;
    readonly seekToEndButton: Locator;
    readonly stepBackButton: Locator;

    public constructor(private readonly page: Page) {
        this.playButton = page.getByTestId('replay-play-btn');
        this.pauseButton = page.getByTestId('replay-pause-btn');
        this.tickCounter = page.getByTestId('replay-tick-counter');
        this.scrubber = page.getByTestId('replay-scrubber');
        // Native <select> labelled "Playback speed" — the engine Select primitive
        // associates its label via `htmlFor`, so locate it by accessible name.
        this.speedSelect = page.getByLabel('Playback speed');
        // Transport buttons carry only aria-labels (no test ids). They let a test
        // reach the final stretch without real-time playing the whole timeline,
        // which is wall-clock-unbounded since ticks advance in real time.
        this.seekToEndButton = page.getByRole('button', { name: 'Seek to end' });
        this.stepBackButton = page.getByRole('button', { name: 'Step back' });
    }

    /**
     * Position the playhead one tick before the end via the transport buttons
     * (seek-to-end then step-back), so a subsequent {@link play} advances a
     * single tick to the final tick regardless of the replay's length.
     * @throws via the caller's assertions if the replay has no playable span.
     */
    public async seekToPenultimateTick(): Promise<void> {
        await this.seekToEndButton.click();
        await this.stepBackButton.click();
    }

    /**
     * Parse the `<current> / <total>` tick counter that `ReplayControls` renders.
     * @throws {Error} when `text` is not in that shape (e.g. a loading state).
     */
    public static parseTickCounter(text: string): {
        readonly current: number;
        readonly total: number;
    } {
        const match = /(\d+)\s*\/\s*(\d+)/.exec(text);
        if (match === null) {
            throw new Error(`Replay tick counter "${text}" is not "<current> / <total>"`);
        }
        return { current: Number(match[1]), total: Number(match[2]) };
    }

    private async readCounter(): Promise<{ readonly current: number; readonly total: number }> {
        return ReplayPlayerPage.parseTickCounter(await this.tickCounter.innerText());
    }

    /** The current playback tick parsed from the tick counter. */
    public async currentTick(): Promise<number> {
        return (await this.readCounter()).current;
    }

    /** The replay's total tick count parsed from the tick counter. */
    public async totalTicks(): Promise<number> {
        return (await this.readCounter()).total;
    }

    /** Select a playback speed multiplier (one of 0.5, 1, 2, 4). */
    public async setSpeed(multiplier: number): Promise<void> {
        await this.speedSelect.selectOption(String(multiplier));
    }

    /** Start auto-advancing playback. */
    public async play(): Promise<void> {
        await this.playButton.click();
    }

    /**
     * Wait until playback reaches the final tick — the counter reads
     * `<total> / <total>` with a positive total. Polls because auto-advance is
     * wall-clock driven by `ReplayControls`.
     */
    public async waitForFinalTick(timeout = 60_000): Promise<void> {
        await expect
            .poll(
                async () => {
                    const { current, total } = await this.readCounter();
                    return total > 0 && current >= total;
                },
                { timeout },
            )
            .toBe(true);
    }
}
