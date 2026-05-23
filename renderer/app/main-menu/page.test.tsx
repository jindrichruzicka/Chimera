// renderer/app/main-menu/page.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedRendererGame } from '../../game/rendererGameRegistry';
import { ThemeProvider } from '../../theme/ThemeProvider';
import MainMenuPage from './page';

const { mockLoadRendererGame } = vi.hoisted(() => ({
    mockLoadRendererGame: vi.fn(),
}));

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGame: mockLoadRendererGame,
}));

function renderMainMenuPage(): void {
    render(
        <ThemeProvider>
            <MainMenuPage />
        </ThemeProvider>,
    );
}

beforeEach(() => {
    mockLoadRendererGame.mockReset();
    mockLoadRendererGame.mockResolvedValue({
        registry: { board: () => null },
    } satisfies LoadedRendererGame);

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

    it('loads the default renderer game shell through the renderer registry', async () => {
        renderMainMenuPage();

        await waitFor(() => {
            expect(mockLoadRendererGame).toHaveBeenCalledWith('tactics');
        });
    });

    it('renders the loaded game main menu definition when the active game provides one', async () => {
        mockLoadRendererGame.mockResolvedValue({
            registry: { board: () => null },
            shell: {
                mainMenu: {
                    buttons: [
                        {
                            label: 'New Game',
                            action: { type: 'navigate', target: '/game' },
                            variant: 'primary',
                        },
                        {
                            label: 'Load Game',
                            action: { type: 'navigate', target: '/saves' },
                            variant: 'secondary',
                        },
                        {
                            label: 'Settings',
                            action: { type: 'navigate', target: '/settings' },
                            variant: 'secondary',
                        },
                        {
                            label: 'Quit',
                            action: { type: 'quit' },
                            variant: 'danger',
                        },
                    ],
                },
                menuCommands: {},
            },
        } satisfies LoadedRendererGame);

        renderMainMenuPage();

        expect(await screen.findByRole('button', { name: 'New Game' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Load Game' })).toBeTruthy();
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

    it('navigates to /saves when the loaded game contributes a Load Game action', async () => {
        mockLoadRendererGame.mockResolvedValue({
            registry: { board: () => null },
            shell: {
                mainMenu: {
                    buttons: [
                        {
                            label: 'New Game',
                            action: { type: 'navigate', target: '/game' },
                            variant: 'primary',
                        },
                        {
                            label: 'Load Game',
                            action: { type: 'navigate', target: '/saves' },
                            variant: 'secondary',
                        },
                        {
                            label: 'Settings',
                            action: { type: 'navigate', target: '/settings' },
                            variant: 'secondary',
                        },
                        {
                            label: 'Quit',
                            action: { type: 'quit' },
                            variant: 'danger',
                        },
                    ],
                },
                menuCommands: {},
            },
        } satisfies LoadedRendererGame);

        renderMainMenuPage();

        fireEvent.click(await screen.findByRole('button', { name: 'Load Game' }));

        expect(mockPush).toHaveBeenCalledWith('/saves');
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
