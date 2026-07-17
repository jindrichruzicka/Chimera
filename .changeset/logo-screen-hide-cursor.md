---
'@chimera-engine/renderer': patch
---

The boot logo screen now hides the OS mouse cursor while it plays. `LogoVideoScreen` routes its cursor through a new `--ch-cursor-hidden: none` design token (kept in the `--ch-cursor-*` family so it stays game-overridable); every other screen keeps its system/game cursor unchanged.
