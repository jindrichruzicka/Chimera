// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCoverExitRamp } from './useCoverExitRamp.js';

const EXIT_MS = 200;

interface RampProps {
    up: boolean;
    visible: boolean;
    exitMs: number;
}

function renderRamp(initial: RampProps, options: { reactStrictMode?: boolean } = {}) {
    return renderHook(
        ({ up, visible, exitMs }: RampProps) => useCoverExitRamp(up, visible, exitMs),
        { initialProps: initial, ...options },
    );
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useCoverExitRamp', () => {
    it('mounts without exiting while the cover window is open', () => {
        const { result } = renderRamp({ up: true, visible: true, exitMs: EXIT_MS });
        expect(result.current).toEqual({ mounted: true, exiting: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('drops a cover nobody saw in the same render, arming no timer', () => {
        // The fast entry: the window opened and closed under an opaque scrim, so
        // there is nothing to fade out of and the drop stays a hard unmount.
        const { result, rerender } = renderRamp({ up: true, visible: false, exitMs: EXIT_MS });

        rerender({ up: false, visible: false, exitMs: EXIT_MS });

        expect(result.current).toEqual({ mounted: false, exiting: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps a seen cover mounted and exiting from the first render after the drop', () => {
        const { result, rerender } = renderRamp({ up: true, visible: true, exitMs: EXIT_MS });

        rerender({ up: false, visible: false, exitMs: EXIT_MS });

        // Mounted AND exiting on the same committed render: a cover that
        // unmounted for one render and came back would flash, and one that
        // stayed opaque for a render would start its ramp late.
        expect(result.current).toEqual({ mounted: true, exiting: true });
        expect(vi.getTimerCount()).toBe(1);
    });

    it('unmounts the exiting cover at exactly exitMs', () => {
        const { result, rerender } = renderRamp({ up: true, visible: true, exitMs: EXIT_MS });
        rerender({ up: false, visible: false, exitMs: EXIT_MS });

        act(() => {
            vi.advanceTimersByTime(EXIT_MS - 1);
        });
        expect(result.current).toEqual({ mounted: true, exiting: true });

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toEqual({ mounted: false, exiting: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('exits a cover that stopped being visible before its window closed', () => {
        // The floor's remainder: the gate settles, so `visible` falls while the
        // window stays open for the minimum. Reading only the last covered
        // render would call that cover unseen and cut it.
        const { result, rerender } = renderRamp({ up: true, visible: true, exitMs: EXIT_MS });

        rerender({ up: true, visible: false, exitMs: EXIT_MS });
        rerender({ up: false, visible: false, exitMs: EXIT_MS });

        expect(result.current).toEqual({ mounted: true, exiting: true });
    });

    it('a cover reported visible with its window already closed arms nothing', () => {
        // Visibility belongs to the window it was seen in. A caller whose
        // `visible` term outlives `up` must not resurrect a ramp for a window
        // that closed unseen.
        const { result, rerender } = renderRamp({ up: true, visible: false, exitMs: EXIT_MS });

        rerender({ up: false, visible: true, exitMs: EXIT_MS });

        expect(result.current).toEqual({ mounted: false, exiting: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('re-times a running ramp when the duration changes under it', () => {
        // /game flips this term when a restore starts mid-ramp (screenFadeMs()
        // to 0): the cover has to leave on the NEW duration, not sit out the
        // one the ramp began with, because a restore's abort control is under it.
        const { result, rerender } = renderRamp({ up: true, visible: true, exitMs: EXIT_MS });
        rerender({ up: false, visible: false, exitMs: EXIT_MS });
        expect(result.current.exiting).toBe(true);

        rerender({ up: false, visible: false, exitMs: 20 });
        act(() => {
            vi.advanceTimersByTime(20);
        });

        expect(result.current).toEqual({ mounted: false, exiting: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a re-opened window cancels the ramp and clears its timer', () => {
        const { result, rerender } = renderRamp({ up: true, visible: true, exitMs: EXIT_MS });
        rerender({ up: false, visible: false, exitMs: EXIT_MS });
        expect(result.current.exiting).toBe(true);

        rerender({ up: true, visible: true, exitMs: EXIT_MS });

        expect(result.current).toEqual({ mounted: true, exiting: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a re-opened window that is never seen drops hard again', () => {
        // The ramp's arming fact is per-window: the previous window's visibility
        // must not carry into the next one.
        const { result, rerender } = renderRamp({ up: true, visible: true, exitMs: EXIT_MS });
        rerender({ up: false, visible: false, exitMs: EXIT_MS });
        act(() => {
            vi.advanceTimersByTime(EXIT_MS);
        });

        rerender({ up: true, visible: false, exitMs: EXIT_MS });
        rerender({ up: false, visible: false, exitMs: EXIT_MS });

        expect(result.current).toEqual({ mounted: false, exiting: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('unmount cancels the pending ramp timer', () => {
        const { rerender, unmount } = renderRamp({ up: true, visible: true, exitMs: EXIT_MS });
        rerender({ up: false, visible: false, exitMs: EXIT_MS });
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('exitMs 0 is structurally inert: mounted tracks up and setTimeout is never called', () => {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
        const { result, rerender } = renderRamp({ up: true, visible: true, exitMs: 0 });
        expect(result.current).toEqual({ mounted: true, exiting: false });

        rerender({ up: false, visible: false, exitMs: 0 });

        expect(result.current).toEqual({ mounted: false, exiting: false });
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        // Positive control: the spy observes the channel the hook would use.
        window.setTimeout(() => undefined, 5);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a negative exitMs', -50],
        ['a non-finite exitMs', Number.POSITIVE_INFINITY],
        ['NaN', Number.NaN],
    ])('%s is inert rather than stranding the cover', (_name, exitMs) => {
        const { result, rerender } = renderRamp({ up: true, visible: true, exitMs });

        rerender({ up: false, visible: false, exitMs });

        expect(result.current).toEqual({ mounted: false, exiting: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("survives StrictMode's simulated effect remount without restarting the ramp", () => {
        const { result, rerender } = renderRamp(
            { up: true, visible: true, exitMs: EXIT_MS },
            { reactStrictMode: true },
        );
        rerender({ up: false, visible: false, exitMs: EXIT_MS });
        expect(result.current).toEqual({ mounted: true, exiting: true });

        act(() => {
            vi.advanceTimersByTime(EXIT_MS);
        });

        expect(result.current).toEqual({ mounted: false, exiting: false });
    });
});
