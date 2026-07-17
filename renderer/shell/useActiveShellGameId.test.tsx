// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '../state/settingsStore';
import { useActiveShellGameId } from './useActiveShellGameId';

// `usePathname` keys the URL-reading effect AND scopes the store fallback, so
// the stub is swappable per test.
const { mockPathname } = vi.hoisted(() => ({ mockPathname: { current: '/main-menu' } }));

vi.mock('next/navigation', () => ({
    usePathname: () => mockPathname.current,
}));

function Probe(): React.ReactElement {
    const gameId = useActiveShellGameId();
    return <span data-testid="game-id">{gameId ?? 'null'}</span>;
}

function renderAt(pathname: string, search: string): void {
    mockPathname.current = pathname;
    window.history.replaceState({}, '', `${pathname}${search}`);
    render(<Probe />);
}

beforeEach(() => {
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

afterEach(() => {
    cleanup();
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

describe('useActiveShellGameId', () => {
    it('resolves the explicit URL ?gameId= on any route', () => {
        renderAt('/lobby', '?gameId=demo');
        expect(screen.getByTestId('game-id').textContent).toBe('demo');
    });

    it('prefers the URL ?gameId= over the store on the game route', () => {
        useSettingsStore.setState({ activeGameId: 'other', settings: {} });
        renderAt('/game', '?gameId=demo');
        expect(screen.getByTestId('game-id').textContent).toBe('demo');
    });

    it('falls back to the store activeGameId on the game scene (bare direct-game boot)', () => {
        useSettingsStore.setState({ activeGameId: 'demo', settings: {} });
        renderAt('/game', '');
        expect(screen.getByTestId('game-id').textContent).toBe('demo');
    });

    it('keeps the session fallback on settings (direct-game boot lands there bare)', () => {
        useSettingsStore.setState({ activeGameId: 'demo', settings: {} });
        renderAt('/settings', '');
        expect(screen.getByTestId('game-id').textContent).toBe('demo');
    });

    it('ignores the store activeGameId on the bare lobby (no default-game branding)', () => {
        // An active lobby sets activeGameId, but a bare /lobby is the
        // engine-default shell — the hosted game's id alone must not pull the
        // game's branding (tokens/i18n/icons) into it.
        useSettingsStore.setState({ activeGameId: 'demo', settings: {} });
        renderAt('/lobby', '');
        expect(screen.getByTestId('game-id').textContent).toBe('null');
    });

    it('ignores the store activeGameId on the lobby with a trailing slash (static export)', () => {
        useSettingsStore.setState({ activeGameId: 'demo', settings: {} });
        renderAt('/lobby/', '');
        expect(screen.getByTestId('game-id').textContent).toBe('null');
    });

    it('resolves null with no URL context and no store context', () => {
        renderAt('/main-menu', '');
        expect(screen.getByTestId('game-id').textContent).toBe('null');
    });
});
