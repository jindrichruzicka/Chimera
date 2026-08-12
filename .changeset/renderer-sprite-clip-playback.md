---
'@chimera-engine/renderer': minor
---

Ship the sprite half of the animation system, which was authorable and CI-gated but unplayable.

Sprite clip sheets have been declarable since F82 — `SpriteAnimationMetadata` /
`SpriteClipDeclaration` are sim-side authoring types, `spriteAnimationEntry` builds the manifest
entry, and `validate-assets` gates every `'sprite-sheet'` entry's sheet including the mandatory
`frames` run. Nothing in the engine could play one: `useClipPlayer` takes a `ModelInstance`, and
`SpriteClipBackend`, `parseSpriteAtlas` and the sprite sheet reader were all internals with no
binding, component or atlas reader exported. A game could author a sheet CI would check and then
had no way to put it on screen. That gap is closed.

**New on `@chimera-engine/renderer/components/r3f`:**

- `AnimatedSprite` — the whole path as one element: `<AnimatedSprite sheet={ref} clip="run"
loop="loop" />` resolves the ref, measures the atlas, plays the clip and fires its marks. Also
  takes `speed`, `handlers`, `timeScale`, `position`, `rotation`, `scale`, `renderOrder`,
  `visible`, and `children` to replace the default unlit material.
- `useSpriteClipPlayer(atlas, geometry, sheet, options)` — the seam under it, for a game that
  owns its own mesh and material.
- The types `AnimatedSpriteProps` and `UseSpriteClipPlayerOptions`.

**New on `@chimera-engine/renderer/assets`:** `useSpriteAtlas` (loads a sheet and measures its
cells, returning them with the manager-owned texture), `useSpriteAnimationSheet` (the sprite twin
of `useAnimationSheet`), the non-React `parseSpriteAtlas` under the first, and the types
`UseSpriteAtlasState`, `SpriteAtlas`, `SpriteAtlasFrame` and `ParsedSpriteAnimationSheet`. No
`exports` subpath is added; the barrel set is unchanged at eight.

**A sprite is a `Mesh`, never a `THREE.Sprite`.** Measured against three r184: `Sprite` shares ONE
module-level geometry across every instance in the process. Sprite playback animates by writing
that geometry's `uv` attribute, so a single `Sprite` playing a clip would re-cut every other
`Sprite` in the scene. `AnimatedSprite` allocates its own `PlaneGeometry(1, 1)` — whose uv is
already the atlas's own TL/TR/BL/BR order, so cells are written straight through — and disposes it
on unmount. The quad is therefore world-oriented rather than camera-facing; a game that wants
billboarding rotates the mesh. Rule ONE-WRITER-PER-QUAD: two clip players over one geometry would
fight over `uv` every frame, so the hook takes the geometry rather than allocating one and the
element pairs exactly one with each mount.

**The authored unit is `durationSeconds`, not fps.** A game authors a clip's length, because that
is what every mark in the sheet is denominated against; the backend plays cells, so it takes fps.
The new internal `spriteClipSpecs` converts as `fps = frames.length / durationSeconds`, which
keeps the authored length exact and lands every compiled mark on the phase the game wrote. A clip
with no usable `durationSeconds` or no usable frame run is DROPPED with a warning rather than
given an invented frame rate — a wrong length is a silently wrong animation, where a missing clip
is a visible one.

Both bindings share one playback lifecycle: the declarative surface, Rule LAST-WRITER-WINS on the
clip-speed layer, the single DEFAULT-priority frame driver and the imperative
`ClipPlayerHandle` were extracted verbatim out of `useClipPlayer` into an internal
`useClipPlayback`, so the mesh and sprite halves cannot drift into two contracts. `useClipPlayer`'s
behaviour, signature and exports are unchanged. The sprite half reports through the same log
bridge (Invariant #67) under a named `SpriteClipPlaybackError`, follows the authoritative time
dilation by default, and carries no dispatcher on any handler — Invariant #132 holds for it by the
same absent parameters.

`validate-assets` now matches `useSpriteAtlas(...)` in its on-demand ref scan alongside `useAsset`
and `useModelInstance`, so an undeclared sprite ref passed to the HOOK is a CI-blocking error.
A ref that reaches the engine only as the `<AnimatedSprite sheet={ref}>` JSX prop is **not**
scanned — `AnimatedSprite` is the first engine component to take an `AssetRef` as a prop, and the
Invariant #52 scan matches call expressions only. That is a known gap, recorded in the invariant's
own text; a JSX-prop matcher is follow-up work, not something this change delivers.
