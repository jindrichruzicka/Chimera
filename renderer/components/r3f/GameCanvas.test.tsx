// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { Canvas } from '@react-three/fiber';
import { GameCanvas } from './GameCanvas';
import type { CameraPreset, OrthographicCameraConfig, PerspectiveCameraConfig } from './GameCanvas';

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
    instance: typeof OrthographicCamera | typeof PerspectiveCamera;
    position: readonly [number, number, number];
    lookAt: readonly [number, number, number];
}>;

// Presets carry their documented projection mode (camera-system.md preset table).
const expectedPresets = {
    isometric: { instance: OrthographicCamera, position: [10, 10, 10], lookAt: [0, 0, 0] },
    'top-down': { instance: OrthographicCamera, position: [0, 20, 0], lookAt: [0, 0, 0] },
    'side-scrolling': { instance: PerspectiveCamera, position: [0, 5, 15], lookAt: [0, 5, 0] },
    free: { instance: PerspectiveCamera, position: [0, 5, 10], lookAt: [0, 0, 0] },
} satisfies Record<CameraPreset, ExpectedCameraPreset>;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('GameCanvas', () => {
    it.each(Object.entries(expectedPresets))(
        'renders %s and initializes the preset camera in its documented mode',
        (cameraPreset, expected) => {
            render(
                <GameCanvas camera={cameraPreset as CameraPreset}>
                    <mesh />
                </GameCanvas>,
            );

            const camera = latestCanvasCamera();

            expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
            expect(camera).toBeInstanceOf(expected.instance);
            expect(camera.position.toArray()).toEqual(expected.position);
            expect(camera.up.toArray()).toEqual([0, 1, 0]);
            expectVectorToBeClose(
                cameraDirection(camera),
                expectedDirection(expected.position, expected.lookAt),
            );
        },
    );

    it.each(['isometric', 'top-down'] as const)(
        'marks the %s preset camera manual with the default world-unit frustum',
        (cameraPreset) => {
            render(
                <GameCanvas camera={cameraPreset}>
                    <mesh />
                </GameCanvas>,
            );

            const camera = latestCanvasCamera() as OrthographicCamera & { manual?: boolean };

            // An author/preset frustum must survive canvas resizes: without
            // `manual`, R3F rewrites ortho frusta to pixel half-extents.
            expect(camera.manual).toBe(true);
            expect(camera.left).toBe(-10);
            expect(camera.right).toBe(10);
            expect(camera.top).toBe(10);
            expect(camera.bottom).toBe(-10);
            expect(camera.near).toBe(0.1);
            expect(camera.far).toBe(1000);
        },
    );

    it.each(['side-scrolling', 'free'] as const)(
        'leaves the %s preset camera non-manual so R3F keeps the aspect responsive',
        (cameraPreset) => {
            render(
                <GameCanvas camera={cameraPreset}>
                    <mesh />
                </GameCanvas>,
            );

            const camera = latestCanvasCamera() as PerspectiveCamera & { manual?: boolean };

            expect(camera.manual).toBeUndefined();
            expect(camera.fov).toBe(50);
            expect(camera.near).toBe(0.1);
            expect(camera.far).toBe(1000);
        },
    );

    it('mounts one PerfProbe inside the R3F canvas root', () => {
        render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        expect(perfProbeSpy).toHaveBeenCalledTimes(1);
    });

    it('builds a perspective camera from an explicit config', () => {
        const config: PerspectiveCameraConfig = {
            mode: 'perspective',
            position: [5, 8, 3],
            lookAt: [1, 2, 3],
            fov: 75,
            near: 0.5,
            far: 500,
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as PerspectiveCamera & { manual?: boolean };

        expect(camera).toBeInstanceOf(PerspectiveCamera);
        expect(camera.fov).toBe(75);
        expect(camera.near).toBe(0.5);
        expect(camera.far).toBe(500);
        expect(camera.manual).toBeUndefined();
        expect(camera.position.toArray()).toEqual([5, 8, 3]);
        expectVectorToBeClose(cameraDirection(camera), expectedDirection([5, 8, 3], [1, 2, 3]));
    });

    it('pins the aspect ratio and marks the camera manual when aspect is set', () => {
        const config: PerspectiveCameraConfig = {
            mode: 'perspective',
            position: [0, 5, 10],
            lookAt: [0, 0, 0],
            aspect: 1.5,
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as PerspectiveCamera & { manual?: boolean };

        expect(camera.aspect).toBe(1.5);
        expect(camera.manual).toBe(true);
    });

    it('builds a manual orthographic camera from an explicit frustum', () => {
        const config: OrthographicCameraConfig = {
            mode: 'orthographic',
            position: [0, 20, 0],
            lookAt: [0, 0, 0],
            frustum: { left: -20, right: 20, top: 15, bottom: -15 },
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera & { manual?: boolean };

        expect(camera).toBeInstanceOf(OrthographicCamera);
        expect(camera.manual).toBe(true);
        expect(camera.left).toBe(-20);
        expect(camera.right).toBe(20);
        expect(camera.top).toBe(15);
        expect(camera.bottom).toBe(-15);
        // near/far fall back to the defaults when the frustum omits them.
        expect(camera.near).toBe(0.1);
        expect(camera.far).toBe(1000);
    });

    it('applies a custom up vector', () => {
        const config: OrthographicCameraConfig = {
            mode: 'orthographic',
            position: [1, 12, 0],
            lookAt: [1, 0, 0],
            up: [0, 0, 1],
            frustum: { left: -3.75, right: 3.75, top: 2.5, bottom: -2.5, near: 0.1, far: 100 },
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasCamera().up.toArray()).toEqual([0, 0, 1]);
    });

    it('reproduces the tactics board camera matrices exactly', () => {
        // The tactics e2e page object mirrors this projection for pixel-space
        // clicks, so the declarative config must yield the same matrices as the
        // imperative sequence the board used to run. `up` before `lookAt` is
        // load-bearing: this view direction (0,-1,0) is degenerate against the
        // default up vector.
        const config: OrthographicCameraConfig = {
            mode: 'orthographic',
            position: [1, 12, 0],
            lookAt: [1, 0, 0],
            up: [0, 0, 1],
            frustum: { left: -3.75, right: 3.75, top: 2.5, bottom: -2.5, near: 0.1, far: 100 },
        };

        const reference = new OrthographicCamera(-3.75, 3.75, 2.5, -2.5, 0.1, 100);
        reference.up.set(0, 0, 1);
        reference.position.set(1, 12, 0);
        reference.lookAt(new Vector3(1, 0, 0));
        reference.updateProjectionMatrix();
        reference.updateMatrixWorld();

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera & { manual?: boolean };

        expect(camera.manual).toBe(true);
        expect(camera.projectionMatrix.toArray()).toEqual(reference.projectionMatrix.toArray());
        expect(camera.matrixWorld.toArray()).toEqual(reference.matrixWorld.toArray());
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
