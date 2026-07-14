import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SCREEN_FADE_FAST_MS,
    SCREEN_FADE_MS,
    SCREEN_FADE_SLOW_MS,
    screenFadeMs,
} from './screenFadeDuration.js';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

function stubReducedMotionPreference(matches: boolean): void {
    vi.stubGlobal('window', {
        matchMedia: (query: string) => ({
            matches: query === '(prefers-reduced-motion: reduce)' && matches,
        }),
    });
}

describe('screen-fade durations', () => {
    it('uses 200ms as the fast (default) screen-fade duration', () => {
        expect(SCREEN_FADE_FAST_MS).toBe(200);
    });

    it('uses 400ms as the slow screen-fade duration', () => {
        expect(SCREEN_FADE_SLOW_MS).toBe(400);
    });

    it('defaults the slow duration to twice the fast one (2× slower)', () => {
        expect(SCREEN_FADE_SLOW_MS).toBe(2 * SCREEN_FADE_FAST_MS);
    });

    it('keeps SCREEN_FADE_MS as the fast-duration alias for back-compat', () => {
        expect(SCREEN_FADE_MS).toBe(SCREEN_FADE_FAST_MS);
        expect(SCREEN_FADE_MS).toBe(200);
    });
});

describe('screenFadeMs', () => {
    it('returns the fast duration by default outside e2e', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        expect(screenFadeMs()).toBe(SCREEN_FADE_FAST_MS);
    });

    it("returns the fast duration for speed 'fast' outside e2e", () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        expect(screenFadeMs('fast')).toBe(SCREEN_FADE_FAST_MS);
    });

    it("returns the slow duration for speed 'slow' outside e2e", () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        expect(screenFadeMs('slow')).toBe(SCREEN_FADE_SLOW_MS);
    });

    it('collapses to 0ms under the e2e flag for every speed so Playwright navigation is instant', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        expect(screenFadeMs()).toBe(0);
        expect(screenFadeMs('fast')).toBe(0);
        expect(screenFadeMs('slow')).toBe(0);
    });

    it('collapses to 0ms for every speed when the user prefers reduced motion', () => {
        // The JS-driven FadeProvider sits outside the CSS token collapse, so
        // the duration source itself must honour the preference.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        stubReducedMotionPreference(true);
        expect(screenFadeMs()).toBe(0);
        expect(screenFadeMs('fast')).toBe(0);
        expect(screenFadeMs('slow')).toBe(0);
    });

    it('keeps the normal durations when reduced motion is not requested', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        stubReducedMotionPreference(false);
        expect(screenFadeMs('fast')).toBe(SCREEN_FADE_FAST_MS);
        expect(screenFadeMs('slow')).toBe(SCREEN_FADE_SLOW_MS);
    });
});
