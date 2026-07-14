// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '../../../state/settingsStore';
import { useActiveGameIcons } from './useActiveGameIcons';
import type { GameIconSet, IconGlyph } from './registry';

// The hook resolves the active game id from the URL (`?gameId=`, read from
// window.location.search) and the game's contributed icon set from the registry
// shell seam. `usePathname` only keys the effect that re-reads the URL, so a
// fixed stub suffices. Mirrors the useActiveGameTranslations harness.
const { mockLoadRendererGameShell } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
}));

vi.mock('next/navigation', () => ({
    usePathname: () => '/main-menu',
}));

vi.mock('../../../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

function setUrlGameId(gameId: string | null): void {
    window.history.replaceState(
        {},
        '',
        gameId === null ? '/main-menu' : `/main-menu?gameId=${gameId}`,
    );
}

const bannerGlyph: IconGlyph = {
    viewBox: '0 0 24 24',
    content: <path d="M6 2h12v18l-6-4-6 4z" />,
};
const DEMO_ICONS: GameIconSet = { 'game.demo.banner': bannerGlyph };

function IconsProbe(): React.ReactElement {
    const icons = useActiveGameIcons();
    return (
        <span data-testid="icons">
            {icons === undefined ? 'undefined' : Object.keys(icons).sort().join(',')}
        </span>
    );
}

beforeEach(() => {
    setUrlGameId(null);
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({});
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

afterEach(() => {
    cleanup();
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

describe('useActiveGameIcons', () => {
    it("resolves the active game's contributed icon set from the registry seam", async () => {
        setUrlGameId('demo');
        mockLoadRendererGameShell.mockResolvedValue({ icons: DEMO_ICONS });

        render(<IconsProbe />);

        await waitFor(() =>
            expect(screen.getByTestId('icons').textContent).toBe('game.demo.banner'),
        );
        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('demo');
    });

    it('returns undefined when there is no game context', () => {
        render(<IconsProbe />);

        expect(screen.getByTestId('icons').textContent).toBe('undefined');
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('returns undefined when the active game contributes no icons', async () => {
        setUrlGameId('demo');
        mockLoadRendererGameShell.mockResolvedValue({});

        render(<IconsProbe />);

        await waitFor(() => expect(mockLoadRendererGameShell).toHaveBeenCalledWith('demo'));
        expect(screen.getByTestId('icons').textContent).toBe('undefined');
    });

    it('swaps the set when the active game id changes', async () => {
        // Drive the gameId through the reactive settings store (the URL-reading
        // effect is keyed on the pathname, which the stub holds constant).
        useSettingsStore.setState({ activeGameId: 'demo', settings: {} });
        mockLoadRendererGameShell.mockResolvedValue({ icons: DEMO_ICONS });

        render(<IconsProbe />);
        await waitFor(() =>
            expect(screen.getByTestId('icons').textContent).toBe('game.demo.banner'),
        );

        const otherGlyph: IconGlyph = { viewBox: '0 0 24 24', content: <path d="M0 0h24v24H0z" /> };
        mockLoadRendererGameShell.mockResolvedValue({ icons: { 'game.other.flag': otherGlyph } });
        act(() => {
            useSettingsStore.setState({ activeGameId: 'other', settings: {} });
        });

        await waitFor(() =>
            expect(screen.getByTestId('icons').textContent).toBe('game.other.flag'),
        );
    });
});
