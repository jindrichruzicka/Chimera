// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RootErrorBoundary } from './RootErrorBoundary.js';

// Suppress React's console.error output for expected boundary errors in tests
beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

// A component that throws on render
function Bomb({ shouldThrow }: { readonly shouldThrow: boolean }): React.ReactElement {
    if (shouldThrow) throw new Error('test explosion');
    return <div>safe</div>;
}

describe('RootErrorBoundary', () => {
    it('renders children when no error is thrown', () => {
        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={false} />
            </RootErrorBoundary>,
        );
        expect(screen.getByText('safe')).toBeTruthy();
    });

    it('renders CrashFallback when a child throws', () => {
        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>,
        );
        expect(screen.getByText(/unexpected error/i)).toBeTruthy();
    });

    it('CrashFallback renders "Return to Main Menu" button', () => {
        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>,
        );
        expect(screen.getByRole('button', { name: /return to main menu/i })).toBeTruthy();
    });

    it('CrashFallback renders "Restart Application" button', () => {
        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>,
        );
        expect(screen.getByRole('button', { name: /restart application/i })).toBeTruthy();
    });

    it('"Restart Application" calls globalThis.__chimera.system.quit', async () => {
        const quit = vi.fn();
        (globalThis as Record<string, unknown>)['__chimera'] = { system: { quit } };

        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>,
        );
        await userEvent.click(screen.getByRole('button', { name: /restart application/i }));
        expect(quit).toHaveBeenCalled();

        delete (globalThis as Record<string, unknown>)['__chimera'];
    });
});
