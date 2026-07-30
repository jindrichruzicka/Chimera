---
title: 'Camera System'
description: 'CameraMode/CameraPreset types, the GameCanvas declarative camera prop (presets, explicit configs, up vector, manual-projection rules), preset defaults table, CameraController interface, CameraAnimationCancelled error, useCamera() hook, and camera state ownership rules.'
tags: [camera, r3f, animation, renderer, three-js]
---

# Camera System

> §4.22 of the Chimera architecture.
> Related: [Curves, Tweening & Interaction](curves-tweening-interaction.md) · [Renderer State Stores](renderer-state-stores.md)

---

## Overview

React Three Fiber provides full camera control via `useThree()`, `three`'s `PerspectiveCamera`/`OrthographicCamera`, and `@react-three/drei`'s `<CameraControls>`. Camera state lives entirely inside the R3F Canvas tree — **never** in the simulation.

`GameCanvas` is exported from the public r3f barrel (`@chimera-engine/renderer/components/r3f`, Invariant #96) and mounts `PerfProbe` and `FrameRateLimiter` inside its `<Canvas>` root — a game using it must not mount either again.

---

## GameCanvas Camera Prop

`GameCanvas` takes a single declarative `camera` prop: a named preset string, or a fully explicit config object. The game never constructs a three.js camera itself.

```typescript
// renderer/components/r3f/GameCanvas.tsx (all types re-exported from the r3f barrel)

export type CameraMode = 'perspective' | 'orthographic';
export type CameraPreset = 'isometric' | 'top-down' | 'side-scrolling' | 'free';

export type Vector3Tuple = readonly [x: number, y: number, z: number];

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
    /** Pins the aspect ratio and marks the camera `manual`; omit to let R3F
     *  maintain the aspect on resize (the default and usual choice). */
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
    children: React.ReactNode;
}>;
```

### Named Preset Defaults

Each preset carries its documented projection mode — `camera="isometric"` always yields an orthographic camera. A game wanting a preset viewpoint in the other mode writes the explicit config instead.

| Preset           | Mode         | Initial position | Look-at     | Frustum / fov              |
| ---------------- | ------------ | ---------------- | ----------- | -------------------------- |
| `isometric`      | orthographic | `(10, 10, 10)`   | `(0, 0, 0)` | `±10 × ±10` (manual)       |
| `top-down`       | orthographic | `(0, 20, 0)`     | `(0, 0, 0)` | `±10 × ±10` (manual)       |
| `side-scrolling` | perspective  | `(0, 5, 15)`     | `(0, 5, 0)` | fov 50 (responsive aspect) |
| `free`           | perspective  | `(0, 5, 10)`     | `(0, 0, 0)` | fov 50 (responsive aspect) |

### Manual-projection rules

`manual` is derived from the config, never passed:

- **Orthographic** (preset or explicit) ⇒ always `manual`. An author frustum is in world units; R3F's resize handler would otherwise replace it with pixel half-extents. Trade-off: a manual frustum is not aspect-corrected — content stretches if the canvas aspect diverges from the frustum aspect, so pick a frustum matching the intended canvas shape.
- **Perspective** ⇒ `manual` only when `aspect` is pinned; otherwise R3F keeps the aspect correct on every resize (what you almost always want).

### Preset example

```typescript
<GameCanvas camera="isometric">…</GameCanvas>
```

### Explicit config examples

```typescript
// Wider view frustum + deeper far plane for a space game
const SPACE_CAMERA = {
    mode: 'perspective',
    position: [0, 5, 10],
    lookAt: [0, 0, 0],
    fov: 75,
    far: 5000,
} as const satisfies PerspectiveCameraConfig;

<GameCanvas camera={SPACE_CAMERA}>…</GameCanvas>

// Fixed-frustum top-down board camera: exact world-unit ortho bounds, Z-up
// plane (up is applied before lookAt, so a straight-down view is well-defined).
const BOARD_CAMERA = {
    mode: 'orthographic',
    position: [1, 12, 0],
    lookAt: [1, 0, 0],
    up: [0, 0, 1],
    frustum: { left: -3.75, right: 3.75, top: 2.5, bottom: -2.5, near: 0.1, far: 100 },
} as const satisfies OrthographicCameraConfig;

<GameCanvas camera={BOARD_CAMERA}>…</GameCanvas>
```

> **Stability note:** if the `camera` config object is constructed inline (`camera={{ mode: … }}`), a new three.js camera is recreated on every render because the internal `useMemo` compares by reference. Hoist the config to a module-level constant (as above) or `useMemo` it in the parent component.

---

## CameraController Interface

```typescript
// renderer/hooks/useCamera.ts

export type Vector3Tuple = readonly [x: number, y: number, z: number];

export type EasingFn = (progress: number) => number;

export type CameraAnimationTarget = Readonly<{
    position: Vector3Tuple;
    lookAt?: Vector3Tuple;
}>;

export interface CameraController {
    setPosition(x: number, y: number, z: number): void;
    lookAt(x: number, y: number, z: number): void;
    zoom(factor: number): void;

    /**
     * Smooth animated move to a new position/look-at.
     * Frame-driven via `useTweenCallback` (§4.21).
     *
     * Resolution contract:
     *   • Resolves on animation complete.
     *   • Rejects with CameraAnimationCancelled when manually cancelled,
     *     superseded, or component unmounts.
     *   • Consumers that await must catch CameraAnimationCancelled.
     */
    animateTo(target: CameraAnimationTarget, durationMs: number, easing?: EasingFn): Promise<void>;

    /**
     * Cancels the currently active camera animation, if any.
     * Returns true when an animation was cancelled.
     */
    cancelAnimation(): boolean;
}

export class CameraAnimationCancelled extends Error {
    constructor(public readonly reason: 'unmount' | 'superseded' | 'manual') {
        super(`Camera animation cancelled: ${reason}`);
        this.name = 'CameraAnimationCancelled';
        Object.setPrototypeOf(this, CameraAnimationCancelled.prototype);
    }
}

export function useCamera(): CameraController;
```

---

## Usage Example

```typescript
// In a game's PlayfieldScreen.tsx:
const camera = useCamera();

function onUnitSelected(unit: Entity) {
    camera
        .animateTo({ position: [unit.x, 8, unit.z + 6], lookAt: [unit.x, 0, unit.z] }, 400, easeOut)
        .catch((err) => {
            if (!(err instanceof CameraAnimationCancelled)) throw err;
            // Animation was superseded by another selection — safe to ignore
        });
}
```

---

## Camera State Ownership

Camera state (position, look-at, zoom) is **renderer-only**. It lives in R3F's internal Three.js scene graph. If game screens need to observe or persist camera state across remounts, a lightweight `cameraStore.ts` Zustand store scoped to the renderer may be used.

Camera state is **never** part of `GameSnapshot`, never sent over the network, and not included in saves.

---

## Invariant

**#57** — Camera state is renderer-only. `GameSnapshot` must never contain camera position, look-at, zoom, or any other camera parameter. Camera configuration is driven by game playfield components in response to snapshot data — it is never driven by authoritative simulation actions.

---

## Cross-References

- [Curves, Tweening & Interaction](curves-tweening-interaction.md) — `animateTo()` is driven by `useTweenCallback` (§4.21)
- [Scene Transitions & Fade](scene-transitions-fade.md) — camera may animate during scene transition
