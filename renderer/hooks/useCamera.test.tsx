// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { type useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraAnimationCancelled, type CameraController, useCamera } from './useCamera.js';

interface FrameState {
    invalidate(): void;
}

type FrameCallback = (state: FrameState, deltaSeconds: number) => void;

let activeCamera: PerspectiveCamera;
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
        useThree: vi.fn(
            (selector?: (state: FrameState & { camera: PerspectiveCamera }) => unknown) => {
                const state = { camera: activeCamera, invalidate };
                return selector ? selector(state) : state;
            },
        ),
    };
});

beforeEach(() => {
    activeCamera = new PerspectiveCamera();
    activeCamera.position.set(0, 0, 10);
    activeCamera.lookAt(new Vector3(0, 0, 0));
    activeCamera.updateMatrixWorld();
    frameCallbacks = [];
    invalidate = vi.fn();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useCamera', () => {
    it('returns a controller bound to the active R3F camera', () => {
        const controller = renderUseCamera();
        const updateProjectionMatrix = vi.spyOn(activeCamera, 'updateProjectionMatrix');

        controller.setPosition(1, 2, 3);
        controller.lookAt(1, 2, 0);
        controller.zoom(2);

        expect(activeCamera.position.toArray()).toEqual([1, 2, 3]);
        expectVectorToBeClose(cameraDirection(activeCamera), [0, 0, -1]);
        expect(activeCamera.zoom).toBe(2);
        expect(updateProjectionMatrix).toHaveBeenCalledOnce();
    });

    it('resolves animateTo when the frame-driven animation completes', async () => {
        const controller = renderUseCamera();
        const animation = controller.animateTo({ position: [10, 0, 10], lookAt: [10, 0, 0] }, 1000);

        await act(async () => {
            advanceFrames(0.5);
        });

        expectVectorToBeClose(activeCamera.position.toArray(), [5, 0, 10]);
        expectVectorToBeClose(cameraDirection(activeCamera), [0, 0, -1]);

        await act(async () => {
            advanceFrames(0.5);
        });

        await expect(animation).resolves.toBeUndefined();
        expectVectorToBeClose(activeCamera.position.toArray(), [10, 0, 10]);
        expectVectorToBeClose(cameraDirection(activeCamera), [0, 0, -1]);
    });

    it('rejects animateTo with unmount cancellation when the component unmounts', async () => {
        const { controller, unmount } = renderUseCameraWithUnmount();
        const animation = controller.animateTo({ position: [4, 5, 6] }, 1000);
        const rejection = animation.catch((error: unknown) => error);

        unmount();

        const error = await rejection;
        expect(error).toBeInstanceOf(CameraAnimationCancelled);
        expect(error).toMatchObject({ reason: 'unmount', name: 'CameraAnimationCancelled' });
    });

    it('rejects an in-flight animateTo with superseded cancellation', async () => {
        const controller = renderUseCamera();
        const firstAnimation = controller.animateTo({ position: [4, 5, 6] }, 1000);
        const firstRejection = firstAnimation.catch((error: unknown) => error);

        const secondAnimation = controller.animateTo({ position: [7, 8, 9] }, 1000);

        const error = await firstRejection;
        expect(error).toBeInstanceOf(CameraAnimationCancelled);
        expect(error).toMatchObject({ reason: 'superseded', name: 'CameraAnimationCancelled' });

        await act(async () => {
            advanceFrames(1);
        });

        await expect(secondAnimation).resolves.toBeUndefined();
        expectVectorToBeClose(activeCamera.position.toArray(), [7, 8, 9]);
    });

    it('rejects an in-flight animateTo with manual cancellation', async () => {
        const controller = renderUseCamera();
        const animation = controller.animateTo({ position: [10, 0, 10] }, 1000);
        const rejection = animation.catch((error: unknown) => error);

        await act(async () => {
            advanceFrames(0.25);
        });

        const positionAfterCancel = activeCamera.position.toArray();
        const cancelled = controller.cancelAnimation();

        const error = await rejection;
        expect(cancelled).toBe(true);
        expect(error).toBeInstanceOf(CameraAnimationCancelled);
        expect(error).toMatchObject({ reason: 'manual', name: 'CameraAnimationCancelled' });

        await act(async () => {
            advanceFrames(1);
        });

        expectVectorToBeClose(activeCamera.position.toArray(), positionAfterCancel);
    });

    it('returns false when cancelling without an active animation', () => {
        const controller = renderUseCamera();

        expect(controller.cancelAnimation()).toBe(false);
    });

    it('resolves immediately for zero-duration animateTo without advancing frames', async () => {
        const controller = renderUseCamera();

        await expect(
            controller.animateTo({ position: [0, 0, 20], lookAt: [0, 0, 0] }, 0),
        ).resolves.toBeUndefined();

        expectVectorToBeClose(activeCamera.position.toArray(), [0, 0, 20]);
        expectVectorToBeClose(cameraDirection(activeCamera), [0, 0, -1]);
    });

    it('ignores zoom(0) without updating camera zoom', () => {
        const controller = renderUseCamera();
        const initialZoom = activeCamera.zoom;

        controller.zoom(0);

        expect(activeCamera.zoom).toBe(initialZoom);
    });

    it('ignores zoom(NaN) without updating camera zoom', () => {
        const controller = renderUseCamera();
        const initialZoom = activeCamera.zoom;

        controller.zoom(NaN);

        expect(activeCamera.zoom).toBe(initialZoom);
    });

    it('ignores zoom(Infinity) without updating camera zoom', () => {
        const controller = renderUseCamera();
        const initialZoom = activeCamera.zoom;

        controller.zoom(Infinity);

        expect(activeCamera.zoom).toBe(initialZoom);
    });

    it('ignores zoom(-1) without updating camera zoom', () => {
        const controller = renderUseCamera();
        const initialZoom = activeCamera.zoom;

        controller.zoom(-1);

        expect(activeCamera.zoom).toBe(initialZoom);
    });

    it('applies valid positive zoom(2)', () => {
        const controller = renderUseCamera();

        controller.zoom(2);

        expect(activeCamera.zoom).toBe(2);
    });

    it('resolves animateTo driven by useTweenCallback after a single frame advance', async () => {
        const controller = renderUseCamera();

        const animation = controller.animateTo({ position: [10, 0, 10] }, 1000);

        await act(async () => {
            advanceFrames(1);
        });

        await expect(animation).resolves.toBeUndefined();
        expectVectorToBeClose(activeCamera.position.toArray(), [10, 0, 10]);
    });
});

function renderUseCamera(): CameraController {
    return renderUseCameraWithUnmount().controller;
}

function renderUseCameraWithUnmount(): Readonly<{
    controller: CameraController;
    unmount: () => void;
}> {
    let controller: CameraController | null = null;

    function Harness(): React.ReactElement {
        controller = useCamera();
        return <div />;
    }

    const { unmount } = render(<Harness />);

    if (controller === null) {
        throw new Error('Expected useCamera to return a controller');
    }

    return { controller, unmount };
}

function advanceFrames(deltaSeconds: number): void {
    frameCallbacks.forEach((callback) => {
        callback({ invalidate }, deltaSeconds);
    });
}

function cameraDirection(camera: PerspectiveCamera): readonly number[] {
    return roundVector(camera.getWorldDirection(new Vector3()).toArray());
}

function roundVector(vector: readonly number[]): readonly number[] {
    return vector.map((value) => Number(value.toFixed(6)));
}

function expectVectorToBeClose(actual: readonly number[], expected: readonly number[]): void {
    expect(actual).toHaveLength(expected.length);

    actual.forEach((value, index) => {
        expect(value).toBeCloseTo(expected[index] ?? 0, 3);
    });
}
