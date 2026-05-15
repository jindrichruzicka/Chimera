'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useMemo, useReducer, useRef } from 'react';
import { linear, type EasingFn } from '../utils/curves.js';

export { useTweenCallback, type TweenCallbackHandlers } from './useTweenCallback.js';

export interface TweenState {
    readonly value: number;
    readonly isRunning: boolean;
    start(): void;
    stop(): void;
}

export function useTween(durationMs: number, easingFn: EasingFn = linear): TweenState {
    return useTweenController(durationMs, easingFn);
}

function useTweenController(durationMs: number, easingFn: EasingFn): TweenState {
    const invalidate = useThree((state) => state.invalidate);
    const [, forceLifecycleRender] = useReducer((version: number) => version + 1, 0);
    const elapsedMsRef = useRef(0);
    const durationMsRef = useRef(durationMs);
    const easingFnRef = useRef(easingFn);
    const invalidateRef = useRef(invalidate);
    const tweenRef = useRef<Pick<TweenState, 'value' | 'isRunning'>>({
        isRunning: false,
        value: 0,
    });

    durationMsRef.current = durationMs;
    easingFnRef.current = easingFn;
    invalidateRef.current = invalidate;

    const publishTween = useCallback((value: number, isRunning: boolean): void => {
        tweenRef.current = { isRunning, value };
    }, []);

    const start = useCallback((): void => {
        elapsedMsRef.current = 0;

        if (normalizeDurationMs(durationMsRef.current) === 0) {
            completeTween(publishTween, invalidateRef.current);
            forceLifecycleRender();
            return;
        }

        publishTween(0, true);
        forceLifecycleRender();
        invalidateRef.current();
    }, [publishTween]);

    const stop = useCallback((): void => {
        if (!tweenRef.current.isRunning) {
            return;
        }
        elapsedMsRef.current = 0;
        publishTween(0, false);
        forceLifecycleRender();
        invalidateRef.current();
    }, [publishTween]);

    useFrame((state, deltaSeconds) => {
        if (!tweenRef.current.isRunning) {
            return;
        }

        const activeDurationMs = normalizeDurationMs(durationMsRef.current);
        if (activeDurationMs === 0) {
            elapsedMsRef.current = 0;
            completeTween(publishTween, state.invalidate);
            forceLifecycleRender();
            return;
        }

        elapsedMsRef.current += deltaSeconds * 1000;
        const progress = clampUnit(elapsedMsRef.current / activeDurationMs);

        if (progress >= 1) {
            elapsedMsRef.current = activeDurationMs;
            completeTween(publishTween, state.invalidate);
            forceLifecycleRender();
            return;
        }

        const value = clampUnit(easingFnRef.current(progress));
        publishTween(value, true);
        state.invalidate();
    });

    return useMemo(
        () => ({
            get isRunning(): boolean {
                return tweenRef.current.isRunning;
            },
            start,
            stop,
            get value(): number {
                return tweenRef.current.value;
            },
        }),
        [start, stop],
    );
}

function completeTween(
    publishTween: (value: number, isRunning: boolean) => void,
    invalidate: () => void,
): void {
    publishTween(1, false);
    invalidate();
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
