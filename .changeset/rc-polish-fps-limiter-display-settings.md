---
'@chimera-engine/renderer': minor
'@chimera-engine/simulation': minor
---

RC polish across the engine chrome and settings:

- New real frame-rate limiter: `FrameRateLimiter` (exported from the r3f barrel) gates
  `gl.render` at render priority and reads `targetFps` from resolved settings, replacing
  the previously non-functional display cap.
- Removed the dead `display.fullscreen`, `display.vsync`, and `display.uiScale` settings
  engine-wide (they had no runtime effect; fullscreen is forced in production). The
  gameplay settings tab is now language-only.
- Slimmed the default chrome: dropped the lobby role badge and the default HUD's
  `Tick`/undo/redo affordances (`DefaultGameHud`), and removed the duplicated title from
  the blank game template.
