// renderer/app/page.test.tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from './page';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            system: {
                platform: vi.fn(async () => ({ os: 'macos', version: 'test' })),
            },
            saves: {
                checkCrashRecovery: vi.fn(async () => ({ needsRecovery: false, slotId: null })),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('HomePage page object locators', () => {
    it('marks the main menu screen for the page object model', () => {
        render(<HomePage />);
        expect(screen.getByTestId('main-menu')).toBeTruthy();
    });

    it('renders a play button with the main-menu-play test id', () => {
        render(<HomePage />);
        expect(screen.getByTestId('main-menu-play')).toBeTruthy();
    });

    it('renders a settings button with the main-menu-settings test id', () => {
        render(<HomePage />);
        expect(screen.getByTestId('main-menu-settings')).toBeTruthy();
    });

    it('navigates to /lobby when the play button is clicked', () => {
        render(<HomePage />);
        fireEvent.click(screen.getByTestId('main-menu-play'));
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('navigates to /settings when the settings button is clicked', () => {
        render(<HomePage />);
        fireEvent.click(screen.getByTestId('main-menu-settings'));
        expect(mockPush).toHaveBeenCalledWith('/settings');
    });
});
