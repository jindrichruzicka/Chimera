/**
 * hud-layout.spec.ts
 *
 * Geometry guard for the in-match command strip. The tactics HUD is styled as
 * a slim centered island (one 36px control row), but its height is decided by
 * the real CSS cascade — engine `Divider.vertical` pins a large standalone
 * `min-height` (--ch-divider-length-sm) that once outranked the game override
 * by bundle order and silently inflated the island to 172px. Unit tests cannot
 * see the composed cascade, so the bound is asserted here against the packaged
 * renderer bundle.
 *
 * Also pins the chat toggle to the command bar's own centre line: the dock is
 * absolutely anchored inside the HUD footer row, so the bubble must share the
 * island's vertical centre instead of free-floating over the board.
 */
import { test, expect } from '../fixtures/direct-game.fixture';

/** Generous ceiling for the island: one 36px row + panel padding + borders. */
const MAX_BAR_HEIGHT_PX = 64;

test.describe('HUD layout', () => {
    test('command bar stays a slim island with the chat toggle on its centre line', async ({
        hostWindow,
    }) => {
        await hostWindow.getByTestId('tactics-hud-panel').waitFor();

        const panel = await hostWindow.getByTestId('tactics-hud-panel').boundingBox();
        const toggle = await hostWindow.getByTestId('tactics-chat-toggle').boundingBox();
        expect(panel).not.toBeNull();
        expect(toggle).not.toBeNull();
        if (panel === null || toggle === null) return;

        // The island is one slim control row, not a tall panel.
        expect(panel.height).toBeLessThanOrEqual(MAX_BAR_HEIGHT_PX);

        // The chat bubble rides the command bar's centre line (same footer row),
        // within a small tolerance for sub-pixel layout rounding.
        const panelCenterY = panel.y + panel.height / 2;
        const toggleCenterY = toggle.y + toggle.height / 2;
        expect(Math.abs(panelCenterY - toggleCenterY)).toBeLessThanOrEqual(2);

        // And it sits at the footer's trailing edge, past the centered island.
        expect(toggle.x).toBeGreaterThan(panel.x + panel.width);
    });

    /**
     * The permanent negative control for the opt-in loading cover (§4.36).
     *
     * Tactics declares `loadingScreens` for its `asset-demo` screen and for
     * nothing else, and no registry-wide `loadingScreen` — so the default is
     * NOTHING, and the in-match playfield is where that default is visible. It
     * lives here, on an ordinary screen in the real build, precisely so it
     * stays a negative control: opting the playfield in would delete the only
     * evidence that a game gets no cover it did not ask for.
     */
    test('an ordinary tactics screen carries no loading cover once the match is up', async ({
        hostWindow,
    }) => {
        // The settled state, after the HUD is up: the route-entry gate raises
        // its own cover during boot and drops it on every settle path, so what
        // is measured here is that nothing was left standing and that the
        // playfield resolves no cover of its own.
        await hostWindow.getByTestId('tactics-hud-panel').waitFor();

        // The declared-cover surface: every engine preset form renders through
        // this one element, so its absence is the absence of a resolved cover.
        await expect(hostWindow.getByTestId('scene-loading-preset')).toHaveCount(0);
        // And neither cover LAYER is standing. Both are `--ch-z-loading-hud`,
        // above every modal and toast, so one left up would outlive the wait it
        // was raised for and swallow the rest of the match visually.
        await expect(hostWindow.getByTestId('route-entry-loading-cover')).toHaveCount(0);
        await expect(hostWindow.getByTestId('scene-preload-cover')).toHaveCount(0);
    });
});
