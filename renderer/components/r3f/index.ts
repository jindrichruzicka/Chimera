/**
 * renderer/components/r3f/index.ts
 *
 * Public R3F component barrel (`@chimera-engine/renderer/components/r3f`).
 * The engine `<GameCanvas>` root (declarative camera, §4.22) plus engine-owned
 * components a game mounts inside its own `<Canvas>` — the only renderer R3F
 * surface game apps may import (Invariant #96).
 *
 * The barrel also carries Canvas-bound hooks (`useModelAnimation`) alongside
 * its components — they call `useFrame`, so they too require a `<Canvas>`.
 *
 * Keep this barrel curated: internals (InteractionBlocker, interactionContext,
 * shell/*) are NOT exported.
 */

export { PerfProbe } from '../shell/perf/PerfProbe';
export { FrameRateLimiter } from './FrameRateLimiter';
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
