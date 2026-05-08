// @vitest-environment jsdom

import { cleanup, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultTheme } from './default-theme';
import { ThemeProvider } from './ThemeProvider';
import { ThemeRegistry } from './ThemeRegistry';
import { ThemeRegistryTestHelpers } from './__test-support__/ThemeRegistry.test-helpers';
import type { ThemeDefinition, ThemeId } from './types';
import { themeId } from './types';
import { useTheme } from './useTheme';
import { useThemeOverride } from './useThemeOverride';

const overrideTheme: ThemeDefinition = {
    ...defaultTheme,
    id: themeId('test-game-theme'),
    name: 'Test Game Theme',
};

function ThemeIdProbe(): React.ReactElement {
    const { current } = useTheme();

    return <span data-testid="theme-id">{current.id}</span>;
}

function GameScene({ themeId: id }: { readonly themeId: ThemeId }): React.ReactElement {
    const theme = useThemeOverride(id);

    return (
        <ThemeProvider theme={theme}>
            <ThemeIdProbe />
        </ThemeProvider>
    );
}

afterEach(() => {
    cleanup();
    ThemeRegistryTestHelpers.reset();
});

beforeEach(() => {
    ThemeRegistryTestHelpers.reset();
});

describe('useThemeOverride', () => {
    it('returns the engine-default theme for the engine-default id', () => {
        const { result } = renderHook(() => useThemeOverride(themeId('engine-default')), {
            wrapper: ThemeProvider,
        });

        expect(result.current).toBe(defaultTheme);
    });

    it('returns the defaultTheme when the id is not registered', () => {
        const { result } = renderHook(() => useThemeOverride(themeId('unknown-theme')), {
            wrapper: ThemeProvider,
        });

        expect(result.current).toBe(defaultTheme);
    });

    it('returns the registered theme when the id is registered', () => {
        ThemeRegistry.register(overrideTheme.id, overrideTheme);

        const { result } = renderHook(() => useThemeOverride(overrideTheme.id), {
            wrapper: ThemeProvider,
        });

        expect(result.current).toBe(overrideTheme);
    });

    it('activates the registered theme within a nested ThemeProvider on mount', () => {
        ThemeRegistry.register(overrideTheme.id, overrideTheme);

        render(
            <ThemeProvider>
                <GameScene themeId={overrideTheme.id} />
            </ThemeProvider>,
        );

        expect(screen.getByTestId('theme-id').textContent).toBe(overrideTheme.id);
    });

    it('reverts to engine-default theme after game scene unmounts', () => {
        ThemeRegistry.register(overrideTheme.id, overrideTheme);

        function Wrapper({ showGame }: { readonly showGame: boolean }): React.ReactElement {
            return (
                <ThemeProvider>
                    {showGame ? <GameScene themeId={overrideTheme.id} /> : <ThemeIdProbe />}
                </ThemeProvider>
            );
        }

        const { rerender } = render(<Wrapper showGame={true} />);
        expect(screen.getByTestId('theme-id').textContent).toBe(overrideTheme.id);

        rerender(<Wrapper showGame={false} />);
        expect(screen.getByTestId('theme-id').textContent).toBe(defaultTheme.id);
    });
});
