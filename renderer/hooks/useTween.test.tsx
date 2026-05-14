// @vitest-environment jsdom

import { useFrame } from '@react-three/fiber';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { easeIn, linear } from '../utils/curves.js';
import { type TweenState, useTween, useTweenCallback } from './useTween.js';

interface FrameState {
    invalidate(): void;
}

type FrameCallback = (state: FrameState, deltaSeconds: number) => void;

let frameCallbacks: FrameCallback[] = [];
let invalidate: ReturnType<typeof vi.fn>;

vi.mock('@react-three/fiber', async () => {
    const { useRef: useReactRef } = await vi.importActual<{ useRef: typeof useRef }>('react');

    return {
        useFrame: vi.fn((callback: FrameCallback) => {
            const callbackIndexRef = useReactRef<number | null>(null);
            callbackIndexRef.current ??= frameCallbacks.length;

            frameCallbacks[callbackIndexRef.current] = callback;
        }),
        useThree: vi.fn((selector: (state: FrameState) => unknown) => selector({ invalidate })),
    };
});

beforeEach(() => {
    frameCallbacks = [];
    invalidate = vi.fn();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useTween', () => {
    it('starts at rest until start is called', () => {
        const { result } = renderHook(() => useTween(1000));

        expect(result.current.value).toBe(0);
        expect(result.current.isRunning).toBe(false);
    });

    it('progresses from 0 toward 1 across frames after start', () => {
        const { result } = renderHook(() => useTween(1000, linear));

        act(() => {
            result.current.start();
        });

        expect(result.current.value).toBe(0);
        expect(result.current.isRunning).toBe(true);

        act(() => {
            advanceFrames(0.25);
        });

        expect(result.current.value).toBe(0.25);
        expect(result.current.isRunning).toBe(true);
    });

    it('applies the configured easing function to frame progress', () => {
        const { result } = renderHook(() => useTween(1000, easeIn));

        act(() => {
            result.current.start();
            advanceFrames(0.5);
        });

        expect(result.current.value).toBe(0.25);
        expect(result.current.isRunning).toBe(true);
    });

    it('naturally completes at value 1 and stops running on the final frame', () => {
        const { result } = renderHook(() => useTween(1000, linear));

        act(() => {
            result.current.start();
            advanceFrames(0.75);
        });

        expect(result.current.value).toBe(0.75);
        expect(result.current.isRunning).toBe(true);

        act(() => {
            advanceFrames(0.25);
        });

        expect(result.current.value).toBe(1);
        expect(result.current.isRunning).toBe(false);
    });

    it('clamps natural completion when a frame overshoots duration', () => {
        const { result } = renderHook(() => useTween(1000, linear));

        act(() => {
            result.current.start();
            advanceFrames(1.5);
        });

        expect(result.current.value).toBe(1);
        expect(result.current.isRunning).toBe(false);
    });

    it('completes immediately when started with zero duration', () => {
        const { result } = renderHook(() => useTween(0, linear));

        act(() => {
            result.current.start();
        });

        expect(result.current.value).toBe(1);
        expect(result.current.isRunning).toBe(false);
    });

    it('completes on the next frame when active duration becomes invalid', () => {
        const { result, rerender } = renderHook(({ durationMs }) => useTween(durationMs, linear), {
            initialProps: { durationMs: 1000 },
        });

        act(() => {
            result.current.start();
            advanceFrames(0.25);
        });

        expect(result.current.value).toBe(0.25);
        expect(result.current.isRunning).toBe(true);

        rerender({ durationMs: Number.NaN });

        act(() => {
            advanceFrames(0.25);
        });

        expect(result.current.value).toBe(1);
        expect(result.current.isRunning).toBe(false);
    });

    it('stops mid-flight by cancelling and resetting value to 0', () => {
        const { result } = renderHook(() => useTween(1000, linear));

        act(() => {
            result.current.start();
            advanceFrames(0.4);
        });

        expect(result.current.value).toBe(0.4);
        expect(result.current.isRunning).toBe(true);

        act(() => {
            result.current.stop();
        });

        expect(result.current.value).toBe(0);
        expect(result.current.isRunning).toBe(false);
    });

    it('ignores later frames after stop until restarted', () => {
        const { result } = renderHook(() => useTween(1000, linear));

        act(() => {
            result.current.start();
            advanceFrames(0.4);
            result.current.stop();
            advanceFrames(0.6);
        });

        expect(result.current.value).toBe(0);
        expect(result.current.isRunning).toBe(false);
    });

    it('restarts from 0 after stop', () => {
        const { result } = renderHook(() => useTween(1000, linear));

        act(() => {
            result.current.start();
            advanceFrames(0.4);
            result.current.stop();
            result.current.start();
        });

        expect(result.current.value).toBe(0);
        expect(result.current.isRunning).toBe(true);

        act(() => {
            advanceFrames(0.25);
        });

        expect(result.current.value).toBe(0.25);
        expect(result.current.isRunning).toBe(true);
    });

    it('does not rerender consumers for in-flight frame progress', () => {
        const { result } = renderHook(() => useTweenRenderProbe());

        expect(result.current.renderCount).toBe(1);

        act(() => {
            result.current.start();
        });

        expect(result.current.renderCount).toBe(2);

        act(() => {
            advanceFrames(0.25);
        });

        expect(result.current.value).toBe(0.25);
        expect(result.current.isRunning).toBe(true);
        expect(result.current.renderCount).toBe(2);
    });

    it('rerenders lifecycle consumers when a frame naturally completes the tween', () => {
        const { result } = renderHook(() => useTweenRenderProbe());

        act(() => {
            result.current.start();
        });

        const renderCountAfterStart = result.current.renderCount;

        act(() => {
            advanceFrames(0.5);
        });

        expect(result.current.renderCount).toBe(renderCountAfterStart);

        act(() => {
            advanceFrames(0.5);
        });

        expect(result.current.value).toBe(1);
        expect(result.current.isRunning).toBe(false);
        expect(result.current.renderCount).toBe(renderCountAfterStart + 1);
    });

    it('rerenders lifecycle consumers when an invalid duration completes the tween mid-flight', () => {
        const { result, rerender } = renderHook(
            ({ durationMs }) => useTweenRenderProbeWithDuration(durationMs),
            { initialProps: { durationMs: 1000 } },
        );

        act(() => {
            result.current.start();
            advanceFrames(0.25);
        });

        rerender({ durationMs: Number.NaN });

        const renderCountAfterRerender = result.current.renderCount;

        act(() => {
            advanceFrames(0.25);
        });

        expect(result.current.value).toBe(1);
        expect(result.current.isRunning).toBe(false);
        expect(result.current.renderCount).toBe(renderCountAfterRerender + 1);
    });

    it('exposes live values read by consumer frame callbacks', () => {
        const { result } = renderHook(() => useTweenConsumerProbe());

        act(() => {
            result.current.start();
        });

        act(() => {
            advanceFrames(0.5);
        });

        expect(result.current.value).toBe(0.5);

        act(() => {
            advanceFrames(0.25);
        });

        expect(result.current.samples).toEqual([0.5, 0.75]);
    });
});

describe('useTweenCallback', () => {
    it('emits eased ticks and completion callbacks across frames', () => {
        const onTick = vi.fn();
        const onComplete = vi.fn();
        const { result } = renderHook(() =>
            useTweenCallback(1000, easeIn, {
                onComplete,
                onTick,
            }),
        );

        act(() => {
            result.current.start();
        });

        expect(result.current.isRunning).toBe(true);

        act(() => {
            advanceFrames(0.5);
        });

        expect(onTick).toHaveBeenLastCalledWith(0.25);
        expect(onComplete).not.toHaveBeenCalled();
        expect(result.current.isRunning).toBe(true);

        act(() => {
            advanceFrames(0.5);
        });

        expect(onTick).toHaveBeenLastCalledWith(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(result.current.isRunning).toBe(false);
    });

    it('does not complete after stop cancels an active tween', () => {
        const onTick = vi.fn();
        const onComplete = vi.fn();
        const { result } = renderHook(() =>
            useTweenCallback(1000, linear, {
                onComplete,
                onTick,
            }),
        );

        act(() => {
            result.current.start();
            advanceFrames(0.5);
            result.current.stop();
            advanceFrames(0.5);
        });

        expect(onTick).toHaveBeenCalledTimes(1);
        expect(onComplete).not.toHaveBeenCalled();
        expect(result.current.isRunning).toBe(false);
    });
});

function advanceFrames(deltaSeconds: number): void {
    frameCallbacks.forEach((callback) => {
        callback({ invalidate }, deltaSeconds);
    });
}

function useTweenConsumerProbe(): {
    readonly samples: readonly number[];
    readonly start: () => void;
    readonly value: number;
} {
    const tween = useTween(1000, linear);
    const samplesRef = useRef<number[]>([]);

    useFrame(() => {
        samplesRef.current.push(tween.value);
    });

    return {
        samples: samplesRef.current,
        start: tween.start,
        get value(): number {
            return tween.value;
        },
    };
}

function useTweenRenderProbe(): TweenState & { readonly renderCount: number } {
    return useTweenRenderProbeWithDuration(1000);
}

function useTweenRenderProbeWithDuration(
    durationMs: number,
): TweenState & { readonly renderCount: number } {
    const renderCountRef = useRef(0);
    renderCountRef.current += 1;
    const tween = useTween(durationMs, linear);

    return {
        get isRunning(): boolean {
            return tween.isRunning;
        },
        get value(): number {
            return tween.value;
        },
        start: tween.start,
        stop: tween.stop,
        renderCount: renderCountRef.current,
    };
}
