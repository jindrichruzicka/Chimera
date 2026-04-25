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

interface GameCanvasProps {
    cameraMode: CameraMode;
    cameraPreset: CameraPreset;
    children: React.ReactNode;
}
```

### Preset Defaults

| Preset           | Mode         | Initial position | Look-at     |
| ---------------- | ------------ | ---------------- | ----------- |
| `isometric`      | orthographic | `(10, 10, 10)`   | `(0, 0, 0)` |
| `top-down`       | orthographic | `(0, 20, 0)`     | `(0, 0, 0)` |
| `side-scrolling` | perspective  | `(0, 5, 15)`     | `(0, 5, 0)` |
| `free`           | perspective  | `(0, 5, 10)`     | `(0, 0, 0)` |

---

## CameraController Interface

```typescript
// renderer/hooks/useCamera.ts

export type Vector3Tuple = [x: number, y: number, z: number];

export interface CameraController {
    setPosition(x: number, y: number, z: number): void;
    lookAt(x: number, y: number, z: number): void;
    zoom(factor: number): void;

    /**
     * Smooth animated move to a new position/look-at.
     * Internally uses useTween (§4.21).
     *
     * Resolution contract:
     *   • Resolves on animation complete.
     *   • Rejects with CameraAnimationCancelled when superseded or component unmounts.
     *   • Consumers that await must catch CameraAnimationCancelled.
     */
    animateTo(
        target: { position: Vector3Tuple; lookAt?: Vector3Tuple },
        durationMs: number,
        easing?: EasingFn,
    ): Promise<void>;
}

export class CameraAnimationCancelled extends Error {
    constructor(public readonly reason: 'unmount' | 'superseded') {
        super(`Camera animation cancelled: ${reason}`);
        this.name = 'CameraAnimationCancelled';
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

- [Curves, Tweening & Interaction](curves-tweening-interaction.md) — `useTween` used internally by `animateTo()`
- [Scene Transitions & Fade](scene-transitions-fade.md) — camera may animate during scene transition
