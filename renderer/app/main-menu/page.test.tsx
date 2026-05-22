// renderer/app/main-menu/page.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../theme/ThemeProvider';
import MainMenuPage from './page';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

function renderMainMenuPage(): void {
    render(
        <ThemeProvider>
            <MainMenuPage />
        </ThemeProvider>,
    );
}

beforeEach(() => {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            system: {
                quit: vi.fn(),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('MainMenuPage', () => {
    it('renders the main-menu container with data-testid="main-menu"', () => {
        renderMainMenuPage();
        expect(screen.getByTestId('main-menu')).toBeTruthy();
    });

    it('renders a play button with data-testid="main-menu-play"', () => {
        renderMainMenuPage();
        expect(screen.getByTestId('main-menu-play')).toBeTruthy();
    });

    it('renders a settings button with data-testid="main-menu-settings"', () => {
        renderMainMenuPage();
        expect(screen.getByTestId('main-menu-settings')).toBeTruthy();
    });

    it('renders a quit button with data-testid="main-menu-quit"', () => {
        renderMainMenuPage();
        expect(screen.getByTestId('main-menu-quit')).toBeTruthy();
    });

    it('uses shared themed variants for shell actions', () => {
        renderMainMenuPage();

        expect(screen.getByTestId('main-menu-play')).toHaveAttribute(
            'data-ch-button-variant',
            'primary',
        );
        expect(screen.getByTestId('main-menu-settings')).toHaveAttribute(
            'data-ch-button-variant',
            'secondary',
        );
        expect(screen.getByTestId('main-menu-quit')).toHaveAttribute(
            'data-ch-button-variant',
            'danger',
        );
    });

    it('uses the shared Heading primitive for the page title', () => {
        renderMainMenuPage();

        const heading = screen.getByRole('heading', { level: 1, name: 'Chimera' });

        expect(heading).toHaveAttribute('data-ch-heading-level', '1');
        expect(heading).toHaveAttribute('data-ch-heading-size', 'xl');
    });

    it('navigates to /lobby when the play button is clicked', () => {
        renderMainMenuPage();
        fireEvent.click(screen.getByTestId('main-menu-play'));
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('navigates to /settings when the settings button is clicked', () => {
        renderMainMenuPage();
        fireEvent.click(screen.getByTestId('main-menu-settings'));
        expect(mockPush).toHaveBeenCalledWith('/settings');
    });

    it('calls window.__chimera.system.quit() when the quit button is clicked', () => {
        renderMainMenuPage();
        fireEvent.click(screen.getByTestId('main-menu-quit'));
        expect(window.__chimera.system.quit).toHaveBeenCalledOnce();
    });

    it('does not call router.push when the quit button is clicked', () => {
        renderMainMenuPage();
        fireEvent.click(screen.getByTestId('main-menu-quit'));
        expect(mockPush).not.toHaveBeenCalled();
    });
});
