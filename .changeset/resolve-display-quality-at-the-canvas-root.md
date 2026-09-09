---
'@chimera-engine/renderer': patch
---

Resolve `display.shadowQuality` and `display.renderScale` at the canvas root.

**The precedence is one rule for both knobs: the player's setting chooses, the game's prop caps.** A
game therefore cannot spend a player's GPU budget for them, and a player cannot ask for more than the
scene supports. A game that authors nothing imposes no cap, so the player's setting stands alone.

This changes what `GameCanvasProps.shadows` and `GameCanvasProps.renderScale` mean: each is now a
**ceiling** rather than the value applied. Authoring `shadows="soft"` no longer renders soft shadows
on its own — the player's tier does, up to that ceiling — and at the engine default tier (`off`) a
canvas has shadow mapping disabled whatever the game authored. That is what the canvas rendered
before either setting existed, so nothing visibly changes today; it is F103's casting light that
makes shadows show.

Two vocabularies meet at this seam and they are different quantities, which is the mistake the docs
now exist to prevent. `display.shadowQuality` is a player TIER (`off` | `low` | `medium` | `high`);
`shadows` is a shadow-map NAME (`off` | `basic` | `percentage` | `soft` | `variance`). The tier maps
to a name and the clamp is an index comparison on the ascending cost order.

`display.renderScale` is a FRACTION of what would otherwise be drawn; `renderScale` is r3f's `dpr`
and is ABSOLUTE. A **range** ceiling is not scaled end-for-end, and getting that wrong is a setting
that does nothing: r3f resolves a range by clamping the display's own ratio into it
(`Math.min(Math.max(dpr[0], target), dpr[1])`), so scaling the ends yields `clamp(target, lo·f, hi·f)`
— not `f ×` anything, and on a `devicePixelRatio` of 1 the same ratio for every option. The engine
therefore resolves the range itself and scales the result, handing the canvas a scalar. At the engine
default fraction that scalar equals what r3f's own `calculateDpr` returns for the same ceiling, and
the tests assert it against that formula rather than against a copied number.

The resolved ratio is floored just above zero, so a coarse setting renders coarsely rather than
degenerating to a zero-area drawing buffer.

Both are read by `selectDisplayQuality.ts`, the sibling of `selectTargetFps.ts`, and neither it nor
the resolution is a barrel export — the canvas root is the one place an engine-wide display setting
can apply to whatever a game renders (Invariant #127), and the seam stays engine-internal
(Invariant #96).

Which knobs survive a mid-session change is now stated rather than discovered: shadows, render scale
and the colour trio all apply live, because r3f re-runs `configure()` from a layout effect with no
dependency array and writes `gl.shadowMap` and the `dpr` on every pass. `contextOptions` cannot, and
is refused by name.
