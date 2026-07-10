---
'@chimera-engine/renderer': minor
---

Add the `--ch-cursor-*` token family and route every engine cursor style through it (F69). `--ch-cursor-default: auto` and `--ch-cursor-pointer: pointer` join the existing `--ch-cursor-disabled` in `styles/tokens.css`; `styles/globals.css` applies the default token at the document root (cursor inherits, so shell chrome and the R3F canvas share one cursor set), and engine UI modules plus the default theme reference `var(--ch-cursor-pointer, pointer)` instead of hardcoding `cursor: pointer`. Behaviour-neutral with no overrides — computed cursors are identical to before; games may now legally override the cursor tokens (Invariant #85), which the hardware-cursor registry plumbing will use to inject `url(chimera://…)` values.
