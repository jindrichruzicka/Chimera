---
'@chimera-engine/renderer': minor
---

Frame-rate cap as loop pacing, not frame presentation.

`display.targetFps` no longer works by taking over frame presentation. `FrameRateLimiter`
is now a loop **driver**: it registers no `useFrame`, never calls `gl.render`, and owns a
single `requestAnimationFrame` chain that calls the store-bound `advance()` at the target
rate. The `<Canvas>` runs with `frameloop="never"` while a cap is active.

This matters because R3F's `internal.priority` is a counter rather than a lock — a
presenting cap was one co-presenter among however many the game mounted, since ANY
`useFrame(cb, priority > 0)` subscriber becomes one (a post-processing composer, a
portal/scissor renderer, a hand-rolled render-target pipeline), and none of them could
suppress the others. Pacing the loop caps whoever presents, including presenters the
engine has never heard of.

- `GameCanvas` wires both halves of the cap itself — the `frameloop` prop and the
  `<FrameRateLimiter />` driver mounted inside the canvas. A canvas wired with only the
  driver is an uncapped loop and is reported as a named `FrameloopWiringError`; only the
  prop is a black canvas and cannot be detected.
- The perf HUD's `fps` now reports the **presented** rate. It previously counted native
  frames, so a 30 fps cap on a 120 Hz display read as ~120. A healthy `frameMsAvg` at a
  30 fps cap is ~33 ms, not the panel's ~8 ms — the baseline moves with the cap by design.
- No behaviour change at `targetFps: 0`: the uncapped path stays R3F's default.
