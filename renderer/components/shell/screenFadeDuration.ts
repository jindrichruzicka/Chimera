/**
 * Shared durations for the app-level screen fades (menu ↔ lobby ↔ game route
 * transitions, plus the boot logo sequence). Two speeds:
 *
 *   - `fast` — the default for all normal transitions (route nav, game
 *     enter/leave, lobby/menu fades).
 *   - `slow` — the deliberate boot fades: the logo screen fading in and out,
 *     and the main menu fading in from black. Twice the fast duration by
 *     default so the boot sequence feels intentional rather than snappy.
 *
 * Both collapse to 0ms under the Playwright e2e flag so the large navigation
 * suite is not slowed — and never blocked behind a black overlay — by the
 * fades. Mirrors the per-frame `fadeOutMs: 0 / fadeInMs: 0` override the game
 * page already applies to the in-game TransitionOverlay under e2e.
 *
 * These are plain constants (not `--ch-*` CSS motion tokens): the fades are
 * animated in JS by the FadeProvider, not by CSS animations, so retiming them
 * means editing the values below.
 */

/** Fast screen-fade duration (ms): the default for all normal transitions. */
export const SCREEN_FADE_FAST_MS = 200;

/**
 * Slow screen-fade duration (ms): the deliberate boot fades (logo in/out,
 * main-menu fade-in). Defaults to twice {@link SCREEN_FADE_FAST_MS}.
 */
export const SCREEN_FADE_SLOW_MS = 2 * SCREEN_FADE_FAST_MS;

/** Back-compat alias for the fast duration (200ms). */
export const SCREEN_FADE_MS = SCREEN_FADE_FAST_MS;

/** Which speed tier a screen fade should run at. */
export type ScreenFadeSpeed = 'fast' | 'slow';

/**
 * The screen-fade duration to use right now: 0 when running under the
 * Playwright e2e build (so navigation is instant, regardless of speed),
 * otherwise the {@link SCREEN_FADE_FAST_MS} / {@link SCREEN_FADE_SLOW_MS}
 * duration for `speed` (defaults to `'fast'`).
 */
export function screenFadeMs(speed: ScreenFadeSpeed = 'fast'): number {
    if (process.env['NEXT_PUBLIC_CHIMERA_E2E'] === '1') {
        return 0;
    }
    return speed === 'slow' ? SCREEN_FADE_SLOW_MS : SCREEN_FADE_FAST_MS;
}
