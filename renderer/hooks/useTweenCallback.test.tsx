// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { type useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { easeIn, linear } from '../utils/curves.js';
import { useTweenCallback } from './useTweenCallback.js';

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

describe('useTweenCallback', () => {
    it('fires onComplete exactly once on natural finish without cancellation', () => {
        const onTick = vi.fn();
        const onComplete = vi.fn();
        const onCancel = vi.fn();
        const { result } = renderHook(() =>
            useTweenCallback(1000, easeIn, {
                onCancel,
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
        expect(onCancel).not.toHaveBeenCalled();
        expect(result.current.isRunning).toBe(true);

        act(() => {
            advanceFrames(0.5);
            advanceFrames(0.5);
        });

        expect(onTick).toHaveBeenLastCalledWith(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
        expect(result.current.isRunning).toBe(false);
    });

    it('fires onCancel exactly once when stop cancels an active tween', () => {
        const onTick = vi.fn();
        const onComplete = vi.fn();
        const onCancel = vi.fn();
        const { result } = renderHook(() =>
            useTweenCallback(1000, linear, {
                onCancel,
                onComplete,
                onTick,
            }),
        );

        act(() => {
            result.current.start();
            advanceFrames(0.4);
            result.current.stop();
            advanceFrames(1);
            result.current.stop();
        });

        expect(onTick).toHaveBeenCalledTimes(1);
        expect(onTick).toHaveBeenLastCalledWith(0.4);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onComplete).not.toHaveBeenCalled();
        expect(result.current.isRunning).toBe(false);
    });

    it('treats stop before start as a no-op', () => {
        const onTick = vi.fn();
        const onComplete = vi.fn();
        const onCancel = vi.fn();
        const { result } = renderHook(() =>
            useTweenCallback(1000, linear, {
                onCancel,
                onComplete,
                onTick,
            }),
        );

        act(() => {
            result.current.stop();
            advanceFrames(1);
        });

        expect(onTick).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
        expect(result.current.isRunning).toBe(false);
    });

    it('treats stop after natural completion as a no-op', () => {
        const onTick = vi.fn();
        const onComplete = vi.fn();
        const onCancel = vi.fn();
        const { result } = renderHook(() =>
            useTweenCallback(1000, linear, {
                onCancel,
                onComplete,
                onTick,
            }),
        );

        act(() => {
            result.current.start();
            advanceFrames(1);
            result.current.stop();
        });

        expect(onTick).toHaveBeenCalledTimes(1);
        expect(onTick).toHaveBeenLastCalledWith(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
        expect(result.current.isRunning).toBe(false);
    });

    it('uses the latest callback refs after rerender', () => {
        const initialOnTick = vi.fn();
        const initialOnComplete = vi.fn();
        const initialOnCancel = vi.fn();
        const latestOnTick = vi.fn();
        const latestOnComplete = vi.fn();
        const latestOnCancel = vi.fn();
        const { result, rerender } = renderHook(
            ({ onTick, onComplete, onCancel }) =>
                useTweenCallback(1000, linear, {
                    onCancel,
                    onComplete,
                    onTick,
                }),
            {
                initialProps: {
                    onCancel: initialOnCancel,
                    onComplete: initialOnComplete,
                    onTick: initialOnTick,
                },
            },
        );

        act(() => {
            result.current.start();
        });

        rerender({
            onCancel: latestOnCancel,
            onComplete: latestOnComplete,
            onTick: latestOnTick,
        });

        act(() => {
            advanceFrames(1);
        });

        expect(initialOnTick).not.toHaveBeenCalled();
        expect(initialOnComplete).not.toHaveBeenCalled();
        expect(initialOnCancel).not.toHaveBeenCalled();
        expect(latestOnTick).toHaveBeenCalledTimes(1);
        expect(latestOnTick).toHaveBeenLastCalledWith(1);
        expect(latestOnComplete).toHaveBeenCalledTimes(1);
        expect(latestOnCancel).not.toHaveBeenCalled();
    });
});

function advanceFrames(deltaSeconds: number): void {
    frameCallbacks.forEach((callback) => {
        callback({ invalidate }, deltaSeconds);
    });
}
