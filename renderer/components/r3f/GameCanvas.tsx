'use client';

import { Canvas } from '@react-three/fiber';
import React from 'react';
import type { ReactNode } from 'react';
import { PerfProbe } from '../shell/perf/PerfProbe';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import type { Vector3Tuple } from '../../types/r3f-types.js';

export type CameraMode = 'perspective' | 'orthographic';
export type CameraPreset = 'isometric' | 'top-down' | 'side-scrolling' | 'free';
export type { Vector3Tuple } from '../../types/r3f-types.js';

export type CameraPresetConfig = Readonly<{
    position: Vector3Tuple;
    lookAt: Vector3Tuple;
}>;

export type PerspectiveCameraOptions = Readonly<{
    fov?: number;
    aspect?: number;
    near?: number;
    far?: number;
}>;

export type OrthographicCameraOptions = Readonly<{
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
    near?: number;
    far?: number;
}>;

export type GameCanvasProps = Readonly<{
    cameraMode: CameraMode;
    cameraPreset: CameraPreset | CameraPresetConfig;
    perspectiveCameraOptions?: PerspectiveCameraOptions;
    orthographicCameraOptions?: OrthographicCameraOptions;
    children: ReactNode;
}>;

type CameraPresetDefaults = Readonly<{
    position: Vector3Tuple;
    lookAt: Vector3Tuple;
}>;

const cameraPresetDefaults = {
    isometric: { position: [10, 10, 10], lookAt: [0, 0, 0] },
    'top-down': { position: [0, 20, 0], lookAt: [0, 0, 0] },
    'side-scrolling': { position: [0, 5, 15], lookAt: [0, 5, 0] },
    free: { position: [0, 5, 10], lookAt: [0, 0, 0] },
} satisfies Record<CameraPreset, CameraPresetDefaults>;

export function GameCanvas({
    cameraMode,
    cameraPreset,
    perspectiveCameraOptions,
    orthographicCameraOptions,
    children,
}: GameCanvasProps): React.ReactElement {
    const camera = React.useMemo(
        () =>
            createCamera(
                cameraMode,
                cameraPreset,
                perspectiveCameraOptions,
                orthographicCameraOptions,
            ),
        [cameraMode, cameraPreset, perspectiveCameraOptions, orthographicCameraOptions],
    );

    return (
        <Canvas camera={camera}>
            <PerfProbe />
            {children}
        </Canvas>
    );
}

function resolveCameraPreset(
    cameraPreset: CameraPreset | CameraPresetConfig,
): CameraPresetDefaults {
    if (typeof cameraPreset === 'string') {
        return cameraPresetDefaults[cameraPreset];
    }
    return cameraPreset;
}

function createCamera(
    cameraMode: CameraMode,
    cameraPreset: CameraPreset | CameraPresetConfig,
    perspectiveCameraOptions: PerspectiveCameraOptions | undefined,
    orthographicCameraOptions: OrthographicCameraOptions | undefined,
): PerspectiveCamera | OrthographicCamera {
    const camera =
        cameraMode === 'orthographic'
            ? new OrthographicCamera(
                  orthographicCameraOptions?.left ?? -10,
                  orthographicCameraOptions?.right ?? 10,
                  orthographicCameraOptions?.top ?? 10,
                  orthographicCameraOptions?.bottom ?? -10,
                  orthographicCameraOptions?.near ?? 0.1,
                  orthographicCameraOptions?.far ?? 1000,
              )
            : new PerspectiveCamera(
                  perspectiveCameraOptions?.fov ?? 50,
                  perspectiveCameraOptions?.aspect ?? 1,
                  perspectiveCameraOptions?.near ?? 0.1,
                  perspectiveCameraOptions?.far ?? 1000,
              );

    applyCameraPreset(camera, cameraPreset);

    return camera;
}

function applyCameraPreset(
    camera: PerspectiveCamera | OrthographicCamera,
    cameraPreset: CameraPreset | CameraPresetConfig,
): void {
    const { position, lookAt } = resolveCameraPreset(cameraPreset);

    camera.position.set(...position);
    camera.lookAt(new Vector3(...lookAt));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
}
