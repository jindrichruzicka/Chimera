// renderer/components/shell/useProfileSwitcher.test.ts
// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProfileSwitcherBridge, useProfileSwitcher } from './useProfileSwitcher';
import { useProfileStore } from '../../state/profileStore';

describe('getProfileSwitcherBridge', () => {
    it('returns null when __chimera is absent', () => {
        expect(getProfileSwitcherBridge({})).toBeNull();
    });

    it('returns null when profile namespace is absent', () => {
        expect(getProfileSwitcherBridge({ __chimera: {} })).toBeNull();
    });

    it('returns null when logs namespace is absent', () => {
        const profile = {
            listLocalSlots: vi.fn(),
            switchLocalSlot: vi.fn(),
            getLocalProfile: vi.fn(),
        };
        expect(getProfileSwitcherBridge({ __chimera: { profile } })).toBeNull();
    });

    it('returns bridge when both profile and logs are present', () => {
        const profile = {
            listLocalSlots: vi.fn(),
            switchLocalSlot: vi.fn(),
            getLocalProfile: vi.fn(),
        };
        const logs = { emit: vi.fn() };
        const result = getProfileSwitcherBridge({ __chimera: { profile, logs } });
        expect(result).toEqual({ profile, logs });
    });
});

describe('useProfileSwitcher', () => {
    beforeEach(() => {
        useProfileStore.getState().setLocalProfileId(null);
        Reflect.deleteProperty(globalThis, '__chimera');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(globalThis, '__chimera');
    });

    it('returns empty slots when bridge is unavailable', () => {
        const { result } = renderHook(() => useProfileSwitcher());
        expect(result.current.slots).toEqual([]);
    });

    it('loads profile slots from the bridge on mount', async () => {
        const slots = [
            { localProfileId: 'local-a', displayName: 'Alice' },
            { localProfileId: 'local-b', displayName: 'Bob' },
        ];

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                profile: {
                    listLocalSlots: vi.fn(async () => slots),
                    switchLocalSlot: vi.fn(async () => undefined),
                    getLocalProfile: vi.fn(async () => ({
                        localProfileId: 'local-a',
                        displayName: 'Alice',
                        avatar: { type: 'initials' as const, initials: 'A' },
                        locale: 'en',
                    })),
                },
                logs: { emit: vi.fn() },
            },
        });

        const { result } = renderHook(() => useProfileSwitcher());

        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current.slots).toEqual(slots);
    });

    it('emits a structured log entry when listLocalSlots rejects', async () => {
        const emit = vi.fn();
        const loadError = new Error('ipc error');

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                profile: {
                    listLocalSlots: vi.fn(async () => Promise.reject(loadError)),
                    switchLocalSlot: vi.fn(async () => undefined),
                    getLocalProfile: vi.fn(async () => undefined),
                },
                logs: { emit },
            },
        });

        renderHook(() => useProfileSwitcher());

        await act(async () => {
            await Promise.resolve();
        });

        expect(emit).toHaveBeenCalledOnce();
        // Non-null: asserted immediately above that the mock was called once
        const entry = emit.mock.calls[0]![0] as {
            level: string;
            error: { name: string; message: string };
        };
        expect(entry.level).toBe('error');
        expect(entry.error.name).toBe('Error');
        expect(entry.error.message).toBe('ipc error');
    });

    it('switchToProfile calls switchLocalSlot with the correct localProfileId', async () => {
        const switchLocalSlot = vi.fn(async () => undefined);
        const getLocalProfile = vi.fn(async () => ({
            localProfileId: 'local-b',
            displayName: 'Bob',
            avatar: { type: 'initials' as const, initials: 'B' },
            locale: 'en',
        }));

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                profile: {
                    listLocalSlots: vi.fn(async () => []),
                    switchLocalSlot,
                    getLocalProfile,
                },
                logs: { emit: vi.fn() },
            },
        });

        const { result } = renderHook(() => useProfileSwitcher());

        await act(async () => {
            await result.current.switchToProfile('local-b');
        });

        expect(switchLocalSlot).toHaveBeenCalledWith('local-b');
    });

    it('after ACK, profileStore reflects the profile confirmed by getLocalProfile', async () => {
        const switchLocalSlot = vi.fn(async () => undefined);
        const getLocalProfile = vi.fn(async () => ({
            localProfileId: 'local-b',
            displayName: 'Bob',
            avatar: { type: 'initials' as const, initials: 'B' },
            locale: 'en',
        }));
        const slots = [
            { localProfileId: 'local-a', displayName: 'Alice' },
            { localProfileId: 'local-b', displayName: 'Bob' },
        ];

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                profile: {
                    listLocalSlots: vi.fn(async () => slots),
                    switchLocalSlot,
                    getLocalProfile,
                },
                logs: { emit: vi.fn() },
            },
        });

        const { result } = renderHook(() => useProfileSwitcher());

        await act(async () => {
            await result.current.switchToProfile('local-b');
        });

        expect(getLocalProfile).toHaveBeenCalled();
        expect(useProfileStore.getState().localProfileId).toBe('local-b');
    });

    it('emits a structured log entry when switchToProfile fails', async () => {
        const emit = vi.fn();
        const switchError = new Error('update failed');

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                profile: {
                    listLocalSlots: vi.fn(async () => []),
                    switchLocalSlot: vi.fn(async () => Promise.reject(switchError)),
                    getLocalProfile: vi.fn(async () => undefined),
                },
                logs: { emit },
            },
        });

        const { result } = renderHook(() => useProfileSwitcher());

        await act(async () => {
            await result.current.switchToProfile('local-b');
        });

        expect(emit).toHaveBeenCalledOnce();
        // Non-null: asserted immediately above that the mock was called once
        const entry = emit.mock.calls[0]![0] as {
            level: string;
            context: { localProfileId: string };
            error: { message: string };
        };
        expect(entry.level).toBe('error');
        expect(entry.context.localProfileId).toBe('local-b');
        expect(entry.error.message).toBe('update failed');
    });

    it('does not update profileStore when bridge is unavailable', async () => {
        const { result } = renderHook(() => useProfileSwitcher());

        await act(async () => {
            await result.current.switchToProfile('local-b');
        });

        expect(useProfileStore.getState().localProfileId).toBeNull();
    });

    it('cancels pending listLocalSlots call on unmount', async () => {
        let resolveSlots!: (slots: { localProfileId: string; displayName: string }[]) => void;
        const listLocalSlots = vi.fn(
            () =>
                new Promise<{ localProfileId: string; displayName: string }[]>((res) => {
                    resolveSlots = res;
                }),
        );

        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: {
                profile: {
                    listLocalSlots,
                    switchLocalSlot: vi.fn(async () => undefined),
                    getLocalProfile: vi.fn(async () => undefined),
                },
                logs: { emit: vi.fn() },
            },
        });

        const { result, unmount } = renderHook(() => useProfileSwitcher());
        unmount();

        await act(async () => {
            resolveSlots([{ localProfileId: 'local-a', displayName: 'Alice' }]);
            await Promise.resolve();
        });

        // Slots should remain empty because the effect was cancelled
        expect(result.current.slots).toEqual([]);
    });
});
