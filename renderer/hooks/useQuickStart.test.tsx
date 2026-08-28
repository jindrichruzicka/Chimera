// @vitest-environment jsdom

/**
 * renderer/hooks/useQuickStart.test.tsx
 *
 * The game-facing quick-start facade (§4.37.18), published on
 * `@chimera-engine/renderer/game`: one object carrying the three session verbs
 * a game's own shell page needs plus the engine-computed availability behind
 * Continue.
 *
 * Tests written first (TDD — red confirmed: the module did not exist).
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveSlotMeta } from '@chimera-engine/simulation/bridge/api-types.js';
import { autosaveSlotId } from '@chimera-engine/simulation/foundation/save-slots.js';
import { useSaveStore } from '../state/saveStore';
import {
    _resetShellStateForTest,
    getShellState,
    setShellDraft,
    setShellRoute,
} from '../shell/shellStateStore';
import { useQuickStart } from './useQuickStart';

const mockLeaveGame = vi.fn();

vi.mock('../bridge/useLeaveGame', () => ({
    useLeaveGame: () => mockLeaveGame,
}));

const quickStart = vi.fn();
const load = vi.fn();

const GAME_ID = 'tactics';

function autosaveSlot(gameId: string): SaveSlotMeta {
    return {
        slotId: autosaveSlotId(gameId),
        gameId,
        displayName: 'Autosave',
        savedAt: 0,
        tick: 1,
    } as unknown as SaveSlotMeta;
}

beforeEach(() => {
    _resetShellStateForTest();
    quickStart.mockReset().mockResolvedValue({});
    load.mockReset().mockResolvedValue(undefined);
    mockLeaveGame.mockReset().mockResolvedValue(undefined);
    useSaveStore.setState({ slots: [], isLoading: false });
    (globalThis as Record<string, unknown>)['__chimera'] = {
        lobby: { quickStart },
        saves: { load },
    };
    act(() => {
        setShellRoute({ surface: 'page', pathname: '/character-select', gameId: GAME_ID });
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(globalThis, '__chimera');
    vi.restoreAllMocks();
});

describe('useQuickStart — start', () => {
    it('opens the match for the published game context', async () => {
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await result.current.start();
        });

        expect(quickStart).toHaveBeenCalledWith({ gameId: GAME_ID });
    });

    it('starts the DRAFT the pages accumulated when called with nothing', async () => {
        act(() => {
            setShellDraft({ gameParams: { mapSize: 'small' } });
            setShellDraft({ hostAttributes: { team: 'red' } });
        });
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await result.current.start();
        });

        expect(quickStart).toHaveBeenCalledWith({
            gameId: GAME_ID,
            gameParams: { mapSize: 'small' },
            hostAttributes: { team: 'red' },
        });
    });

    it('merges an explicit config OVER the draft, per key', async () => {
        act(() => {
            setShellDraft({ gameParams: { mapSize: 'small' }, hostAttributes: { team: 'red' } });
        });
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await result.current.start({ hostAttributes: { team: 'blue' } });
        });

        expect(quickStart).toHaveBeenCalledWith({
            gameId: GAME_ID,
            gameParams: { mapSize: 'small' },
            hostAttributes: { team: 'blue' },
        });
    });

    it('reads the draft at CALL time, not at render time', async () => {
        const { result } = renderHook(() => useQuickStart());

        act(() => {
            setShellDraft({ hostAttributes: { team: 'red' } });
        });
        await act(async () => {
            await result.current.start();
        });

        expect(quickStart).toHaveBeenCalledWith({
            gameId: GAME_ID,
            hostAttributes: { team: 'red' },
        });
    });

    it('never re-renders the caller when the draft changes', () => {
        // A page that only STARTS the draft has no reason to re-render on every
        // keystroke a sibling page makes; the draft is read transiently.
        let renders = 0;
        renderHook(() => {
            renders += 1;
            return useQuickStart();
        });
        const before = renders;

        act(() => {
            setShellDraft({ hostAttributes: { team: 'red' } });
        });

        expect(renders).toBe(before);
    });

    it('arms the to-match transition and leaves it armed on success', async () => {
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await result.current.start();
        });

        expect(getShellState().transition).toMatchObject({ kind: 'to-match' });
    });

    it('clears the transition and rejects when the IPC refuses', async () => {
        quickStart.mockRejectedValue(new Error('a session is already active'));
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await expect(result.current.start()).rejects.toThrow('a session is already active');
        });

        expect(getShellState().transition).toBeNull();
    });

    it('refuses with no game context — there is no game to start', async () => {
        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: null });
        });
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await expect(result.current.start()).rejects.toThrow(/game/u);
        });

        expect(quickStart).not.toHaveBeenCalled();
        expect(getShellState().transition).toBeNull();
    });
});

describe('useQuickStart — one failure shape', () => {
    it.each(['start', 'continueFromAutosave'] as const)(
        'REJECTS rather than throwing when the preload bridge is absent (%s)',
        async (verb) => {
            // The engine's own menu verbs keep this a synchronous throw so an
            // engine defect reaches the crash fallback. A game calls this as
            // `void start().catch(report)`, which a synchronous throw breaks.
            Reflect.deleteProperty(globalThis, '__chimera');
            const { result } = renderHook(() => useQuickStart());

            await act(async () => {
                await expect(result.current[verb]()).rejects.toThrow(/not available/u);
            });
        },
    );
});

describe('useQuickStart — continueFromAutosave', () => {
    it('loads the autosave slot for the published game', async () => {
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await result.current.continueFromAutosave();
        });

        expect(load).toHaveBeenCalledWith(autosaveSlotId(GAME_ID));
    });

    it('arms the to-match transition', async () => {
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await result.current.continueFromAutosave();
        });

        expect(getShellState().transition).toMatchObject({ kind: 'to-match' });
    });

    it('clears the transition and rejects when the load is refused', async () => {
        load.mockRejectedValue(new Error('no such slot'));
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await expect(result.current.continueFromAutosave()).rejects.toThrow('no such slot');
        });

        expect(getShellState().transition).toBeNull();
    });

    it('refuses with no game context — the slot cannot be named', async () => {
        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: null });
        });
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await expect(result.current.continueFromAutosave()).rejects.toThrow(/game/u);
        });

        expect(load).not.toHaveBeenCalled();
    });
});

describe('useQuickStart — close', () => {
    it('ends the session through the engine leave, which forks on the session mode', async () => {
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await result.current.close({ autosave: false });
        });

        expect(mockLeaveGame).toHaveBeenCalledWith({ autosave: false });
    });

    it('forwards nothing when called bare, so the engine leave keeps its own default', async () => {
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await result.current.close();
        });

        expect(mockLeaveGame).toHaveBeenCalledWith(undefined);
    });

    it('propagates a refused close rather than swallowing it', async () => {
        mockLeaveGame.mockRejectedValue(new Error('no hosted session'));
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await expect(result.current.close()).rejects.toThrow('no hosted session');
        });
    });

    it('arms no transition — a close is an exit, not a match entry', async () => {
        const { result } = renderHook(() => useQuickStart());

        await act(async () => {
            await result.current.close();
        });

        expect(getShellState().transition).toBeNull();
    });
});

describe('useQuickStart — hasAutosave', () => {
    it('is false while the game has no autosave', () => {
        const { result } = renderHook(() => useQuickStart());

        expect(result.current.hasAutosave).toBe(false);
    });

    it('is true once the slot list carries the autosave', async () => {
        const { result } = renderHook(() => useQuickStart());

        act(() => {
            useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        });

        await waitFor(() => {
            expect(result.current.hasAutosave).toBe(true);
        });
    });

    it('flips back to false when the autosave is deleted', async () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        const { result } = renderHook(() => useQuickStart());
        expect(result.current.hasAutosave).toBe(true);

        act(() => {
            useSaveStore.setState({ slots: [], isLoading: false });
        });

        await waitFor(() => {
            expect(result.current.hasAutosave).toBe(false);
        });
    });

    it('is false when another game holds the only autosave', () => {
        useSaveStore.setState({ slots: [autosaveSlot('other')], isLoading: false });
        const { result } = renderHook(() => useQuickStart());

        expect(result.current.hasAutosave).toBe(false);
    });

    it('is false with no game context — there is nothing to continue', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: null });
        });
        const { result } = renderHook(() => useQuickStart());

        expect(result.current.hasAutosave).toBe(false);
    });
});
