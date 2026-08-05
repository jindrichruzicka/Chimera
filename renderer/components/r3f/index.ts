/**
 * renderer/components/r3f/index.ts
 *
 * Public R3F component barrel (`@chimera-engine/renderer/components/r3f`).
 * The engine `<GameCanvas>` root (declarative camera, §4.22; `role="main" |
 * "overlay"` multi-canvas) plus the Canvas-bound `useModelAnimation` hook —
 * the only renderer R3F surface game apps may import (Invariant #96).
 *
 * GameCanvas is the only canvas root a game mounts. It wires `PerfProbe`
 * (main role only), `FrameRateLimiter`, and the `frameloop` prop itself, so
 * none of those modules is exported: they are engine wiring, not game
 * surface.
 *
 * Keep this barrel curated: internals (PerfProbe, FrameRateLimiter,
 * useEngineFrameloop, mainCanvasRegistry, InteractionBlocker,
 * interactionContext, shell/*) are NOT exported.
 */

export { GameCanvas } from './GameCanvas';
export { useModelAnimation } from './useModelAnimation';
export type {
    CameraMode,
    CameraPreset,
    CameraConfig,
    PerspectiveCameraConfig,
    OrthographicCameraConfig,
    OrthographicFrustum,
    GameCanvasCamera,
    GameCanvasProps,
    Vector3Tuple,
} from './GameCanvas';
