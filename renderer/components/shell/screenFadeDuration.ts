/**
 * renderer/components/shell/screenFadeDuration.ts
 *
 * Shared duration for the app-level screen fades (menu ↔ lobby ↔ game route
 * transitions). Collapses to 0ms under the Playwright e2e flag so the large
 * navigation suite is not slowed — and never blocked behind a black overlay —
 * by the fades. Mirrors the per-frame `fadeOutMs: 0 / fadeInMs: 0` override the
 * game page already applies to the in-game TransitionOverlay under e2e.
 */

/** Screen fade duration (ms) for normal runtime use. */
export const SCREEN_FADE_MS = 200;

/**
 * The screen-fade duration to use right now: 0 when running under the
 * Playwright e2e build (so navigation is instant), otherwise {@link SCREEN_FADE_MS}.
 */
export function screenFadeMs(): number {
    return process.env['NEXT_PUBLIC_CHIMERA_E2E'] === '1' ? 0 : SCREEN_FADE_MS;
}
