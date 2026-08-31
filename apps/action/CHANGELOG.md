# @chimera-engine/action

## 0.1.1-rc.0

### Patch Changes

- c066986: Prove the action app end to end, and fix the defect that proof found: the host never handed a
  game's own lobby `setup` to its `buildInitialEntities` hook.

    `GameDefinition.buildInitialEntities` takes `(playerIds, setup?)`, and its contract in
    `simulation/engine/ActionRegistry.ts` says the second argument is there so a game can seed starting
    entities from the host-authored configuration. Nothing passed it. `resolveInitialEntitiesForGame` dropped the parameter, so every
    game reading it fell back to seat order — and the fallback is invisible from the outside, because
    the picks still ride `snapshot.setup` and every projection afterwards looks correct. The players are
    simply on the wrong pieces. The composition root now builds the setup before the entities and hands
    it over; the restored-host test harness, which mirrors that call, does the same.

    The suite that caught it is `apps/action/e2e/` — the action app's own Playwright project, with its
    own build root (`.e2e-build-action/`), its own throwaway-profile root and its own CI job. Two suites
    sharing either would delete each other's artefacts mid-run, so nothing is shared; the fixtures the
    tactics suite has an equivalent of are this app's own copies, because a game directory may not
    import another's. Its fixture offers no `CHIMERA_E2E` auto-start seam at all: every match here is
    opened by clicking Start, so `chimera:lobby:quick-start` is exercised on its only production path.

    Eight specs: the fresh-profile menu over the live background, held-key movement on the realtime
    heartbeat, autosave-on-leave and Continue restoring the arena as it was left, the Start overwrite
    confirm and both its answers, background persistence across `menu → select → settings`, in-scene
    picking plus a click-through sweep of the shell controls those surfaces carry, each clicked with the
    interactive plate mounted under it, a rebind that reaches the pre-match picker with no match ever
    run, and the pass-and-play seat picking,
    playing and moving on its own keys. The two seats end up on shapes seat order would not have chosen,
    which is what makes the last one the killer for the fix above.

    `ACTION_SHELL_YAW_ATTRIBUTE` / `ACTION_SHELL_DOLLY_ATTRIBUTE` move from `ActionShellCameraRig.tsx`
    to `actionShellCamera.ts`, beside the two describers whose answers they carry — a reader outside the
    renderer needs the attribute name and the phase vocabulary together, and only the plain `.ts` half
    of that pair is reachable from a Playwright runner.

- 985ce07: Give `apps/action` its shell: the menu, the `/select` picker and the reactive live background —
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

- 7cbe612: Add `apps/action` — the engine's second reference consumer, and its FIRST realtime one.

    The app skeleton mirrors `apps/tactics` (manifest, asset manifest, settings schema, `simulation/`,
    `screens/`, `components/`, `renderer/{register,loaders,next.config,app/**}`,
    `electron/{main,build-main}`, `styles/`, `dev/` fixtures) and carries a deliberately minimal
    surface: no cursor, no logo screen, no icon override, no languages, no spectators, no lobby setup,
    no AI, no content collections. Every one of those is a capability the host branches on, so
    declaring one empty would announce something the app has not built; the shell task adds the
    menu-facing half.

    **Realtime is the point.** `realtime: true` with `tickRateMs: 100` is what makes the host arm a
    `RealtimeTicker`, and the simulation's per-beat movement pass rides the resulting `engine:tick`
    through the game definition's `onBeat` hook — no clock, no RNG, no dispatch inside it, so a recorded
    beat sequence replays to the same state (Invariants #43/#70). `__tests__/realtime-beat.test.ts`
    joins the three links (manifest → `resolveTickerHz` → `ActionPipeline.process('engine:tick')` →
    `onBeat`) so a movement pass registered under the wrong game id fails there rather than as a match
    that renders and never moves.

    **Positions are INTEGERS, not `FixedPoint`, and that was measured rather than assumed.** A primitive
    advances whole arena cells per beat, so the simulation carries no fractional gameplay quantity and
    Invariant #75 is not engaged. It could not be satisfied here anyway: the engine's save path is
    `JsonSaveSerializer`, whose `JSON.stringify` throws on a `bigint` and whose `deserialize` has no
    reviver that could return one — a `FixedPoint` position would make the app unsavable, which the
    HUD's save affordance and F88's autosave/Continue flow both depend on.
    `actions.test.ts` pins the round trip in both directions.

    Two actions, both with real validation branches: `action:set-velocity { dx, dy ∈ -1|0|1 }` writes a
    standing order onto the primitive the acting seat owns (rejected outright when the seat owns none),
    and `action:select-primitive { entityId }` claims one exclusively — rejecting an unknown id, the
    ground plane, and a primitive another seat drives — releasing and STOPPING whatever the seat drove
    before, so an abandoned primitive cannot coast on with nobody at the controls. Ownership lives on
    the entity rather than in a per-player field, so the renderer's selection colouring and the
    reducer's authority read one value.

    `ActionPlayfield` mounts one `GameCanvas role="main"` on the `top-down` preset and turns arrow keys
    into velocity through a HELD-SET model: the input layer dispatches on key down and key up, both axes
    sum and clamp independently (Left+Right cancels while a held Down keeps moving), and an action is
    sent only when the derived velocity CHANGES — a screen that dispatched per snapshot would fire ten
    identical actions a second at this heartbeat.

    Workspace wiring: `tsc -b` solution reference, `typecheck` entry, vitest source resolution and
    coverage, changeset-policy graph, and the game-app import bans in `eslint.config.mjs` — which now
    name `@chimera-engine/action` alongside `@chimera-engine/tactics`, so neither game's gameplay tree
    can reach the other's. `pnpm verify:packaged-bundle` verifies BOTH apps and reports both before
    deciding its exit code; its guard discovers every `apps/<game>` with an Electron composition root and
    fails when the driver's list misses one, because an unverified app is one whose app-owned
    `build:app` or `electron-builder.yml` can reship the debug layer with the gate green.
