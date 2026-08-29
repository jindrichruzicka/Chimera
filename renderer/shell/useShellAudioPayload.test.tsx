// @vitest-environment jsdom

/**
 * renderer/shell/useShellAudioPayload.test.tsx
 *
 * The one resolution of "what does the active game contribute as its shell
 * audio" (§4.25). What the session DOES with the answer is
 * `ShellAudioSession.test.tsx`; this file measures the answer.
 *
 * Tests written first (TDD — red confirmed: the module did not exist, so the
 * import failed to resolve).
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { LoadedRendererGameShell } from '../game/rendererGameRegistry';
import { _resetShellStateForTest, setShellRoute, type ShellSurface } from './shellStateStore';
import { useShellAudioPayload } from './useShellAudioPayload';

const { mockLoadRendererGameShell } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
}));

vi.mock('../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

const BED_REF = 'fake/audio/music/menu.ogg' as AssetRef<AudioClipAsset>;

/** Reports the whole payload as text, so one probe covers every field. */
function PayloadProbe(): React.ReactElement {
    const payload = useShellAudioPayload();
    return (
        <span data-testid="payload">
            {[
                `assets=${payload.assets === null ? 'none' : payload.assets.gameId}`,
                `bed=${payload.musicBed === null ? 'none' : String(payload.musicBed.ref)}`,
            ].join(' ')}
        </span>
    );
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

describe('useShellAudioPayload', () => {
    it('resolves the declared inventory and bed for the active game', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: { gameId: 'fake', entries: [] },
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'fake');

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(payloadText()).toBe(`assets=fake bed=${BED_REF}`);
        });
    });

    it('answers nothing for a game that declares neither', async () => {
        setSurface('main-menu', '/main-menu', 'fake');

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('fake');
        });
        expect(payloadText()).toBe('assets=none bed=none');
    });

    it('drops a bed declared without an inventory, which has nothing to resolve against', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'fake');

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('fake');
        });
        expect(payloadText()).toBe('assets=none bed=none');
    });

    it('answers nothing on a surface that carries no shell audio', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: { gameId: 'fake', entries: [] },
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('match', '/game', 'fake');

        render(<PayloadProbe />);

        await Promise.resolve();
        expect(payloadText()).toBe('assets=none bed=none');
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('answers nothing on a shell surface with no game in context', async () => {
        setSurface('main-menu', '/main-menu', null);

        render(<PayloadProbe />);

        await Promise.resolve();
        expect(payloadText()).toBe('assets=none bed=none');
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('withholds a payload loaded for the PREVIOUS game while the new context is in flight', async () => {
        // A stale inventory answering for the wrong game would register the old
        // game's clips as the new one's — the bed would keep playing across a
        // context change that should have replaced it.
        let releaseSecondLoad: (shell: LoadedRendererGameShell) => void = () => undefined;
        mockLoadRendererGameShell
            .mockResolvedValueOnce({
                shellAudioAssets: { gameId: 'first', entries: [] },
                shellMusicBed: { ref: BED_REF },
            } satisfies LoadedRendererGameShell)
            .mockImplementationOnce(
                () =>
                    new Promise<LoadedRendererGameShell>((resolve) => {
                        releaseSecondLoad = resolve;
                    }),
            );
        setSurface('main-menu', '/main-menu', 'first');
        render(<PayloadProbe />);
        await waitFor(() => {
            expect(payloadText()).toBe(`assets=first bed=${BED_REF}`);
        });

        setSurface('main-menu', '/main-menu', 'second');

        expect(payloadText()).toBe('assets=none bed=none');

        await act(async () => {
            releaseSecondLoad({ shellAudioAssets: { gameId: 'second', entries: [] } });
        });
        expect(payloadText()).toBe('assets=second bed=none');
    });

    it('loads on the hop from a non-audio surface that already carried the game context', async () => {
        // `/logo-screen?gameId=x` → `/main-menu?gameId=x`: the game never changes,
        // so an effect keyed on it alone runs once, off-surface, and never again —
        // and the menu is silent for the rest of the session.
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: { gameId: 'fake', entries: [] },
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('boot', '/logo-screen', 'fake');
        render(<PayloadProbe />);
        await act(async () => undefined);
        expect(payloadText()).toBe('assets=none bed=none');

        setSurface('main-menu', '/main-menu', 'fake');

        await waitFor(() => {
            expect(payloadText()).toBe(`assets=fake bed=${BED_REF}`);
        });
    });

    it('answers nothing when the shell payload fails to load', async () => {
        mockLoadRendererGameShell.mockRejectedValue(new Error('no such game'));
        setSurface('main-menu', '/main-menu', 'fake');

        render(<PayloadProbe />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('fake');
        });
        expect(payloadText()).toBe('assets=none bed=none');
    });

    it('gives up the resolved payload when the surface leaves the shell', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: { gameId: 'fake', entries: [] },
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'fake');
        render(<PayloadProbe />);
        await waitFor(() => {
            expect(payloadText()).toBe(`assets=fake bed=${BED_REF}`);
        });

        setSurface('match', '/game', 'fake');

        expect(payloadText()).toBe('assets=none bed=none');
    });
});
