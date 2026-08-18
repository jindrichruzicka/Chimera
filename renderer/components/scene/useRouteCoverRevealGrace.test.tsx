// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRouteCoverRevealGrace } from './useRouteCoverRevealGrace.js';

const GRACE_MS = 350;

interface GraceProps {
    waiting: boolean;
    graceMs: number;
}

function renderGrace(initial: GraceProps, options: { reactStrictMode?: boolean } = {}) {
    return renderHook(
        ({ waiting, graceMs }: GraceProps) => useRouteCoverRevealGrace(waiting, graceMs),
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

describe('useRouteCoverRevealGrace', () => {
    it('withholds the request while the wait is younger than the grace', () => {
        const { result } = renderGrace({ waiting: true, graceMs: GRACE_MS });
        expect(result.current).toBe(false);
        // One timer carries the request — the positive control for every
        // structurally-inert case asserting the count stays 0.
        expect(vi.getTimerCount()).toBe(1);

        act(() => {
            vi.advanceTimersByTime(GRACE_MS - 1);
        });
        expect(result.current).toBe(false);
    });

    it('requests the reveal at exactly the grace since the wait began', () => {
        const { result } = renderGrace({ waiting: true, graceMs: GRACE_MS });

        act(() => {
            vi.advanceTimersByTime(GRACE_MS - 1);
        });
        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('fires on a wait that never ends — the timer reads nothing but the clock', () => {
        // The requirement the route depends on: a slow, missing or undeclared
        // asset can leave the gate pending forever, and the reveal still comes.
        const { result } = renderGrace({ waiting: true, graceMs: GRACE_MS });

        act(() => {
            vi.advanceTimersByTime(60_000);
        });

        expect(result.current).toBe(true);
    });

    it('arms nothing for a mount that is not waiting', () => {
        const { result } = renderGrace({ waiting: false, graceMs: GRACE_MS });
        expect(result.current).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a wait that ends before the grace cancels the timer and requests nothing', () => {
        const { result, rerender } = renderGrace({ waiting: true, graceMs: GRACE_MS });
        act(() => {
            vi.advanceTimersByTime(100);
        });

        rerender({ waiting: false, graceMs: GRACE_MS });
        expect(vi.getTimerCount()).toBe(0);

        act(() => {
            vi.advanceTimersByTime(GRACE_MS);
        });
        expect(result.current).toBe(false);
    });

    it('withdraws the request when the wait ends after it was granted', () => {
        const { result, rerender } = renderGrace({ waiting: true, graceMs: GRACE_MS });
        act(() => {
            vi.advanceTimersByTime(GRACE_MS);
        });
        expect(result.current).toBe(true);

        rerender({ waiting: false, graceMs: GRACE_MS });

        expect(result.current).toBe(false);
    });

    it('a second wait in the same mount gets its own full grace', () => {
        const { result, rerender } = renderGrace({ waiting: true, graceMs: GRACE_MS });
        act(() => {
            vi.advanceTimersByTime(300);
        });
        rerender({ waiting: false, graceMs: GRACE_MS });

        rerender({ waiting: true, graceMs: GRACE_MS });
        // The first wait's 300 ms must not carry over: a grace that resumed the
        // old wait would grant the request 50 ms in.
        act(() => {
            vi.advanceTimersByTime(GRACE_MS - 1);
        });
        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe(true);
    });

    it('unmount cancels the pending request timer', () => {
        const { unmount } = renderGrace({ waiting: true, graceMs: GRACE_MS });
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('graceMs 0 is structurally inert: returns waiting and never calls setTimeout', () => {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
        const { result, rerender } = renderGrace({ waiting: true, graceMs: 0 });
        expect(result.current).toBe(true);

        rerender({ waiting: false, graceMs: 0 });
        expect(result.current).toBe(false);

        expect(setTimeoutSpy).not.toHaveBeenCalled();
        // Positive control: the spy observes the channel the hook would use.
        window.setTimeout(() => undefined, 5);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    it('a negative graceMs is inert like zero', () => {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
        const { result } = renderGrace({ waiting: true, graceMs: -50 });

        expect(result.current).toBe(true);
        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('a non-finite graceMs is inert rather than arming a reveal that never comes', () => {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
        const infinite = renderGrace({ waiting: true, graceMs: Number.POSITIVE_INFINITY });
        expect(infinite.result.current).toBe(true);

        const nan = renderGrace({ waiting: true, graceMs: Number.NaN });
        expect(nan.result.current).toBe(true);

        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it("the grace survives StrictMode's simulated effect remount", () => {
        // reactStrictMode (StrictMode at root.render), NOT a wrapper: only the
        // root form simulates the effect unmount/remount. The setup re-arms the
        // timer its own cleanup just cleared — an effect that armed once per
        // mount would leave the reveal permanently un-armed in dev.
        const { result } = renderGrace(
            { waiting: true, graceMs: GRACE_MS },
            { reactStrictMode: true },
        );
        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(GRACE_MS - 1);
        });
        expect(result.current).toBe(false);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe(true);
    });
});
