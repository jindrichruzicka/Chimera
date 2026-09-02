---
title: 'Requirements — Materials, Shaders & Sprite Appearance'
description: 'Requirements brief for the next rendering-appearance feature: renderer configuration on GameCanvas, texture color space and sampling at load, sprite tint/opacity/blending/alpha mode, a custom-shader seam, per-instance material overrides, and environment-map assets. Written against HEAD 763cc1ec.'
tags: [requirements, rendering, materials, shaders, sprites, pbr, blending, assets, r3f]
status: proposal
---

# Requirements — Materials, Shaders & Sprite Appearance

> **What this is.** A requirements brief, not a design and not a spec. It states
> what a game must be able to do and why the current surface cannot do it. How
> to build it is the engine's call.
>
> **Provenance.** Every claim below was read out of the tree at `763cc1ec`
> against `three` 0.184, `@react-three/fiber` 9.6.1. File and line references
> are to that commit. Nothing here is inferred from documentation.
>
> **Where this came from.** Writing a docs-site article on PBR and materials
> stalled: the article would have been mostly workarounds for engine gaps, and
> three of those gaps are things the engine should simply do. Documenting them
> would have shipped the workaround as the recommendation.

---

## Summary

A game today can mount meshes and sprites, but it cannot control **how they
look** beyond what a stock material exposes. Five separate seams are missing,
and they compound: `GameCanvas` publishes no renderer configuration,
`AnimatedSprite` publishes no appearance props, the texture loader publishes no
sampling options, `useModelInstance` shares its materials, and there is no
environment-map asset kind. Each is independently small. Together they are the
reason "make this sprite glow" and "tint the selected unit" have no answer.

**One of these is not a gap but a defect**: shadow maps are disabled, so
`castShadow` / `receiveShadow` in the engine's own reference apps render
nothing (§A.1).

---

## Part A — Confirmed gaps

### A.1 — Shadows are off, and two reference apps already ask for them

`GameCanvas` renders `<Canvas>` with `camera`, `frameloop`, `className`,
`style` and `onPointerMissed` — and nothing else
(`renderer/components/r3f/GameCanvas.tsx:206`). No `shadows` prop is passed, so
R3F's default applies: `shadows = false`, therefore
`gl.shadowMap.enabled = false`.

Grep for `shadowMap` across the repo (excluding `node_modules` and `dist`)
returns **zero** hits. Nothing anywhere enables it.

Meanwhile:

| File                                               | Line | Writes          |
| -------------------------------------------------- | ---- | --------------- |
| `apps/tactics/components/TacticsUnitPrimitive.tsx` | 149  | `castShadow`    |
| `apps/tactics/components/TacticsGroundPlane.tsx`   | 51   | `receiveShadow` |
| `apps/action/screens/ActionPlayfield.tsx`          | 154  | `castShadow`    |
| `apps/action/components/ActionPrimitiveMesh.tsx`   | —    | `castShadow`    |
| `apps/action/components/ActionGroundPlane.tsx`     | 30   | `receiveShadow` |
| `apps/action/shell/ActionShellBackground.tsx`      | —    | `castShadow`    |

All six are inert. This is worth treating as a bug fix ahead of the feature
work: it is the cheapest of the gaps and the only one that makes existing code
lie.

### A.2 — `GameCanvas` is the only canvas root, and it exposes no renderer config

`chimera/no-raw-r3f-canvas` (Invariant #127) bans the `Canvas` binding from
`@react-three/fiber` in every game file. The rule's own header states the
principle: _"The canvas root is the seam where engine-wide display settings
apply (the `display.targetFps` cap today)."_

So the ban is correct, and the consequence is that **whatever `GameCanvas` does
not expose, no game can set**. `GameCanvasProps`
(`renderer/components/r3f/GameCanvas.tsx:83`) exposes `camera`, `children`,
`role`, `className`, `onPointerMissed`. Not reachable by any game:

- `shadows` (and shadow-map type)
- `toneMapping`, `toneMappingExposure`
- `outputColorSpace` (R3F's `linear` / `flat` escape hatches)
- `dpr` — a render-scale lever, and the natural companion to the existing fps cap
- `gl` constructor options: `antialias`, `alpha`, `powerPreference`, `stencil`,
  `preserveDrawingBuffer`

The last group matters disproportionately: those are **construction-time**
WebGL context parameters. Unlike the others they cannot be corrected later from
inside the canvas, so no escape hatch exists for them even in principle.

The partial escape hatch that does exist — `useThree(s => s.gl)` from a scene
child, which `no-raw-r3f-canvas` explicitly permits — is not an answer. It runs
a commit after the context is built, it races R3F's own `applyProps`, and it
puts renderer-global state in the hands of an arbitrary child component. It
should not become the documented route.

### A.3 — Loaded textures carry no color space, and cannot be given one

`loadTexture` (`renderer/assets/AssetManager.ts:474`) is a bare `TextureLoader`
with no post-configuration. three's `Texture` constructor defaults
`colorSpace` to `NoColorSpace` (`three/src/textures/Texture.js:48`).

R3F sets `gl.outputColorSpace = SRGBColorSpace` by default. So a color texture
resolved through `useAsset` and assigned to a `map` is sampled as if it were
linear data and renders visibly wrong — washed out, and wrong in a way that
reads as an art bug rather than a code bug.

The same image inside a `.glb` comes out **correct**, because `GLTFLoader` tags
base-color and emissive textures itself. One asset, two deliveries, two
appearances.

And it cannot be fixed downstream. Invariant #21 forbids mutating anything
shared with a cached asset, and the texture is shared by every consumer of the
ref. `AnimatedSprite`'s own header says so, and then names the missing seam:

> _"The texture is never configured here… Filtering and color space belong to
> how the sheet is authored and loaded, not to an element that draws one frame
> of it."_

Correct — and there is currently no way to author them at load. The engine
states the rule and provides no surface that obeys it.

**There is already a slot for this.** `AssetLoadRequest.metadata`
(`renderer/assets/AssetLoaderRegistry.ts:11`) is passed from the manifest entry
to the loader, and `getManifestMetadata` (`AssetManager.ts:266`) reads it back.
The animation system already uses it for clip sheets.

### A.4 — `AnimatedSprite` has no appearance surface

`AnimatedSpriteProps` (`renderer/components/r3f/AnimatedSprite.tsx:63`) carries
`sheet`, `position`, `rotation`, `scale`, `renderOrder`, `visible`, `children`
and the playback options. There is no tint, no opacity, no blending, no alpha
mode.

The default material is hardcoded (`AnimatedSprite.tsx:158`):

```tsx
<meshBasicMaterial map={texture} transparent toneMapped={false} alphaTest={0.01} />
```

Two problems.

**First, `transparent` plus `alphaTest: 0.01` is a hybrid that is right for
neither mode.** A cutout sprite wants `alphaTest` around 0.5 with
`transparent: false`, so it writes depth and sorts by position like solid
geometry. A soft-alpha sprite wants `transparent: true` with no alpha test.
The current combination pays transparent's sorting cost while clipping almost
nothing.

**Second, replacing the material costs more than it should.** Supplying
`children` means the caller owns `map` too — and `AnimatedSprite` never hands
its texture to its children, so the caller must call `useSpriteAtlas(sheet)`
independently in a parent to get a texture the component already holds. Every
game that wants a tinted sprite reimplements the component's own resolution.

Additive, subtractive, multiply and masked sprites — the four modes named in
the request — are all on the far side of that cost today.

### A.5 — Model instances share their materials

`useModelInstance` clones the node tree and skeletons per mount; geometry,
**materials** and textures stay shared with the cached asset, and Invariant #21
forbids mutating them.

So there is no sanctioned way to tint one instance of a model — the single most
common selection/damage/team-color affordance in any game with units on a
board.

No in-repo workaround exists to point at, because nothing in-repo has hit this
yet: `useModelInstance` is called only from the tactics model-showcase screen,
and both reference apps build their units from primitives carrying their own
`meshStandardMaterial`, which they can tint freely. The limitation is real for
any game whose units are loaded models, which is most of them.

This is the mesh-side twin of §A.4 and should be solved with it.

### A.6 — No environment-map asset kind

Registered kinds are `texture`, `audio-clip`, `gltf-model`, `sprite-sheet`,
`particle-config`. There is no equirectangular / HDRI / cube-map kind and no
loader for `.hdr` or `.exr`.

PBR without image-based lighting looks flat, so this is not an optional extra
for a materials feature — it is what makes a metal or glass material read as
metal or glass at all.

The available workaround is drei's `<Environment preset>`, which **fetches an
HDRI from a public CDN at runtime**. `webSecurity: true` is set and no CSP
header blocks it, so it works — and it is still wrong for a packaged offline
game.

### A.7 — Texture format coverage is narrow

The app-protocol MIME table (`electron/main/index.ts:598`) maps `.png`, `.webp`
and `.svg` for images. Everything unmapped falls through to
`application/octet-stream`.

Missing and relevant:

- `.jpg` / `.jpeg` — already a known trap, already documented on the docs site.
- `.ktx2` / `.basis` — GPU-compressed textures. This is what keeps VRAM sane on
  a real 3D scene; a PBR material set is 3–5 textures per material.
- `.hdr` / `.exr` — see §A.6.

`.ktx2` carries a real decision attached: it needs a Basis transcoder (wasm),
which must ship with the app rather than be fetched, and the loader needs the
renderer handle to detect supported formats.

---

## Part B — Requirements

Ordered by dependency, not priority. **R1** and **R3** unblock the rest.

### R1 — Renderer configuration belongs on `GameCanvas`

Because `no-raw-r3f-canvas` makes it the only root, `GameCanvas` must publish
the renderer configuration a game needs. Required coverage:

| Concern            | Must be settable                        | Note                                        |
| ------------------ | --------------------------------------- | ------------------------------------------- |
| Shadows            | on/off + map type                       | Fixes §A.1                                  |
| Tone mapping       | mode + exposure                         |                                             |
| Output color space | sRGB / linear                           |                                             |
| Render scale       | `dpr`, fixed or range                   | Pairs with `display.targetFps`              |
| Context options    | `antialias`, `alpha`, `powerPreference` | **Construction-time — no later fix exists** |

Requirements:

- **R1.1** — Every knob above is reachable from a game without importing
  `Canvas` and without reaching `gl` from a scene child.
- **R1.2** — Defaults reproduce today's rendering exactly, **except** where a
  default is deliberately changed (§R3.4, §R4.2). A game that sets nothing sees
  no unannounced visual change.
- **R1.3** — Construction-time options are distinguished from mutable ones in
  the API's own shape, so a game cannot write a value that silently does
  nothing after first commit.
- **R1.4** — An `overlay`-role canvas gets its own configuration. A minimap must
  be able to run cheaper than the main scene.

**Open decision.** A raw `gl={...}` passthrough is the smallest change, but it
hands games an R3F-shaped surface the engine cannot put a settings seam behind
(§R2), and it re-opens the coupling `no-raw-r3f-canvas` exists to prevent. A
curated engine-owned prop is more work and keeps the seam. **Recommendation:
curated.**

### R2 — Quality knobs are player settings, not just author settings

`display.targetFps` already exists, is stored in `EngineSettings.display`, and
already renders on the shell settings page
(`renderer/app/settings/page.tsx:180`). Shadow quality and render scale are the
same kind of knob and belong in the same namespace, so the settings UI, the
persistence layer and the merge policy all come for free.

- **R2.1** — At least `display.shadowQuality` and `display.renderScale` are
  engine settings, resolved by `GameCanvas` the way `useEngineFrameloop` and
  `FrameRateLimiter` resolve the fps cap today.
- **R2.2** — Precedence between a game's authored value and the player's
  setting is **defined and documented**. Proposal: the game declares a ceiling
  and a default; the player picks at or below the ceiling. A game that needs
  shadows for readability must be able to say so.
- **R2.3** — Changing a setting mid-session must not require a canvas remount
  for the knobs that can avoid it, and must state plainly which ones cannot
  (the `gl` context options of R1.3).

### R3 — Texture sampling is authored at load

- **R3.1** — A manifest entry can declare, per texture and per sprite sheet:
  `colorSpace`, `magFilter` / `minFilter`, `wrapS` / `wrapT`, `flipY`,
  `anisotropy`, `generateMipmaps`.
- **R3.2** — The loader applies them before the texture is published to any
  consumer, so no component ever sees an unconfigured texture and Invariant #21
  is never the thing standing in a game's way.
- **R3.3** — `AssetLoadRequest.metadata` already carries per-entry data to
  loaders and is the obvious home. Use it or replace it deliberately, not by
  accident.
- **R3.4** — **Pick a default color space and state it.** `SRGBColorSpace` for a
  `texture` kind is right far more often than not; `NoColorSpace` is right for
  data maps (roughness, metalness, normal, AO, masks). Whichever way it lands,
  it is a visual change to existing games and needs a changelog note. If data
  maps become common enough to matter, a second kind (or a metadata flag)
  distinguishing color from data textures is worth considering.
- **R3.5** — Filtering matters as much as color space: a pixel-art game needs
  `NearestFilter`, and today cannot have it at any price.

### R4 — Sprites get a first-class appearance surface

`AnimatedSprite` must cover the common cases without the caller replacing the
material:

- **R4.1** — `color` (tint) and `opacity`.
- **R4.2** — `blending`, covering at minimum **normal**, **additive**,
  **subtractive**, **multiply** and **none**. Named modes rather than raw three
  constants, so a game does not import `three` for a prop value.
- **R4.3** — An explicit **alpha mode**: `opaque` / `mask` (with an authorable
  threshold) / `blend`. This replaces the hardcoded `transparent` +
  `alphaTest: 0.01` of §A.4, which is a third thing that is neither. Defaults
  need a deliberate call — matching today's behaviour is defensible, and so is
  fixing it while the engine is pre-release.
- **R4.4** — `depthWrite` and `depthTest`. Additive sprites almost always want
  `depthWrite: false`; without it they occlude each other and the effect
  collapses. A blending mode that cannot be made to look right is not shipped.
- **R4.5** — Everything above composes with the clip player and mutates no
  shared texture. Tinting a sprite must not tint every sprite cut from the same
  sheet — the failure mode Invariant #21 exists to prevent.

### R5 — A supported custom-shader seam

The explicit ask is sprites drawn with custom shaders. Requirements:

- **R5.1** — A game can supply its own material to `AnimatedSprite` **and
  receive the atlas texture**, without re-resolving the sheet in a parent
  (§A.4). A render-prop child or a `material` prop both work; the constraint is
  that the component already holds the texture and should hand it over.
- **R5.2** — The UV contract is **documented as contract**, not left as an
  implementation detail. `SpriteClipBackend` animates by writing the geometry's
  `uv` attribute in `PlaneGeometry` vertex order, so a custom shader that reads
  `uv` animates for free. A shader author cannot discover that by reading the
  props.
- **R5.3** — A supported pattern for a **time uniform** that follows engine
  time: it must respect `useAnimationTimeScale` (already the documented opt-in
  for shader uniforms) and the `display.targetFps` cap. A helper is preferable
  to a documented snippet, because the wrong version of this works until the
  player enables slow motion.
- **R5.4** — **Ownership and disposal are stated.** A game-created
  `ShaderMaterial` is game-owned and must be disposed by its component.
  `AnimatedSprite` already solved exactly this for its geometry — commit-phase
  allocation, never `useMemo`, because StrictMode double-invokes and discards
  one result with no cleanup. The same trap is waiting for every game that
  writes a shader material, and the guidance should ride with the seam.
- **R5.5** — **A shader is renderer-only feedback and gates nothing
  authoritative.** Same discipline as Invariant #132 (animation marks) and #135
  (audio cues): a uniform derived from the frame clock is derived from a clock
  no two machines share (#42/#43). Worth writing as an invariant if a new
  surface can reach a dispatcher — it should not be able to.

### R6 — Per-instance material override for model instances

- **R6.1** — A sanctioned way to give one `useModelInstance` mount its own
  material state — at minimum a tint or an emissive override — without
  violating Invariant #21.
- **R6.2** — Whatever this clones is component-owned and disposed on unmount,
  under the same carve-out #21 already grants the node tree and skeletons.
- **R6.3** — The cost is stated where a game can see it: a cloned material is a
  new draw-call batch and a new shader compile on first use. A game tinting 200
  units needs to know that before it ships, not after.

### R7 — Environment maps as game assets

- **R7.1** — An asset kind for environment / IBL maps, with a loader, so an
  HDRI ships in `assets/` and resolves through the manifest like everything
  else.
- **R7.2** — MIME entries for whatever formats that kind admits (§A.7).
- **R7.3** — `validate:assets` covers the new kind.
- **R7.4** — A packaged game must be able to light a PBR scene **with no
  network access at all**. That is the acceptance test, and it is what makes
  drei's CDN preset unacceptable as the answer.

### R8 — Texture format coverage

- **R8.1** — `.jpg` / `.jpeg` in the MIME table. Small, already a known trap.
- **R8.2** — A decision on `.ktx2` / Basis. If yes: the transcoder ships with
  the app, never fetched, and the loader needs the renderer handle for format
  detection. If no: say so, so games plan for uncompressed VRAM.

---

## Part C — Cross-cutting constraints

These apply to every requirement above.

1. **Invariant #21 is the frame, not an obstacle.** Every gap in Part A exists
   because a game needed to configure something shared. The fix is always to
   move the configuration to where the resource is created, never to loosen the
   sharing rule.

2. **Nothing here may become authoritative.** Materials, shaders and lighting
   are renderer-only. No new surface should be able to reach a dispatcher, a
   `SendAction`, or a tick — the shape is the enforcement, per #132 and #135.

3. **`no-raw-r3f-canvas` must stay honest.** If a game still has to reach for
   raw `Canvas` after this work, R1 is not finished.

4. **Postprocessing interaction must be defined.** A mounted `EffectComposer`
   takes over tone mapping and color output, so an empty composer does not look
   like no composer. Once `GameCanvas` owns tone-mapping props, state who wins.
   The composer almost certainly should — and the engine should not fight it, or
   silently lose to it.

5. **The frame cap already paces the loop**, so anything time-driven added here
   inherits the capped `delta` and must be correct at 30 fps as well as at 144.

6. **The standalone lint preset** must keep working for games outside the
   monorepo — four of its rules need an `apps/<name>/` path segment.

---

## Part D — Suggested slicing

Not prescriptive; the dependencies are.

| Slice | Contents        | Notes                                                                  |
| ----- | --------------- | ---------------------------------------------------------------------- |
| **0** | §A.1 shadow fix | Standalone bug fix. Ship ahead of the rest.                            |
| **1** | R1 + R2         | Renderer config and its settings seam. Unblocks everything visual.     |
| **2** | R3 + R8.1       | Texture authoring at load. Independent of slice 1.                     |
| **3** | R4              | Sprite appearance. Needs R3 for filtering and color space to be right. |
| **4** | R5 + R6         | The shader and per-instance seams. Needs R4's material plumbing.       |
| **5** | R7 + R8.2       | IBL and compressed textures. Largest, most deferrable.                 |

Slices 1 and 2 are independent and can run in parallel.

---

## Part E — What the docs site does after

Tracked separately in ChimeraWeb; listed so the engine work knows what will be
written against it.

- A **Materials, Lighting & Color** article under _3D Scenes_, sibling to _Drei
  & the R3F Ecosystem_ — the seam and the traps, linking out for generic PBR
  theory rather than re-teaching it.
- **2D Features** gains the sprite blending and alpha-mode section (R4).
- **Asset References & Loading** gains the per-entry sampling options (R3).
- The drei article's CDN warning gets a real alternative to point at (R7).
- If §R3.4 changes a default, that is a visual change to existing games and
  wants a changelog note — the docs site itself carries no migration notes, by
  policy.

---

## Open questions for the engine

1. **R1** — curated props or raw `gl` passthrough? (Recommendation: curated.)
2. **R3.4** — what is the default color space for the `texture` kind, and do
   data maps get their own kind or a metadata flag?
3. **R4.3** — does the sprite alpha default stay bug-compatible with today's
   `transparent` + `alphaTest: 0.01`, or get fixed while pre-release allows it?
4. **R6** — is a per-instance material override in scope for this feature, or
   its own?
5. **R8.2** — is KTX2 in or out?
6. Does any of this warrant new invariants, or is it all covered by #21, #127,
   #132 and #135 as they stand?
