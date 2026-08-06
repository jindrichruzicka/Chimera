'use client';

import { Canvas } from '@react-three/fiber';
import type { Camera } from '@react-three/fiber';
import React from 'react';
import type { ReactNode } from 'react';
import { PerfProbe } from '../shell/perf/PerfProbe';
import { FrameRateLimiter } from './FrameRateLimiter';
import { registerMainCanvas } from './mainCanvasRegistry';
import { useEngineFrameloop } from './useEngineFrameloop';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import type { Vector3Tuple } from '../../types/r3f-types.js';

export type CameraMode = 'perspective' | 'orthographic';
export type CameraPreset = 'isometric' | 'top-down' | 'side-scrolling' | 'free';
export type { Vector3Tuple } from '../../types/r3f-types.js';

/**
 * World-unit orthographic view volume. An explicit frustum always marks the
 * camera `manual`: without it, R3F rewrites ortho frusta to pixel half-extents
 * on every canvas resize, silently discarding the author's world framing.
 */
export type OrthographicFrustum = Readonly<{
    left: number;
    right: number;
    top: number;
    bottom: number;
    near?: number; // default 0.1
    far?: number; // default 1000
}>;

export type PerspectiveCameraConfig = Readonly<{
    mode: 'perspective';
    position: Vector3Tuple;
    lookAt: Vector3Tuple;
    up?: Vector3Tuple; // default [0, 1, 0]; applied before lookAt
    fov?: number; // default 50
    near?: number; // default 0.1
    far?: number; // default 1000
    /**
     * Pins the aspect ratio and marks the camera `manual`; omit to let R3F
     * maintain the aspect on resize (the default and usual choice).
     */
    aspect?: number;
}>;

export type OrthographicCameraConfig = Readonly<{
    mode: 'orthographic';
    position: Vector3Tuple;
    lookAt: Vector3Tuple;
    up?: Vector3Tuple; // default [0, 1, 0]; applied before lookAt
    frustum: OrthographicFrustum;
}>;

export type CameraConfig = PerspectiveCameraConfig | OrthographicCameraConfig;

/** Named preset (documented mode + defaults) or a fully explicit config. */
export type GameCanvasCamera = CameraPreset | CameraConfig;

export type GameCanvasProps = Readonly<{
    camera: GameCanvasCamera;
    children: ReactNode;
    /**
     * Which canvas this is. The `'main'` canvas (the default) publishes perf
     * metrics; an `'overlay'` (minimap, preview) mounts no `PerfProbe`, so the
     * HUD keeps measuring the main scene. Both roles are paced by the
     * `display.targetFps` cap. Mounting two concurrent mains is reported by
     * name through the renderer logger — logged, not thrown.
     */
    role?: 'main' | 'overlay';
    /**
     * Forwarded to the r3f wrapper `<div>` for canvas chrome. r3f pins
     * position and size as inline styles on that div, so placement and the
     * explicit size live on a game-owned wrapper element — this class can
     * never re-place or re-size the canvas.
     *
     * For a full-window scene that wrapper is the screen's ROOT element and
     * wants `position: absolute; inset: 0`. Sizing it any other way fails
     * quietly in one of two ways — camera-system.md §4.22 "Sizing the wrapper"
     * is where both are written out, and `GameShell.test.tsx` pins the host
     * geometry they turn on.
     */
    className?: string;
    /** Forwarded to the r3f `<Canvas>` `onPointerMissed` (deselect-on-empty-click). */
    onPointerMissed?: (event: MouseEvent) => void;
}>;

// Each preset carries its documented projection mode (camera-system.md preset
// table); a game wanting a preset viewpoint in the other mode writes the
// explicit config instead.
const cameraPresetConfigs = {
    isometric: {
        mode: 'orthographic',
        position: [10, 10, 10],
        lookAt: [0, 0, 0],
        frustum: { left: -10, right: 10, top: 10, bottom: -10 },
    },
    'top-down': {
        mode: 'orthographic',
        position: [0, 20, 0],
        lookAt: [0, 0, 0],
        frustum: { left: -10, right: 10, top: 10, bottom: -10 },
    },
    'side-scrolling': { mode: 'perspective', position: [0, 5, 15], lookAt: [0, 5, 0] },
    free: { mode: 'perspective', position: [0, 5, 10], lookAt: [0, 0, 0] },
} satisfies Record<CameraPreset, CameraConfig>;

const DEFAULT_UP: Vector3Tuple = [0, 1, 0];

export function GameCanvas({
    camera,
    children,
    role = 'main',
    className,
    onPointerMissed,
}: GameCanvasProps): React.ReactElement {
    const cameraInstance = React.useMemo(() => createCamera(camera), [camera]);
    // Both halves of the frame-rate cap — the prop below and the
    // <FrameRateLimiter /> driver inside; see selectTargetFps.ts for why they
    // must read one cap.
    const frameloop = useEngineFrameloop();

    React.useEffect(() => {
        if (role !== 'main') {
            return;
        }
        return registerMainCanvas();
    }, [role]);

    return (
        <Canvas
            camera={cameraInstance}
            frameloop={frameloop}
            className={className}
            // r3f types onPointerMissed without `| undefined`, so under
            // exactOptionalPropertyTypes the key must be omitted, not set to
            // undefined.
            {...(onPointerMissed ? { onPointerMissed } : {})}
        >
            {role === 'main' ? <PerfProbe /> : null}
            <FrameRateLimiter />
            {children}
        </Canvas>
    );
}

function resolveCameraConfig(camera: GameCanvasCamera): CameraConfig {
    return typeof camera === 'string' ? cameraPresetConfigs[camera] : camera;
}

function createCamera(camera: GameCanvasCamera): Camera {
    const config = resolveCameraConfig(camera);
    const instance =
        config.mode === 'orthographic'
            ? createOrthographicCamera(config)
            : createPerspectiveCamera(config);

    orientCamera(instance, config);

    return instance;
}

function createOrthographicCamera(config: OrthographicCameraConfig): Camera {
    const { frustum } = config;
    const camera: Camera = new OrthographicCamera(
        frustum.left,
        frustum.right,
        frustum.top,
        frustum.bottom,
        frustum.near ?? 0.1,
        frustum.far ?? 1000,
    );

    // A world-unit frustum must survive canvas resizes: without `manual`,
    // R3F's updateCamera() replaces left/right/top/bottom with pixel
    // half-extents. The trade-off is that a manual frustum is not
    // aspect-corrected — content stretches if the canvas aspect diverges.
    camera.manual = true;

    return camera;
}

function createPerspectiveCamera(config: PerspectiveCameraConfig): Camera {
    const camera: Camera = new PerspectiveCamera(
        config.fov ?? 50,
        config.aspect ?? 1,
        config.near ?? 0.1,
        config.far ?? 1000,
    );

    if (config.aspect !== undefined) {
        camera.manual = true; // pinned aspect: opt out of R3F resize correction
    }

    return camera;
}

function orientCamera(camera: Camera, config: CameraConfig): void {
    camera.up.set(...(config.up ?? DEFAULT_UP)); // before lookAt: lookAt derives roll from up
    camera.position.set(...config.position); // before lookAt: lookAt aims from the position
    camera.lookAt(new Vector3(...config.lookAt));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
}
