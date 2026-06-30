// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FadeProvider, useFade } from './FadeContext.js';
import { useScreenFadeNavigate } from './useScreenFadeNavigate.js';

afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
});

beforeEach(() => {
    // Collapse the fade to 0ms so fadeOut resolves on the next microtask.
    vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
});

describe('useScreenFadeNavigate', () => {
    it('fades out to black before invoking the navigate callback', async () => {
        const navigate = vi.fn();
        let fadeOutThenNavigate: ((navigate: () => void) => Promise<void>) | null = null;
        let opacity = -1;

        function Consumer(): React.ReactElement {
            fadeOutThenNavigate = useScreenFadeNavigate();
            opacity = useFade().opacity;
            return <div />;
        }

        render(
            <FadeProvider>
                <Consumer />
            </FadeProvider>,
        );

        await act(async () => {
            await fadeOutThenNavigate?.(navigate);
        });

        expect(navigate).toHaveBeenCalledTimes(1);
        // The overlay is fully black at the moment navigation happens.
        expect(opacity).toBe(1);
    });
});
