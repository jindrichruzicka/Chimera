'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Camera } from 'three';
import { Vector3 } from 'three';
import type { EasingFn } from '../utils/curves.js';
import type { Vector3Tuple } from '../types/r3f-types.js';

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
    durationMs: number;
    easing: EasingFn;
    resolve: () => void;
    reject: (reason: CameraAnimationCancelled) => void;
}> & {
    elapsedMs: number;
};

const linear: EasingFn = (progress) => progress;

export function useCamera(): CameraController {
    const { camera } = useThree();
    const cameraRef = useRef(camera as ControllableCamera);
    const activeAnimationRef = useRef<ActiveAnimation | null>(null);
    const explicitLookAtRef = useRef<Vector3 | null>(null);
    const nextPositionRef = useRef(new Vector3());
    const nextLookAtRef = useRef(new Vector3());

    cameraRef.current = camera;

    const cancelActiveAnimation = useCallback((reason: CameraAnimationCancelReason): boolean => {
        const animation = activeAnimationRef.current;
        if (animation === null) {
            return false;
        }

        activeAnimationRef.current = null;
        animation.reject(new CameraAnimationCancelled(reason));
        return true;
    }, []);

    useEffect(() => {
        return () => {
            cancelActiveAnimation('unmount');
        };
    }, [cancelActiveAnimation]);

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

    const cancelAnimation = useCallback(
        (): boolean => cancelActiveAnimation('manual'),
        [cancelActiveAnimation],
    );

    // TODO(F37): refactor animateTo to use useTween from renderer/hooks/useTween.ts once curves.ts/useTween.ts land.
    const animateTo = useCallback(
        (
            target: CameraAnimationTarget,
            durationMs: number,
            easing: EasingFn = linear,
        ): Promise<void> => {
            cancelActiveAnimation('superseded');

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
                activeAnimationRef.current = {
                    elapsedMs: 0,
                    startPosition: activeCamera.position.clone(),
                    targetPosition,
                    startLookAt:
                        targetLookAt === null
                            ? null
                            : (explicitLookAtRef.current?.clone() ??
                              deriveCurrentLookAt(activeCamera)),
                    targetLookAt,
                    durationMs: duration,
                    easing,
                    resolve,
                    reject,
                };
            });
        },
        [cancelActiveAnimation],
    );

    useFrame((_state, deltaSeconds) => {
        const animation = activeAnimationRef.current;
        if (animation === null) {
            return;
        }

        animation.elapsedMs += deltaSeconds * 1000;
        const progress = Math.min(animation.elapsedMs / animation.durationMs, 1);
        applyAnimationProgress(
            cameraRef.current,
            animation,
            animation.easing(progress),
            explicitLookAtRef,
            nextPositionRef.current,
            nextLookAtRef.current,
        );

        if (progress < 1) {
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
    });

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
    camera.position.copy(
        nextPosition.lerpVectors(animation.startPosition, animation.targetPosition, progress),
    );

    if (animation.startLookAt !== null && animation.targetLookAt !== null) {
        nextLookAt.lerpVectors(animation.startLookAt, animation.targetLookAt, progress);
        camera.lookAt(nextLookAt);
        explicitLookAtRef.current = nextLookAt.clone();
    } else {
        explicitLookAtRef.current = deriveCurrentLookAt(camera);
    }

    camera.updateMatrixWorld();
}
