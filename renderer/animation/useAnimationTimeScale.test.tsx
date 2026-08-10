// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimeScaleStore } from './timeScaleStore.js';
import { useAnimationTimeScale } from './useAnimationTimeScale.js';

beforeEach(() => {
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

afterEach(() => {
    cleanup();
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

describe('useAnimationTimeScale', () => {
    it('reads real time while nothing has dilated', () => {
        const { result } = renderHook(() => useAnimationTimeScale());

        expect(result.current).toBe(1);
    });

    it('re-renders its consumer with the multiplier a later write seats', () => {
        const seen: number[] = [];
        renderHook(() => {
            seen.push(useAnimationTimeScale());
        });

        act(() => {
            useTimeScaleStore.getState().setAuthoritativePermille(250);
        });

        expect(seen[0]).toBe(1);
        expect(seen[seen.length - 1]).toBe(0.25);
    });

    it('publishes the multiplier, never the permille', () => {
        useTimeScaleStore.getState().setAuthoritativePermille(2000);

        const { result } = renderHook(() => useAnimationTimeScale());

        expect(result.current).toBe(2);
    });
});
