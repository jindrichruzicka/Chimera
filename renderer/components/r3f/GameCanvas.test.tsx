// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { Canvas } from '@react-three/fiber';
import { GameCanvas } from './GameCanvas';
import type {
    CameraMode,
    CameraPreset,
    CameraPresetConfig,
    PerspectiveCameraOptions,
    OrthographicCameraOptions,
} from './GameCanvas';

const perfProbeSpy = vi.hoisted(() => vi.fn());

vi.mock('../shell/perf/PerfProbe', () => ({
    PerfProbe: () => {
        perfProbeSpy();
        return null;
    },
}));

vi.mock('@react-three/fiber', () => ({
    Canvas: vi.fn(({ children }: { readonly children?: ReactNode }) => (
        <div data-testid="r3f-canvas">{children}</div>
    )),
}));

type ExpectedCameraPreset = Readonly<{
    mode: CameraMode;
    position: readonly [number, number, number];
    lookAt: readonly [number, number, number];
}>;

const expectedPresets = {
    isometric: { mode: 'orthographic', position: [10, 10, 10], lookAt: [0, 0, 0] },
    'top-down': { mode: 'orthographic', position: [0, 20, 0], lookAt: [0, 0, 0] },
    'side-scrolling': { mode: 'perspective', position: [0, 5, 15], lookAt: [0, 5, 0] },
    free: { mode: 'perspective', position: [0, 5, 10], lookAt: [0, 0, 0] },
} satisfies Record<CameraPreset, ExpectedCameraPreset>;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('GameCanvas', () => {
    it.each(Object.entries(expectedPresets))(
        'renders %s and initializes the camera preset',
        (cameraPreset, expected) => {
            render(
                <GameCanvas cameraMode={expected.mode} cameraPreset={cameraPreset as CameraPreset}>
                    <mesh />
                </GameCanvas>,
            );

            const camera = latestCanvasCamera();

            expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
            expect(camera.position.toArray()).toEqual(expected.position);
            expectVectorToBeClose(
                cameraDirection(camera),
                expectedDirection(expected.position, expected.lookAt),
            );
        },
    );

    it('passes a PerspectiveCamera when perspective mode is selected', () => {
        render(
            <GameCanvas cameraMode="perspective" cameraPreset="isometric">
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasCamera()).toBeInstanceOf(PerspectiveCamera);
    });

    it('passes an OrthographicCamera when orthographic mode is selected', () => {
        render(
            <GameCanvas cameraMode="orthographic" cameraPreset="free">
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasCamera()).toBeInstanceOf(OrthographicCamera);
    });

    it('mounts one PerfProbe inside the R3F canvas root', () => {
        render(
            <GameCanvas cameraMode="perspective" cameraPreset="free">
                <mesh />
            </GameCanvas>,
        );

        expect(perfProbeSpy).toHaveBeenCalledTimes(1);
    });

    it('uses a custom preset object to set camera position and lookAt', () => {
        const customPreset: CameraPresetConfig = {
            position: [5, 8, 3],
            lookAt: [1, 2, 3],
        };

        render(
            <GameCanvas cameraMode="perspective" cameraPreset={customPreset}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera();

        expect(camera.position.toArray()).toEqual([5, 8, 3]);
        expectVectorToBeClose(cameraDirection(camera), expectedDirection([5, 8, 3], [1, 2, 3]));
    });

    it('applies perspectiveCameraOptions when creating a PerspectiveCamera', () => {
        const options: PerspectiveCameraOptions = { fov: 75, near: 0.5, far: 500 };

        render(
            <GameCanvas
                cameraMode="perspective"
                cameraPreset="free"
                perspectiveCameraOptions={options}
            >
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as PerspectiveCamera;

        expect(camera.fov).toBe(75);
        expect(camera.near).toBe(0.5);
        expect(camera.far).toBe(500);
    });

    it('applies orthographicCameraOptions when creating an OrthographicCamera', () => {
        const options: OrthographicCameraOptions = {
            left: -20,
            right: 20,
            top: 15,
            bottom: -15,
            near: 0.5,
            far: 500,
        };

        render(
            <GameCanvas
                cameraMode="orthographic"
                cameraPreset="top-down"
                orthographicCameraOptions={options}
            >
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera;

        expect(camera.left).toBe(-20);
        expect(camera.right).toBe(20);
        expect(camera.top).toBe(15);
        expect(camera.bottom).toBe(-15);
        expect(camera.near).toBe(0.5);
        expect(camera.far).toBe(500);
    });
});

function latestCanvasCamera(): PerspectiveCamera | OrthographicCamera {
    const lastCall = vi.mocked(Canvas).mock.calls.at(-1);
    if (!lastCall) {
        throw new Error('Expected GameCanvas to render R3F Canvas');
    }

    const props = lastCall[0] as { readonly camera?: PerspectiveCamera | OrthographicCamera };
    if (!props.camera) {
        throw new Error('Expected GameCanvas to pass an initialized camera to Canvas');
    }

    return props.camera;
}

function cameraDirection(camera: PerspectiveCamera | OrthographicCamera): number[] {
    return roundVector(camera.getWorldDirection(new Vector3()).toArray());
}

function expectedDirection(
    position: readonly [number, number, number],
    lookAt: readonly [number, number, number],
): number[] {
    return roundVector(
        new Vector3(...lookAt)
            .sub(new Vector3(...position))
            .normalize()
            .toArray(),
    );
}

function roundVector(vector: readonly number[]): number[] {
    return vector.map((value) => Number(value.toFixed(6)));
}

function expectVectorToBeClose(actual: readonly number[], expected: readonly number[]): void {
    expect(actual).toHaveLength(expected.length);

    actual.forEach((value, index) => {
        expect(value).toBeCloseTo(expected[index] ?? 0, 3);
    });
}
