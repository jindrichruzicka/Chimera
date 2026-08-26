// @vitest-environment jsdom

/**
 * renderer/shell/useShellNavigate.test.tsx
 *
 * The game-facing navigation hook (§4.37.18): an instant hop between shell
 * routes that carries the `?gameId=` context along, so a game page that sends
 * the player to `/settings` and back does not drop the game the shell is
 * rendering for.
 *
 * Tests written first (TDD — red confirmed: the module did not exist).
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetShellStateForTest, setShellRoute } from './shellStateStore';
import { useShellNavigate } from './useShellNavigate';

const mockPush = vi.fn();
// ONE router object for every render: a fresh `{ push }` per call would hand
// every dependency list in this file a value that changes on each render, and
// make the memoisation below unobservable.
const mockRouter = { push: mockPush };

vi.mock('next/navigation', () => ({
    useRouter: () => mockRouter,
}));

beforeEach(() => {
    _resetShellStateForTest();
    mockPush.mockReset();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useShellNavigate', () => {
    it('carries the published game context onto the target', () => {
        act(() => {
            setShellRoute({ surface: 'page', pathname: '/credits', gameId: 'tactics' });
        });
        const { result } = renderHook(() => useShellNavigate());

        act(() => {
            result.current('/settings');
        });

        expect(mockPush).toHaveBeenCalledWith('/settings?gameId=tactics');
    });

    it('pushes the bare target when no game is in context', () => {
        const { result } = renderHook(() => useShellNavigate());

        act(() => {
            result.current('/settings');
        });

        expect(mockPush).toHaveBeenCalledWith('/settings');
    });

    it('leaves a gameId the caller already put on the target alone', () => {
        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });
        });
        const { result } = renderHook(() => useShellNavigate());

        act(() => {
            result.current('/settings?gameId=other');
        });

        expect(mockPush).toHaveBeenCalledWith('/settings?gameId=other');
    });

    it('follows a game context that changes under the mounted hook', () => {
        const { result } = renderHook(() => useShellNavigate());

        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });
        });
        act(() => {
            result.current('/lobby');
        });

        expect(mockPush).toHaveBeenCalledWith('/lobby?gameId=tactics');
    });

    it('returns the same callback across renders that change nothing it reads', () => {
        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });
        });
        const { result, rerender } = renderHook(() => useShellNavigate());
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });

    it('returns a NEW callback when the game context changes', () => {
        const { result } = renderHook(() => useShellNavigate());
        const first = result.current;

        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });
        });

        expect(result.current).not.toBe(first);
    });

    it('never navigates on its own — nothing is pushed until it is called', () => {
        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });
        });

        renderHook(() => useShellNavigate());

        expect(mockPush).not.toHaveBeenCalled();
    });
});
