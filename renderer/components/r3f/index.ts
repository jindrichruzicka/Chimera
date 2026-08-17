/**
 * renderer/components/r3f/index.ts
 *
 * Public R3F component barrel (`@chimera-engine/renderer/components/r3f`).
 * The engine `<GameCanvas>` root (declarative camera, §4.22; `role="main" |
 * "overlay"` multi-canvas) plus the Canvas-bound animation, tween, camera and
 * pointer-interaction hooks, and the curve functions those hooks take as
 * arguments — the only renderer R3F surface game apps may import
 * (Invariant #96).
 *
 * **The mesh half.** Two hooks, a raw seam and a bound one, and a model uses ONE
 * of them (Rule ONE-MIXER-PER-ROOT): `useModelAnimation` hands back the
 * `AnimationMixer` and drives it, leaving actions, crossfades and loop modes to
 * the caller; `useClipPlayer` owns its own mixer and plays a declared clip
 * through the `renderer/animation/*` layer, firing the marks the clip sheet
 * authors.
 *
 * **The sprite half**, which is the same shape one level up: `AnimatedSprite` is
 * the element a game mounts — an `AssetRef` to a sheet in, an animated quad out —
 * and `useSpriteClipPlayer` is the seam under it, for a game that owns its own
 * mesh and material. Both play the `SpriteAnimationMetadata` a game authors and
 * `validate-assets` gates, through the same `ClipPlayer` and the same marker
 * scheduler as the mesh half. A sprite's cells and clip sheet are read with
 * `useSpriteAtlas`/`useSpriteAnimationSheet` from the `assets` barrel.
 *
 * `useAnimationTimeScale` is next: the authoritative dilation multiplier as
 * a plain number. Both clip players already follow it, so this is what
 * everything a game animates by hand — a camera tween, a particle rate, a shader
 * uniform, a HUD countdown — opts in with.
 *
 * **Animating by hand** is the rest.
 * `useTween` drives a normalized 0→1 value off `useFrame` and hands it back to
 * read; `useTweenCallback` is the same loop delivering through
 * `onTick`/`onComplete`/`onCancel`. `useCamera` is the controller built on the
 * second one — `setPosition`, `lookAt`, `zoom`, and an `animateTo` that returns
 * a promise rejecting with `CameraAnimationCancelled` when a later call
 * supersedes it or the component unmounts. The five curve functions ship as
 * VALUES, not just the `EasingFn` type, because they are what a caller passes:
 * a barrel exporting the type alone would leave every caller on the `linear`
 * default.
 *
 * **Pointer interaction** (§4.23) is the last: `useGameInteraction` turns an
 * entity id and an action builder into r3f handlers, no-ops the click while
 * blocked, and keeps hover local (Invariant #58). `InteractionBlocker` is the
 * provider it reads. `GameCanvas` already mounts one, so a game calls the hook
 * without mounting anything; the export is for NESTING a second provider to
 * narrow blocking over a subtree. The raw `InteractionContext` is deliberately
 * not exported — the `assets` and `input` barrels publish a provider plus its
 * `useX()` accessor and never the context object, and this one follows them.
 *
 * All of that ships from here because neither `renderer/animation/`,
 * `renderer/hooks/` nor `renderer/utils/` is an importable subpath
 * (Invariant #96) — which is why this barrel re-exports modules from outside
 * its own directory. Invariant #96 sanctions exactly that: its rule is on the
 * import SPECIFIER, never on where a symbol happens to live, so those three
 * directories stay internal while what this barrel names is public — the same
 * shape as `components/ui` re-exporting `EscapeStackProvider` from
 * `renderer/components/shell/`.
 *
 * GameCanvas is the only canvas root a game mounts. It wires `PerfProbe` (main
 * role only), `FrameRateLimiter`, the `frameloop` prop itself, and the
 * `<InteractionBlocker>` that gates pointer input for every canvas
 * child. None of the first three is exported, and the reason is that mounting
 * one a second time is a DEFECT: two probes double-publish, two limiters fight
 * over the same clock, and the `frameloop` prop has one owner. It is not that
 * `GameCanvas` mounts them — `InteractionBlocker` is mounted here and exported
 * anyway, because nesting a second provider is a legitimate way for a game to
 * narrow blocking over a subtree. `renderer/animation/*` likewise stays internal
 * — F82 adds barrel EXPORTS, not barrels — and reaches games through
 * `useClipPlayer`'s own signature types below.
 *
 * Keep this barrel curated: every other module in this directory, and every
 * `shell/*` module it reaches, is an internal. What is exported, and what the
 * export graph is allowed to drag in, is held by
 * `__tests__/r3f-barrel-side-effects.test.ts` rather than by a list here that
 * the next export would falsify.
 */

export { GameCanvas } from './GameCanvas';
export { useAnimationTimeScale } from '../../animation/useAnimationTimeScale';
export { useTween } from '../../hooks/useTween';
export { useTweenCallback } from '../../hooks/useTweenCallback';
export { useCamera, CameraAnimationCancelled } from '../../hooks/useCamera';
export { lerp, linear, easeIn, easeOut, easeInOut } from '../../utils/curves';
export { useGameInteraction } from '../../hooks/useGameInteraction';
export { InteractionBlocker, useInteractionContext } from './InteractionBlocker';
export { useModelAnimation } from './useModelAnimation';
export { useClipPlayer } from './useClipPlayer';
export { useSpriteClipPlayer } from './useSpriteClipPlayer';
export { AnimatedSprite } from './AnimatedSprite';
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
export type { UseSpriteClipPlayerOptions } from './useSpriteClipPlayer';
export type { AnimatedSpriteProps } from './AnimatedSprite';
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
// `Vector3Tuple` is NOT re-exported from `useCamera` as well: both it and
// `GameCanvas` re-export the one declaration in `renderer/types/r3f-types.ts`,
// so a second export statement here is a duplicate identifier, not a widening.
export type { EasingFn } from '../../utils/curves';
export type { TweenState } from '../../hooks/useTween';
export type { TweenCallbackHandlers } from '../../hooks/useTweenCallback';
export type {
    CameraController,
    CameraAnimationTarget,
    CameraAnimationCancelReason,
} from '../../hooks/useCamera';
export type { InteractionHandlers } from '../../hooks/useGameInteraction';
