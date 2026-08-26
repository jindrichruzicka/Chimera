// @vitest-environment jsdom
//
// renderer/app/shellPageChrome.test.tsx
//
// The shared chrome a game's own shell page composes (§4.37.17). Reached from
// the game's Next host tree as `@chimera-engine/renderer/shell/shellPageChrome`.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EscapeStackProvider } from '../components/shell/EscapeStack';
import { I18nProvider } from '../i18n/I18nProvider';
import { ShellPageChrome } from './shellPageChrome';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

function Providers({ children }: { readonly children: React.ReactNode }): React.ReactElement {
    return (
        <I18nProvider>
            <EscapeStackProvider>{children}</EscapeStackProvider>
        </I18nProvider>
    );
}

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: Providers });

beforeEach(() => {
    mockPush.mockReset();
    window.history.replaceState({}, '', '/credits?gameId=tactics');
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ShellPageChrome', () => {
    it('renders its title and body inside a permanently-open dialog', () => {
        render(
            <ShellPageChrome title="Credits">
                <p>Made by everyone.</p>
            </ShellPageChrome>,
        );

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toHaveAccessibleName('Credits');
        expect(screen.getByText('Made by everyone.')).toBeInTheDocument();
    });

    it('returns to the main menu with the game context preserved when closed', () => {
        render(<ShellPageChrome title="Credits">body</ShellPageChrome>);

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(mockPush).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('returns to the bare main menu when the page carries no game context', () => {
        window.history.replaceState({}, '', '/credits');

        render(<ShellPageChrome title="Credits">body</ShellPageChrome>);

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(mockPush).toHaveBeenCalledWith('/main-menu');
    });

    it('routes Escape through the same exit as the Close control', () => {
        render(<ShellPageChrome title="Credits">body</ShellPageChrome>);

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(mockPush).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('lets the page own the exit with onClose, navigating nowhere on its own', () => {
        const onClose = vi.fn();
        render(
            <ShellPageChrome title="Credits" onClose={onClose}>
                body
            </ShellPageChrome>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('renders declared actions in place of the default Close control', () => {
        const onApply = vi.fn();
        render(
            <ShellPageChrome
                title="Credits"
                actions={[
                    { label: 'Apply', onClick: onApply, dismiss: false, testId: 'apply' },
                    { label: 'Back', testId: 'back' },
                ]}
            >
                body
            </ShellPageChrome>,
        );

        expect(screen.getByTestId('apply')).toBeInTheDocument();
        expect(screen.getByTestId('back')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();

        fireEvent.click(screen.getByTestId('apply'));
        expect(onApply).toHaveBeenCalledTimes(1);
        expect(mockPush).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('back'));
        expect(mockPush).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('sizes the surface as an engine workspace by default, and honours a declared size', () => {
        const { rerender } = render(<ShellPageChrome title="Credits">body</ShellPageChrome>);

        expect(screen.getByRole('dialog')).toHaveAttribute('data-ch-modal-size', 'lg');

        rerender(
            <ShellPageChrome title="Credits" size="md">
                body
            </ShellPageChrome>,
        );

        expect(screen.getByRole('dialog')).toHaveAttribute('data-ch-modal-size', 'md');
    });

    it('leaves the surface free to resize unless the page pins it', () => {
        const { rerender } = render(<ShellPageChrome title="Credits">body</ShellPageChrome>);

        expect(screen.getByRole('dialog')).not.toHaveAttribute(
            'data-ch-modal-fixed-height',
            'true',
        );

        rerender(
            <ShellPageChrome title="Credits" fixedHeight>
                body
            </ShellPageChrome>,
        );

        expect(screen.getByRole('dialog')).toHaveAttribute('data-ch-modal-fixed-height', 'true');
    });

    it('forwards the page testid so a page object can address the surface', () => {
        render(
            <ShellPageChrome title="Credits" data-testid="credits-page">
                body
            </ShellPageChrome>,
        );

        expect(screen.getByTestId('credits-page')).toBeInTheDocument();
    });
});
