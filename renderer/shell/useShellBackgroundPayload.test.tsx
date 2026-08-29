// @vitest-environment jsdom

/**
 * renderer/shell/useShellBackgroundPayload.test.tsx
 *
 * The one resolution of "what does the active game contribute as its shell
 * background, and may the player click it" (§4.37.9).
 *
 * Tests written first (TDD — red confirmed: the module did not exist, so the
 * import failed to resolve).
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadedRendererGameShell } from '../game/rendererGameRegistry';
import { _resetShellStateForTest, setShellRoute, type ShellSurface } from './shellStateStore';
import {
    useShellBackgroundIsInteractive,
    useShellBackgroundPayload,
} from './useShellBackgroundPayload';

const { mockLoadRendererGameShell } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
}));

vi.mock('../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

function GameBackground(): React.ReactElement {
    return <div data-testid="game-background" />;
}

/** Reports the whole payload as text, so one probe covers every field. */
function PayloadProbe(): React.ReactElement {
    const payload = useShellBackgroundPayload();
    return (
        <span data-testid="payload">
            {[
                `surface=${String(payload.isShellBackgroundSurface)}`,
                `context=${String(payload.isForThisContext)}`,
                `background=${payload.Background === null ? 'none' : 'game'}`,
                `assets=${payload.assets === null ? 'none' : 'declared'}`,
                `interactive=${String(payload.isInteractive)}`,
            ].join(' ')}
        </span>
    );
}

function InteractiveProbe(): React.ReactElement {
    return <span data-testid="interactive">{String(useShellBackgroundIsInteractive())}</span>;
}

function setSurface(surface: ShellSurface, pathname: string, gameId: string | null): void {
    act(() => {
        setShellRoute({ surface, pathname, gameId });
    });
}

function payloadText(): string {
    return screen.getByTestId('payload').textContent ?? '';
}

beforeEach(() => {
    _resetShellStateForTest();
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({} satisfies LoadedRendererGameShell);
});

afterEach(() => {
    cleanup();
    _resetShellStateForTest();
});

describe('useShellBackgroundPayload', () => {
    it('resolves the declared background, assets and opt-in for the active game', async () => {
        const assets = { gameId: 'fake', entries: [] };
        setSurface('main-menu', '/main-menu', 'fake');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
            shellBackgroundAssets: assets,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(payloadText()).toBe(
                'surface=true context=true background=game assets=declared interactive=true',
            );
        });
        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('fake');
    });

    it('reports a game that declares no background as resolved but non-interactive', async () => {
        setSurface('main-menu', '/main-menu', 'fake');
        mockLoadRendererGameShell.mockResolvedValue({} satisfies LoadedRendererGameShell);

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(payloadText()).toBe(
                'surface=true context=true background=none assets=none interactive=false',
            );
        });
    });

    // The opt-in is answered by the SUBTREE: the engine default is a plain
    // coloured plate, so a declared flag with no component to click is inert.
    it('refuses the opt-in when the game declares the flag but no background', async () => {
        setSurface('main-menu', '/main-menu', 'fake');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(payloadText()).toBe(
                'surface=true context=true background=none assets=none interactive=false',
            );
        });
    });

    it('loads nothing and reports nothing on a surface that carries no background', async () => {
        setSurface('match', '/game', 'fake');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(payloadText()).toBe(
                'surface=false context=false background=none assets=none interactive=false',
            );
        });
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('loads nothing on a background surface with no game context', async () => {
        setSurface('main-menu', '/main-menu', null);

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(payloadText()).toBe(
                'surface=true context=true background=none assets=none interactive=false',
            );
        });
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('answers nothing while a NEW game context is still loading', async () => {
        let release!: (shell: LoadedRendererGameShell) => void;
        mockLoadRendererGameShell.mockReturnValue(
            new Promise<LoadedRendererGameShell>((resolve) => {
                release = resolve;
            }),
        );
        setSurface('main-menu', '/main-menu', 'fake');

        render(<PayloadProbe />);

        expect(payloadText()).toBe(
            'surface=true context=false background=none assets=none interactive=false',
        );

        await act(async () => {
            release({ shellBackground: GameBackground, shellBackgroundInteractive: true });
        });

        expect(payloadText()).toBe(
            'surface=true context=true background=game assets=none interactive=true',
        );
    });

    it('degrades to a non-interactive engine default when the shell load fails', async () => {
        setSurface('main-menu', '/main-menu', 'fake');
        mockLoadRendererGameShell.mockRejectedValue(new Error('no such game'));

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(payloadText()).toBe(
                'surface=true context=true background=none assets=none interactive=false',
            );
        });
    });

    // The surface conjunct is not redundant with the effect that clears the
    // payload, and a settled assertion cannot see the difference: a surface flip
    // re-runs the effect only AFTER the commit it caused, so for exactly one
    // render the resolved background is still readable while the player is
    // already on the match. Recording from INSIDE the render is what catches it
    // — `waitFor` would watch the effect correct it and report success.
    it('never reports the opt-in on the match surface, not even for one commit', async () => {
        const seen: string[] = [];

        function RecordingProbe(): null {
            seen.push(String(useShellBackgroundPayload().isInteractive));
            return null;
        }

        setSurface('main-menu', '/main-menu', 'fake');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        render(<RecordingProbe />);
        await waitFor(() => {
            expect(seen).toContain('true');
        });

        // The match keeps the SAME game context — only the surface changes, so
        // nothing about the payload is stale except where the player is.
        seen.length = 0;
        setSurface('match', '/game', 'fake');

        expect(seen).not.toHaveLength(0);
        expect(seen).toEqual(seen.map(() => 'false'));
    });

    // The surface is a dependency of the load, not only of the early return: a
    // match clears the payload, and the player coming BACK to the menu carries
    // the same `gameId`, so a resolution keyed on the game alone would never
    // re-run and the background would never come back.
    it('resolves again on returning to a background surface with the same game', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);
        setSurface('match', '/game', 'fake');

        render(<PayloadProbe />);
        await waitFor(() => {
            expect(payloadText()).toContain('background=none');
        });

        setSurface('main-menu', '/main-menu', 'fake');

        await waitFor(() => {
            expect(payloadText()).toBe(
                'surface=true context=true background=game assets=none interactive=true',
            );
        });
    });

    // A payload answers for ONE game. Leaving the context must not leave the
    // previous game's opt-in standing on an engine-default plate.
    it('drops a resolved opt-in when the route leaves the game context', async () => {
        setSurface('main-menu', '/main-menu', 'fake');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        render(<PayloadProbe />);
        await waitFor(() => {
            expect(payloadText()).toContain('interactive=true');
        });

        setSurface('main-menu', '/main-menu', null);

        await waitFor(() => {
            expect(payloadText()).toContain('interactive=false');
        });
    });
});

describe('useShellBackgroundIsInteractive', () => {
    it('agrees with the payload it is read from', async () => {
        setSurface('main-menu', '/main-menu', 'fake');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        render(
            <>
                <PayloadProbe />
                <InteractiveProbe />
            </>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('interactive')).toHaveTextContent('true');
        });
        expect(payloadText()).toContain('interactive=true');
    });

    it('is false for a game that never opts in', async () => {
        setSurface('main-menu', '/main-menu', 'fake');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
        } satisfies LoadedRendererGameShell);

        render(<InteractiveProbe />);

        await waitFor(() => {
            expect(screen.getByTestId('interactive')).toHaveTextContent('false');
        });
    });
});
