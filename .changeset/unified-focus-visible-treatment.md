---
'@chimera-engine/renderer': minor
---

Unify keyboard-focus (`:focus-visible`) styling across the UI kit. All interactive primitives now draw their focus indicator at or inside the border-box — bordered components recolor their border to `--ch-focus-ring-color` (plus a transparent inset outline for forced-colors modes), borderless ones draw a visible inset outline — so scroll containers can never clip the indicator (previously the Tabs tablist clipped the offset halo ring into a stray sliver). `Button` and `Slider` gain focus styles they previously lacked, and all components now share the single `--ch-focus-ring-color` token, which defaults to `--ch-color-text-secondary` (distinct from the accent-hover color that already paints active tab chrome and primary button borders) and is intended to be overridden per game. The now-unused `--ch-focus-ring-offset` token is removed.
