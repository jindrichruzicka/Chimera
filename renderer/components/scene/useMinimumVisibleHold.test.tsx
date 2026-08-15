// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMinimumVisibleHold } from './useMinimumVisibleHold.js';

const HOLD_MS = 300;

interface HoldProps {
    shown: boolean;
    holdMs: number;
}

function renderHold(initial: HoldProps, options: { reactStrictMode?: boolean } = {}) {
    return renderHook(({ shown, holdMs }: HoldProps) => useMinimumVisibleHold(shown, holdMs), {
        initialProps: initial,
        ...options,
    });
}

beforeEach(() => {
    // The remainder is computed from a monotonic performance.now() stamp, so the
    // clock the stamp reads must advance with the timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useMinimumVisibleHold', () => {
    it('returns true from the moment shown rises', () => {
        const { result } = renderHold({ shown: true, holdMs: HOLD_MS });
        expect(result.current).toBe(true);
    });

    it('returns false on a mount that never shows, arming no timer', () => {
        const { result } = renderHold({ shown: false, holdMs: HOLD_MS });
        expect(result.current).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('releases immediately, no timer pending, when the fall comes at the minimum', () => {
        const { result, rerender } = renderHold({ shown: true, holdMs: HOLD_MS });
        act(() => {
            vi.advanceTimersByTime(HOLD_MS);
        });

        rerender({ shown: false, holdMs: HOLD_MS });

        expect(result.current).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('holds a fall inside the minimum until exactly the minimum since the rise', () => {
        const { result, rerender } = renderHold({ shown: true, holdMs: HOLD_MS });
        act(() => {
            vi.advanceTimersByTime(100);
        });

        rerender({ shown: false, holdMs: HOLD_MS });
        expect(result.current).toBe(true);
        // One timer carries the release — the positive control for every
        // structurally-inert case asserting the count stays 0.
        expect(vi.getTimerCount()).toBe(1);

        act(() => {
            vi.advanceTimersByTime(HOLD_MS - 100 - 1);
        });
        expect(result.current).toBe(true);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a re-show during a pending release cancels it and stamps a fresh show time', () => {
        const { result, rerender } = renderHold({ shown: true, holdMs: HOLD_MS });
        act(() => {
            vi.advanceTimersByTime(100);
        });
        rerender({ shown: false, holdMs: HOLD_MS });

        act(() => {
            vi.advanceTimersByTime(50);
        }); // t=150, release pending for t=300
        rerender({ shown: true, holdMs: HOLD_MS });
        expect(vi.getTimerCount()).toBe(0);

        // Past the ORIGINAL release point: an uncancelled timer has fired by now
        // and would have wrongly released the latch below.
        act(() => {
            vi.advanceTimersByTime(200);
        }); // t=350
        rerender({ shown: false, holdMs: HOLD_MS });
        expect(result.current).toBe(true);

        // Fresh stamp at t=150 → release at t=450.
        act(() => {
            vi.advanceTimersByTime(99);
        }); // t=449
        expect(result.current).toBe(true);
        act(() => {
            vi.advanceTimersByTime(1);
        }); // t=450
        expect(result.current).toBe(false);
    });

    it('unmount cancels the pending release timer', () => {
        const { rerender, unmount } = renderHold({ shown: true, holdMs: HOLD_MS });
        act(() => {
            vi.advanceTimersByTime(100);
        });
        rerender({ shown: false, holdMs: HOLD_MS });
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('holdMs 0 is structurally inert: returns shown and never calls setTimeout', () => {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
        const { result, rerender } = renderHold({ shown: true, holdMs: 0 });
        expect(result.current).toBe(true);

        rerender({ shown: false, holdMs: 0 });
        expect(result.current).toBe(false);

        expect(setTimeoutSpy).not.toHaveBeenCalled();
        // Positive control: the spy observes the channel the hook would use.
        window.setTimeout(() => undefined, 5);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    it('holdMs 0 returns shown on EVERY render — the fall render included, with no extra flush', () => {
        // The per-render channel: result.current reads only the post-effect
        // value, which lets a zero-boundary mutant (holdMs >= 0) hold the fall
        // RENDER true and flip it back in an effect flush the inert path
        // promises not to add.
        const observed: { shown: boolean; value: boolean }[] = [];
        function Probe({ shown }: { shown: boolean }): null {
            const value = useMinimumVisibleHold(shown, 0);
            observed.push({ shown, value });
            return null;
        }

        const { rerender } = render(<Probe shown={true} />);
        rerender(<Probe shown={false} />);

        expect(observed).toEqual([
            { shown: true, value: true },
            { shown: false, value: false },
        ]);
    });

    it('a flip to an inert holdMs mid-hold releases the latch rather than leaking it', () => {
        const { result, rerender } = renderHold({ shown: true, holdMs: HOLD_MS });
        act(() => {
            vi.advanceTimersByTime(100);
        });
        rerender({ shown: false, holdMs: HOLD_MS });
        expect(result.current).toBe(true);

        rerender({ shown: false, holdMs: 0 });

        expect(result.current).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a holdMs change during a pending release re-times it from the same stamp', () => {
        const { result, rerender } = renderHold({ shown: true, holdMs: HOLD_MS });
        act(() => {
            vi.advanceTimersByTime(100);
        });
        rerender({ shown: false, holdMs: HOLD_MS }); // release pending for t=300

        rerender({ shown: false, holdMs: 600 }); // same stamp → release at t=600

        act(() => {
            vi.advanceTimersByTime(499);
        }); // t=599
        expect(result.current).toBe(true);
        act(() => {
            vi.advanceTimersByTime(1);
        }); // t=600
        expect(result.current).toBe(false);
    });

    it('a negative holdMs is inert like zero', () => {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
        const { result, rerender } = renderHold({ shown: true, holdMs: -50 });
        expect(result.current).toBe(true);

        rerender({ shown: false, holdMs: -50 });

        expect(result.current).toBe(false);
        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('a non-finite holdMs is inert rather than arming a never-ending hold', () => {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
        const infinite = renderHold({ shown: true, holdMs: Number.POSITIVE_INFINITY });
        infinite.rerender({ shown: false, holdMs: Number.POSITIVE_INFINITY });
        expect(infinite.result.current).toBe(false);

        const nan = renderHold({ shown: true, holdMs: Number.NaN });
        nan.rerender({ shown: false, holdMs: Number.NaN });
        expect(nan.result.current).toBe(false);

        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it("the latch survives StrictMode's simulated effect remount", () => {
        // reactStrictMode (StrictMode at root.render), NOT a wrapper: only the
        // root form simulates the effect unmount/remount this regression is
        // about — a cleanup-only latch stays dead for the rest of the mount.
        const { result, rerender } = renderHold(
            { shown: true, holdMs: HOLD_MS },
            { reactStrictMode: true },
        );
        expect(result.current).toBe(true);

        act(() => {
            vi.advanceTimersByTime(100);
        });
        rerender({ shown: false, holdMs: HOLD_MS });
        expect(result.current).toBe(true);

        act(() => {
            vi.advanceTimersByTime(HOLD_MS - 100 - 1);
        });
        expect(result.current).toBe(true);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe(false);
    });
});
