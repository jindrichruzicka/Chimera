---
'@chimera-engine/renderer': patch
'@chimera-engine/tactics': patch
---

The shared `Modal` overlay now supports a token-driven backdrop blur. A new `--ch-overlay-backdrop-blur` design token feeds `backdrop-filter: blur(...)` on the overlay; it defaults to `0` (no blur, unchanged plain scrim). Tactics overrides it to `8px`, frosting the shell that shows through its semi-transparent modal scrim.
