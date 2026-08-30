import { expect, type Locator, type Page } from '@playwright/test';

/** How long a REVEAL may take on a CI runner, which runs an order slower. */
const REVEAL_TIMEOUT_MS = 30_000;

/**
 * The action app's match surface: the engine's `GameShell` chrome plus this
 * game's two registered screens (the playfield canvas and the HUD).
 *
 * Movement is driven through HELD keys rather than presses. The playfield turns
 * a seat's held direction set into ONE `action:set-velocity` and lets the host's
 * heartbeat move the primitive, so a tap that went down and up inside one beat
 * can legitimately move nothing — the hold is what the game is built around.
 */
export class ActionMatchPage {
    readonly canvas: Locator;
    readonly hudSlot: Locator;
    readonly tick: Locator;
    readonly screenFade: Locator;
    readonly routeCover: Locator;

    public constructor(private readonly page: Page) {
        this.canvas = page.getByTestId('game-canvas');
        this.hudSlot = page.getByTestId('game-hud-slot');
        this.tick = page.getByTestId('action-hud-tick');
        this.screenFade = page.getByTestId('screen-fade-overlay');
        this.routeCover = page.getByTestId('route-entry-loading-cover');
    }

    /**
     * Wait until the match is actually REVEALED, not merely mounted.
     *
     * Five conditions, because a canvas mounts long before the player can see
     * it: the canvas is there, the app-level curtain is down, no route-entry
     * cover is above it, and the chrome the loading beat withholds has both
     * been RELEASED and PAINTED. `toBeVisible` would answer yes through a fully
     * opaque scrim, so the fade is read as a CSS value instead.
     *
     * The HUD is checked in two parts. `game-hud-slot` is an unstyled engine
     * wrapper, and this game's HUD bar inside it is `position: absolute` — so
     * the wrapper collapses to a zero-height box and Playwright calls it hidden
     * however visible the bar is. Its presence is the release and nothing more;
     * the game's own tick readout is the half that proves paint.
     */
    public async waitForRevealed(timeout = REVEAL_TIMEOUT_MS): Promise<void> {
        await expect(this.canvas).toBeVisible({ timeout });
        await expect(this.screenFade).toHaveCSS('opacity', '0', { timeout });
        await expect(this.routeCover).toHaveCount(0, { timeout });
        await expect(this.hudSlot).toHaveCount(1, { timeout });
        await expect(this.tick).toBeVisible({ timeout });
    }

    /**
     * The heartbeat count the HUD is showing.
     *
     * The suite's CLOCK, and the only honest one available from outside the
     * host: a beat that changed nothing takes the engine's clock-only broadcast
     * path, which advances the renderer's tick WITHOUT sending a new snapshot —
     * so the tick on the snapshot the bridge hands back stops moving while the
     * match is plainly still running. This readout follows the clock-only path,
     * and it is also what the player is looking at.
     */
    public async hudTick(): Promise<number> {
        const text = (await this.tick.innerText()).trim();
        const value = Number(text.replace(/^Tick\s+/, ''));
        if (!Number.isFinite(value)) {
            throw new Error(`The HUD tick read as "${text}", which is not a number`);
        }
        return value;
    }

    /**
     * Hold `key` for `durationMs`, then release it.
     *
     * The release is in a `finally` so a failed assertion mid-hold cannot leave
     * a key down for the rest of the spec — a stuck key would keep dispatching
     * velocity into every later step.
     */
    public async holdKey(key: string, durationMs: number): Promise<void> {
        await this.page.keyboard.down(key);
        try {
            await this.page.waitForTimeout(durationMs);
        } finally {
            await this.page.keyboard.up(key);
        }
    }
}
