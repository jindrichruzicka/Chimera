/**
 * renderer/components/r3f/index.ts
 *
 * Public R3F component barrel (`@chimera-engine/renderer/components/r3f`).
 * The engine `<GameCanvas>` root (declarative camera, §4.22; `role="main" |
 * "overlay"` multi-canvas) plus the two Canvas-bound animation hooks —
 * the only renderer R3F surface game apps may import (Invariant #96).
 *
 * The two hooks are a raw seam and a bound one, and a model uses ONE of them
 * (Rule ONE-MIXER-PER-ROOT): `useModelAnimation` hands back the `AnimationMixer`
 * and drives it, leaving actions, crossfades and loop modes to the caller;
 * `useClipPlayer` owns its own mixer and plays a declared clip through the
 * `renderer/animation/*` layer, firing the marks the clip sheet authors.
 *
 * `useAnimationTimeScale` is the third: the authoritative dilation multiplier as
 * a plain number. `useClipPlayer` already follows it, so this is what everything
 * a game animates by hand — a camera tween, a particle rate, a shader uniform, a
 * HUD countdown — opts in with. It ships from here because `renderer/animation/`
 * is not an importable subpath (Invariant #96), which is also why this barrel
 * re-exports one module from outside its own directory.
 *
 * GameCanvas is the only canvas root a game mounts. It wires `PerfProbe`
 * (main role only), `FrameRateLimiter`, and the `frameloop` prop itself, so
 * none of those modules is exported: they are engine wiring, not game
 * surface. `renderer/animation/*` likewise stays internal — F82 adds barrel
 * EXPORTS, not barrels — and reaches games through `useClipPlayer`'s own
 * signature types below.
 *
 * Keep this barrel curated: every other module in this directory, and every
 * `shell/*` module it reaches, is an internal. What is exported, and what the
 * export graph is allowed to drag in, is held by
 * `__tests__/r3f-barrel-side-effects.test.ts` rather than by a list here that
 * the next export would falsify.
 */

export { GameCanvas } from './GameCanvas';
export { useAnimationTimeScale } from '../../animation/useAnimationTimeScale';
export { useModelAnimation } from './useModelAnimation';
export { useClipPlayer } from './useClipPlayer';
export type {
    ClipEndEvent,
    ClipMarkerHandlers,
    ClipPlayerHandle,
    MarkerEvent,
    NotifyEvent,
    PassageEndEvent,
    PassageEndReason,
    PassageEvent,
    PassageTickEvent,
    UseClipPlayerOptions,
} from './useClipPlayer';
export type {
    CameraMode,
    CameraPreset,
    CameraConfig,
    CameraFit,
    PerspectiveCameraConfig,
    OrthographicCameraConfig,
    OrthographicFrustum,
    GameCanvasCamera,
    GameCanvasProps,
    Vector3Tuple,
} from './GameCanvas';
