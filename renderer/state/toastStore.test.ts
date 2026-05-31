// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createToastStore,
    TOAST_DURATION_MS_BY_SEVERITY,
    useToastStore,
    type ToastSeverity,
} from './toastStore';

const UUID_1 = '00000000-0000-4000-8000-000000000001';
const UUID_2 = '00000000-0000-4000-8000-000000000002';
const NOW_MS = 1_234.5;

describe('toastStore', () => {
    let randomUUID: ReturnType<
        typeof vi.fn<() => `${string}-${string}-${string}-${string}-${string}`>
    >;

    beforeEach(() => {
        randomUUID = vi
            .fn<() => `${string}-${string}-${string}-${string}-${string}`>()
            .mockReturnValue(UUID_1);
        vi.stubGlobal('crypto', { randomUUID });
        vi.spyOn(performance, 'now').mockReturnValue(NOW_MS);
        useToastStore.getState().dismissAll();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('starts with an empty queue', () => {
        const store = createToastStore();

        expect(store.getState().queue).toEqual([]);
    });

    it('defines severity duration defaults as the single source of truth', () => {
        expect(TOAST_DURATION_MS_BY_SEVERITY).toEqual({
            info: 4_000,
            success: 3_000,
            warning: 6_000,
            error: 8_000,
        });
    });

    it('pushes a toast with an id and creation timestamp', () => {
        const store = createToastStore();

        store.getState().push({ severity: 'info', title: 'Player reconnected' });

        expect(store.getState().queue).toEqual([
            {
                id: UUID_1,
                severity: 'info',
                title: 'Player reconnected',
                durationMs: 4_000,
                createdAt: NOW_MS,
            },
        ]);
        expect(randomUUID).toHaveBeenCalledOnce();
    });

    it.each([
        ['info', 4_000],
        ['success', 3_000],
        ['warning', 6_000],
        ['error', 8_000],
    ] satisfies readonly [ToastSeverity, number][])(
        'uses the %s severity duration when durationMs is omitted',
        (severity, durationMs) => {
            const store = createToastStore();

            store.getState().push({ severity, title: `${severity} toast` });

            expect(store.getState().queue[0]?.durationMs).toBe(durationMs);
        },
    );

    it('preserves an explicit duration override', () => {
        const store = createToastStore();

        store.getState().push({ severity: 'warning', title: 'Custom warning', durationMs: 2_500 });

        expect(store.getState().queue[0]?.durationMs).toBe(2_500);
    });

    it('preserves optional toast body and action fields', () => {
        const store = createToastStore();
        const action = { label: 'Open', onClick: vi.fn() };

        store.getState().push({
            severity: 'error',
            title: 'Save failed',
            body: 'Try again from the save menu.',
            action,
        });

        expect(store.getState().queue[0]).toMatchObject({
            body: 'Try again from the save menu.',
            action,
        });
    });

    it('appends pushed toasts in order with unique ids', () => {
        const store = createToastStore();
        randomUUID.mockReturnValueOnce(UUID_1).mockReturnValueOnce(UUID_2);

        store.getState().push({ severity: 'info', title: 'First' });
        store.getState().push({ severity: 'success', title: 'Second' });

        expect(store.getState().queue.map((toast) => toast.id)).toEqual([UUID_1, UUID_2]);
        expect(store.getState().queue.map((toast) => toast.title)).toEqual(['First', 'Second']);
    });

    it('dismiss removes the matching toast', () => {
        const store = createToastStore();
        randomUUID.mockReturnValueOnce(UUID_1).mockReturnValueOnce(UUID_2);
        store.getState().push({ severity: 'info', title: 'Keep' });
        store.getState().push({ severity: 'warning', title: 'Dismiss' });

        store.getState().dismiss(UUID_2);

        expect(store.getState().queue.map((toast) => toast.title)).toEqual(['Keep']);
    });

    it('dismiss with an unknown id is a no-op', () => {
        const store = createToastStore();
        store.getState().push({ severity: 'info', title: 'Still here' });
        const before = store.getState().queue;

        store.getState().dismiss(UUID_2);

        expect(store.getState().queue).toEqual(before);
    });

    it('dismissAll clears the queue', () => {
        const store = createToastStore();
        randomUUID.mockReturnValueOnce(UUID_1).mockReturnValueOnce(UUID_2);
        store.getState().push({ severity: 'info', title: 'First' });
        store.getState().push({ severity: 'success', title: 'Second' });

        store.getState().dismissAll();

        expect(store.getState().queue).toEqual([]);
    });

    describe('useToastStore hook', () => {
        beforeEach(() => {
            useToastStore.getState().dismissAll();
        });

        it('returns an empty queue on initial render', () => {
            const { result } = renderHook(() => useToastStore((s) => s.queue));

            expect(result.current).toEqual([]);
        });

        it('re-renders the consumer when a toast is pushed', () => {
            const { result } = renderHook(() => useToastStore((s) => s.queue));

            act(() => {
                useToastStore.getState().push({ severity: 'info', title: 'Hook test' });
            });

            expect(result.current).toHaveLength(1);
            expect(result.current[0]).toMatchObject({ severity: 'info', title: 'Hook test' });
        });

        it('re-renders the consumer when a toast is dismissed', () => {
            const { result } = renderHook(() => useToastStore((s) => s.queue));
            act(() => {
                useToastStore.getState().push({ severity: 'success', title: 'Gone soon' });
            });
            const id = result.current[0]!.id;

            act(() => {
                useToastStore.getState().dismiss(id);
            });

            expect(result.current).toEqual([]);
        });

        it('re-renders the consumer when dismissAll is called', () => {
            const { result } = renderHook(() => useToastStore((s) => s.queue));
            act(() => {
                useToastStore.getState().push({ severity: 'warning', title: 'One' });
                useToastStore.getState().push({ severity: 'error', title: 'Two' });
            });

            act(() => {
                useToastStore.getState().dismissAll();
            });

            expect(result.current).toEqual([]);
        });
    });
});
