---
'@chimera-engine/renderer': patch
---

`GameCanvas` re-resolves its render scale when the display's device-pixel ratio changes.

A range `renderScale` — r3f's `[1, 2]` default included — is resolved against the display's own
ratio, and the canvas root read that ratio only when it rendered. A ratio change that re-rendered
nothing else left the canvas at the dpr resolved from the old ratio. The canvas root now subscribes
to the ratio through `matchMedia`, so a change reaches the canvas without a remount. Where there is
no `matchMedia` (jsdom), nothing is subscribed.

camera-system.md §4.22 "Precedence" now records that the shadow clamp has no floor, deliberately,
and what a game whose scene needs shadows does instead: it sets its settings default for
`display.shadowQuality`, which the player can still lower.
