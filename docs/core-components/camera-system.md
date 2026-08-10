---
title: 'Camera System'
description: 'CameraMode/CameraPreset/CameraFit types, the GameCanvas declarative camera prop (presets, explicit configs, up vector, manual-projection and canvas-fit rules), preset defaults table, CameraController interface, CameraAnimationCancelled error, useCamera() hook, camera state ownership rules, and the render-loop pacing that applies the display.targetFps frame-rate cap.'
tags: [camera, r3f, animation, renderer, three-js]
---

# Camera System

> §4.22 of the Chimera architecture.
> Related: [Curves, Tweening & Interaction](curves-tweening-interaction.md) · [Renderer State Stores](renderer-state-stores.md)

---

## Overview

React Three Fiber provides full camera control via `useThree()`, `three`'s `PerspectiveCamera`/`OrthographicCamera`, and `@react-three/drei`'s `<CameraControls>`. Camera state lives entirely inside the R3F Canvas tree — **never** in the simulation.

`GameCanvas` is exported from the public r3f barrel (`@chimera-engine/renderer/components/r3f`, Invariant #96) and is the **only canvas root a game mounts** (Invariant #127 — the barrel exports no other runtime component, and `chimera/no-raw-r3f-canvas` plus mechanical Check 32 ban the raw r3f `Canvas` binding from game code). It mounts `FrameRateLimiter` inside its `<Canvas>` root — and `PerfProbe` too on the `role="main"` canvas (the default); a `role="overlay"` canvas (minimap, preview) mounts no probe, so the perf HUD keeps measuring the main scene (§4.16). It also owns the `frameloop` **prop** on that root, taking it from `useEngineFrameloop()`.

### The render loop and the frame-rate cap

`display.targetFps` is applied by **pacing the loop**, never by presenting frames. Two halves, both required, both wired by `GameCanvas`:

1. `frameloop={useEngineFrameloop()}` on the `<Canvas>` — `'never'` at any cap, `'always'` when uncapped. It must be the prop: R3F's `CanvasImpl` re-applies `frameloop` from a layout effect with no dependency array, so an internal `setFrameloop` is clobbered on the next render.
2. `<FrameRateLimiter />` inside it — a loop **driver** that owns one `requestAnimationFrame` chain and calls the store-bound `advance()` at the target rate. It registers no `useFrame` and calls no `gl.render`.

**An engine cap must never present a frame.** R3F's `internal.priority` is a _counter_, not a lock: `subscribe` does `internal.priority = internal.priority + (priority > 0 ? 1 : 0)`, and `update()` suppresses only R3F's own automatic render while calling every subscriber unconditionally. Any `useFrame(cb, priority > 0)` subscriber a game mounts — a post-processing composer, a portal/scissor renderer, a hand-rolled render-target pipeline — therefore becomes a co-presenter that nothing can suppress, including a cap implemented the same way. Pacing the loop caps whoever presents, including presenters the engine has never heard of, and writing an engine composer would not help: it would be one more co-presenter.

Both halves are **engine-internal wiring**: `GameCanvas` is the only canvas root a game mounts (Invariant #127), it wires both on every role, and neither half is exported from the r3f barrel. The half-wired states remain physically possible inside the engine, so the limiter keeps its self-check. Wiring one half is a defect in each direction, and only one of them is detectable:

- Driver mounted, prop missing → the canvas keeps R3F's own loop, the cap silently does nothing, and the perf HUD reports the native rate. The limiter detects this and reports a named `FrameloopWiringError` through the renderer logger — logged, not thrown, because the failure degrades to the behaviour that existed before any cap and R3F's error boundary re-throws outward past the `<Canvas>`.
- `frameloop="never"` with no driver → **a permanently black canvas**, and nothing detects it. The limiter cannot: none of it is mounted. A registration check from `useEngineFrameloop` cannot either, because R3F renders canvas children into a separate reconciler root after `configure()` resolves. A frame-counting watchdog cannot tell a missing driver from a backgrounded window, which advances no frames either. This one is documented rather than guessed at — and closing the own-`<Canvas>` hatch is what confines it to engine code.

Demand rendering reaches no engine canvas: `invalidate()` early-returns under `'never'`, and under `'always'` R3F renders every frame regardless of the counter it writes. See `renderer/components/r3f/useEngineFrameloop.ts`.

### Multi-canvas and the `role` prop

A game needing a second view — a minimap, a unit preview — mounts a second `GameCanvas` with `role="overlay"` instead of a raw `<Canvas>` (Invariant #127; the tactics demo board's minimap is the reference adoption):

- `role="main"` (the default) mounts `PerfProbe`, so the perf HUD measures the main scene; an `'overlay'` mounts no probe (§4.16). Two concurrently-mounted mains are reported by name (`DuplicateMainGameCanvasError`) through the renderer logger — logged, not thrown, deferred one frame and cancelled if the pair resolves first, so a same-frame handover never false-fires.
- **Every** role mounts `FrameRateLimiter` and takes `frameloop={useEngineFrameloop()}`: each canvas is paced by the `display.targetFps` cap.
- Placement and size are the game's: the corner anchor and the explicit size live on a game-owned wrapper element, and the curated `className` prop carries canvas chrome (a zero-height wrapper never mounts the scene). What pins the canvas box inside that wrapper is "Canvas-fit rules" below.

### Sizing the wrapper — for every role, not just overlays

The wrapper rule above is not an overlay detail; the **main** canvas needs it too, and gets it wrong more quietly. A screen mounts inside `div.chimera-scene-router`, which carries no styles and therefore has an auto block size, under a host `<section>` whose only sizing is `position: relative` plus a `minHeight` floor. So:

- `block-size: 100%` on the screen resolves against an auto-height parent → auto → the box collapses onto that floor. The scene renders into a short strip at the top of a full-screen window, with no error and no warning. This is the common failure, and it looks like a broken camera rather than a broken layout.
- A wrapper that reaches zero height fails differently and more visibly-in-hindsight: r3f renders canvas children only after measuring a non-zero box, so the scene never mounts and assets never load.

The reliable spelling for a full-window scene is `position: absolute; inset: 0` on the screen's **root** element — it takes the box out of flow, skipping the auto-height div, and resolves against the positioned host section. Any in-flow element between the two re-introduces the auto-height link. `inset: 0` alone is sufficient: adding `inline-size`/`block-size: 100%` is over-constrained (the used size is identical) and turns any later `padding` on the same element into overflow, since this repo sets no `box-sizing` reset.

The host geometry all of this turns on — `position: relative` plus the `minHeight` floor on the screen host `<section>` — is pinned by `renderer/components/shell/GameShell.test.tsx`. This section is the canonical statement, and it has exactly one deliberate full restatement: `tools/create-chimera-game/templates/blank/screens/__GamePascal__Playfield.module.css`, which ships into generated games that have no copy of these docs. Edit the two together.

---

## GameCanvas Camera Prop

`GameCanvas` takes a single declarative `camera` prop: a named preset string, or a fully explicit config object. The game never constructs a three.js camera itself.

```typescript
// renderer/components/r3f/GameCanvas.tsx, plus CameraFit from its sibling
// cameraFit.ts (all types re-exported from the r3f barrel)

export type CameraMode = 'perspective' | 'orthographic';
export type CameraPreset = 'isometric' | 'top-down' | 'side-scrolling' | 'free';

export type Vector3Tuple = readonly [x: number, y: number, z: number];

/**
 * What happens when the canvas aspect diverges from the camera's own aspect
 * (ortho: `(right - left) / (top - bottom)`; perspective: the pinned `aspect`).
 * Only meaningful for a `manual` camera — a responsive perspective camera has
 * no divergence to resolve. See "Canvas-fit rules" below.
 */
export type CameraFit = 'letterbox' | 'expand' | 'stretch';

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
    /** How a diverging canvas aspect is resolved; default `'letterbox'`.
     *  Inert without a pinned `aspect`. */
    fit?: CameraFit;
}>;

export type OrthographicCameraConfig = Readonly<{
    mode: 'orthographic';
    position: Vector3Tuple;
    lookAt: Vector3Tuple;
    up?: Vector3Tuple; // default [0, 1, 0]; applied before lookAt
    frustum: OrthographicFrustum;
    /** How a diverging canvas aspect is resolved; default `'letterbox'`.
     *  Overriding the ortho aspect means writing the frustum ratio you want —
     *  that ratio IS the camera's aspect, so there is no separate field. */
    fit?: CameraFit;
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
     * Forwarded to the r3f wrapper `<div>` for canvas chrome. r3f pins
     * position and size as inline styles on that div, so placement and the
     * explicit size live on a game-owned wrapper element — this class can
     * never re-place or re-size the canvas. Once a `letterbox` fit pins a box,
     * that div IS the fitted box, so chrome (border, radius) follows the
     * visible canvas rather than the bars.
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
```

### Named Preset Defaults

Each preset carries its documented projection mode — `camera="isometric"` always yields an orthographic camera. A game wanting a preset viewpoint in the other mode writes the explicit config instead.

| Preset           | Mode         | Initial position | Look-at     | Frustum / fov                 |
| ---------------- | ------------ | ---------------- | ----------- | ----------------------------- |
| `isometric`      | orthographic | `(10, 10, 10)`   | `(0, 0, 0)` | `±10 × ±6.25` (manual, 16:10) |
| `top-down`       | orthographic | `(0, 20, 0)`     | `(0, 0, 0)` | `±10 × ±6.25` (manual, 16:10) |
| `side-scrolling` | perspective  | `(0, 5, 15)`     | `(0, 5, 0)` | fov 50 (responsive aspect)    |
| `free`           | perspective  | `(0, 5, 10)`     | `(0, 0, 0)` | fov 50 (responsive aspect)    |

Every preset takes the default `fit: 'letterbox'`. The preset frusta are 16:10 because a preset is authored blind to the player's monitor — the ratio picks what is framed, and the fit policy is what keeps it undistorted on a display of another shape.

### Manual-projection rules

`manual` is derived from the config, never passed:

- **Orthographic** (preset or explicit) ⇒ always `manual`. An author frustum is in world units; R3F's resize handler would otherwise replace it with pixel half-extents (1 world unit = 1 pixel), discarding the world framing entirely.
- **Perspective** ⇒ `manual` only when `aspect` is pinned; otherwise R3F keeps the aspect correct on every resize (what you almost always want).

### Canvas-fit rules

`manual` also opts the camera out of R3F's only aspect hook — `updateCamera()` opens with `if (camera.manual) return`. A manual camera therefore projects at an aspect of its own (ortho: `(right - left) / (top - bottom)`; perspective: the pinned `aspect`) which three maps onto the whole GL viewport, one axis independently of the other. `fit` is what resolves the divergence:

| `fit`                | Frustum        | Canvas             | Trade-off                                                      |
| -------------------- | -------------- | ------------------ | -------------------------------------------------------------- |
| `'letterbox'` (dflt) | authored       | fitted rect + bars | exact framing everywhere; bars on a mismatched canvas          |
| `'expand'`           | grown, centred | fills              | no bars; authored bounds become a **minimum**, not the framing |
| `'stretch'`          | authored       | fills              | distorts wherever the aspects diverge                          |

- **`'letterbox'`** renders the authored frustum at its exact aspect, centred, with the remainder painted `--ch-color-scrim`: pillarbox (side bars) on a canvas wider than the camera, letterbox (top/bottom bars) on a taller one. The one policy under which an authored world framing means exactly one thing on every display.
    - Nothing is pinned and nothing is painted when the fit would leave a remainder under half a CSS pixel — a canvas that already has the camera's shape (the tactics minimap is one) keeps sizing itself, exactly as it did before the policy existed.
- **`'expand'`** grows the frustum on its short axis until it matches the canvas, about the frustum's own centre — a wider monitor sees _more_ world. For a perspective camera the vertical `fov` is widened only on a canvas **taller** than the pinned aspect, since the aspect alone already grows the horizontal axis.
- **`'stretch'`** is the named escape hatch for the behaviour that predates the policy. Nothing is reconciled.

A responsive perspective camera (no pinned `aspect`) has no divergence to resolve: `fit` is inert on it, and it stays non-`manual`.

**The letterbox is a DOM box, not a GL viewport.** `GameCanvas` renders an engine-owned frame that declares no layout mode of its own and, when there is a remainder, pins the r3f `<Canvas>` inside it at the fitted size — out of flow (`position: absolute; inset: 0`), centred by auto margins. In r3f 9.6.1, `state.size` is measured on a 100%/100% inner div inside that wrapper and the canvas element is sized from it, so both are exactly the box the engine pinned. This is load-bearing: r3f derives pointer NDC from `state.size` — a `gl.setViewport()`/`setScissor()` letterbox would leave `state.size` describing the full canvas while rendering covered only the inner rect, so every raycast and click would land on the wrong world point, and `useThree().viewport`, DPR maths and r3f's own `gl.setSize()` on resize would all disagree with what is on screen. The DOM route keeps `size`, `viewport`, picking and DPR coherent for free.

Two details of that pinning are load-bearing:

- **Out of flow.** The engine frame declares no layout mode of its own, and the pinned canvas leaves flow entirely, so nothing the frame does can re-size it. `perf-hud.spec.ts` pins the tactics minimap canvas's aspect in a real browser, which is the only place layout is computed.
- **The pinned size is the content box.** A `className` that adds a border grows the wrapper's border box outward and leaves the content box — the one r3f measures `state.size` on — at the fitted size. ("Sizing the wrapper" above says why a border grows outward here.)

Consequences worth knowing:

- An overlay a game lays over its own full-bleed wrapper **sits over the bars**, not beside them — but only if it is **positioned and rendered after** the `<GameCanvas>`, because the frame the scrim sits on is itself a positioned element with `z-index: auto`. The tactics board's reveal readout and BOTH of the model showcase's status elements satisfy both halves, pinned by `TacticsDemoBoard.test.tsx` and `TacticsModelShowcaseScreen.test.tsx`.
- The frame is inert to the pointer, so a click on a bar is not absorbed by the engine box — it reaches whatever the game has behind it.
- r3f 9.6.1 connects its pointer listeners to its own wrapper, which under a fit is the fitted box, so a bar click reaches nothing r3f is listening on: `onPointerMissed` fires over the canvas only.
- Every role letterboxes, `'overlay'` included: an overlay canvas whose wrapper aspect diverges from its camera's gets bars and a scrim exactly as a main one does.
- Where there are bars the scrim also sits **behind** the canvas, which r3f leaves transparent: a letterboxed scene's backdrop is the scrim rather than whatever showed through before. A game wanting another backdrop sets a scene background.
- The "Sizing the wrapper" rules above are unchanged: the game still owns the outer box; the engine frame lives inside it.

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

// Same framing as a guaranteed MINIMUM instead: no bars, and a wider window
// shows more of the world around it.
const OPEN_WORLD_CAMERA = { ...BOARD_CAMERA, fit: 'expand' } as const satisfies OrthographicCameraConfig;
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
