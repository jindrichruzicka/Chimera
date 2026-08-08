---
'create-chimera-game': minor
'@chimera-engine/electron': minor
'@chimera-engine/tactics': patch
---

**A game app's `scene/` is now `components/`, and it holds every reusable piece of the game's UI — not only the parts that render inside the Canvas.**

`scene/` named a technology. The split it produced ran along the wrong seam: a mesh went in `scene/`, but a shared React panel, a hook two screens had to agree on, and an ambience component that only ever plays audio all had nowhere to go and piled up in `screens/` next to the registry entries. `screens/` was reading as "React UI" when what it actually contains is the set of components the `GameScreenRegistry` names.

The new line is about reuse, not about rendering target:

- **`screens/`** — only what the screen registry names: playfield, HUD, in-game menu, post-game summary, result banner.
- **`components/`** — everything those screens are built from. Shared React components, shared hooks and stores, and the `three` / `@react-three/fiber` primitives a screen renders as children of its `<GameCanvas>`.

In `apps/tactics` that moved the whole former `scene/` (ground plane, minimap, unit primitive, selection ring, camera and scene model, the model showcase) plus `TacticsAmbience` and `useCommitmentBuffer` out of `screens/`. The blank template's growth directories are now `ai/`, `data/` and `components/`.

**`components/` is an Invariant #96 renderer surface.** This is the substantive rule change, and it follows from the merge: a shared component that plays a cue needs `@chimera-engine/renderer/audio` exactly as a screen does, so the old "a module in `scene/` may not import from `@chimera-engine/renderer` at all" cannot survive alongside it. `chimera/no-game-renderer-internals` now admits `apps/<name>/components/*.{jsx,tsx}` alongside `screens/` and `shell/`; the extension gate is unchanged, so a plain-`.ts` helper in any of the three is still not a surface, and every non-surface directory in a game app stays blocked whatever the extension. The invariant checker's Checks 6, 17, 23 and 24 widened to the same directory, and `chimera-validate-assets` now walks `apps/<name>/components/` for on-demand asset loads — anchored at the `apps/<name>/<surface>` position rather than added to the bare-segment set, since `components` is a name that recurs at any depth.

One zone deliberately did **not** widen: `chimera/no-hardcoded-design-values` still reaches `screens/` only. `components/` holds the in-Canvas primitives, whose `three` material colours are not CSS values and cannot be expressed as `var(--ch-*)`, so widening the rule as written would red the directory it was widened onto. The consequence — a DOM component in `components/` has its colour and size literals unchecked — is now stated in `docs/core-components/dev-tooling.md` next to the pre-existing `shell/` half of the same gap, and in the scaffold README.
