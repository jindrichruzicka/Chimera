import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCREEN_FADE_MS, screenFadeMs } from './screenFadeDuration.js';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('screenFadeMs', () => {
    it('returns the configured screen-fade duration outside e2e', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        expect(screenFadeMs()).toBe(SCREEN_FADE_MS);
    });

    it('collapses to 0ms under the e2e flag so Playwright navigation is instant', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        expect(screenFadeMs()).toBe(0);
    });

    it('uses 200ms as the default screen-fade duration', () => {
        expect(SCREEN_FADE_MS).toBe(200);
    });
});
