---
'@chimera-engine/renderer': minor
---

Publish the tween, camera, curve and pointer-interaction surface through
`@chimera-engine/renderer/components/r3f`, and mount `<InteractionBlocker>` inside
`GameCanvas`. Six documented engine APIs shipped in the tarball and could not be imported:
`renderer/tsconfig.build.json` includes the whole package, so `dist/hooks/useCamera.js` and
`dist/utils/curves.js` were always there, but the `exports` map has no `./hooks`, no
`./utils` and no wildcard. `useTween`, `useTweenCallback`, `useCamera`, the curve
primitives, `useGameInteraction` and `InteractionBlocker` were documented as engine API in
§4.21–§4.23 and unreachable from every installed package.

The barrel grows from 6 runtime exports to 18 — adding `useTween`, `useTweenCallback`,
`useCamera`, `CameraAnimationCancelled`, `lerp`, `linear`, `easeIn`, `easeOut`, `easeInOut`,
`useGameInteraction`, `InteractionBlocker` and `useInteractionContext` — plus the
`EasingFn`, `TweenState`, `TweenCallbackHandlers`, `CameraController`,
`CameraAnimationTarget`, `CameraAnimationCancelReason` and `InteractionHandlers` types they
take. The curve functions ship as values and not only as the `EasingFn` type, because they
are what a caller passes: a barrel exporting the type alone leaves every caller on the
`linear` default.

**No ninth barrel and no new `exports` key.** Invariant #96 names `renderer/hooks/` as an
internal and states the escape in the same sentence — whatever a barrel re-exports is legal
through that barrel — so a `./hooks` subpath would contradict a named clause of the
invariant, while re-exporting through `components/r3f` is the mechanism it blesses and the
one that barrel already used for `useAnimationTimeScale`. The barrel set stays at eight,
and `@chimera-engine/renderer/hooks/useCamera.js` remains a violation on the same day
`useCamera` becomes public: the rule is on the specifier, never on where the symbol lives.

`GameCanvas` now wraps its children in `<InteractionBlocker>` on every role, from inside its
`<Canvas>`. Without it `useGameInteraction` threw for every caller — `useInteractionContext`
has a null default and refuses to guess (Invariant #83), and nothing in the engine mounted a
provider — so the hook was unusable rather than merely unreachable. The export remains, for
nesting a second provider to narrow blocking over a subtree; the raw `InteractionContext` is
not exported, matching the `assets` and `input` barrels, which publish a provider plus its
`useX()` accessor and never the context object.

Additive throughout — nothing removed or renamed. The barrel's import graph grows 34 → 43
modules and its store edges three → four, the fourth being `gameStore` by way of the
blocker's `snapshot.sceneTransition` read; `react-dom` becomes a barrel external through
`useCamera`'s `flushSync`, and was already a peer dependency.
