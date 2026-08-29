---
'@chimera-engine/renderer': minor
---

Let a game's shell background take pointer input, with pass-through hit-testing instead of a global
flip.

`LoadedRendererGameShell` gains `shellBackgroundInteractive?: boolean`. Absent or `false` is the
inert-decor contract every painted backdrop stays on — `pointer-events: none` and
`aria-hidden="true"` on `ShellBackgroundHost` — and the reference game is the opt-out pin. `true`
flips both together: a region that accepts clicks must not be hidden from assistive tech. It is
answered by the game's own SUBTREE, not by the flag, so an opt-in declared over the engine's plain
coloured plate stays inert.

**The flag alone clears no path to the background, and a page-only construction is not enough.** A
box with `pointer-events: auto` is a hit target over its whole area whether or not it paints
anything, and two boxes sit above the background — the app-level `--ch-z-raised` frame and the
page's own container. Measured in the Electron renderer on `/main-menu`, with the menu alone made
click-through: `document.elementFromPoint` at an empty corner returns the FRAME, not the background.
So three layers stand aside, each for itself:

- `ShellBackgroundHost` — `pointer-events: auto`, `aria-hidden` dropped.
- `ShellContentLayer` (new) — the `--ch-z-raised` frame, extracted from `AppShell`'s bare `<div>`
  so it can go `pointer-events: none`. It restores NOTHING, which makes the rule for everything it
  holds: a surface that must stay usable states its own `pointer-events: auto`, where that surface
  lives. `Modal.overlay`, `Drawer.overlay` and the `RootErrorBoundary` crash fallback each gain that
  declaration here — without it a settings or confirm dialog, a drawer, and both crash-recovery
  buttons are unusable the moment a game opts in. `ToastHost`'s toast already had one, and
  `ConnectionStatusIndicator` keeps `none` because it is decor.
- the route's page — `main-menu` puts `pointer-events: none` on its full-viewport container and
  restores `auto` on `> *`, so whatever the menu grows next is clickable the day it is added. A
  game-owned page owns the same construction for its own route, being the top layer there.
  `/settings` and `/lobby` render inside a `Modal` whose overlay covers the viewport, so the
  background takes no clicks there at all — a dialog owning the screen while it is open.

The engine's three readers — the host, the content layer and `main-menu` — take the opt-in from one
function, `useShellBackgroundPayload`, so the derivation is shared even though each keeps its own
state and its own load. It is engine-internal, reaches no barrel, and answers `false` on any surface
carrying no background, including the match.

Nothing changes for a game that does not opt in: the host's markup, the frame's hit-testing and
every engine control are byte-identical, pinned by the host's inline-literal markup assertion and
the tactics e2e suite.
