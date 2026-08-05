---
title: 'Camera System'
description: 'CameraMode/CameraPreset types, the GameCanvas declarative camera prop (presets, explicit configs, up vector, manual-projection rules), preset defaults table, CameraController interface, CameraAnimationCancelled error, useCamera() hook, camera state ownership rules, and the render-loop pacing that applies the display.targetFps frame-rate cap.'
tags: [camera, r3f, animation, renderer, three-js]
---

# Camera System

> §4.22 of the Chimera architecture.
> Related: [Curves, Tweening & Interaction](curves-tweening-interaction.md) · [Renderer State Stores](renderer-state-stores.md)

---

## Overview

React Three Fiber provides full camera control via `useThree()`, `three`'s `PerspectiveCamera`/`OrthographicCamera`, and `@react-three/drei`'s `<CameraControls>`. Camera state lives entirely inside the R3F Canvas tree — **never** in the simulation.

`GameCanvas` is exported from the public r3f barrel (`@chimera-engine/renderer/components/r3f`, Invariant #96) and mounts `FrameRateLimiter` inside its `<Canvas>` root — and `PerfProbe` too on the `role="main"` canvas (the default); a `role="overlay"` canvas (minimap, preview) mounts no probe, so the perf HUD keeps measuring the main scene (§4.16). A game using it must not mount either component again. It also owns the `frameloop` **prop** on that root, taking it from `useEngineFrameloop()`.

### The render loop and the frame-rate cap

`display.targetFps` is applied by **pacing the loop**, never by presenting frames. Two halves, both required, both wired by `GameCanvas`:

1. `frameloop={useEngineFrameloop()}` on the `<Canvas>` — `'never'` at any cap, `'always'` when uncapped. It must be the prop: R3F's `CanvasImpl` re-applies `frameloop` from a layout effect with no dependency array, so an internal `setFrameloop` is clobbered on the next render.
2. `<FrameRateLimiter />` inside it — a loop **driver** that owns one `requestAnimationFrame` chain and calls the store-bound `advance()` at the target rate. It registers no `useFrame` and calls no `gl.render`.

**An engine cap must never present a frame.** R3F's `internal.priority` is a _counter_, not a lock: `subscribe` does `internal.priority = internal.priority + (priority > 0 ? 1 : 0)`, and `update()` suppresses only R3F's own automatic render while calling every subscriber unconditionally. Any `useFrame(cb, priority > 0)` subscriber a game mounts — a post-processing composer, a portal/scissor renderer, a hand-rolled render-target pipeline — therefore becomes a co-presenter that nothing can suppress, including a cap implemented the same way. Pacing the loop caps whoever presents, including presenters the engine has never heard of, and writing an engine composer would not help: it would be one more co-presenter.

A game that owns its own `<Canvas>` must wire **both** halves. Wiring one is a defect in each direction, and only one of them is detectable:

- Driver mounted, prop missing → the canvas keeps R3F's own loop, the cap silently does nothing, and the perf HUD reports the native rate. The limiter detects this and reports a named `FrameloopWiringError` through the renderer logger — logged, not thrown, because the failure degrades to the behaviour that existed before any cap and R3F's error boundary re-throws outward past the `<Canvas>`.
- `frameloop="never"` with no driver → **a permanently black canvas**, and nothing detects it. The limiter cannot: none of it is mounted. A registration check from `useEngineFrameloop` cannot either, because R3F renders canvas children into a separate reconciler root after `configure()` resolves. A frame-counting watchdog cannot tell a missing driver from a backgrounded window, which advances no frames either. This one is documented rather than guessed at.

Demand rendering reaches no engine canvas: `invalidate()` early-returns under `'never'`, and under `'always'` R3F renders every frame regardless of the counter it writes. See `renderer/components/r3f/useEngineFrameloop.ts`.

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
    /**
     * Which canvas this is. The `'main'` canvas (the default) publishes perf
     * metrics; an `'overlay'` (minimap, preview) mounts no `PerfProbe`, so the
     * HUD keeps measuring the main scene. Both roles are paced by the
     * `display.targetFps` cap. Mounting two concurrent mains is reported by
     * name through the renderer logger — logged, not thrown.
     */
    role?: 'main' | 'overlay';
    /**
     * Forwarded to the r3f wrapper `<div>` so a game sizes and positions the
     * canvas from its own module CSS (a zero-height wrapper never mounts the
     * scene).
     */
    className?: string;
    /** Forwarded to the r3f `<Canvas>` `onPointerMissed` (deselect-on-empty-click). */
    onPointerMissed?: (event: MouseEvent) => void;
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
