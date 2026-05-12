---
title: 'Camera System'
description: 'CameraMode/CameraPreset types, GameCanvas camera props, preset defaults table, CameraController interface, CameraAnimationCancelled error, useCamera() hook, and camera state ownership rules.'
tags: [camera, r3f, animation, renderer, three-js]
---

# Camera System

> §4.22 of the Chimera architecture.
> Related: [Curves, Tweening & Interaction](curves-tweening-interaction.md) · [Renderer State Stores](renderer-state-stores.md)

---

## Overview

React Three Fiber provides full camera control via `useThree()`, `three`'s `PerspectiveCamera`/`OrthographicCamera`, and `@react-three/drei`'s `<CameraControls>`. Camera state lives entirely inside the R3F Canvas tree — **never** in the simulation.

---

## GameCanvas Camera Props

```typescript
// renderer/components/r3f/GameCanvas.tsx

export type CameraMode = 'perspective' | 'orthographic';
export type CameraPreset = 'isometric' | 'top-down' | 'side-scrolling' | 'free';

export type Vector3Tuple = readonly [x: number, y: number, z: number];

/** Pass a custom position/lookAt object instead of one of the named presets. */
export type CameraPresetConfig = Readonly<{
    position: Vector3Tuple;
    lookAt: Vector3Tuple;
}>;

/** Override any subset of PerspectiveCamera constructor args (defaults below). */
export type PerspectiveCameraOptions = Readonly<{
    fov?: number; // default 50
    aspect?: number; // default 1
    near?: number; // default 0.1
    far?: number; // default 1000
}>;

/** Override any subset of OrthographicCamera constructor args (defaults below). */
export type OrthographicCameraOptions = Readonly<{
    left?: number; // default -10
    right?: number; // default  10
    top?: number; // default  10
    bottom?: number; // default -10
    near?: number; // default 0.1
    far?: number; // default 1000
}>;

interface GameCanvasProps {
    cameraMode: CameraMode;
    /** Named built-in preset OR a custom { position, lookAt } object. */
    cameraPreset: CameraPreset | CameraPresetConfig;
    /** Optional fine-grained PerspectiveCamera constructor overrides. */
    perspectiveCameraOptions?: PerspectiveCameraOptions;
    /** Optional fine-grained OrthographicCamera constructor overrides. */
    orthographicCameraOptions?: OrthographicCameraOptions;
    children: React.ReactNode;
}
```

### Named Preset Defaults

| Preset           | Mode         | Initial position | Look-at     |
| ---------------- | ------------ | ---------------- | ----------- |
| `isometric`      | orthographic | `(10, 10, 10)`   | `(0, 0, 0)` |
| `top-down`       | orthographic | `(0, 20, 0)`     | `(0, 0, 0)` |
| `side-scrolling` | perspective  | `(0, 5, 15)`     | `(0, 5, 0)` |
| `free`           | perspective  | `(0, 5, 10)`     | `(0, 0, 0)` |

### Custom preset example

```typescript
// Pass any position/lookAt without defining a new named preset
<GameCanvas
    cameraMode="perspective"
    cameraPreset={{ position: [5, 8, 3], lookAt: [0, 2, 0] }}
>
    …
</GameCanvas>
```

### Constructor options example

```typescript
// Wider view frustum + deeper far plane for a space game
<GameCanvas
    cameraMode="perspective"
    cameraPreset="free"
    perspectiveCameraOptions={{ fov: 75, far: 5000 }}
>
    …
</GameCanvas>

// Expanded ortho bounds for a zoomed-out tactics map
<GameCanvas
    cameraMode="orthographic"
    cameraPreset="isometric"
    orthographicCameraOptions={{ left: -25, right: 25, top: 20, bottom: -20 }}
>
    …
</GameCanvas>
```

> **Stability note:** if `cameraPreset` or the camera option props are constructed inline (e.g. `{{ position: … }}`), a new camera object is recreated on every render because `useMemo` compares by reference. Hoist them to a module-level constant or `useMemo` in the parent component to avoid unnecessary recreation.

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
     * Frame-driven via `useFrame`; will migrate to `useTween` (§4.21) when F37 lands.
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
// In a tactics game's BoardScreen.tsx:
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

**#57** — Camera state is renderer-only. `GameSnapshot` must never contain camera position, look-at, zoom, or any other camera parameter. Camera configuration is driven by game board components in response to snapshot data — it is never driven by authoritative simulation actions.

---

## Cross-References

- [Curves, Tweening & Interaction](curves-tweening-interaction.md) — `useTween` will be used internally by `animateTo()` when F37 lands
- [Scene Transitions & Fade](scene-transitions-fade.md) — camera may animate during scene transition
