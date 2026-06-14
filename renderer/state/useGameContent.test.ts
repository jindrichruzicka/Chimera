// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentAPI, GameContent } from '@chimera/electron/preload/api-types.js';
import { getContentBridge, resetGameContentCache, useGameContent } from './useGameContent';

// The hook passes content through verbatim, so the item fields are arbitrary
// here (no hex, to keep clear of the renderer design-token lint rule).
const SAMPLE: GameContent = {
    'player-colors': [{ id: 'blue', name: 'Blue' }],
};

function installBridge(content: ContentAPI): void {
    (globalThis as unknown as { __chimera?: { content: ContentAPI } }).__chimera = { content };
}

function clearBridge(): void {
    delete (globalThis as unknown as { __chimera?: unknown }).__chimera;
}

afterEach(() => {
    resetGameContentCache();
    clearBridge();
    vi.restoreAllMocks();
});

describe('getContentBridge', () => {
    it('returns null when no bridge is present', () => {
        clearBridge();
        expect(getContentBridge()).toBeNull();
    });

    it('returns the content namespace when present', () => {
        const content: ContentAPI = { getCollections: vi.fn() };
        installBridge(content);
        expect(getContentBridge()).toBe(content);
    });
});

describe('useGameContent', () => {
    it('fetches and returns content for a gameId', async () => {
        const getCollections = vi.fn().mockResolvedValue(SAMPLE);
        installBridge({ getCollections });

        const { result } = renderHook(() => useGameContent('tactics'));
        await waitFor(() => expect(result.current).toEqual(SAMPLE));
        expect(getCollections).toHaveBeenCalledWith('tactics');
    });

    it('serves a cached value without refetching for the same gameId', async () => {
        const getCollections = vi.fn().mockResolvedValue(SAMPLE);
        installBridge({ getCollections });

        const first = renderHook(() => useGameContent('tactics'));
        await waitFor(() => expect(first.result.current).toEqual(SAMPLE));
        expect(getCollections).toHaveBeenCalledTimes(1);

        const second = renderHook(() => useGameContent('tactics'));
        expect(second.result.current).toEqual(SAMPLE);
        expect(getCollections).toHaveBeenCalledTimes(1);
    });

    it('returns undefined for a null gameId', () => {
        installBridge({ getCollections: vi.fn() });
        const { result } = renderHook(() => useGameContent(null));
        expect(result.current).toBeUndefined();
    });

    it('returns undefined when the bridge is unavailable', () => {
        clearBridge();
        const { result } = renderHook(() => useGameContent('tactics'));
        expect(result.current).toBeUndefined();
    });

    it('returns undefined when the game declares no content (null)', async () => {
        const getCollections = vi.fn().mockResolvedValue(null);
        installBridge({ getCollections });

        const { result } = renderHook(() => useGameContent('tic-tac-toe'));
        // Stays undefined; cache records the null so no refetch happens.
        await waitFor(() => expect(getCollections).toHaveBeenCalledTimes(1));
        expect(result.current).toBeUndefined();
    });

    it("never reports the previous gameId's content while the next game is still fetching", async () => {
        const tacticsContent: GameContent = { 'player-colors': [{ id: 'blue', name: 'Blue' }] };
        const chessContent: GameContent = { 'player-colors': [{ id: 'red', name: 'Red' }] };
        let resolveChess: (value: GameContent | null) => void = () => {};
        const getCollections = vi.fn((gameId: string) =>
            gameId === 'tactics'
                ? Promise.resolve(tacticsContent)
                : new Promise<GameContent | null>((resolve) => {
                      resolveChess = resolve;
                  }),
        );
        installBridge({ getCollections });

        const { result, rerender } = renderHook(({ gameId }) => useGameContent(gameId), {
            initialProps: { gameId: 'tactics' },
        });
        await waitFor(() => expect(result.current).toEqual(tacticsContent));

        // Switch to a not-yet-fetched game: the hook must not surface tactics'
        // content for the chess gameId while chess is still in flight.
        rerender({ gameId: 'chess' });
        expect(result.current).toBeUndefined();

        // Once chess resolves, its content (and only its content) appears.
        resolveChess(chessContent);
        await waitFor(() => expect(result.current).toEqual(chessContent));
    });
});
