// @vitest-environment jsdom

/**
 * renderer/app/saves/useSavesApi.test.ts
 *
 * Unit tests for the useSavesApi hook and getSavesBridge factory.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #374 (WARN-1 address)
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSavesBridge, useSavesApi } from './useSavesApi';
import { toSlotId } from '@chimera/simulation/bridge/api-types.js';
import type {
    CrashRecoveryStatus,
    SaveRequest,
    SaveSlotMeta,
    SavesAPI,
} from '@chimera/simulation/bridge/api-types.js';

// ── getSavesBridge ────────────────────────────────────────────────────────────

describe('getSavesBridge', () => {
    it('returns null when source has no __chimera property', () => {
        expect(getSavesBridge({})).toBeNull();
    });

    it('returns null when __chimera has no saves property', () => {
        expect(getSavesBridge({ __chimera: {} })).toBeNull();
    });

    it('returns the saves API when present', () => {
        const saves: SavesAPI = {
            list: vi.fn(),
            save: vi.fn(),
            load: vi.fn(),
            delete: vi.fn(),
            onSlotUpdate: vi.fn(),
            checkCrashRecovery: vi.fn(),
        };

        const bridge = getSavesBridge({ __chimera: { saves } });

        expect(bridge).toBe(saves);
    });
});

// ── useSavesApi ───────────────────────────────────────────────────────────────

describe('useSavesApi', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(globalThis, '__chimera');
    });

    it('throws when calling save without preload bridge', async () => {
        const { result } = renderHook(() => useSavesApi());

        await expect(
            result.current.save({ gameId: 'tactics', slotId: toSlotId('slot-1') }),
        ).rejects.toThrow('Chimera saves API not available');
    });

    it('throws when calling load without preload bridge', async () => {
        const { result } = renderHook(() => useSavesApi());

        await expect(result.current.load(toSlotId('slot-1'))).rejects.toThrow(
            'Chimera saves API not available',
        );
    });

    it('throws when calling delete without preload bridge', async () => {
        const { result } = renderHook(() => useSavesApi());

        await expect(result.current.delete(toSlotId('slot-1'))).rejects.toThrow(
            'Chimera saves API not available',
        );
    });

    it('delegates save through the bridge', async () => {
        const mockSlotMeta: SaveSlotMeta = {
            slotId: toSlotId('slot-1'),
            gameId: 'tactics',
            tick: 1,
            savedAt: 1_000_000,
        };
        const mockSave = vi.fn(async (_req: SaveRequest) => mockSlotMeta);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                saves: {
                    save: mockSave,
                    load: vi.fn(async () => undefined),
                    delete: vi.fn(async () => undefined),
                    list: vi.fn(async () => []),
                    onSlotUpdate: vi.fn(() => () => undefined),
                },
            },
        });

        const { result } = renderHook(() => useSavesApi());
        const request: SaveRequest = { gameId: 'tactics', slotId: toSlotId('slot-1') };
        const returned = await result.current.save(request);

        expect(mockSave).toHaveBeenCalledWith(request);
        expect(returned).toBe(mockSlotMeta);
    });

    it('delegates load through the bridge', async () => {
        const mockLoad = vi.fn(async () => undefined);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                saves: {
                    save: vi.fn(),
                    load: mockLoad,
                    delete: vi.fn(),
                    list: vi.fn(async () => []),
                    onSlotUpdate: vi.fn(() => () => undefined),
                },
            },
        });

        const { result } = renderHook(() => useSavesApi());
        await result.current.load(toSlotId('slot-1'));

        expect(mockLoad).toHaveBeenCalledWith(toSlotId('slot-1'));
    });

    it('delegates delete through the bridge', async () => {
        const mockDelete = vi.fn(async () => undefined);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                saves: {
                    save: vi.fn(),
                    load: vi.fn(),
                    delete: mockDelete,
                    list: vi.fn(async () => []),
                    onSlotUpdate: vi.fn(() => () => undefined),
                },
            },
        });

        const { result } = renderHook(() => useSavesApi());
        await result.current.delete(toSlotId('slot-2'));

        expect(mockDelete).toHaveBeenCalledWith(toSlotId('slot-2'));
    });

    it('throws when calling checkCrashRecovery without preload bridge', async () => {
        const { result } = renderHook(() => useSavesApi());

        await expect(result.current.checkCrashRecovery()).rejects.toThrow(
            'Chimera saves API not available',
        );
    });

    it('delegates checkCrashRecovery through the bridge', async () => {
        const mockStatus: CrashRecoveryStatus = {
            needsRecovery: true,
            slotId: toSlotId('slot-crash-1'),
        };
        const mockCheck = vi.fn(async () => mockStatus);

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                saves: {
                    save: vi.fn(),
                    load: vi.fn(async () => undefined),
                    delete: vi.fn(async () => undefined),
                    list: vi.fn(async () => []),
                    onSlotUpdate: vi.fn(() => () => undefined),
                    checkCrashRecovery: mockCheck,
                },
            },
        });

        const { result } = renderHook(() => useSavesApi());
        const returned = await result.current.checkCrashRecovery();

        expect(mockCheck).toHaveBeenCalledOnce();
        expect(returned).toBe(mockStatus);
    });

    it('returns a stable reference across re-renders', () => {
        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                saves: {
                    save: vi.fn(),
                    load: vi.fn(),
                    delete: vi.fn(),
                    list: vi.fn(async () => []),
                    onSlotUpdate: vi.fn(() => () => undefined),
                },
            },
        });

        const { result, rerender } = renderHook(() => useSavesApi());
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });
});
