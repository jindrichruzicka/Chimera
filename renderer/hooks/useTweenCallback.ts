'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useMemo, useReducer, useRef } from 'react';
import { type EasingFn } from '../utils/curves.js';
import { type TweenState } from './useTween.js';

export interface TweenCallbackHandlers {
    readonly onTick: (value: number) => void;
    readonly onComplete: () => void;
    readonly onCancel: () => void;
}

export function useTweenCallback(
    durationMs: number,
    easingFn: EasingFn,
    callbacks: TweenCallbackHandlers,
): Pick<TweenState, 'start' | 'stop' | 'isRunning'> {
    const invalidate = useThree((state) => state.invalidate);
    const [, forceLifecycleRender] = useReducer((version: number) => version + 1, 0);
    const elapsedMsRef = useRef(0);
    const durationMsRef = useRef(durationMs);
    const easingFnRef = useRef(easingFn);
    const callbacksRef = useRef(callbacks);
    const invalidateRef = useRef(invalidate);
    const isRunningRef = useRef(false);

    durationMsRef.current = durationMs;
    easingFnRef.current = easingFn;
    callbacksRef.current = callbacks;
    invalidateRef.current = invalidate;

    const complete = useCallback(
        (invalidateFrame: () => void): void => {
            elapsedMsRef.current = normalizeDurationMs(durationMsRef.current);
            isRunningRef.current = false;
            callbacksRef.current.onTick(1);
            callbacksRef.current.onComplete();
            forceLifecycleRender();
            invalidateFrame();
        },
        [forceLifecycleRender],
    );

    const start = useCallback((): void => {
        elapsedMsRef.current = 0;

        if (normalizeDurationMs(durationMsRef.current) === 0) {
            complete(invalidateRef.current);
            return;
        }

        isRunningRef.current = true;
        forceLifecycleRender();
        invalidateRef.current();
    }, [complete, forceLifecycleRender]);

    const stop = useCallback((): void => {
        if (!isRunningRef.current) {
            return;
        }

        elapsedMsRef.current = 0;
        isRunningRef.current = false;
        callbacksRef.current.onCancel();
        forceLifecycleRender();
        invalidateRef.current();
    }, [forceLifecycleRender]);

    useFrame((state, deltaSeconds) => {
        if (!isRunningRef.current) {
            return;
        }

        const activeDurationMs = normalizeDurationMs(durationMsRef.current);
        if (activeDurationMs === 0) {
            complete(state.invalidate);
            return;
        }

        elapsedMsRef.current += deltaSeconds * 1000;
        const progress = clampUnit(elapsedMsRef.current / activeDurationMs);

        if (progress >= 1) {
            complete(state.invalidate);
            return;
        }

        const value = clampUnit(easingFnRef.current(progress));
        callbacksRef.current.onTick(value);
        state.invalidate();
    });

    return useMemo(
        () => ({
            get isRunning(): boolean {
                return isRunningRef.current;
            },
            start,
            stop,
        }),
        [start, stop],
    );
}

function normalizeDurationMs(durationMs: number): number {
    return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
}

function clampUnit(value: number): number {
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
}
