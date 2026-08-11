// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render as baseRender, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import { FadeProvider } from './FadeContext.js';
import { ScreenFadeOverlay } from './ScreenFadeOverlay.js';
import { RootErrorBoundary } from './RootErrorBoundary.js';

// CrashFallback calls useTranslate(); in production AppShell mounts the i18n
// provider above the boundary, so its fallback still resolves after a child
// throws. The inert provider resolves engine English so the crash-copy
// assertions hold.
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: I18nProvider });

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

    it('resolves the crash heading through the active-locale translator', () => {
        baseRender(
            <I18nProvider gameOverride={{ 'engine.crash.heading': 'Something broke.' }}>
                <RootErrorBoundary>
                    <Bomb shouldThrow={true} />
                </RootErrorBoundary>
            </I18nProvider>,
        );
        expect(screen.getByText('Something broke.')).toBeTruthy();
    });

    it('forwards caught errors through the logs IPC surface with component context', () => {
        const emit = vi.fn();
        (globalThis as Record<string, unknown>)['__chimera'] = { logs: { emit } };

        render(
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>,
        );

        expect(emit).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'error',
                message: '[RootErrorBoundary] Uncaught error in React tree',
                source: { process: 'renderer', module: 'RootErrorBoundary' },
                error: expect.objectContaining({
                    name: 'Error',
                    message: 'test explosion',
                }),
                context: expect.objectContaining({
                    componentStack: expect.stringContaining('Bomb'),
                }),
            }),
        );

        delete (globalThis as Record<string, unknown>)['__chimera'];
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

// ── the app-level screen fade ─────────────────────────────────────────────────
//
// ScreenFadeOverlay paints a fixed, full-viewport black scrim whose alpha is
// the fade opacity, so a crash caught while a hop holds that fade opaque leaves
// the fallback unreadable underneath it. These cases build the arrangement they
// measure — provider, boundary, scrim as a sibling — and assert the opacity the
// boundary drives, never pointer behaviour: the scrim is `pointerEvents:
// 'none'`, so the crash buttons keep taking clicks either way.

/** The app-level arrangement: provider, boundary, and the scrim as a sibling. */
function renderInFade(initialOpacity: number): void {
    render(
        <FadeProvider initialOpacity={initialOpacity}>
            <RootErrorBoundary>
                <Bomb shouldThrow={true} />
            </RootErrorBoundary>
            <ScreenFadeOverlay />
        </FadeProvider>,
    );
}

function fadeOpacity(): string {
    return screen.getByTestId('screen-fade-overlay').style.opacity;
}

describe('RootErrorBoundary vs. the app-level screen fade', () => {
    it('clears a fully-opaque fade so the crash fallback is readable', () => {
        renderInFade(1);

        expect(fadeOpacity()).toBe('0');
        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('clears the fade immediately, with no timer advanced', () => {
        // Held at t=0: nothing advances the clock between the throw and the
        // assertion, so only a zero-duration clear can have landed. Routing the
        // clear through `fadeIn(300)` leaves the scrim at 1 here — the animation
        // makes its first step in a frame callback that never fires.
        vi.useFakeTimers();
        try {
            renderInFade(1);

            expect(fadeOpacity()).toBe('0');
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders the fallback with no FadeProvider above it, and throws nothing', () => {
        // `contextType` yields the context's default (`null`) with no provider
        // mounted. A non-optional read throws a TypeError inside
        // componentDidCatch, which escapes the boundary and blanks the app —
        // React rethrows it, so this render call itself would fail.
        expect(() => {
            render(
                <RootErrorBoundary>
                    <Bomb shouldThrow={true} />
                </RootErrorBoundary>,
            );
        }).not.toThrow();

        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('leaves an already-clear fade alone rather than driving it somewhere new', () => {
        // Positive control for the opacity assertions above: the scrim reads 0
        // here because it started there, so a clear that overshot to 1 — or a
        // `fadeOut(0)` written where `fadeIn(0)` belongs — is visible as a
        // difference between this case and the opaque one.
        renderInFade(0);

        expect(fadeOpacity()).toBe('0');
        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('leaves the fade untouched while no error has been caught', () => {
        // Scopes the clear to the CATCH path: hoisting it into render or into
        // componentDidMount would clear the scrim on every mount, including the
        // mid-hop fade this boundary must not interfere with.
        render(
            <FadeProvider initialOpacity={1}>
                <RootErrorBoundary>
                    <Bomb shouldThrow={false} />
                </RootErrorBoundary>
                <ScreenFadeOverlay />
            </FadeProvider>,
        );

        expect(fadeOpacity()).toBe('1');
        expect(screen.getByText('safe')).toBeTruthy();
    });
});
