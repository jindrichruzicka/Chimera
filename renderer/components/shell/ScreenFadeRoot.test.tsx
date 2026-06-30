// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFade } from './FadeContext.js';
import { ScreenFadeRoot } from './ScreenFadeRoot.js';

afterEach(() => {
    cleanup();
});

describe('ScreenFadeRoot', () => {
    it('provides the app-level fade context and mounts the overlay around its children', () => {
        function Consumer(): React.ReactElement {
            // Throws if no FadeProvider is above — proves the context is provided.
            useFade();
            return <div data-testid="child" />;
        }

        render(
            <ScreenFadeRoot>
                <Consumer />
            </ScreenFadeRoot>,
        );

        expect(screen.getByTestId('child')).toBeTruthy();
        expect(screen.getByTestId('screen-fade-overlay')).toBeTruthy();
    });
});
