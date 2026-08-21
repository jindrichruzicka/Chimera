# @chimera-engine/simulation

## 1.0.0-rc.8

## 1.0.0-rc.7

### Minor Changes

- 46eba2f: Add F84 — spatial audio: an explicit listener pose, an authored distance falloff, and
  moving sources. `PlayOptions.position` becomes `PlayOptions.spatial` (a
  `SpatialOptions` carrying the position plus `fullVolumeDistance` / `falloffDistance` /
  `falloff` / `rolloffFactor`), mapping onto the voice's own `PannerNode` vocabulary
  with no engine arithmetic. The engine default falloff is `'linear'` — deliberately
  diverging from the platform's `'inverse'`, since only the linear model reaches zero at
  `maxDistance` — and `panningModel` is pinned to `'equalpower'` and is not authorable.
  Distances join the static validation tier: an inverted band, a negative or non-finite
  distance or `rolloffFactor`, or a non-finite position component rejects synchronously
  inside `play()` with an invalid handle and one warning, before any voice is reserved;
  an equal pair is an authored hard cutoff realised as the narrowest expressible band
  through a named power-of-two epsilon.

    `AudioManager.setListener(pose, opts?)` writes the app's ONE listener — game-supplied,
    never derived from a camera — over a feature-detected `AudioParam` path with a
    `setPosition`/`setOrientation` fallback; the panner position writes share the same
    feature-detected tier with their own `setPosition` fallback. Updates ramp over an
    anti-zipper window unless `{ immediate: true }`. `AudioManager.setVoicePosition` moves a live spatial
    voice (ramped or immediate), parks a move on a loading
    voice's record for `t0` with last-write-wins, warns once and no-ops on a non-spatial
    voice, and stays silent on a released handle. `useSpatialAudio()` exposes both verbs
    from the existing `@chimera-engine/renderer/audio` barrel — no new subpath — together
    with the spatial option types.

    Event-driven SFX gain a per-occurrence seam: `GameEventAudioBinding` entries accept
    `options?: (event) => EventAudioOverrides`, a sim-side primitives-only overrides type
    merged over the static fields, contained per event when it throws. It cannot produce a
    position; positioned event SFX use explicit call sites, and Tactics is the reference
    adopter — positioned board SFX with the listener anchored at the board focus, never the
    camera. No spatial code path writes any gain stage
    (Invariant #116 re-verified; the spatial rules are new Invariant #134).

## 1.0.0-rc.6

### Minor Changes

- 0243537: Add the animation clip-sheet authoring vocabulary, the shared time-scale arithmetic and the
  content-load window verifier — the first of the animation layer (F82), and the half that lives
  in the zero-dependency simulation leaf.

    `@chimera-engine/simulation/content` gains `modelAnimationEntry`, `spriteAnimationEntry`,
    `compileAnimationWindows`, `beatsForRealSeconds` and `AnimationWindowMismatchError`, plus the
    sheet types below. The two builders are twins of the existing `audioClipEntry`:
    each builds a `'gltf-model'` / `'sprite-sheet'` manifest entry and stores an optional clip
    sheet in the `AssetManifestEntry.metadata` slot verbatim, by reference, never inspecting it —
    and omits the `metadata` key entirely when none is passed, so an entry from the builder
    deep-equals a hand-authored one. `AssetManifestEntry.metadata` stays typed `unknown`; the sheet
    is structurally opaque to `simulation/` and `ai/`, and the playback parser is the renderer's.

    The sheet types themselves — `AnimationClipName`, `AnimationMarkName`, `AnimationWindowName`,
    `AnimationLoopMode`, `ClipPosition`, `AnimationNotify`, `AnimationPassage`,
    `AnimationTrackSheet`, `ModelAnimationMetadata`, `SpriteClipDeclaration` and
    `SpriteAnimationMetadata` — are declared in `simulation/foundation/animation-clip-sheet.ts`,
    mirroring `audio-cue-sheet.ts`: pure type declarations with zero runtime, asserted by an esbuild
    pin that the module bundles to the empty string. A `ClipPosition` is a normalized phase, an
    absolute `{ seconds }`, or a `{ frame }` index. `AnimationLoopMode` is `'once' | 'loop'` and
    deliberately has no ping-pong member — nothing downstream models a reversing playhead, so it is
    refused at the type level rather than clamped later.

    `compileAnimationWindows(sheet, clipName, tickRateMs)` is the reason the visual span and the
    mechanical one are authored twice. A passage carries clip-relative `from`/`to` positions and,
    optionally, the `[startBeat, endBeat]` integers the simulation will open a gameplay window on.
    The verifier recomputes the second from the first under outward rounding —
    `startBeat = floor(from)`, `endBeat = max(startBeat + 1, ceil(to))`, in beats — and throws
    `AnimationWindowMismatchError` (carrying the clip, the passage and both tuples) when the two
    disagree, returning the **authored** tuple by reference when they agree. It verifies rather than
    derives on purpose: deriving would make the length of every hit window in a game a function of
    the host pacing knob `tickRateMs`, so raising the tick rate would silently retune combat. The
    `max(startBeat + 1, …)` term is the structural one-beat floor — at the default 20 Hz beat the
    finest expressible mechanical window is one beat, and a narrower authored span is floored at one
    rather than collapsing to the empty window `[n, n]`. Beat quotients are snapped by a 1e-9 epsilon
    before rounding, because resolving a frame or a phase multiplies two floats and lands a hair off
    a beat in either direction. An authored bound that is not a non-negative integer, a
    `tickRateMs` that is not a finite positive number, and a position the clip cannot resolve are
    each a `RangeError`. `beatsForRealSeconds(realSeconds, tickRateMs, scalePermille)` is the same
    arithmetic the other way round, counting the beats of the dilated period a wall-clock span
    occupies; it divides by `dilatedBeatPeriodMs` rather than re-deriving the division.

    `simulation/foundation/time-scale.ts` holds the time-dilation arithmetic:
    `NORMAL_TIME_SCALE_PERMILLE` (1000), `MIN_TIME_SCALE_PERMILLE` (50), `MAX_TIME_SCALE_PERMILLE`
    (4000), `clampTimeScalePermille`, and the pair `timeScaleMultiplier` (the renderer's clip
    playback multiplier) and `dilatedBeatPeriodMs` (the host's declared beat period). Both divide by
    the same clamp result, so the two halves of a dilated hit cannot drift apart independently.
    `clampTimeScalePermille` applies two distinct rules in order: anything that is not a finite
    integer — `undefined`, `NaN`, `±Infinity`, or a fractional permille such as `2.5` — falls back to
    real time, and only then is a finite integer clamped into `[50, 4000]`. A fraction is refused
    rather than rounded, because silently turning `2.5` into the 5%-speed floor reads as a
    slow-motion bug rather than as the typo it is.

    That module carries runtime values, so it is exported from no barrel: the package root and
    `@chimera-engine/simulation/contracts` are both asserted to bundle to the empty string, and
    re-exporting it from either would break that. It is reached through its own
    `@chimera-engine/simulation/foundation/time-scale.js` subpath, resolved by the `./*.js` wildcard
    already in the exports map — the same route `foundation/crc32.js` and
    `foundation/asset-ref-parse.js` already take. No exports-map entry was added.

    Additive throughout; nothing is removed, renamed or narrowed, and no snapshot type changes.
    The build-time half — `validate-assets`' `invalidAnimationSheets` gate over the sheets these
    builders write — lands in `@chimera-engine/electron`.

- b53c262: A clip change can now blend, and a finished clip stays on its last frame.

    `useClipPlayer` takes a `blendSeconds` option: the seconds to blend out of whatever was
    playing and into the newly declared clip. A clip may also declare the length once, in its
    manifest sheet, as `blendInSeconds`. Omitting the option falls back to that authored
    length, and to no blend when the sheet declares none — so a game that declares neither
    keeps the cut it has today. A `blendSeconds` at the call site overrides an authored one,
    including with a `0`, which asks for a cut. Both are wall-clock seconds and neither
    scales with the dilation multiplier, so a transition takes as long in a slowed-down scene
    as it does at full speed.

    `AnimatedSprite` and `useSpriteClipPlayer` deliberately do NOT take `blendSeconds`: a
    sprite playback rewrites quad UVs and has no weight to interpolate. A sprite clip's sheet
    may still author `blendInSeconds` — the sheet is shared vocabulary — and no sprite
    backend honours it.

    Behaviour an adopter sees without asking for anything:
    - A clip change now closes the outgoing clip's open passages with reason
      `'clip-changed'` instead of `'stopped'`, whether or not a blend was asked for. A
      `loop` change and a `sheet` change do the same. `'stopped'` now means what a caller
      asking for a stop gets — `stop(name)`, `stopAll()`, or declaring `clip: null` — and
      `'released'` still means the player was disposed. A game switching on
      `PassageEndEvent.reason` should read the new value.
    - A `'once'` clip that reaches its end now HOLDS its last frame instead of restoring the
      model's original state on the same tick its `clip-end` handler runs. The pose comes
      down when something asks the player for a change — including declaring another clip,
      which blends out of the held frame when it declares a blend and cuts it when it does
      not.

    An authored `blendInSeconds` that is not a finite number of at least zero now fails
    `validate-assets` at build time, naming the clip, and is dropped with a warning by the
    runtime sheet parser if it reaches one.

- f59644e: `ContentDatabase` items are now frozen **recursively**, `ContentLoader.load()` validates `DataRef`
  integrity **by default**, and item ids are constrained to a grammar that makes that validation sound
  — the two halves of Invariants #13 and #14 that the code declared but did not deliver.

    **Deep freeze (#13).** `createContentDatabase` called `Object.freeze(item)`, which is shallow: every
    nested object and array inside a loaded content item stayed mutable after `load()` returned, so
    "immutable after load" held exactly one level deep. Nothing mutated in practice only because every
    shipping content item is flat (`{ id, name, hex, order }`) — the guarantee would have lapsed
    silently on the first game to author a `stats: {...}` or `attacks: [...]` field. Items are now frozen
    through a recursive walk at the single freeze site every construction path funnels through, so
    `ContentLoader.load()` and direct `createContentDatabase()` calls are covered alike. The walk's
    visited marker is a `WeakSet`, deliberately not `Object.isFrozen`: an item the caller already
    shallow-froze must still have its nested values frozen, and a self-referential item must terminate.
    Cost is one pass per item at load time, never per access.

    Two adopter-facing consequences. Freezing is transitive, so an object a caller **shares** into an
    inline item (a module-level constant reused across items) is frozen along with it — shallow freezing
    never reached past the item itself. And because the query methods return `T` rather than a deep
    `Readonly<T>`, code that shallow-copies a nested content value and writes through the copy
    (`const s = {...item}; s.stats.hp -= 5`) still type-checks but now throws `TypeError` where it
    previously succeeded. Both were already Invariant #2/#13 violations; nothing first-party does either.
    The walk's domain is JSON (Invariant #15): a value JSON cannot produce — a `Map` or `Date` from a
    programmatic caller — is frozen but not walked, since freezing does not make those immutable anyway.
    An array-buffer view is skipped outright, neither frozen nor walked: `Object.freeze` throws on a
    non-empty typed array, and one rule for every view beats two.

    **Ref validation (#14).** `ContentLoadOptions.validateRefs` defaulted to `false` and the engine's
    only production call site (`loadAllGameContent`) passed just `{ schemas }`, so the ref half of
    Invariant #14 never ran outside tests: a game shipping a dangling `DataRef` booted fine and failed
    later as an `UnknownDataRefError` thrown from inside a reducer, mid-match, instead of fatally at
    startup. The default is now `true`. This is a **behavioural change to a published default**: a
    `load()` that previously tolerated a dangling ref now rejects. `validateRefs: false` remains as a
    narrow opt-out for a deliberately partial load whose refs resolve against a database that call does
    not build (staged base/expansion loads); no production startup path may use it.

    Refs are now recognised in object **keys** as well as values, at any depth. A map keyed by ref
    (`resistances: { 'damage-types:fire': 50 }`) is a first-class way to author per-ref data, and
    walking values alone exempted every ref written that way — a dangling one loaded clean and surfaced
    from `resolveRef()` mid-match instead. Ordinary field names contain no colon and exit the check
    immediately; the cost is that the false-positive class above now applies to keys too.

    The default was flipped rather than opted into at the electron call site so the guarantee has a
    single home — every current and future loader call site (scaffolded games, expansions, a second host
    path) is covered without remembering to ask. The startup path is pinned by its own test against a
    temp assets root, so the guard survives both a default flip-back and a call-site opt-out.

    **Item ids now have an enforced grammar** (`ITEM_ID_SHAPE`, `/^\S+$/` — non-empty, no whitespace).
    Non-ASCII, dotted, slashed and colon-bearing ids stay legal; `parseRef` splits a ref on its first
    colon, so `units:tier:elite` resolves id `tier:elite`. `ContentLoader` rejects a violating id as a
    `ContentSchemaError`, enforced at `createContentDatabase` — the single factory every construction
    path funnels through, the same siting as the deep freeze. `ContentLoader` repeats the check at merge
    time for one narrow reason: it runs before the duplicate check, so two id-less items are reported as
    malformed rather than as a `ContentConflictError` over a `Map` keyed on `undefined`. This is what
    makes ref detection sound
    rather than a guess. Detection needs to tell `"units:warrior"` from prose like `"units: 3 required"`,
    and can only do that by testing the id half — but that test is safe only if no _legal_ id can look
    like prose. Without the grammar an item ided `"Fire Mage"` would be legal and unreferenceable: both a
    correct and a dangling `"units:Fire Mage"` would be skipped, silently exempting that item from the
    integrity check. With it, a string the rule rejects cannot name any item, so skipping one can never
    skip a resolvable ref.

    **Two upgrade breaks follow from that, both intended.** First, the grammar is a new rejection: an
    item ided `"Fire Mage"` loaded before and now fails with a `ContentSchemaError`. It was legal but
    unreferenceable, which is precisely the state the grammar exists to make impossible — rename the id
    (and any ref to it). Second, with refs checked by default, any **non-ref** string of the form
    `<knownCollection>:<no-whitespace>` is now a fatal load error: an i18next-style `"units:warrior_name"`
    in a game that also has a `units` collection will stop the load. Nothing in untyped JSON distinguishes
    that from a real ref. A game hits it only by naming a collection after another of its namespaces;
    rename the collection, or pass `validateRefs: false`.

    The limits of the guarantee, stated on Invariant #14 rather than left implied. Not diagnosed at load,
    each reaching `resolveRef()` at call time instead: an id half that is empty or contains whitespace
    (`units:`, `units:Fire Mage`), which cannot name a legal item; a mistyped collection prefix
    (`unit:warrior`), which is not recognised as a ref at all; and a ref into a collection the loader
    never saw. The falsifiable form of what _is_ guaranteed: every string reachable from a loaded item
    through object entries and array elements — keys as well as values, at any depth — whose prefix names
    a known collection and whose id half matches `ITEM_ID_SHAPE` must resolve, or the load fails. Those
    two traversals are exactly what JSON can express; strings outside them (a symbol-keyed property, a
    non-index property on an array, a `Map`/`Set`'s contents) live in shapes only a programmatic `inline`
    source can build, and are not examined.

    `ContentSchemaError`'s message now reads `Content validation failed for '<collection>:<id>'` rather
    than `Schema validation failed…`: it also covers the id-grammar rejection, which fires for
    collections that have no registered schema at all. The specific reason stays in `cause`.

    `ITEM_ID_SHAPE` is exported from `@chimera-engine/simulation/content` so a game can reuse it in its
    own Zod id schema.

    **A failed content load now terminates the app.** `main()` logged the failure and rethrew, but the
    composition root launches it as `void main(...)`, so the throw was only an unhandled rejection —
    Electron printed a warning and kept the process alive with no window. Invariant #14 says the game
    does not start; it now calls `app.exit(1)`, matching the Invariant #27 startup guard (and, for the
    same reason, deliberately no modal `showErrorBox`, which would hang a non-interactive launch). The
    reason is reported through the injected `logger` and the pino sink is drained with a guarded
    `flushSync()` first — the sink buffers (`minLength: 4096`) and `app.exit()` emits no `before-quit`,
    so without that flush the refusal would leave no record at all. The
    per-game load is also wrapped so a failure names the game and its data directory, keeping the loader
    error as `cause` — the loader is game-agnostic and its errors carry only a ref string.

    No shipping content changes behaviour: the reference game's content is flat, its ids are slugs, and
    it carries no colon-bearing values.

- a2f7d10: Close the animation system (F82): author the two remaining invariants, and amend the prose the
  code falsified.

    **Invariant #129** (the last reserved slot, now authored) states that beat-owned gameplay windows
    are host-only — `StateProjector.project()`'s field allowlist omits the registry, so no window
    record ever crosses a boundary — that records are integer or `FixedPoint` throughout because the
    registry is saved and replayed, that `AnimationWindowManager`'s three verbs are pure, and that
    within a match a window leaves through one of the manager's FOUR paths, each reported with a
    distinguishing reason: `'expired'`, `'owner-gone'` (checked first, so it stays the truthful reason
    on the beat the countdown would also have run out), `'replaced'` and `'interrupted'`. The MATCH
    BOUNDARY is deliberately named as not being one of them — `animationWindows` is match-scoped, so
    `engine:start_game` and `engine:return_to_lobby` drop the whole registry with no per-window event,
    in the same reduce that drops a game's own extension fields.

    **Invariant #132** states as a numbered rule that no animation event may gate an
    `EngineAction`. A clip's marks report where a playhead is, and a gameplay consequence derived
    from one would be derived from the frame clock, which no two machines share. The rule is held by
    ABSENT PARAMETERS — `ClipMarkerHandlers` and every event it carries name no dispatcher, no
    `SendAction`, no `PlayerId` and no tick — so a handler has nothing to dispatch with. Stated as an
    invariant rather than left to be inferred from one hook's signature, because a future animation
    surface adding a parameter would be adding it to a shape no rule had claimed.

    The prose sweep is the other half, and it is about one word. `GameSnapshot.tick` counts ACTIONS,
    not beats: an `engine:tick` that fires a timer dispatches children through the same
    `ActionPipeline.process()`, and each one advances the counter. Every doc line that treated the
    two as the same number is amended — most importantly the action-pipeline claim that "each
    `engine:tick` advances the counter by 1", which is exactly what would make a `tick`-difference
    animation clock look correct. `ReplayPlayer`'s "+1 tick per recorded action" is restated as what
    it is, a REFUSAL that bounds what is replayable (a nested `ctx.dispatch` and `engine:undo`/`redo`
    are not), and the two measurably-false replay lines are deleted rather than sharpened.

    No runtime behaviour changes: this is the documentation and invariant half of a feature whose
    code landed across the tasks before it, plus one new engine-side test pinning #132's parameter
    census.

- 8f6e8fd: Asset-gated scene reveal: a scene's declared `requiredAssets` now gate what a player
  SEES, on both entry paths, without ever gating a mount or the host's barrier.

    Before this, `SceneDescriptor.requiredAssets` was a declaration `validate-assets`
    checked and no code read at runtime. A scene could name every ref it needed and the
    player would still watch them pop in after the fade.

    **The declaration now travels on two carriers.** A scene being ENTERED carries it on
    `SceneTransitionState.requiredAssets`, which `startScenePreload` promotes and awaits
    before the client dispatches `engine:scene_ready`. A scene already COMMITTED carries it
    on the new `BaseGameSnapshot.sceneRequiredAssets`, which `useCriticalAssetPreloadGate`
    promotes for a route entered mid-scene — a restore or a replay — so that path is gated
    too rather than only a live transition.

    **Fail-open is the guarantee, not a fallback.** Both arms settle on four independent
    paths: the load resolving, the load REJECTING, an elapsed budget
    (`CRITICAL_ASSET_PRELOAD_BUDGET_MS` = 8 s for the route arm,
    `SCENE_PRELOAD_BUDGET_MS` = 5 s for the transition arm), and a nothing-to-load
    short-circuit. No combination of a missing,
    slow or undeclared asset can produce a permanently black screen. The transition arm's
    ack fires on all four outcomes deliberately: the host barrier waits for every player and
    evaluates `timeoutTicks` only when an action is applied, so a turn-based match has no
    ticker to time a withheld ack out — withholding it would freeze the match rather than
    degrade it.

    **A gate withholds a reveal, never a MOUNT.** `GameShell` mounts on the same commit it
    did before, which is what keeps the unique disposer of a page-injected `AssetManager`
    reachable; `/replays/player`'s `isReady` is unchanged for the same reason, and its cover
    is an overlay above a mounted shell.

    **Two new optional `GameScreenRegistry` slots.** `loadingScreen` covers every screen key;
    `loadingScreens[key]` covers one, and `'none'` opts a key out of a registry-wide cover.
    Either accepts a component, a static `{ message }`, a static `{ image }`, or the
    `'spinner'` / `'progress'` presets. They resolve through ONE cascade and render at three
    sites — a suspended code-split chunk, a scene transition, and a route entry — always as a
    SIBLING of the transition overlay, never inside its `aria-hidden` subtree. **The default is unchanged from before the slots existed: a game that declares neither gets the engine's own empty placeholder, which is what the Suspense site rendered before.**

    Properties you can rely on:
    - A declared ref that is `deferred` in the manifest is promoted for the run and restored
      by nothing — the promoted manifest is built from the same base object, so entry
      equivalence keeps every cached ref and `registerManifest` evicts none.
    - `engine:scene_ready` still carries `{ playerId }` and nothing else. No client's load
      timing, fraction or outcome enters authoritative state.
    - Neither budget collapses under `NEXT_PUBLIC_CHIMERA_E2E`. The e2e build is where a
      never-releasing gate is observed; disabling it there would make its own spec pass
      vacuously.

    One caveat worth knowing before you rely on the route arm:
    - **The guarantee is scoped to a live, rendering client.** A seat in `state.players` with
      no mounted `SceneRouter` — a disconnect mid-transition, or an AI seat — can already
      stall the host barrier today. This change does not fix that, and the budgets are chosen
      so it does not meaningfully widen the window.

- 6b600c2: A scene transition waiting on a seat that cannot acknowledge is now released by a host-side
  budget, instead of holding forever.

    The barrier requires an `engine:scene_ready` from every key of `state.players`, and that action
    has exactly one producer — `useFadeTransition`, inside a mounted `SceneRouter`. A seat with no
    renderer never sends one: an AI seat has no renderer at all, and a disconnect mid-transition
    leaves the seat in `state.players` with its renderer gone (no engine action removes a seat).
    `SceneTransitionState.timeoutTicks` could not cover for it either, because a tick advances only
    when an action is applied and a turn-based match applies none while a transition is pending.

    `SessionRuntime` now measures a pending transition against a wall clock —
    `DEFAULT_SCENE_TRANSITION_BUDGET_MS`, 30 s, above every client-side budget it has to outlast so
    a slow-but-live client is never mistaken for a seat that cannot ack — and dispatches a new
    host-only engine action, `engine:scene_expire`. That action carries no payload and decides
    nothing: it sets `SceneTransitionState.expired`, which `isTransitionTimedOut` reads beside the
    tick budget, so the descriptor's own `onClientTimeout` still chooses between committing and
    dropping exactly as it does when the tick budget elapses.

    The wall clock stays in the host runtime; the reduce remains pure and clock-free, and
    `engine:scene_ready` still carries `{ playerId }` and nothing else — no client's load timing
    enters authoritative state.

    Worth knowing before a game adds a transition: in a match with an AI seat the acks can never
    complete the barrier, so this budget is not a rescue there but the release path, and every scene
    hop costs it in full. A game that adds a transition should pick `sceneTransitionBudgetMs` with
    that case in mind.

- 88680bb: Restored the mandated structured-logger wiring across the main-process composition root
  and removed a dead `UndoPolicy` field.
    - `buildHostSessionPipeline` now forwards its injected `Logger` into both
      `InMemoryActionHistory` and `ActionPipeline`, so the `action-history:overflow` warn
      (Invariant #45) and the `engine:tick` timer-rejection warn (Invariant #90, §4.20) are
      reachable in production instead of being swallowed by a noop logger.
    - `SettingsManager.getSettings()` now emits the mandated warn when called for an
      unregistered `gameId` before degrading to engine defaults (Invariant #34).
    - `ProfileManager` is now constructed with an injected `Logger` child — the last
      main-process manager that was missing one (Invariant #67).
    - Removed `UndoPolicy.requireConsentFrom`, a field with no enforcement anywhere in the
      engine. Multi-player undo consent is not a supported policy dimension (§4.5, §7).

- c4d095d: Add F90 — a minimum visible time for loading covers. One optional registry knob,
  `GameScreenRegistry.loadingScreenMinVisibleMs?: number` (in `@chimera-engine/simulation`'s
  zero-dependency foundation leaf): once a cover the player can actually see has been shown, it
  stays on screen at least that long, so a fast load reads as a beat instead of a flicker. A
  wait that outlives the minimum changes nothing, and an absent or `0` value keeps every path
  byte-identical — no timer is armed at all.

    The renderer half supplies the machinery. `resolveLoadingCoverHoldMs(registry)` is the single
    resolver: `0` for absent/zero/negative/non-finite declarations, `0` under
    `NEXT_PUBLIC_CHIMERA_E2E === '1'` read at call time (the hold is a deliberate delay like the
    screen fades, never a release budget), and deliberately NOT collapsed under
    `prefers-reduced-motion`, where zeroed fades make a sub-perceptual flash strictly worse.
    `useMinimumVisibleHold(shown, holdMs)` is the shared delayed-release latch — one timer per
    release, monotonic stamp at the rise, re-show cancels and re-stamps, StrictMode-safe, and
    structurally inert at `0`. Registration warns once (never throws) on a non-finite or negative
    declaration, and once — honoring the value, never clamping — on a minimum above
    `SCENE_PRELOAD_BUDGET_MS`.

    Visibility is the arming condition at every consumer: the hold arms only when the cover
    cascade resolves a game-declared form (never the engine placeholder or `'none'`) and nothing
    opaque paints over the cover. On `/game` the reveal — the latched app-level fade-in plus the
    route cover drop — waits for max(gate settle, shown + minimum), with the faded lobby→game
    entry unchanged (the opaque scrim covers the route cover, so a mount-stamped hold would
    extend a black screen), a waiting restore bypassing the hold, and `/replays/player` holding
    only its cover, `isReady` untouched. `SceneRouter` keeps one held-layer slot for the drops it
    cannot defer — the transition cover's host-side commit and a Suspense fallback's chunk
    resolution — re-rendering the dropped cover's same cascade resolution (last measured
    fraction, or `reason="code"`) as a sibling layer for the remainder, with one clock per visual
    wait and at most one cover layer in the DOM at a time. `GameShell` gains an optional
    `sceneCoverOccluded` prop threading the pages' occlusion signal through to the router.

    Nothing host-visible moves: `useFadeTransition` — the `engine:scene_ready` ack, both fade
    channels and the progress protocol — ships byte-identical, and no preload budget widens or
    collapses. Additive throughout; a registry without the field behaves exactly as before.

### Patch Changes

- 1655193: Hardened the production debug-mode startup guard for packaged builds (Invariant #27/#77).

    `assertProductionDebugGuard` early-returned unless `NODE_ENV === 'production'`, but an
    electron-builder-packaged launch never sets `NODE_ENV` — so a shipped binary started with
    `CHIMERA_DEBUG=1` booted the full debug bridge with `GameSnapshot`-level Inspector access.
    Both startup guards now take `app.isPackaged` and share one `isProductionRuntime` predicate
    (`isPackaged || NODE_ENV === 'production'`), adopting the same trusted build signal the replay
    privacy gate already used. The existing `NODE_ENV` trigger is unchanged.

    As defence in depth, the app bundler gained an opt-in production `define`: packaging scripts
    declare `CHIMERA_PACKAGED_BUILD=1`, which bakes both `IS_DEBUG_MODE` reads so the emitted bundle
    contains the literal `IS_DEBUG_MODE = false` — the debug bridge sits behind a permanently-false
    gate even if the startup guard were bypassed. (This step made the gate dead but left the debug
    module graph in the bundle; a separate change in this same release removes it — see "Packaged
    builds no longer bundle the Runtime Debug Layer".) Dev and e2e builds share that bundler and
    deliberately get no define, so the F9
    Inspector stays reachable; a drift test fails loudly if a packaging script ever loses the flag.

    Also fixes a scaffolding bug this exposed: the packaging scripts emitted by `create-chimera-game`
    (both workspace and standalone) never set `NEXT_PUBLIC_CHIMERA_PACKAGED=1` on their `next build`
    step, so every scaffolded game's distributable shipped the dev-only component gallery and replay
    routes. Both emitters now declare it, and `start:debug` rebuilds the renderer as well as the app
    bundle so a preceding `pnpm package` cannot leave a debug launch half-gated.

- 6cd3bbd: The scene actions that FINISH a transition now pass the terminal-match gate, so a transition
  still in flight when a match resolves is no longer stranded by the guard itself.

    Both terminal guards rejected everything once `gameResult` was recorded: the pipeline's own
    gate, and the game route's `sendAction` wrapper. Nothing ties `gameResult` to `sceneTransition`
    — and the game resolver runs on the output of every reduce, including the prepare's own — so
    the state is reachable. There the rejection stranded the transition: the acks are what the host
    waits for, the host's own commit or drop is what clears it, and the barrier's timeout is counted
    in ticks that only an applied action advances.

    `engine:scene_prepare` still does not pass: a resolved match may FINISH the transition it is in,
    and may not BEGIN another. The set is one exported predicate,
    `isSceneTransitionCompletionAction` in `simulation/foundation/scene-lifecycle.ts`, which both
    guards consult — the renderer may not import the pipeline, and two copies of the list would
    drift.

    Admitting them is necessary and not sufficient: the release still needs every seat in
    `state.players` to acknowledge, or the host's own budget to expire the transition. What a seat
    that cannot acknowledge at all does to it is measured in
    `simulation/scene/__tests__/unackable-seat-barrier.test.ts`.

    Also fixed, in the same path: a scene commit landing after a result now carries the recorded
    `gameResult` through unchanged. `initialize`/`teardown` may return any state and the commit
    spreads it, so the newly-admitted commit would otherwise have been a door through which game
    code could blank a recorded result and resume a finished match. Only `gameResult` is re-pinned,
    so an entered scene still writes its own `phase`.

    The spectator gate is unchanged: a seatless viewer has nothing to acknowledge for.

## 1.0.0-rc.5

## 1.0.0-rc.4

## 1.0.0-rc.3

## 1.0.0-rc.2

### Minor Changes

- 7f237bb: Dev multiplayer harness: game-owned fixtures, auto-session, standalone packaging (§4.32)
    - `@chimera-engine/electron` ships the harness as the `chimera-dev-mp` bin (+ the
      `./dev-harness` library subpath): one command spawns an auto-hosting instance plus
      auto-joining clients, relays the host's `host:port:token` lobby code via an atomic
      announce-file handshake, auto-readies every seat, and auto-starts the match once the
      roster is complete. Works identically from the monorepo and from a standalone
      scaffolded app (the app dir is the harness root; entry from `package.json` `main`).
    - Games inject their own test data from `<appRoot>/dev/`: `profiles/*.json` (cosmetic
      engine-shaped identities, seeded as each instance's active profile) and
      `scenarios/*.json` (per-seat game-defined attributes such as a JSON-encoded deck,
      host-authored match settings such as an arena id, AI seats, auto-start) — validated by
      the new `@chimera-engine/simulation` `shared/dev-fixture-contract.ts` schemas and
      riding the same lobby channels a real player uses into `snapshot.setup`.
    - Per-game player-attribute value cap: `GameLobbySetup.maxAttributeValueLength`
      (default 256 — unchanged behaviour) lets a game admit deck-sized values; the wire
      schema's coarse bound is now `WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH` (16384) with
      the precise cap enforced by `LobbyManager` on both write paths.
    - `create-chimera-game` scaffolds ship a `dev:mp` script, starter `dev/` fixtures, and
      a synthesized standalone `.gitignore`; `verify:scaffold` gains a `dev-harness`
      dry-run step and `verify:pack` probes the new subpath.
    - Fixes the previously dead harness wiring: the spawn entry pointed at a deleted
      monorepo path, `--dev-auto-join` could never match its own equals-form flag, and the
      documented seed-profile copy was unimplemented.

- RC polish across the engine chrome and settings:
    - New real frame-rate limiter: `FrameRateLimiter` (exported from the r3f barrel) gates
      `gl.render` at render priority and reads `targetFps` from resolved settings, replacing
      the previously non-functional display cap.
    - Removed the dead `display.fullscreen`, `display.vsync`, and `display.uiScale` settings
      engine-wide (they had no runtime effect; fullscreen is forced in production). The
      gameplay settings tab is now language-only.
    - Slimmed the default chrome: dropped the lobby role badge and the default HUD's
      `Tick`/undo/redo affordances (`DefaultGameHud`), and removed the duplicated title from
      the blank game template.

## 1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- M10 — first public release (`1.0.0`). Adopt the locked `1.X.Y` versioning scheme: every
  `@chimera-engine/*` engine package and the `create-chimera-game` initializer now share one
  version and re-publish together. This bump retires the independent `0.x` per-package semver
  and aligns the whole first-party set at `1.0.0`. Previewed on npm as `1.0.0-rc.0` under the
  `rc` dist-tag before the final release.

### Minor Changes

- e9f122f: Add the optional spectator capability to the `GameManifest` contract and the reserved allow-spectators match setting (F72). New exports from `foundation/game-manifest-contract`: `GameSpectatorSupport` (an opaque `mode: 'perspective'` — the only v1 visibility model), the optional `GameManifest.spectators` field, and the pure `resolveSpectatorSupport(manifest)` helper (returns `undefined` for an absent field or a malformed `mode`, never throws, never mutates). New exports from `foundation/game-lobby-contract`: the engine-owned reserved match-setting key `ALLOW_SPECTATORS_SETTING` (`'engine.allowSpectators'`), its `ALLOW_SPECTATORS_DEFAULT` (`'false'`), and the pure `readAllowSpectators(matchSettings)` reader (`true` only when the key is exactly `'true'`, fail-safe closed otherwise). Behaviour-neutral for every existing game: absent `spectators` resolves to `undefined` and join-in-progress stays rejected — no game admits spectators until it declares the capability and the host enables it per match.
- da1f1cd: Let a spectator switch which seat they follow (F72 Spectator Mode). The `SPECTATE_TARGET_UPDATE` wire message is now plumbed end-to-end: the networking transports gain `ClientTransport.sendSpectateTarget(targetPlayerId)` and `HostTransport.onSpectateTargetUpdate((from, targetPlayerId) => …)` (mirrored across the local WebSocket provider — `WsClientTransport`, `MessageRouter`, `WsHostTransport` — and the `InMemoryMultiplayerProvider`); the host derives the spectator from the connection (never a client-supplied id, Invariant #99) and, after validating the requested target is a currently-seated player, re-points the viewer's `SpectatorRegistry` entry and immediately re-broadcasts the new-perspective projection — an unknown or non-seated target is ignored and the perspective is unchanged. A new renderer→main IPC seam drives it: `window.__chimera.spectate.setFollowedTarget(targetPlayerId)` sends the Zod-validated `chimera:spectate:set-target` channel (Invariant #5), which `LobbyManager.setSpectatorTarget` forwards over the joined session's transport. The message is out-of-band / cosmetic: never an `EngineAction`, never advances `tick`, and never enters `ActionHistory`, saves, or replays (Invariant #115).

## 0.10.0

### Minor Changes

- 483a4ab: Add the optional hardware-cursor declaration to the `GameManifest` contract (F69). New exports from `foundation/game-manifest-contract`: `GameCursorRole` (`'default' | 'pointer' | 'disabled'`), `GameCursorHotspot`, `GameCursorImage` (game-asset-relative `image` path + optional `hotspot`), `DEFAULT_CURSOR_HOTSPOT`, the optional `GameManifest.cursor` field, and the pure `resolveGameCursor(manifest)` helper that normalizes declared roles (hotspots defaulted to `(0, 0)`) and returns `undefined` for absent or empty declarations — behaviour-neutral: the plain system cursor stays. Image paths are opaque at this layer and resolved only by the renderer through the game-asset protocol.
- abdd11d: Add the optional logo-screen declaration to the `GameManifest` contract (F70). New exports from `foundation/game-manifest-contract`: `GameLogoScreen` (an opaque game-owned `route` of the form `` `/${string}` ``), the optional `GameManifest.logoScreen` field, and the pure `resolveGameLogoScreen(manifest)` helper. The resolver returns `undefined` for an absent declaration or a malformed route (non-string, missing the leading slash, or carrying a `?` query / `#` fragment) and never throws — a bad manifest can never brick a packaged boot; the host just falls back to the main menu. Behaviour-neutral for games that declare nothing: boot goes straight to `/main-menu` exactly as before.

### Patch Changes

- 70e4147: Fix player colours (and other host-authored seat attributes) flashing their default value at the start of a replay before snapping to the chosen value.

    Seat setup — chosen player colours, names, team, etc. — is match-initialization data carried on the `engine:start_game` payload, not a gameplay action. A replay's `gameConfig` is frozen at lobby-start, before that setup exists, so `createBaseReplayInitialSnapshot` reconstructed the initial frame without any `setup`; the value only appeared once the recorded `engine:start_game` action replayed, producing a one-frame default → chosen flash. The reconstruction now lifts `setup` from the replay's first `engine:start_game` action (validated via the same `parseSetup` sanitiser the live pipeline uses) and seeds it into the initial snapshot, so the first frame already carries the correct attributes. Determinism is preserved — the replayed `engine:start_game` re-applies the identical value, leaving every post-action frame bit-identical — and the fix is self-healing for already-recorded replays (no file-format change).

- 26da224: Fix "Return to lobby" doing nothing after a match ends (from the post-game summary or the post-game replay).
    - `@chimera-engine/simulation`: the `ActionPipeline` terminal-match gate now allows `engine:return_to_lobby` after a `gameResult` is recorded. It is the host-only abandon-to-lobby reset (the reverse of `start_game`) and does not mutate the recorded result, so it must not be rejected alongside gameplay/turn/undo actions — otherwise the host can never leave a finished match back to the lobby.
    - `@chimera-engine/renderer`: the in-game menu's leave action is now injectable through `GameShell` → `InGameMenuHost`, and the replay player supplies a context-aware leave (back to the lobby for a post-game replay, back to the replay library for a library-opened one). `GameStoreBootstrap` also returns to the lobby on a `phase:'lobby'` snapshot when on the replay player route, not just `/game`.

## 0.9.0

### Minor Changes

- Initial package extraction from the Chimera monorepo (M9, F57–F66). The pure,
  zero-runtime-dependency simulation core — engine, action registry, reducers, snapshot
  and projection, and the deterministic host — published as `@chimera-engine/simulation`.
