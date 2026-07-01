// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReplayAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import { getReplayBridge, useReplayApi } from './useReplayApi';

function makeReplayBridge(): ReplayAPI {
    return {
        list: vi.fn(() => Promise.resolve([])),
        exportCurrentMatch: vi.fn(() => Promise.resolve('/p')),
        openInPlayer: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
        onNavigate: vi.fn(() => () => undefined),
        onExported: vi.fn(() => () => undefined),
        openPlayback: vi.fn(() =>
            Promise.resolve({
                gameId: 'tactics',
                totalTicks: 3,
                playerIds: ['p1'],
                viewerId: 'p1',
            }),
        ),
        snapshotAt: vi.fn(() => Promise.resolve({ tick: 0 } as never)),
        snapshotRange: vi.fn(() => Promise.resolve([])),
        closePlayback: vi.fn(() => Promise.resolve()),
        // Perspective sub-namespace (F44b / T7). The hook wraps the slice the
        // browser and player consume (`list`, `exportCurrent`, `openPlayback`,
        // `snapshotAt`, `closePlayback`); `exportCurrent` backs the player's save
        // icon for a perspective replay.
        perspective: {
            list: vi.fn(() => Promise.resolve([])),
            exportCurrent: vi.fn(() => Promise.resolve('/p')),
            openInPlayer: vi.fn(() => Promise.resolve()),
            delete: vi.fn(() => Promise.resolve()),
            openPlayback: vi.fn(() =>
                Promise.resolve({ gameId: 'tactics', totalTicks: 3, viewerId: 'p1' }),
            ),
            snapshotAt: vi.fn(() => Promise.resolve({ tick: 0 } as never)),
            snapshotRange: vi.fn(() => Promise.resolve([])),
            closePlayback: vi.fn(() => Promise.resolve()),
        },
    };
}

describe('getReplayBridge', () => {
    it('returns the replay slice when the bridge is present', () => {
        const replay = makeReplayBridge();
        expect(getReplayBridge({ __chimera: { replay } })).toBe(replay);
    });

    it('returns null when the bridge is absent', () => {
        expect(getReplayBridge({})).toBeNull();
        expect(getReplayBridge({ __chimera: {} })).toBeNull();
    });
});

describe('useReplayApi', () => {
    it('delegates every method to the bridge', async () => {
        const replay = makeReplayBridge();
        Object.defineProperty(window, '__chimera', { configurable: true, value: { replay } });

        try {
            const { result } = renderHook(() => useReplayApi());

            await result.current.list('tactics');
            await result.current.exportCurrentMatch();
            await result.current.openInPlayer('/p');
            await result.current.delete('/p');
            await result.current.openPlayback('/p');
            await result.current.snapshotAt(2);
            await result.current.snapshotRange(1, 3);
            await result.current.closePlayback();
            const off = result.current.onNavigate(() => undefined);
            off();
            const offExported = result.current.onExported(() => undefined);
            offExported();

            expect(replay.list).toHaveBeenCalledWith('tactics');
            expect(replay.exportCurrentMatch).toHaveBeenCalledOnce();
            expect(replay.openInPlayer).toHaveBeenCalledWith('/p');
            expect(replay.delete).toHaveBeenCalledWith('/p');
            expect(replay.openPlayback).toHaveBeenCalledWith('/p');
            expect(replay.snapshotAt).toHaveBeenCalledWith(2);
            expect(replay.snapshotRange).toHaveBeenCalledWith(1, 3);
            expect(replay.closePlayback).toHaveBeenCalledOnce();
            expect(replay.onNavigate).toHaveBeenCalledOnce();
            expect(replay.onExported).toHaveBeenCalledOnce();
        } finally {
            Reflect.deleteProperty(window, '__chimera');
        }
    });

    it('delegates perspective.exportCurrent to the bridge (player save icon)', async () => {
        const replay = makeReplayBridge();
        Object.defineProperty(window, '__chimera', { configurable: true, value: { replay } });

        try {
            const { result } = renderHook(() => useReplayApi());
            await result.current.perspective.exportCurrent();
            expect(replay.perspective.exportCurrent).toHaveBeenCalledOnce();
        } finally {
            Reflect.deleteProperty(window, '__chimera');
        }
    });

    it('delegates perspective.delete to the bridge (replay browser delete)', async () => {
        const replay = makeReplayBridge();
        Object.defineProperty(window, '__chimera', { configurable: true, value: { replay } });

        try {
            const { result } = renderHook(() => useReplayApi());
            await result.current.perspective.delete('/p');
            expect(replay.perspective.delete).toHaveBeenCalledWith('/p');
        } finally {
            Reflect.deleteProperty(window, '__chimera');
        }
    });

    it('returns a stable reference across re-renders', () => {
        const replay = makeReplayBridge();
        Object.defineProperty(window, '__chimera', { configurable: true, value: { replay } });

        try {
            const { result, rerender } = renderHook(() => useReplayApi());
            const first = result.current;
            rerender();
            expect(result.current).toBe(first);
        } finally {
            Reflect.deleteProperty(window, '__chimera');
        }
    });

    it('throws a descriptive error when the bridge is unavailable', async () => {
        const { result } = renderHook(() => useReplayApi());
        await expect(result.current.list('tactics')).rejects.toThrow(/replay API not available/i);
    });
});
