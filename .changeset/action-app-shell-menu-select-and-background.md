---
'@chimera-engine/action': patch
---

Give `apps/action` its shell: the menu, the `/select` picker and the reactive live background —
F88's living demo of the F87 flow layer.

**The menu** (`shell/main-menu.ts`) is four entries: Continue · Start · Settings · Quit. Start is a
`navigate` to the game's own `/select` route rather than a `start-game`, because the pick belongs to
the player — that is what makes the F87 draft load-bearing rather than decorative. Its confirmation
is `when: 'autosave-exists'`, so a first-run player is never told they are about to overwrite a save
that does not exist; the engine resolves it through the one confirm surface (Invariant #140) once
the slot list has hydrated. No lobby entry and no saves browser: this app opens no lobby, and its
one save is the autosave Continue already reaches.

**The background** (`shell/ActionShellBackground.tsx`) mounts one `GameCanvas role="overlay"` over
the same seeds the match starts from, and splits its reads on purpose. The RINGS subscribe to the
draft — a pick is a render — while the CAMERA reads `getShellState()` transiently inside `useFrame`,
because a per-frame subscription would re-render a canvas subtree sixty times a second. Settings
yaws the look direction away onto bare ground and back (a look-away, not an orbit — an orbit would
keep the primitives centred); an armed `to-match` transition dollies toward the drafted primitive on
the transition's OWN `durationMs`, so the move lands with the engine's screen fade instead of
guessing at it. The pose surfaces as `data-action-shell-yaw` / `data-action-shell-dolly` PHASE
attributes written from the frame loop — Playwright-Electron freezes CSS transitions, so an opacity
or transform read would prove nothing, and a phase is something a test can wait on rather than
sample.

**The `/select` page** is a physical route in the app's own Next tree, declared through
`shellRoutes: ['/select']` — which is what keeps ONE background instance alive across
`/main-menu → /select → /settings` and lets the snapshot gate carry the player into the match. The
page and the background share the picks through exactly one thing, `shellStateStore`'s `draft`
(Invariant #139): no module-local store, no context, no prop. Its container is click-through by
construction (`pointer-events: none`, `auto` restored with `> *`), because under
`shellBackgroundInteractive` it is the top layer on its own route and the engine's layers have
already stood aside.

**Pre-match input, and a second seat.** The two selection rings move on the SAME rebindable actions
the match moves primitives with — registered at app boot off the shell payload (§4.26), so they work
before any match has run and a Settings rebind reaches the picker. The action table grows a second
four-id cluster bound to WASD, which is both how player two picks and how player two PLAYS: the
`/select` toggle writes `localSeats: [{ attributes: { primitive, control: 'wasd' } }]`, and
`ActionPlayfield` mounts a second `<ActionSeatMovement>` for the seat carrying that marker. Two
independent held sets, because one shared set would sum both players' keys into a single velocity
and move both primitives as one. A joined (non-host) viewer never drives it.

**The picks now decide the match.** `buildInitialActionEntities` honours each seat's `primitive`
attribute in a first pass and fills the remainder in seat order in a second — one pass would let an
early seat with no pick consume the seed a later seat named. Total and deterministic: an unreadable
value, a shape another seat already holds, and a short roster all resolve without throwing.

The seat attribute is spelled `primitive`, not `avatar`. `avatar` is one of the profile-data
identifiers Invariants #32/#57/#59 forbid in authoritative state, and this value is carried in
`snapshot.setup.playerAttributes` — the invariants gate refuses it in `apps/*/simulation`, and it is
right to: what the seat names is which primitive it drives, not who the player is.

**Menu audio** (`shell-asset-manifest.ts`) adds a looping bed and a select blip as committed
44.1 kHz mono PCM. The bed's loop body holds a whole number of cycles of each of its three partials,
so the wrap is sample-continuous; `shell-asset-manifest.test.ts` reads the RIFF header and checks
that, the declared duration and the ramps against the real bytes — the gap `validate-assets`
structurally cannot close, since it range-checks a sheet against the sheet's own numbers. The sheet
declares an `outro` cue, which is what earns the CUE-ALIGNED menu→match handoff rather than a fade
timed from the moment the player pressed Start. `electron-builder.yml` now ships `assets/` into the
`apps/action/` subtree the packaged host resolves game assets from.
