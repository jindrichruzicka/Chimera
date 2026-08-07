---
'@chimera-engine/renderer': minor
'@chimera-engine/tactics': patch
'create-chimera-game': patch
---

`GameCanvas` cameras now reconcile their own aspect with the canvas through a `fit` policy (§4.22). A `manual` camera — every orthographic one, and any perspective one with a pinned `aspect` — opts out of R3F's only aspect hook, so its projection was mapped onto the whole GL viewport one axis at a time and stretched wherever the canvas aspect diverged.

- **New `CameraFit` type**, exported from `@chimera-engine/renderer/components/r3f`, accepted as `fit?` on both `OrthographicCameraConfig` and `PerspectiveCameraConfig`:
    - `'letterbox'` (the **new default**) renders the authored frustum at its exact aspect, centred, with the remainder painted `--ch-color-scrim` — pillarbox on a wider canvas, letterbox on a taller one.
    - `'expand'` grows the frustum on its short axis about its own centre until it fills the canvas: no bars, and the authored bounds become a guaranteed minimum rather than the exact framing.
    - `'stretch'` is the previous behaviour, kept as a named escape hatch.
    - `fit` is inert on a perspective camera with no pinned `aspect`: it stays non-`manual` and R3F keeps its aspect correct, exactly as before.

**Behavioural, and opt-out-able only via `fit: 'stretch'`:**

- The `isometric` and `top-down` preset frusta change from `±10 × ±10` (a square, aspect 1.0 — stretched on every display that exists) to `±10 × ±6.25` (20 × 12.5, aspect 1.6). A game relying on the old vertical extent sees a shorter world box.
- Every existing orthographic camera, and every perspective camera with a pinned `aspect`, is now letterboxed rather than stretched. A canvas whose aspect already matches its camera gains no bars and nothing pinned on it — the fit applies only once the remainder reaches half a CSS pixel.
- Where there **are** bars, the engine frame paints `--ch-color-scrim` behind the whole canvas, not only the bars: R3F leaves the canvas transparent, so a letterboxed scene's backdrop becomes the scrim rather than whatever showed through before. A game wanting another backdrop sets a scene background.
- The letterbox is implemented in the DOM — an engine-owned frame that pins the r3f `<Canvas>` at the fitted size, out of flow and centred by auto margins — so with R3F 9.6.1 the canvas **element** is the fitted rect and `state.size`, pointer NDC, `useThree().viewport` and DPR all keep describing that one box. The `className` prop still lands on the r3f wrapper, which is now that fitted box, so canvas chrome follows the visible canvas.
- **An HTML overlay a game lays over its own full-bleed wrapper must be positioned and rendered after the `<GameCanvas>`**, because the frame the opaque scrim sits on is itself a positioned element with `z-index: auto`. The frame is inert to the pointer, so a click on a bar is not absorbed by the engine box and reaches whatever the game has behind it. R3F connects its pointer listeners to its own wrapper, which under a fit is the fitted box, so a bar click reaches nothing R3F is listening on: `onPointerMissed` fires over the canvas only.
- Every role letterboxes, `role="overlay"` included: an overlay canvas whose wrapper aspect diverges from its camera's gets bars and a scrim exactly as a main one does.

The tactics demo board keeps its 3:2 frustum and is now pillarboxed on a 16:9 window instead of rendering 18.5% horizontally stretched. The blank game template's playfield comment carries the overlay rule, since a generated game ships with no copy of the engine docs.
