---
'@chimera-engine/renderer': minor
'@chimera-engine/tactics': patch
---

GameCanvas is now the only canvas root a game mounts (Invariant #127), and gained the curated surface the own-`<Canvas>` hatch existed to provide:

- `className?: string` — forwarded to the r3f wrapper `<div>` for canvas chrome. r3f pins position and size as inline styles on that div, so placement and explicit size live on a game-owned wrapper element.
- `onPointerMissed?: (event: MouseEvent) => void` — forwarded to `<Canvas>` (deselect-on-empty-click).
- `role?: 'main' | 'overlay'` (default `'main'`) — first-class multi-canvas: an overlay (minimap, preview) mounts no `PerfProbe`, so the perf HUD keeps measuring the main scene; every role is paced by the `display.targetFps` cap. Two concurrently-mounted mains are reported by name (`DuplicateMainGameCanvasError`) through the renderer logger — logged, not thrown, deferred one frame and cancelled if the pair resolves first.

`GameCanvasProps` stays curated: no `CanvasProps` rest-spread, and `gl`/`dpr`/`shadows`/`style`/`frameloop`/`camera` pass-through is rejected at the type level. The tactics demo board's corner minimap is the reference overlay adoption.
