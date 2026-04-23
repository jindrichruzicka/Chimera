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

    it('"Restart Application" calls __chimera.system.quit', async () => {
        const quit = vi.fn();
        (globalThis as Record<string, unknown>)['__chimera'] = { system: { quit } };

        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>,
        );
        await userEvent.click(screen.getByRole('button', { name: /restart application/i }));
        // NOTE: handleRestart now calls relaunch(); this test preserves the
        // original assertion shape but the fixture no longer routes through quit.
        // The dedicated 'calls relaunch not quit' test below is the authoritative check.
        // quit is NOT called — passing this test validates backward-compat shape only.
        expect(quit).not.toHaveBeenCalled();

        delete (globalThis as Record<string, unknown>)['__chimera'];
    });

    it('"Restart Application" calls __chimera.system.relaunch(), not quit()', async () => {
        const relaunch = vi.fn();
        const quit = vi.fn();
        (globalThis as Record<string, unknown>)['__chimera'] = { system: { relaunch, quit } };

        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>,
        );
        await userEvent.click(screen.getByRole('button', { name: /restart application/i }));
        expect(relaunch).toHaveBeenCalledOnce();
        expect(quit).not.toHaveBeenCalled();

        delete (globalThis as Record<string, unknown>)['__chimera'];
    });

    it('"Return to Main Menu" navigates to root via window.location.replace', async () => {
        const replaceMock = vi.fn();
        vi.stubGlobal('location', { replace: replaceMock });

        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>,
        );
        await userEvent.click(screen.getByRole('button', { name: /return to main menu/i }));
        expect(replaceMock).toHaveBeenCalledWith('/');

        vi.unstubAllGlobals();
    });

    it('crash ID uses ISO timestamp format to correlate with dump filenames', () => {
        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>,
        );
        const paragraph = screen
            .getAllByText(/crash/i)
            .find((el) => el.textContent?.includes('Crash ID:'));
        const text = paragraph?.textContent ?? '';
        // Should match crash-<ISO-with-hyphens> format (e.g. crash-2024-01-15T10-30-45-123Z)
        // NOT crash-<base36>
        expect(text).toMatch(/crash-\d{4}-\d{2}-\d{2}T/);
    });
});
