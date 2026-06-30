// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FadeProvider } from './FadeContext.js';
import { ScreenFadeOverlay } from './ScreenFadeOverlay.js';

afterEach(() => {
    cleanup();
});

describe('ScreenFadeOverlay', () => {
    it('renders a full-screen black overlay whose opacity tracks the fade provider', () => {
        render(
            <FadeProvider initialOpacity={0.5}>
                <ScreenFadeOverlay />
            </FadeProvider>,
        );

        const overlay = screen.getByTestId('screen-fade-overlay');
        expect(overlay.style.opacity).toBe('0.5');
        expect(overlay.style.position).toBe('fixed');
        expect(overlay.style.backgroundColor).toBe('var(--ch-color-scrim)');
        // It must never intercept clicks meant for the screen beneath it.
        expect(overlay.style.pointerEvents).toBe('none');
        expect(overlay.getAttribute('aria-hidden')).toBe('true');
    });

    it('is fully transparent when the fade provider is idle at 0', () => {
        render(
            <FadeProvider>
                <ScreenFadeOverlay />
            </FadeProvider>,
        );

        expect(screen.getByTestId('screen-fade-overlay').style.opacity).toBe('0');
    });
});
