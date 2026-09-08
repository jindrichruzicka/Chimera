# @chimera-engine/action

## 0.1.1-rc.1

### Patch Changes

- 5f2639a: Declare the action app's match-history capability on its manifest, and prove end to end that undo is
  withheld.

    `matchHistory: { undo: false, replay: true }` states what a real-time game's default already resolves
    to. The point is that the intent is readable off the manifest rather than inferred from the loop mode:
    this arena offers no undo, and keeps replay recording. `retainActions` is left to the real-time
    default, because there is no intent there to record. A manifest test asserts the declaration resolves identically to the same manifest without it,
    so this is documentation rather than a behaviour change.

    The new `no-undo.spec.ts` measures the resolved capability in the shipped build. Three withholdings
    have to hold at once there — the host arms a refusing policy, mints no start-of-match memento, and
    the renderer registers no key subscription — and each is unit tested in isolation against a double.
    The spec drives the shipped path into a match, moves the seat's primitive so there is something an
    undo could take back, presses the engine's default undo binding, and asserts the primitive stayed
    where the move left it while the HUD clock kept advancing. It is NOT sensitive to whether the capability was declared
    or inherited: the two resolve identically, which is the manifest test's job to say.

    The companion case asserts the match route renders no `undo` or `redo` control. Neither the engine
    shell nor this app's HUD draws one today, so it is a regression guard rather than a measurement of
    this change.

- 085f120: Advance the tick in the action app's reducers, so a recorded match replays.

    `action:set-velocity` and `action:select-primitive` both returned a changed snapshot carrying the
    input tick through, violating Invariant #42 — `GameSnapshot.tick` advances by exactly 1 per action
    applied by `ActionPipeline.process()`. Nothing in a live match notices, because the pipeline takes
    `reduce`'s output verbatim. The consequence surfaces only when the recording is opened:
    `ReplayPlayer.step()` refuses the first such entry with
    `DeterminismError: replay action at tick 0 advanced to 0 instead of 1`. Both reduce returns now
    write `tick: state.tick + 1`.

    `action:select-primitive` also accepted a click on the primitive the acting seat already drives,
    while its reduce returned the input reference for it. `HostSessionPipeline.processAction` is where
    an applied action meets the replay recorder, so that click was the same unreplayable entry by
    another route. `validate` now refuses it with `already_controlled`; the click stays a no-op on
    screen, as it always was, and `ActionPrimitiveMesh` no longer reports that click at all, so the
    refusal is a guarantee rather than something a player trips on every pick.

    The reducers' remaining no-op arms are unchanged: each returns the input reference without touching
    the tick, and each is refused by `validate`, so none can reach a recording. The per-beat movement
    pass `advanceActionPrimitives` is untouched — it runs inside `engine:tick`'s own reduce, which has
    already advanced, and it still returns the input reference when nothing moved.

- ae4858c: Add a per-beat benchmark for the realtime reference game.

    `ActionBeatPerf.bench.test.ts` times the simulation leg of a beat —
    `ActionPipeline.process()`, which runs the engine's tick reduce and then the app's `onBeat` hook
    `advanceActionPrimitives` — and the app's own `action:set-velocity` reducer beside it. The existing
    benches cover `ActionPipeline.process()` through tactics fixtures and the Stage-7 outbound wave; the
    per-beat game work was timed by neither. The outbound wave stays the outbound bench's, so neither
    file measures a whole beat alone.

    It is the first gate to evaluate the rate-derived budget: the app declares `tickRateMs: 100`, so its
    gates read `tickBudgetMsFor(ACTION_TICK_RATE_MS)` rather than the default-rate `TICK_BUDGET_MS`, and
    a test pins that the two differ by the ratio of the periods — comparing the budget against
    `tickBudgetMsFor(ACTION_TICK_RATE_MS)` would be a tautology a rate-ignoring implementation
    satisfies.

    Two widths. The shipped 3-primitive arena records the baseline and could not fail on any regression
    short of a hang, which is why a synthetic 2000-entity arena runs beside it: making the beat hook
    quadratic breaches the gate there. Each run logs median/p95/max against the budget rather than
    freezing a figure in prose, and the percentile selection behind that log is pinned by its own test.
    Every timed sample asserts it rewrote the entities record, so a fixture drift that parked the arena
    cannot silently leave the bench measuring an early-out.

- ddbee1c: Build the action app's per-beat entities copy only once a primitive moves.

    `advanceActionPrimitives` copied `state.entities` before walking it and returned the input reference
    only after discovering that nothing had moved. The early-out was already load-bearing — with every
    field handed back by reference the pipeline keeps an idle beat on its clock-only broadcast, and the
    perspective recorder's growth stays proportional to time in motion — but the copy was paid on every
    beat regardless. The copy is now materialised on the first primitive that actually changes cell; an
    idle beat, or a beat whose only moving primitive is clamped against the arena wall, walks the record
    without building a copy. The contract is unchanged: the input reference comes back when nothing
    moved, a moved beat returns a new record with only the moved entities replaced, and the input is
    never mutated.

- f7e6831: Assert the action seat's own undo refusal in `no-undo.spec.ts`, off a projection fresh enough to mean
  it.

    A seat's `undoMeta` is derived per projection, and a real-time host broadcasts only a beat that changed
    something — so an idle match leaves a seat holding the start-of-match projection, which reports
    `canUndo: false` on a build with undo ARMED too, because at `engine:start_game` that seat has nothing to
    undo yet. Read stale, that looked like an ineligibility upstream of the declaration; it is staleness.
    The spec now pairs its refusal with a projection-tick comparison, so the assertion fails when the two
    host arms are reverted rather than passing on the start-of-match answer. `electron/main/index.test.ts`
    pins the start-of-match refusal, and pins that the start-of-match projection goes out before the seat's
    memento is seeded — so the reading a seat holds is taken while it has no baseline to undo to at all.

- a8e6bc0: Add an engine-owned entity interpolation seam, and move both reference games onto it.

    `useEntityInterpolation({ entityId, target, durationMs, snapDistance? })` smooths one entity between
    two authoritative positions and returns the ref to attach to the object being moved. It writes the
    transform from `useFrame` through that ref, so a moving entity costs no React commit per frame.

    A game whose entities live on a unit grid advances them a whole cell per beat, so an entity driven
    straight from the snapshot teleports one cell at a time — ten visible steps a second at
    `apps/action`'s 100 ms beat, and a diagonal step covering √2 world units at once. The hook draws the move instead of the
    arrival, at the cost of showing the entity up to one beat behind the host; that delay is stated in
    the hook's contract rather than left to be discovered, and anything that must agree with the host
    reads the snapshot instead.

    Three discontinuities are handled rather than smoothed: an entity appearing mid-match starts where it
    belongs instead of sliding in from the origin, a change of `entityId` snaps, and a move at least
    `snapDistance` far snaps — a deliberate teleport is not a fast walk.

    `durationMs` is the caller's, because a game's beat is not something the renderer holds. `apps/action`
    passes the same constant its manifest declares `tickRateMs` from. `apps/tactics` already tweened its
    units this way and now does it through the shared hook,
    which deletes its private copies of `lerp` and the ease-out curve; its duration is still the
    `--ch-duration-normal` motion token, so reduced motion still collapses the movement to an instant
    one.

- 08acd12: Record what the action app's no-undo e2e cannot measure, and complete the traceability-matrix rows the
  F96 arc touched.

    The `undo` / `redo` control count in `no-undo.spec.ts` reads zero whatever the manifest says: `ActionGameHud`
    draws no undo pair under any declaration and the F96 arc changed nothing under `apps/action/screens/`,
    so that assertion passed identically on the tree before it. The Ctrl+Z half kills only the full
    conjunction of three withholdings, so reverting any one arm leaves the other two refusing.

    The matrix carried F96 into the §4.5 and §4.28 rows and the M10 index row, leaving `F71–F92, F96` — a
    census that skips three shipped M10 features. F93 (§4.5, §4.27, §4.28), F94 (§4.2.1, §4.28) and F95
    (§4.5, §7) now have their rows, the index row reads `F71–F96`, and the preamble sentence that named F73
    as the one feature carried without a roadmap heading names the whole set.
    `tools/traceability-matrix.test.ts` deliberately does not assert this direction — a row may name a
    feature with no heading — so that sentence is what records these as intended rather than missed.

- a98157b: Write the snapshot retention rules into the simulation-layer standards, and add the per-beat
  outbound baseline they are measured against.

    `docs/coding-standards-sections/simulation-layer.md` gains §7.5: `events` is a per-action outbox; a
    fired one-shot leaves `timers` in the beat that fired it while a `cancel()`ed entry stays until a
    `create()` under the same id replaces it (`timers` is in `BASE_SNAPSHOT_KEYS`); a new
    snapshot-resident collection declares its retention on the field where it is added; and retention
    always produces a new snapshot (Invariant #43). §4.2 and §4.20 point at the rules rather than
    restating them.

    The baseline the section quotes is measured in-tree rather than restated from an audit: the new
    `apps/action/__tests__/OutboundPerBeatPerf.bench.test.ts` times what Stage 7 costs the host per
    eventful beat — `StateProjector.project()`, then `JSON.stringify` and `crc32` of the projection,
    once per viewer — at 500 × 4 and 2000 × 8 (entities × viewers) over the action app's shipped
    visibility rules, logs the numbers on every run, and is part of `pnpm test:perf`. The 500 × 4 grid
    is gated against `TICK_BUDGET_MS`; the 2000 × 8 grid is logged only and compared against nothing.

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
