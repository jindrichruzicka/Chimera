// renderer/app/main-menu/page.test.tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MainMenuPage from './page';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

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
        render(<MainMenuPage />);
        expect(screen.getByTestId('main-menu')).toBeTruthy();
    });

    it('renders a play button with data-testid="main-menu-play"', () => {
        render(<MainMenuPage />);
        expect(screen.getByTestId('main-menu-play')).toBeTruthy();
    });

    it('renders a settings button with data-testid="main-menu-settings"', () => {
        render(<MainMenuPage />);
        expect(screen.getByTestId('main-menu-settings')).toBeTruthy();
    });

    it('renders a quit button with data-testid="main-menu-quit"', () => {
        render(<MainMenuPage />);
        expect(screen.getByTestId('main-menu-quit')).toBeTruthy();
    });

    it('navigates to /lobby when the play button is clicked', () => {
        render(<MainMenuPage />);
        fireEvent.click(screen.getByTestId('main-menu-play'));
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('navigates to /settings when the settings button is clicked', () => {
        render(<MainMenuPage />);
        fireEvent.click(screen.getByTestId('main-menu-settings'));
        expect(mockPush).toHaveBeenCalledWith('/settings');
    });

    it('calls window.__chimera.system.quit() when the quit button is clicked', () => {
        render(<MainMenuPage />);
        fireEvent.click(screen.getByTestId('main-menu-quit'));
        expect(window.__chimera.system.quit).toHaveBeenCalledOnce();
    });

    it('does not call router.push when the quit button is clicked', () => {
        render(<MainMenuPage />);
        fireEvent.click(screen.getByTestId('main-menu-quit'));
        expect(mockPush).not.toHaveBeenCalled();
    });
});
