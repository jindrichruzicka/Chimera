// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultTheme } from './default-theme';
import { ThemeProvider } from './ThemeProvider';
import type { ThemeDefinition } from './types';
import { themeId } from './types';
import { useTheme } from './useTheme';

function ThemeProbe(): React.ReactElement {
    const { current } = useTheme();

    return <span data-testid="theme-id">{current.id}</span>;
}

const capturedContextValues: { current: ThemeDefinition }[] = [];

function ContextValueCapture(): React.ReactElement {
    const contextValue = useTheme();

    // Capture the reference on each render
    React.useLayoutEffect(() => {
        capturedContextValues.push(contextValue);
    });

    return <span data-testid="tracker">{contextValue.current.id}</span>;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ThemeProvider and useTheme', () => {
    it('provides the default engine theme when no override is supplied', () => {
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>,
        );

        expect(screen.getByTestId('theme-id').textContent).toBe(defaultTheme.id);
    });

    it('provides the supplied current theme from context', () => {
        const customTheme: ThemeDefinition = {
            ...defaultTheme,
            id: themeId('custom-test-theme'),
            name: 'Custom Test Theme',
        };

        render(
            <ThemeProvider theme={customTheme}>
                <ThemeProbe />
            </ThemeProvider>,
        );

        expect(screen.getByTestId('theme-id').textContent).toBe(customTheme.id);
    });

    it('throws a descriptive error when the hook is used without a provider', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => render(<ThemeProbe />)).toThrow('useTheme must be used within ThemeProvider');
    });

    it('stabilizes context value reference to prevent unnecessary consumer re-renders', () => {
        capturedContextValues.length = 0; // Clear captured values

        function ParentWithRerender() {
            const [renderCount, setRenderCount] = useState(0);

            return (
                <ThemeProvider theme={defaultTheme}>
                    <ContextValueCapture />
                    <button
                        data-testid="rerender-button"
                        onClick={() => setRenderCount((c) => c + 1)}
                    >
                        Rerender {renderCount}
                    </button>
                </ThemeProvider>
            );
        }

        render(<ParentWithRerender />);

        // Initial render should capture first context value
        expect(capturedContextValues).toHaveLength(1);
        const firstContextValue = capturedContextValues[0]!;

        // Trigger parent rerender by clicking button
        const button = screen.getByTestId('rerender-button');
        fireEvent.click(button);

        // After rerender, context value reference should be the same (memoized)
        expect(capturedContextValues).toHaveLength(2);
        expect(capturedContextValues[1]).toBe(firstContextValue);
    });
});
