// renderer/app/main-menu/page.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import { ThemeProvider } from '../../theme/ThemeProvider';
import MainMenuPage from './page';

const { mockLoadRendererGameShell } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
}));

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

function renderMainMenuPage(): void {
    render(
        <ThemeProvider>
            <MainMenuPage />
        </ThemeProvider>,
    );
}

function setMainMenuUrl(search = ''): void {
    window.history.replaceState({}, '', `/main-menu${search}`);
}

beforeEach(() => {
    mockPush.mockReset();
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue(undefined);

    setMainMenuUrl();

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
    setMainMenuUrl();
    Reflect.deleteProperty(window, '__chimera');
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('MainMenuPage — engine fallback (no active lobby game)', () => {
    it('renders the main-menu container with data-testid="main-menu"', () => {
        renderMainMenuPage();
        expect(screen.getByTestId('main-menu')).toBeTruthy();
    });

    it('does not load a renderer game when there is no active lobby game', () => {
        renderMainMenuPage();
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('renders the engine fallback Play button with data-testid="main-menu-play"', () => {
        renderMainMenuPage();
        expect(screen.getByTestId('main-menu-play')).toBeTruthy();
    });

    it('renders the engine fallback Settings button with data-testid="main-menu-settings"', () => {
        renderMainMenuPage();
        expect(screen.getByTestId('main-menu-settings')).toBeTruthy();
    });

    it('renders the engine fallback Quit button with data-testid="main-menu-quit"', () => {
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

    it('renders a dev-only icon button for the component gallery outside production', () => {
        vi.stubEnv('NODE_ENV', 'development');

        renderMainMenuPage();

        expect(screen.getByTestId('main-menu-component-gallery')).toBeTruthy();
        expect(screen.getByRole('button', { name: /component gallery/i })).toBeTruthy();
    });

    it('does not render the component gallery icon button in production', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');

        renderMainMenuPage();

        expect(screen.queryByTestId('main-menu-component-gallery')).toBeNull();
    });

    it('renders the component gallery icon button in E2E-enabled production exports', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');

        renderMainMenuPage();

        expect(screen.getByTestId('main-menu-component-gallery')).toBeTruthy();
    });

    it('navigates to /component-gallery when the dev-only gallery icon button is clicked', () => {
        vi.stubEnv('NODE_ENV', 'development');

        renderMainMenuPage();
        fireEvent.click(screen.getByTestId('main-menu-component-gallery'));

        expect(mockPush).toHaveBeenCalledWith('/component-gallery');
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

describe('MainMenuPage — URL game context (tactics)', () => {
    beforeEach(() => {
        setMainMenuUrl('?gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
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
        } satisfies LoadedRendererGameShell);
    });

    it('loads the renderer shell for the URL gameId without an active lobby', async () => {
        renderMainMenuPage();

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });
    });

    it('renders the loaded game main menu definition when the URL game provides one', async () => {
        renderMainMenuPage();

        expect(await screen.findByRole('button', { name: 'New Game' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Load Game' })).toBeTruthy();
    });

    it('navigates to /saves when the loaded game contributes a Load Game action', async () => {
        renderMainMenuPage();

        fireEvent.click(await screen.findByRole('button', { name: 'Load Game' }));

        expect(mockPush).toHaveBeenCalledWith('/saves?gameId=tactics');
    });

    it('preserves the URL game context when the loaded game navigates to settings', async () => {
        renderMainMenuPage();

        fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));

        expect(mockPush).toHaveBeenCalledWith('/settings?gameId=tactics');
    });
});

describe('MainMenuPage — no engine fallback flash while game shell is loading', () => {
    it('does not render the engine-default Play button while the tactics shell is pending', async () => {
        setMainMenuUrl('?gameId=tactics');

        // Deferred promise — shell never resolves during this test.
        let resolveShell!: (v: LoadedRendererGameShell) => void;
        mockLoadRendererGameShell.mockReturnValue(
            new Promise<LoadedRendererGameShell>((res) => {
                resolveShell = res;
            }),
        );

        renderMainMenuPage();

        // gameId is picked up on mount; the shell is inflight — the engine
        // default "Play" button must NOT be visible during this window.
        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });

        expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();

        // Satisfy the deferred promise so the test can close cleanly.
        resolveShell({
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
                    { label: 'Quit', action: { type: 'quit' }, variant: 'danger' },
                ],
            },
            menuCommands: {},
        });

        await screen.findByRole('button', { name: 'New Game' });
    });

    it('renders the game buttons immediately once the shell resolves — no intermediate engine default', async () => {
        setMainMenuUrl('?gameId=tactics');

        // Resolve synchronously inside Promise micro-task so this test stays
        // deterministic without timers.
        mockLoadRendererGameShell.mockResolvedValue({
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
                    { label: 'Quit', action: { type: 'quit' }, variant: 'danger' },
                ],
            },
            menuCommands: {},
        } satisfies LoadedRendererGameShell);

        renderMainMenuPage();

        // The engine-default "Play" button must never appear, not even before
        // the async shell resolves.
        expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();

        // After the shell loads, only the tactics buttons are present.
        await screen.findByRole('button', { name: 'New Game' });
        expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    });
});
