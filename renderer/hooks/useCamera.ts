'use client';

import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { MutableRefObject } from 'react';
import type { Camera } from 'three';
import { Vector3 } from 'three';
import { lerp, linear, type EasingFn } from '../utils/curves.js';
import type { Vector3Tuple } from '../types/r3f-types.js';
import { useTweenCallback } from './useTweenCallback.js';

export type { Vector3Tuple } from '../types/r3f-types.js';

export type CameraAnimationCancelReason = 'unmount' | 'superseded' | 'manual';

export type CameraAnimationTarget = Readonly<{
    position: Vector3Tuple;
    lookAt?: Vector3Tuple;
}>;

export interface CameraController {
    setPosition(x: number, y: number, z: number): void;
    lookAt(x: number, y: number, z: number): void;
    zoom(factor: number): void;
    animateTo(target: CameraAnimationTarget, durationMs: number, easing?: EasingFn): Promise<void>;
    cancelAnimation(): boolean;
}

export class CameraAnimationCancelled extends Error {
    public constructor(public readonly reason: CameraAnimationCancelReason) {
        super(`Camera animation cancelled: ${reason}`);
        this.name = 'CameraAnimationCancelled';
        Object.setPrototypeOf(this, CameraAnimationCancelled.prototype);
    }
}

type ControllableCamera = Camera & {
    zoom: number;
    updateProjectionMatrix(): void;
};

type ActiveAnimation = Readonly<{
    startPosition: Vector3;
    targetPosition: Vector3;
    startLookAt: Vector3 | null;
    targetLookAt: Vector3 | null;
    resolve: () => void;
    reject: (err: CameraAnimationCancelled) => void;
    cancelReason: { value: CameraAnimationCancelReason };
}>;

type TweenConfig = Readonly<{
    durationMs: number;
    easing: EasingFn;
}>;

const DEFAULT_TWEEN_CONFIG: TweenConfig = { durationMs: 1, easing: linear };

export function useCamera(): CameraController {
    const { camera } = useThree();
    const cameraRef = useRef(camera as ControllableCamera);
    const activeAnimationRef = useRef<ActiveAnimation | null>(null);
    const explicitLookAtRef = useRef<Vector3 | null>(null);
    const nextPositionRef = useRef(new Vector3());
    const nextLookAtRef = useRef(new Vector3());

    // Tween config stored in state so useTweenCallback re-renders with the correct duration/easing
    // before start() is called (via flushSync in animateTo).
    const [tweenConfig, setTweenConfig] = useReducer(
        (_prev: TweenConfig, next: TweenConfig) => next,
        DEFAULT_TWEEN_CONFIG,
    );

    cameraRef.current = camera;

    const tween = useTweenCallback(tweenConfig.durationMs, tweenConfig.easing, {
        onTick(value: number): void {
            const animation = activeAnimationRef.current;
            if (animation === null) {
                return;
            }
            applyAnimationProgress(
                cameraRef.current,
                animation,
                value,
                explicitLookAtRef,
                nextPositionRef.current,
                nextLookAtRef.current,
            );
        },
        onComplete(): void {
            const animation = activeAnimationRef.current;
            if (animation === null) {
                return;
            }
            applyAnimationProgress(
                cameraRef.current,
                animation,
                1,
                explicitLookAtRef,
                nextPositionRef.current,
                nextLookAtRef.current,
            );
            activeAnimationRef.current = null;
            animation.resolve();
        },
        onCancel(): void {
            const animation = activeAnimationRef.current;
            if (animation !== null) {
                activeAnimationRef.current = null;
                animation.reject(new CameraAnimationCancelled(animation.cancelReason.value));
            }
        },
    });

    const tweenRef = useRef(tween);
    tweenRef.current = tween;

    useEffect(() => {
        return () => {
            const animation = activeAnimationRef.current;
            if (animation !== null) {
                animation.cancelReason.value = 'unmount';
            }
            tweenRef.current.stop();
        };
    }, []);

    const setPosition = useCallback((x: number, y: number, z: number): void => {
        const activeCamera = cameraRef.current;
        activeCamera.position.set(x, y, z);
        activeCamera.updateMatrixWorld();
        explicitLookAtRef.current = deriveCurrentLookAt(activeCamera);
    }, []);

    const lookAt = useCallback((x: number, y: number, z: number): void => {
        const activeCamera = cameraRef.current;
        const target = new Vector3(x, y, z);
        activeCamera.lookAt(target);
        activeCamera.updateMatrixWorld();
        explicitLookAtRef.current = target;
    }, []);

    const zoom = useCallback((factor: number): void => {
        if (!Number.isFinite(factor) || factor <= 0) {
            return;
        }
        const activeCamera = cameraRef.current;
        activeCamera.zoom = factor;
        activeCamera.updateProjectionMatrix();
        activeCamera.updateMatrixWorld();
    }, []);

    const cancelAnimation = useCallback((): boolean => {
        const animation = activeAnimationRef.current;
        if (animation === null) {
            return false;
        }
        animation.cancelReason.value = 'manual';
        tweenRef.current.stop();
        return true;
    }, []);

    const animateTo = useCallback(
        (
            target: CameraAnimationTarget,
            durationMs: number,
            easing: EasingFn = linear,
        ): Promise<void> => {
            // Supersede any in-flight animation before starting a new one.
            // The cancelReason is set first so that onCancel() fires with the correct reason
            // when stop() is called synchronously.
            const prev = activeAnimationRef.current;
            if (prev !== null) {
                prev.cancelReason.value = 'superseded';
                tweenRef.current.stop();
            }

            const activeCamera = cameraRef.current;
            const targetPosition = vectorFromTuple(target.position);
            const targetLookAt =
                target.lookAt === undefined ? null : vectorFromTuple(target.lookAt);
            const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;

            if (duration === 0) {
                activeCamera.position.copy(targetPosition);
                if (targetLookAt !== null) {
                    activeCamera.lookAt(targetLookAt);
                    explicitLookAtRef.current = targetLookAt;
                } else {
                    explicitLookAtRef.current = deriveCurrentLookAt(activeCamera);
                }
                activeCamera.updateMatrixWorld();
                return Promise.resolve();
            }

            return new Promise<void>((resolve, reject) => {
                const cancelReason: { value: CameraAnimationCancelReason } = {
                    value: 'superseded',
                };
                activeAnimationRef.current = {
                    startPosition: activeCamera.position.clone(),
                    targetPosition,
                    startLookAt:
                        targetLookAt === null
                            ? null
                            : (explicitLookAtRef.current?.clone() ??
                              deriveCurrentLookAt(activeCamera)),
                    targetLookAt,
                    resolve,
                    reject,
                    cancelReason,
                };

                // flushSync forces an immediate re-render so useTweenCallback picks up
                // the correct durationMs and easing before start() is called.
                flushSync(() => setTweenConfig({ durationMs: duration, easing }));
                tweenRef.current.start();
            });
        },
        [],
    );

    return useMemo(
        () => ({ setPosition, lookAt, zoom, animateTo, cancelAnimation }),
        [animateTo, cancelAnimation, lookAt, setPosition, zoom],
    );
}

function vectorFromTuple(tuple: Vector3Tuple): Vector3 {
    return new Vector3(tuple[0], tuple[1], tuple[2]);
}

function deriveCurrentLookAt(camera: ControllableCamera): Vector3 {
    return camera.position.clone().add(camera.getWorldDirection(new Vector3()));
}

function applyAnimationProgress(
    camera: ControllableCamera,
    animation: ActiveAnimation,
    progress: number,
    explicitLookAtRef: MutableRefObject<Vector3 | null>,
    nextPosition: Vector3,
    nextLookAt: Vector3,
): void {
    nextPosition.set(
        lerp(animation.startPosition.x, animation.targetPosition.x, progress),
        lerp(animation.startPosition.y, animation.targetPosition.y, progress),
        lerp(animation.startPosition.z, animation.targetPosition.z, progress),
    );
    camera.position.copy(nextPosition);

    if (animation.startLookAt !== null && animation.targetLookAt !== null) {
        nextLookAt.set(
            lerp(animation.startLookAt.x, animation.targetLookAt.x, progress),
            lerp(animation.startLookAt.y, animation.targetLookAt.y, progress),
            lerp(animation.startLookAt.z, animation.targetLookAt.z, progress),
        );
        camera.lookAt(nextLookAt);
        explicitLookAtRef.current = nextLookAt.clone();
    } else {
        explicitLookAtRef.current = deriveCurrentLookAt(camera);
    }

    camera.updateMatrixWorld();
}
