# @chimera-engine/renderer

## 1.0.0-rc.7

### Minor Changes

- 0f855c6: Publish the tween, camera, curve and pointer-interaction surface through
  `@chimera-engine/renderer/components/r3f`, and mount `<InteractionBlocker>` inside
  `GameCanvas`. Six documented engine APIs shipped in the tarball and could not be imported:
  `renderer/tsconfig.build.json` includes the whole package, so `dist/hooks/useCamera.js` and
  `dist/utils/curves.js` were always there, but the `exports` map has no `./hooks`, no
  `./utils` and no wildcard. `useTween`, `useTweenCallback`, `useCamera`, the curve
  primitives, `useGameInteraction` and `InteractionBlocker` were documented as engine API in
  §4.21–§4.23 and unreachable from every installed package.

    The barrel grows from 6 runtime exports to 18 — adding `useTween`, `useTweenCallback`,
    `useCamera`, `CameraAnimationCancelled`, `lerp`, `linear`, `easeIn`, `easeOut`, `easeInOut`,
    `useGameInteraction`, `InteractionBlocker` and `useInteractionContext` — plus the
    `EasingFn`, `TweenState`, `TweenCallbackHandlers`, `CameraController`,
    `CameraAnimationTarget`, `CameraAnimationCancelReason` and `InteractionHandlers` types they
    take. The curve functions ship as values and not only as the `EasingFn` type, because they
    are what a caller passes: a barrel exporting the type alone leaves every caller on the
    `linear` default.

    **No ninth barrel and no new `exports` key.** Invariant #96 names `renderer/hooks/` as an
    internal and states the escape in the same sentence — whatever a barrel re-exports is legal
    through that barrel — so a `./hooks` subpath would contradict a named clause of the
    invariant, while re-exporting through `components/r3f` is the mechanism it blesses and the
    one that barrel already used for `useAnimationTimeScale`. The barrel set stays at eight,
    and `@chimera-engine/renderer/hooks/useCamera.js` remains a violation on the same day
    `useCamera` becomes public: the rule is on the specifier, never on where the symbol lives.

    `GameCanvas` now wraps its children in `<InteractionBlocker>` on every role, from inside its
    `<Canvas>`. Without it `useGameInteraction` threw for every caller — `useInteractionContext`
    has a null default and refuses to guess (Invariant #83), and nothing in the engine mounted a
    provider — so the hook was unusable rather than merely unreachable. The export remains, for
    nesting a second provider to narrow blocking over a subtree; the raw `InteractionContext` is
    not exported, matching the `assets` and `input` barrels, which publish a provider plus its
    `useX()` accessor and never the context object.

    Additive throughout — nothing removed or renamed. The barrel's import graph grows 34 → 43
    modules and its store edges three → four, the fourth being `gameStore` by way of the
    blocker's `snapshot.sceneTransition` read; `react-dom` becomes a barrel external through
    `useCamera`'s `flushSync`, and was already a peer dependency.

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

### Patch Changes

- Updated dependencies [46eba2f]
    - @chimera-engine/simulation@1.0.0-rc.7

## 1.0.0-rc.6

### Minor Changes

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

- 9004ccc: `GameCanvas` cameras now reconcile their own aspect with the canvas through a `fit` policy (§4.22). A `manual` camera — every orthographic one, and any perspective one with a pinned `aspect` — opts out of R3F's only aspect hook, so its projection was mapped onto the whole GL viewport one axis at a time and stretched wherever the canvas aspect diverged.
    - **New `CameraFit` type**, exported from `@chimera-engine/renderer/components/r3f`, accepted as `fit?` on both `OrthographicCameraConfig` and `PerspectiveCameraConfig`:
        - `'letterbox'` (the **new default**) renders the authored frustum at its exact aspect, centred, with the remainder painted `--ch-color-scrim` — pillarbox on a wider canvas, letterbox on a taller one.
        - `'expand'` grows the frustum on its short axis about its own centre until it fills the canvas: no bars, and the authored bounds become a guaranteed minimum rather than the exact framing.
        - `'stretch'` is the previous behaviour, kept as a named escape hatch.
        - `fit` is inert on a perspective camera with no pinned `aspect`: it stays non-`manual` and R3F keeps its aspect correct, exactly as before.

    **Behavioural, and opt-out-able only via `fit: 'stretch'`:**
    - The `isometric` and `top-down` preset frusta change from `±10 × ±10` (a square, aspect 1.0 — stretched on every display that exists) to `±10 × ±6.25` (20 × 12.5, aspect 1.6). A game relying on the old vertical extent sees a shorter world box.
    - Every existing orthographic camera, and every perspective camera with a pinned `aspect`, is now letterboxed rather than stretched. A canvas whose aspect already matches its camera gains no bars and nothing pinned on it — the fit applies only once the remainder reaches half a CSS pixel.
    - Where there **are** bars, the engine frame paints `--ch-color-scrim` behind the whole canvas, not only the bars: R3F leaves the canvas transparent, so a letterboxed scene's backdrop becomes the scrim rather than whatever showed through before. A game wanting another backdrop sets a scene background.
    - The letterbox is implemented in the DOM — an engine-owned frame that pins the r3f `<Canvas>` at the fitted size, out of flow and centred by auto margins — so with R3F 9.6.1 the canvas **element** is the fitted rect and `state.size`, pointer NDC, `useThree().viewport` and DPR all keep describing that one box. The `className` prop still lands on the r3f wrapper, which is now that fitted box, so canvas chrome follows the visible canvas.
    - **An HTML overlay a game lays over its own full-bleed wrapper must be positioned and rendered after the `<GameCanvas>`**, because the frame the opaque scrim sits on is itself a positioned element with `z-index: auto`. The frame is inert to the pointer, so a click on a bar is not absorbed by the engine box and reaches whatever the game has behind it. R3F connects its pointer listeners to its own wrapper, which under a fit is the fitted box, so a bar click reaches nothing R3F is listening on: `onPointerMissed` fires over the canvas only.
    - Every role letterboxes, `role="overlay"` included: an overlay canvas whose wrapper aspect diverges from its camera's gets bars and a scrim exactly as a main one does.

    The tactics demo board keeps its 3:2 frustum and is now pillarboxed on a 16:9 window instead of rendering 18.5% horizontally stretched. The blank game template's playfield comment carries the overlay rule, since a generated game ships with no copy of the engine docs.

- 068111c: `AssetManager.preloadCritical` now attempts every `critical` manifest entry instead of
  abandoning the list at the first rejection, and each broken ref is reported by name.

    The match-level warm-up (`startCriticalAssetPreload`) awaited its entries in sequence and let
    the first rejection propagate, so one broken critical ref left every entry after it unloaded by
    that run. Those fell back to loading on demand — the pop-in `priority: 'critical'` exists to
    prevent.

    The run still rejects once every entry has settled, now with a
    `CriticalAssetPreloadFailedError` carrying the refs that failed and the first cause. Because
    attempting all of them means the run cannot settle before its slowest entry, and this arm has
    no budget, `preloadCritical` takes an optional third argument — `onEntryFailure(ref, error)` —
    that fires as each broken ref settles. That is what the renderer log entry is emitted from, so
    one unanswered fetch beside one broken ref no longer withholds the report.

    The sequence is deliberately kept: the defect was the abandonment, not the ordering, and the
    load order is observable and pinned. A failed entry now advances the progress fraction, which
    measures how much of the list has settled.

- f9caea4: Frame-rate cap as loop pacing, not frame presentation.

    `display.targetFps` no longer works by taking over frame presentation. `FrameRateLimiter`
    is now a loop **driver**: it registers no `useFrame`, never calls `gl.render`, and owns a
    single `requestAnimationFrame` chain that calls the store-bound `advance()` at the target
    rate. The `<Canvas>` runs with `frameloop="never"` while a cap is active.

    This matters because R3F's `internal.priority` is a counter rather than a lock — a
    presenting cap was one co-presenter among however many the game mounted, since ANY
    `useFrame(cb, priority > 0)` subscriber becomes one (a post-processing composer, a
    portal/scissor renderer, a hand-rolled render-target pipeline), and none of them could
    suppress the others. Pacing the loop caps whoever presents, including presenters the
    engine has never heard of.
    - `GameCanvas` wires both halves of the cap itself — the `frameloop` prop and the
      `<FrameRateLimiter />` driver mounted inside the canvas. A canvas wired with only the
      driver is an uncapped loop and is reported as a named `FrameloopWiringError`; only the
      prop is a black canvas and cannot be detected.
    - The perf HUD's `fps` now reports the **presented** rate. It previously counted native
      frames, so a 30 fps cap on a 120 Hz display read as ~120. A healthy `frameMsAvg` at a
      30 fps cap is ~33 ms, not the panel's ~8 ms — the baseline moves with the cap by design.
    - No behaviour change at `targetFps: 0`: the uncapped path stays R3F's default.

- bb41334: GameCanvas is now the only canvas root a game mounts (Invariant #127), and gained the curated surface the own-`<Canvas>` hatch existed to provide:
    - `className?: string` — forwarded to the r3f wrapper `<div>` for canvas chrome. r3f pins position and size as inline styles on that div, so placement and explicit size live on a game-owned wrapper element.
    - `onPointerMissed?: (event: MouseEvent) => void` — forwarded to `<Canvas>` (deselect-on-empty-click).
    - `role?: 'main' | 'overlay'` (default `'main'`) — first-class multi-canvas: an overlay (minimap, preview) mounts no `PerfProbe`, so the perf HUD keeps measuring the main scene; every role is paced by the `display.targetFps` cap. Two concurrently-mounted mains are reported by name (`DuplicateMainGameCanvasError`) through the renderer logger — logged, not thrown, deferred one frame and cancelled if the pair resolves first.

    `GameCanvasProps` stays curated: no `CanvasProps` rest-spread, and `gl`/`dpr`/`shadows`/`style`/`frameloop`/`camera` pass-through is rejected at the type level. The tactics demo board's corner minimap is the reference overlay adoption.

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

- 3702818: Added `@chimera-engine/renderer/shell/gameAssetSession`, so a route can render a
  game's assets without a running match. `<GameAssetSession assetManifest>` builds,
  publishes and disposes a game-asset `AssetManager` for surfaces with no `GameShell`
  above them — previously the only manager reachable on a bare route was the app-level
  delegating one, whose delegate only `GameShell` sets, so every `useAsset` /
  `useModelInstance` load rejected with `NoActiveGameSessionError`. The manager is
  allocated in a commit-phase effect rather than in render, so StrictMode's discarded
  render-phase result cannot orphan an undisposable manager (Invariant #21, amended to
  name this second owner).

    The same module exports `useRendererGameAssetManager`, which memoises a manager for a
    route that hands it to `<GameShell assetManager>` and deliberately never disposes it
    (`GameShell` remains the unique disposer of the match-level manager). The `/game` and
    `/replays/player` routes each open-coded that construction; both now share this one.
    It is keyed on the loaded renderer game rather than on its manifest, because
    `LoadedRendererGame.assetManifest` is optional and "game with no manifest" must still
    yield a manager — collapsing that case to `null` would blank the route.

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

- f26c5ec: Narrow the public r3f barrel (`@chimera-engine/renderer/components/r3f`). Removed exports: `PerfProbe`, `FrameRateLimiter`, `useEngineFrameloop`, and the `EngineFrameloop` type.

    The three runtime exports existed only so a game owning its own `<Canvas>` could re-wire what `GameCanvas` already wires — the perf probe, the frame-rate-cap driver, and the `frameloop` prop. That hatch is closed inside the 1.0.0 RC window: `GameCanvas` (`role="main" | "overlay"`) is the only canvas root a game mounts, wires all three itself, and a minimap or preview mounts as a second `<GameCanvas role="overlay">` instead of a raw `<Canvas>`. The modules stay in the engine and keep being mounted by `GameCanvas`; only their public re-export is gone.

- 3fd9271: Remove the `isDefault` flag from `RendererGameContribution`, and with it the engine's notion of a default game. Game context reaches the renderer only as an external `?gameId=` (the launcher stamps it, `withShellGameId` carries it across navigation); the engine names, stores, and derives no game of its own.

    Breaking changes to `@chimera-engine/renderer/game`: `RendererGameContribution.isDefault` is gone — delete the field from your `register.ts` (scaffolds generated by `create-chimera-game` no longer emit it). `getDefaultRendererGameId()` and `NoDefaultRendererGameError` are removed with no replacement: the registry answers "load this explicit gameId", never "which game am I?". `LobbyConfig.gameId` is now `string | null`.

    Behaviour fix: the lobby was the one route that invented a game when the URL supplied none, so a lobby reached without `?gameId=` presented engine-default chrome while silently hosting the flagged default game underneath. It now resolves `gameId` from the URL alone, like every other shell route — one id drives both the host request and the shell branding, and with no game context the `Host` action is disabled (joining is unaffected, since the host's response carries the game). `useActiveShellGameId` drops its lobby-route carve-out, which existed only to defend against that invented default.

    Two further places where the game-agnostic renderer named a concrete game are fixed. `SaveStoreBootstrap` defaulted its game id to the literal `'tactics'` and is mounted propless in the root layout, so every route — including a game-less `/main-menu` — issued `saves.list('tactics')` over IPC; it now takes the active shell game id and stays unwired when there is none. The replays page fell back to `'tactics'` when the URL carried no `?gameId=`; it now lists nothing, which also removes the two call sites that re-resolved the URL specifically to dodge that fabricated fallback.

    Unchanged: the engine defaults a game opts into by contributing no shell — the default main menu, settings, lobby, and background a fresh scaffold renders. That is game context present with no customization, not the absence of game context.

- 0f6dd1c: Add `useClipPlayer` to the public r3f barrel (`@chimera-engine/renderer/components/r3f`) — the
  React binding of the animation layer (F82), and the first of it a game can name.

    `useClipPlayer(instance, sheet, options)` plays a declared clip out of a `ModelInstance` and
    fires the marks the clip sheet authors for it. `options` is declarative — `clip`, `loop`,
    `speed`, `handlers` and a renderer-local `timeScale` — and the returned `ClipPlayerHandle`
    carries the one verb the declarative surface cannot express: `setClipSpeed`. The hook owns one
    `AnimationMixer`, one `MeshClipBackend` and one `ClipPlayer`, all allocated in commit-phase
    effects and released on unmount, and registers exactly one `useFrame` at the DEFAULT render
    priority. `renderer/animation/*` stays internal (Invariant #96): the layer reaches games
    through this hook's own signature types — `UseClipPlayerOptions`, `ClipPlayerHandle`,
    `ClipMarkerHandlers`, `MarkerEvent`, `NotifyEvent`, `PassageEvent`, `PassageTickEvent`,
    `PassageEndEvent`, `PassageEndReason` and `ClipEndEvent` — which join the barrel with it. No
    `exports` subpath is added; the barrel set is unchanged at eight.

    **Rule LAST-WRITER-WINS on the clip-speed layer.** `options.speed` reaches that layer never per
    render, so an imperative `setClipSpeed` WINS until the prop itself changes or the playback
    restarts — a hit changes the snapshot and the screen re-renders on the same frame, and a
    per-render re-apply would silently snap a slow-motion back to full speed. Changing `clip`,
    `loop` or `sheet` restarts the playback and re-seats the declared speed on it; changing `speed`
    re-paces the playback in flight instead of restarting it. `useClipPlayer.ts`'s header records
    which writer owns which of those. A negative or non-finite `speed` is refused with a
    `RangeError` (Rule SPEED-NON-NEGATIVE), declaratively as well as through the handle.

    **Nothing animation-derived can reach an `EngineAction`.** The marker handlers this hook
    forwards carry a marker event and nothing else — no `SendAction`, no `EngineAction`, no
    `PlayerId`, no tick — so the prohibition is held by parameters that do not exist rather than by
    a rule (`docs/coding-standards-sections/react-three-fiber.md`, on Invariants #42/#43 and
    #56-#58). Gameplay consequences stay beat-driven and simulation-owned. Nothing
    here reads a tick, a beat or a host tick rate either: a clip free-runs from the render that
    changed `clip`.

    Reported rather than thrown, through the renderer log bridge (Invariant #67): a clip the
    backend cannot play, an authoring fault in the sheet, and a game handler that threw. The first
    two are engine-detected and carry a named `ClipPlaybackError`; the third is RELAYED under the
    error the game threw, so a log reader can tell which of the game's throws it was, and under
    Rule HANDLER-ISOLATION the clip keeps playing and the marks after it are still delivered. Data
    faults are reported rather than thrown because R3F's `ErrorBoundary` re-throws outward past the
    `<Canvas>` — a throw there would take down more than the animation.

    The mixer allocation and release that `useModelAnimation` owned were extracted verbatim into an
    internal `useOwnedMixer`, so both hooks share one commit-phase allocation and one
    `stopAllAction()` → `uncacheRoot()` release. `useModelAnimation`'s behaviour, signature and
    export are unchanged. Use one hook or the other on a given model, never both: each owns its own
    mixer, and two mixers bound to one root fight over the same tracks.

- 0902c04: Add `@chimera-engine/renderer/assets`, a seventh public barrel, so a game can reach any
  loaded asset at all. The model seam landed across F79 (`useModelInstance`, the headless
  clone/release module, manifest-at-construction), but the hooks that consume it were
  renderer internals with no entry in the `exports` map, and Invariant #96 allows a game
  surface only a public barrel — so no game could obtain a loaded asset outside the engine's
  own tests.

    The barrel ships the consuming hooks, an `AssetManagerProvider`, and the state/asset/error
    type surface those calls take, including the new `NoActiveGameSessionError` the delegating
    manager now rejects with when a load runs outside an active match; its own header is the
    index of what it carries. `renderer/app/providers.tsx` now
    mounts the provider instead of the raw context, with no behaviour change. `@types/three`
    is declared as an optional peer because the barrel's `.d.ts` names three types.

    Additive throughout — nothing removed or renamed — and curated rather than open: the
    modules behind the barrel stay internal (a game may consume a manager, never build one),
    which Invariant #96 states and `chimera/no-game-renderer-internals` enforces.

- c7665c8: Add `@chimera-engine/renderer/audio`, a sixth public barrel, so a game can reach the cue /
  fade / crossfade surface at all. The verbs landed on `AudioManager` across F74, but the hooks
  that call them were renderer internals with no entry in the `exports` map, and Invariant #96
  allows a game surface only a public barrel — so the feature had no possible caller outside its
  own tests.

    The barrel ships the three hooks (`useSound`, `useMusicTrack`, `useAudioManager`), an
    `AudioManagerProvider`, the `MUSIC_PRIORITY` and `DEFAULT_FADE_CURVE` constants, and the
    full option/handle/manager type surface those calls take; its own header is the index.
    `renderer/app/providers.tsx` now mounts the provider instead of the raw context, with no
    behaviour change.

    Additive throughout — nothing removed or renamed — and curated rather than open: the
    modules behind the barrel stay internal, which Invariant #96 states and
    `chimera/no-game-renderer-internals` enforces.

- 91cb179: Add `@chimera-engine/renderer/input`, an eighth public barrel, so a game can subscribe to
  the rebindable input actions it already declares. A game could declare an action end to
  end — a default binding in its settings schema, `InputAction` metadata on
  `LoadedRendererGame.inputActions`, registration by `GameShell`, display and rebind and
  persistence in Settings > Controls, dispatch by `InputManager` — and then had nowhere to
  receive the event: `useInputAction` was a renderer internal with no entry in the `exports`
  map, and Invariant #96 allows a game surface only a public barrel. A player rebound the
  key and nothing happened.

    The barrel ships the two hooks (`useInputAction`, `useInputManager`), a new
    `InputManagerProvider` a game's own component tests can mount with its
    `InputManagerProviderProps`, and the
    `InputAction`/`InputActionId`/`InputEvent`/`InputManager` types those calls take.
    `renderer/app/providers.tsx` now mounts the provider instead of the raw context, with no
    behaviour change. `@chimera-engine/tactics` annotates its action table with the barrel's
    `InputAction` type, which is the adopter proving the subpath reaches a game surface.

    Additive throughout — nothing removed or renamed — and curated rather than open: the
    manager factory, the action registry, the key-binding repository and the binding/rebind
    types stay internal, so a game consumes the app-lifetime manager and never builds one.
    Invariant #96 states that and `chimera/no-game-renderer-internals` enforces it.

- 091a05f: Ship the sprite half of the animation system, which was authorable and CI-gated but unplayable.

    Sprite clip sheets have been declarable since F82 — `SpriteAnimationMetadata` /
    `SpriteClipDeclaration` are sim-side authoring types, `spriteAnimationEntry` builds the manifest
    entry, and `validate-assets` gates every `'sprite-sheet'` entry's sheet including the mandatory
    `frames` run. Nothing in the engine could play one: `useClipPlayer` takes a `ModelInstance`, and
    `SpriteClipBackend`, `parseSpriteAtlas` and the sprite sheet reader were all internals with no
    binding, component or atlas reader exported. A game could author a sheet CI would check and then
    had no way to put it on screen. That gap is closed.

    **New on `@chimera-engine/renderer/components/r3f`:**
    - `AnimatedSprite` — the whole path as one element:
      `<AnimatedSprite sheet={ref} clip="run" loop="loop" />` resolves the ref, measures the atlas,
      plays the clip and fires its marks. Also takes `speed`, `handlers`, `timeScale`, `position`,
      `rotation`, `scale`, `renderOrder`, `visible`, and `children` to replace the default unlit
      material.
    - `useSpriteClipPlayer(atlas, geometry, sheet, options)` — the seam under it, for a game that
      owns its own mesh and material.
    - The types `AnimatedSpriteProps` and `UseSpriteClipPlayerOptions`.

    **New on `@chimera-engine/renderer/assets`:** `useSpriteAtlas` (loads a sheet and measures its
    cells, returning them with the manager-owned texture), `useSpriteAnimationSheet` (the sprite twin
    of `useAnimationSheet`), the non-React `parseSpriteAtlas` under the first, and the types
    `UseSpriteAtlasState`, `SpriteAtlas`, `SpriteAtlasFrame` and `ParsedSpriteAnimationSheet`. No
    `exports` subpath is added; the barrel set is unchanged at eight.

    **A sprite is a `Mesh`, never a `THREE.Sprite`.** Measured against three r184: `Sprite` shares ONE
    module-level geometry across every instance in the process. Sprite playback animates by writing
    that geometry's `uv` attribute, so a single `Sprite` playing a clip would re-cut every other
    `Sprite` in the scene. `AnimatedSprite` allocates its own `PlaneGeometry(1, 1)` — whose uv is
    already the atlas's own TL/TR/BL/BR order, so cells are written straight through — and disposes it
    on unmount. The quad is therefore world-oriented rather than camera-facing; a game that wants
    billboarding rotates the mesh. Rule ONE-WRITER-PER-QUAD: two clip players over one geometry would
    fight over `uv` every frame, so the hook takes the geometry rather than allocating one and the
    element pairs exactly one with each mount.

    **The authored unit is `durationSeconds`, not fps.** A game authors a clip's length, because that
    is what every mark in the sheet is denominated against; the backend plays cells, so it takes fps.
    The new internal `spriteClipSpecs` converts as `fps = frames.length / durationSeconds`, which
    keeps the authored length exact and lands every compiled mark on the phase the game wrote. A clip
    with no usable `durationSeconds` or no usable frame run is DROPPED with a warning rather than
    given an invented frame rate — a wrong length is a silently wrong animation, where a missing clip
    is a visible one.

    Both bindings share one playback lifecycle: the declarative surface, Rule LAST-WRITER-WINS on the
    clip-speed layer, the single DEFAULT-priority frame driver and the imperative
    `ClipPlayerHandle` were extracted verbatim out of `useClipPlayer` into an internal
    `useClipPlayback`, so the mesh and sprite halves cannot drift into two contracts. `useClipPlayer`'s
    behaviour, signature and exports are unchanged. The sprite half reports through the same log
    bridge (Invariant #67) under a named `SpriteClipPlaybackError`, follows the authoritative time
    dilation by default, and carries no dispatcher on any handler — Invariant #132 holds for it by the
    same absent parameters.

    `validate-assets` now matches `useSpriteAtlas(...)` in its on-demand ref scan alongside `useAsset`
    and `useModelInstance`, so an undeclared sprite ref passed to the HOOK is a CI-blocking error.
    A ref that reaches the engine only as the `<AnimatedSprite sheet={ref}>` JSX prop is **not**
    scanned — `AnimatedSprite` is the first engine component to take an `AssetRef` as a prop, and the
    Invariant #52 scan matches call expressions only. That is a known gap, recorded in the invariant's
    own text; a JSX-prop matcher is follow-up work, not something this change delivers.

- 7fbbbef: Add `useAnimationTimeScale` to the public r3f barrel (`@chimera-engine/renderer/components/r3f`)
  and make authoritative time dilation reach every mounted clip on its own (F82).

    A host that dilates a match sets one optional integer on the snapshot,
    `timeScalePermille` — 1000 is real time, 250 quarter speed. `GameShell` now mounts an internal
    `TimeScaleBridge` that carries that integer into a one-float renderer store, whose multiplier
    is derived only through the shared `timeScaleMultiplier`, so the host's beat period and the
    renderer's clip rate stay reciprocal by construction and the `[50, 4000]` clamp plus the
    fractional-permille refusal keep a single definition (Invariant #130). The bridge is the store's
    sole writer, takes the permille as a prop, and carries nothing back (Invariant #131). No
    `exports` subpath is added; the barrel set is unchanged at eight.

    `useClipPlayer` follows that multiplier by default, so a dilated match slows every clip with no
    wiring in the game at all; `options.timeScale` still overrides it for a clip that must ignore a
    global slow-motion. `useAnimationTimeScale()` returns the same multiplier as a plain number, and
    is what everything a game animates by hand — a camera tween, a particle rate, a shader uniform,
    a HUD countdown — opts in with. **Clip playback is what dilates, never the R3F clock:** the clock
    feeds `PerfProbe`, and scaling it would make the performance HUD report a frame rate the player
    never saw.

    **Rule ONE-MIXER-PER-ROOT is now reported rather than only documented.** `useModelAnimation` and
    `useClipPlayer` each own an `AnimationMixer`, and two of them bound to one model root advance
    the same actions twice a frame — the clip plays at a multiple of its speed and every wrap is
    miscounted, with no other symptom. Both hooks now claim the root in an internal per-root
    registry for exactly as long as they hold a mixer, and a root still carrying two of them one
    frame later produces a named `DuplicateMixerBindingError` through the renderer log bridge,
    naming both binders. Logged, never thrown (Invariant #67): R3F's `ErrorBoundary` re-throws
    outward past the `<Canvas>`. A pair that merely overlaps and resolves — one of the two
    unmounting before the frame — is not reported, and neither is a StrictMode remount.

- 9a4ba4c: `/game` and `/replays/player` now hold their REVEAL until the critical asset preload has
  settled, instead of showing a scene whose textures and audio are still arriving. Both
  routes mount `GameShell` exactly as before — the gate withholds the sight of the scene,
  never the mount, because `GameShell` is the unique disposer of the manager those routes
  inject (Invariant #21).

    What an adopter sees while the gate waits: on `/game` the app-level screen fade stays
    where it was and a loading cover renders over the mounted shell; on `/replays/player`
    the cover renders inside the playfield, with the transport controls live above it. The
    cover is the §4.36 one a game already declares through `loadingScreen` /
    `loadingScreens`, resolved for the entering scene's default screen key, so a game that
    declares no cover is visually unchanged apart from the delayed reveal.

    The wait is bounded by `CRITICAL_ASSET_PRELOAD_BUDGET_MS` (8 s) and it fails open: a
    rejected critical load, an elapsed budget, and a game that declares no manifest all
    reveal the scene. The gate reports under the `asset-preload-gate` module: the elapsed
    budget as a warning, and a ref the scene promotion alone made critical as an error
    naming that ref. A ref already critical in the manifest is reported by the match-level
    run instead.

    A scene's declared `requiredAssets` gate a route entry too, read off
    `BaseGameSnapshot.sceneRequiredAssets` and promoted to critical for the run — which is
    what makes a restore or a replay entered mid-scene wait for that scene's own refs.

    New export: `emitRendererWarning` in `renderer/logging/rendererLogger.ts`, the warn-level
    twin of `emitRendererError` for a condition with no `Error` behind it.

### Patch Changes

- 503dd92: Publish asset-fact readers for game tests at a new
  `@chimera-engine/electron/test-support` subpath, and ship a wired asset manifest plus a
  full-bleed scene host in the blank scaffold template.

    **`@chimera-engine/electron/test-support`.** `chimera-validate-assets` checks that a
    declared ref resolves to a file that EXISTS (Invariant #52 is membership-only) and that a
    cue sheet is internally coherent (Invariant #125). Neither opens the file. So the class of
    defect where a manifest and its bytes disagree — an authored `durationSeconds` that is not
    the clip's real length, a re-exported model that dropped the bone a screen poses by name, a
    container truncated by a bad copy — is invisible to the build and surfaces as a mis-timed
    cue or an empty scene at runtime. Binary assets make this worse than ordinary drift: a
    `.wav` or `.glb` cannot be diffed or grepped, so every claim about one is prose until
    something parses it.

    ```ts
    import { assetPathForRef, readWavFacts } from '@chimera-engine/electron/test-support';

    const wav = readWavFacts(assetPathForRef(here, myAudioRefs.theme));
    expect(wav.durationSeconds).toBe(myMusicCues.durationSeconds);
    ```

    `assetPathForRef` maps a declared ref onto its path under the game's own `assets/`
    (Invariant #97), resolving the grammar through the engine's own `parseAssetRef` so it
    cannot drift from the runtime resolver — including the traversal rules. `readWavFacts`
    walks the RIFF chunk list rather than assuming the canonical 44-byte layout (a re-encode
    may splice `LIST`/`fact` ahead of `data`) and refuses to hand back samples for an encoding
    it cannot read, instead of quietly pairing bytes into a plausible number.
    `readGlbDocument` parses the glTF JSON chunk at its declared length, never to
    end-of-file. A malformed container raises `MalformedAssetFileError` naming the path and
    what disagreed.

    The module imports no test framework: `expect` would make it unpublishable, since
    `verify:publish`'s depcheck fails a published `.js` importing an undeclared runtime
    dependency and `vitest` is a root devDependency only. Tactics adopts it as the reference
    consumer, and now asserts what `showcase-rig.glb` actually declares — its unlit extension,
    the `top` bone its showcase poses by name, its embedded buffer and its authored quad
    extents. The model-instances e2e already reddened on three of those four, by launching
    Electron and comparing a pose attribute or a pixel; these read the fact off the bytes and
    name it.

    **The blank template now ships `asset-manifest.ts`.** Empty (`entries: []`), with a
    commented worked example, and — the part that matters — already forwarded through
    `renderer/loaders.ts`. `LoadedRendererGame.assetManifest` is optional, so a game that never
    returns one compiles, typechecks, lints and passes `validate:assets` clean, then rejects
    every asset load at runtime with `UnknownAssetManifestEntryError`. Wiring it from the start
    means an author's first asset is one array entry. It ships with a manifest test written as
    loops over `entries`, so it costs nothing while empty and starts checking refs, scoping and
    container validity at the first declared asset — rather than pinning the manifest empty and
    reddening the moment someone follows its instructions.

    `verify:scaffold` grew the matching non-vacuity arm: `Checked 0 asset refs` is
    byte-identical to what a tree with no manifest reports, so the gate now plants one valid
    entry into the scaffolded manifest and requires the count to move — proving discovery at
    the exact basename, that `entries` is a literal the tool can walk, and that the ref
    resolves into the app's own asset directory.

    **The scaffold ships `ai/`, `data/` and `components/`, held open by a `.gitkeep`.** These are three
    of the canonical game directories `apps/tactics` grew into that previously carried no day-one
    file, so a scaffolded game simply did not have them — the copier emits files, and an empty
    directory is not a file. Shipping them costs nothing at build time (a directory holding only
    `.gitkeep` is invisible to ESLint and to `tsc`, which select by extension) and it puts an
    author's first agent policy, content payload or reusable component where the guards already
    expect it: an `ai/` module is inside the `chimera/no-fromfloat-in-simulation` zone from its
    first line — in both scaffold modes — rather than after someone notices the directory should
    have existed. (A `--workspace` game inherits more than that from the monorepo's root config;
    the standalone preset is the narrower of the two, and `curated-rules.ts` records which
    `chimera/*` rules it withholds, with a reason per rule.)

    `components/` carries one split worth stating, now documented in the scaffold README:
    `screens/` holds only what the screen registry names, and everything those screens are built
    from — shared React, shared hooks and stores, and the in-Canvas `three` / `@react-three/fiber`
    primitives — goes in `components/`. The `<GameCanvas>` itself stays in the screen, which
    renders the primitives as its children.

    **The scaffolded playfield is now a full-bleed scene host.** `position: absolute; inset: 0`
    on the screen's root element, which is where a `<GameCanvas>` goes. This fixes a real
    failure: sized the obvious way, with `block-size: 100%`, the canvas renders into a short
    strip at the top of a full-screen window — no error, no warning, and it reads as a broken
    camera rather than a broken layout. The mechanism is written out in
    `docs/core-components/camera-system.md` §4.22 "Sizing the wrapper"; the host geometry it
    turns on is now pinned by `GameShell.test.tsx`.

    The renderer change is documentation: `GameCanvas`'s `className` JSDoc described the
    failure as "zero-height", which understates the common case, and
    `docs/core-components/camera-system.md` stated the wrapper requirement only under its
    multi-canvas/overlay heading. Both now state the rule and the real failure for every canvas
    role, as does the `PlayfieldScreen` example in `docs/architecture-overview.md` — which
    showed `<GameCanvas>` as a bare screen root and reproduced the strip verbatim if copied.

- e1d1696: Two more caller-supplied callbacks are guarded where they are dispatched: the scene preload's
  report on the not-measured path, and `AssetPreloader.preloadCritical`'s forwarded
  `onEntryFailure`.

    `startScenePreload` reports `1` and returns synchronously when a transition has no manager, no
    manifest or no declared refs. That call was raw, beside a per-ref sibling in the same function
    that already wrapped its own — unguarded, a throwing callback took `startScenePreload` itself
    down and left the caller with no run to await.

    `AssetPreloader.preloadCritical` forwarded `onEntryFailure` to the manager unguarded, one line
    below the `onProgress` it wrapped and on the same premise: the forwarded callback runs inside
    whichever `AssetManager` the wrapper was handed, and `AssetManager` is on the public
    `@chimera-engine/renderer` assets barrel, so a game can implement one. `DefaultAssetManager`
    guards its own dispatch; another implementation need not.

    Both forwards stay conditional, so a manager still receives `undefined` for a channel its caller
    did not register rather than a callback the wrapper synthesised.

- 3e3e571: Fixed `AssetManifestEntry.priority: 'critical'` having no runtime effect. `AssetPreloader`
  and `AssetManager.preloadCritical` both shipped, and neither had a caller anywhere in the
  renderer's runtime path — so a critical entry behaved exactly like a deferred one and
  decoded on first use. For a music bed that means a fade-in, or a crossfade, scheduled
  against a buffer that has not arrived; nothing warns, because `AudioManager.play()`
  swallows a slow load.

    The preload now runs through the new `criticalAssetPreload` module.

    Properties of that call that callers can rely on:
    - **Commit phase, never render.** It cannot move into `createAssetManager` beside the
      construction-time `registerManifest`: StrictMode discards one of the two managers
      `useRendererGameAssetManager` builds in `useMemo`, and that orphan is tolerable only
      because it is inert. A preload at construction fills it with decoded audio and GPU
      textures no dispose path can reach.
    - **Owned by the effect that owns the manager.** A surface allocating its manager inside
      an effect calls `startCriticalAssetPreload` from that same effect. React runs every
      cleanup before every setup, so a separate effect's setup would read the previous manager
      out of state — the one just disposed — and cache into it; `dispose()` empties a
      manager's maps without making it refuse work.
    - **Non-blocking.** The owning surface renders its subtree while the preload runs, and a
      child that loads the same ref first is served the same in-flight promise — the warm-up
      never costs a second fetch and never gates a frame.
    - **Non-fatal.** A rejected critical load is reported through the renderer logger and
      dropped, leaving the deferred on-demand path intact. A teardown-time rejection (the
      owner disposing the manager it owns) reports nothing.

    Two consequences worth naming for adopters. A `GameShell` handed a manifest with a
    critical entry and **no** `assetManager` now reports its fallback manager's unconfigured
    resolver, where it previously stayed silent — that combination can never load anything.
    And any route mounting `GameAssetSession` with a manifest now pays for that manifest's
    critical entries, whatever the route renders: in this repo the Tactics `/model-showcase`
    route fetches and decodes the two ambience beds it does not use.

    Scene-level `requiredAssets` promotion (`markRequiredAssetsCritical`, the
    `TransitionOverlay` progress gate) is a separate arm; the scene transitions doc
    covers it.

- 4af36f7: A caller's `onProgress` callback throwing no longer abandons the critical asset preload or
  replaces the run's outcome with the callback's error.

    `onProgress` is on the `AssetManager` interface, which the public `@chimera-engine/renderer`
    assets barrel exports, so a game can pass one. `DefaultAssetManager.preloadCritical` called it
    unguarded at both of its sites: the per-entry fraction inside the settle-all loop, where an
    escaping throw left every entry after it to load on demand and rejected with the callback's
    error instead of `CriticalAssetPreloadFailedError`; and the terminal `1` on the
    no-critical-entries return, where a throw rejected a run that had nothing to load. That is the
    abandonment shape the settle-all removed, reachable through the sibling of the callback it
    guarded.

    `AssetPreloader.preloadCritical` guards its own calls too. Its terminal `1` runs after
    the manager resolved, so no guard inside the manager covers it, and its filtered forward runs
    inside whichever `AssetManager` the wrapper was handed.

    Each guard swallows per call rather than muting the callback for the rest of the run, and a
    failing ref still rejects with the aggregate naming the refs.

- 0b6d3af: Packaged builds no longer bundle the Runtime Debug Layer (§4.12, Invariant #27).

    #885 made the debug gate permanently false in a distributable, but the code behind it still
    shipped: the packaged main bundle was only 69 bytes smaller than the dev one. Three exclusions
    now keep the layer out of the artifact entirely.

    The main-process graph leaves the bundle. `electron/main/index.ts` gated the debug bridge on the
    imported `IS_DEBUG_MODE`, and esbuild does not propagate a cross-module constant into a consuming
    module — so the branch stayed live and `debug-bridge`, `SnapshotInspector`, `SnapshotRingBuffer`,
    `SnapshotDiff` and the `chimera:debug*` handlers were all bundled. The gate now inlines the same
    expression, which the existing packaged `define` folds to `if (false)`, and esbuild prunes the two
    dynamic imports with it: `dist/electron/main.js` loses roughly 30 KB, with none of the graph's marker
    strings left. The duplication of the expression is pinned by a drift test, because divergence would
    silently restore the shipped graph.

    The Inspector preload is no longer emitted. `buildAppBundles` plans no `debug-preload` spec when
    `CHIMERA_PACKAGED_BUILD=1`, so `dist/preload/debug-api.js` (532 KB) and its 1.06 MB sourcemap are
    no longer produced. This does not change the size of a distributable — electron-builder's `files`
    allowlist already named `dist/preload/api.js` only — but it keeps the largest debug artifact out
    of the packaging build's output tree, and out of any distributable whose `files` list an adopter
    later widens. The check applies to the resolved entry, so it covers the packed-sibling fallback a
    scaffolded game's packaging run takes, not just the monorepo source path.

    The Inspector UI route is gated. `renderer/app/debug` gained a `debugRouteGate` and a server
    wrapper that calls `notFound()` in packaged builds, matching the existing component-gallery and
    replays gates — the route previously shipped ungated in the static export, and now prerenders to
    the 404 page with no Inspector markup. As with the gallery gate, Next still emits the route's
    JS chunk; nothing loads it, but this closes a reachable route rather than removing bytes.

    Dev and e2e builds set none of these flags and are unchanged; F9 still opens the Inspector. The
    #885 startup guard and `define` are untouched — this is subtraction of unreachable code, not a
    replacement for either control.

- 77b229d: Fixed the music bed going silent in every match after the first one of a session.
  `GameShell` now registers the match-level `AssetManager` with the app-level
  `DelegatingAssetManager` **during render** rather than only in a passive effect.
  React flushes mount effects children-first, so a screen that starts a voice in its
  own mount effect — which is what `useSound` is for — reached the delegating manager
  while the delegate was still `null`; the load rejected `NoActiveGameSessionError`,
  and `AudioManager.play()` swallows a rejected load, so the bed was silent with
  nothing in the log. A `React.lazy` screen hid this on the first match only: it
  suspends once and mounts a commit late, by which time the effect has run, then
  renders synchronously from the resolved payload for every match after that.

    The effect still owns the binding for the life of the mount — it re-registers on
    setup, because StrictMode's simulated remount runs cleanup → setup with no render
    between them, and clears the delegate on unmount as before.

- aa910b0: `loadRendererGame` and `loadRendererGameShell` now run a loaded shell's asset warm-up — its
  `fonts`, `preloadImages` and `cursor` textures — on a budget instead of awaiting it without a
  ceiling. `GAME_SHELL_WARMUP_BUDGET_MS` (5 s) releases the load when those fetches have not
  finished, and warns under the `game-registry` module with the game id and the steps still
  outstanding: the one in flight, and the ones it never let start.

    Why it matters to an adopter: this warm-up is awaited BEFORE either preload budget starts
    (`CRITICAL_ASSET_PRELOAD_BUDGET_MS`, `SCENE_PRELOAD_BUDGET_MS`), so a `chimera://` fetch that was
    never answered used to hold a route in a state neither of those could reach — on `/game` that is
    the black screen the lobby→game fade leaves behind, with nothing to release it. This budget and the
    route-entry gate's are sequential, and 5 s + 8 s stays strictly under the 15 s a game-route e2e
    allows the canvas.

    Failing open costs a frame of fallback: a warmed image is a decode the first paint would have done
    anyway, and a cursor token left unwritten is the engine's stock cursor. A warm-up step that REJECTS
    still rejects the load, unchanged — that is a settled outcome and it already reaches the player as
    the crash fallback.

    Not covered, and recorded rather than fixed: the game's own dynamic `import()` above the warm-up.
    An absent `GameScreenRegistry` has no degraded form, so the only settle a budget could add there is
    a throw, which would turn a slow module into a refused route. Its chunk `<script>` is bounded by
    the bundler (120 s, then a `ChunkLoadError` rejection); the stylesheet sibling of that chunk is
    bounded by nothing, so a route entry still contains one unbounded wait. See
    `docs/core-components/asset-reference-system.md`.

    New export: `GAME_SHELL_WARMUP_BUDGET_MS` from `@chimera-engine/renderer/game`.

- 63335a1: `GameShell`'s session-end `AssetManager` disposal is now StrictMode-root safe.
  The dispose is deferred one microtask and cancelled when the effect re-runs for
  the same manager, so a dev double mount (React StrictMode at the root) no longer
  disposes the manager between the simulated mounts — previously that emptied the
  manifest out from under the second mount's children-first loads, latching every
  non-lazily-mounted child's `useAsset` load on `UnknownAssetManifestEntryError`,
  and destroyed a
  page-injected manager the page still held. A real unmount still disposes exactly
  once, and a manifest-identity rebuild still disposes the replaced fallback
  manager (Invariant #21 unchanged: `GameShell` remains the unique disposer of the
  match-level manager).
- 23c6cbd: The renderer logging bridge is now installed before the **first** renderer log, and an `Error` handed
  to it keeps its stack. Both defects made diagnostics the renderer already emits either vanish or
  arrive unusable in the log file a packaged binary leaves behind (§4.27, Invariant #67).

    The renderer has no injected `Logger`. Unlike `electron/main` — where the invariant is backed by a
    `no-console` ESLint zone — `installRendererLogger` _patches_ `console.warn` and `console.error` and
    forwards over `window.__chimera.logs`. In `renderer/**` those two methods therefore **are** the
    sanctioned channel, and the interception model has failure modes the main-process rule has no
    equivalent for: a call the bridge never saw, and a call it saw but could not carry.

    **Installed before the first render-phase log.** The install ran in a `useEffect` in `LoggingBootstrap`,
    which `AppShell` mounted _inside_ `<Providers>`. React runs a parent's render strictly before any
    child's effect, so everything `Providers` logged while rendering escaped the patch entirely. That
    was not hypothetical: `createAudioManagerForEnvironment` warns from a `useMemo` initializer when Web
    Audio init fails, then falls back to a noop audio manager. The fallback protects the app, so a player
    whose audio failed ran a silent game — and the one line saying why reached devtools and never the log
    file. Nothing in the record said the app had gone quiet.

    Hoisting alone would not have fixed it: React commits _all_ effects after the whole tree has
    rendered, so an effect-scoped install is late wherever it is mounted. `<LoggingBootstrap />` is now
    `AppShell`'s **first child**, outside `<Providers>`, and installs **during its render**. Because the
    install left effect scope it also has to survive React's StrictMode remount — every Next host in the
    tree sets `reactStrictMode: true` (`apps/<game>/renderer/next.config.ts` and the scaffold template),
    which runs mount → cleanup → mount, and the render-phase call does not run a second time — so the
    effect re-arms the bridge as well as owning its teardown. The install stays idempotent, is
    refcounted across multiple mounts, and its teardown stays exact (console methods restored, window
    listeners removed).

    The guarantee is bounded at React: client-bundle **module evaluation** — including the
    `chimera-game-registration` side-effect import that runs an adopter's `register.ts` as the bundle
    loads — precedes every render and sits outside the bridge. Module-scope code must not log expecting
    forwarding; anything it emits reaches devtools only.

    Ownership is single-sourced. `installRendererLogger` returns `null` — not a no-op teardown — when
    the bridge is already installed, so a caller can never claim (and later run) a teardown it did not
    create. A no-op return would read as ownership, and a stale claim to it survives Fast Refresh
    (`LoggingBootstrap.tsx` re-evaluates, resetting its module-scope claim, while `rendererLogger.ts`
    keeps its `installed` latch) and would block every future re-install while reporting success. The
    bootstrap also clears its claim before invoking the teardown, so a throwing teardown cannot leave a
    stale claim behind — pinned by `LoggingBootstrap.guard.test.tsx`.

    **An `Error` argument keeps its stack.** `argsToMessage` mapped every non-string argument through
    `String()`, and `makeEntry` was called with no `error`, so `console.error('…', err)` produced a
    `LogEntry` with `error: undefined` and a message ending in a bare `Error: <message>`. The stack — the
    one thing that makes a renderer error actionable — was gone before the entry left the renderer. The
    first `Error` among the arguments is now threaded into `LogEntry.error` as `{ name, message, stack }`
    and **removed from the composed `message`** — its detail travels once, in the `error` field, so the
    main-process logger does not print the same text twice. The remaining arguments compose `message`
    unchanged (string-only call sites read exactly as before), and an `Error` that is the only argument
    becomes the message (`name: message`). This also brings a path that was already built for it to
    life: the main-process `chimera:logs:emit` handler reconstructs an `Error` from `entry.error` for
    `error`/`fatal` levels, which until now only `RootErrorBoundary`'s direct `emitRendererError` call
    ever populated.

    **Oversized fields cost characters, never the entry.** The `chimera:logs:emit` handler drops an
    entry that fails schema validation rather than truncating it, so the renderer truncates first:
    `serialiseError` caps `error.name`/`error.message`/`error.stack` at 256/4096/8192 characters, the
    composed `message` at the schema's existing 4096, and `source.module` at 256. On the electron side
    `LogErrorInfoSchema` and `RendererLogSourceSchema` now enforce the same caps, so every string field
    the schema **names** is bounded at the boundary (§9.1) — `error` previously arrived only from
    `RootErrorBoundary`, once per crash; now every patched console call carrying an `Error` sends one,
    so the unbounded fields became reachable at volume. On the renderer channel an oversized field at
    the boundary means a producer that bypassed the bridge, and the entry is dropped like any other
    malformed payload. The two cap sets cannot share a constant across the electron/renderer boundary,
    so an e2e spec (`renderer-logging.spec.ts`) drives an entry with every page-drivable capped field
    oversized — composed message, `error.name`, `error.message`, `error.stack` — through the real chain
    and asserts it arrives truncated, never dropped. Each side's unit tests pin its own literals, so a
    unilateral cap edit fails that side's suite; the e2e is what catches a **coordinated** edit — a cap
    moved together with the literals in its own test — which otherwise leaves the two sides disagreeing
    with everything green. `source.module` is the exception: no page-reachable route produces a
    caller-supplied module (the console routes pass the `'global'` literal, and `emitRendererError` is
    not on `window`), so its agreement rests on the two unit suites and the coordinated-edit gap stays
    open for that field alone. `context` is the one field left unbounded, and stays so deliberately: it carries arbitrary
    structured diagnostics, and a size budget would mean serialising every entry to measure it. The
    schema bounds its shape and not its extent, so an oversized `context` cannot cost an entry — but the
    window handlers' `context.stack` is truncated to the same 8192 regardless, so every string the
    bridge itself composes is bounded, not only the ones a validator would reject. The shape half has a
    consequence worth stating, since it is the drop rule read backwards: a `context` that is not a
    record costs the **whole entry**, silently. §9.1's `logs` row now records all of this, caps and
    exception both.

    `console.log` remains deliberately **unforwarded** (PII/volume hygiene). A call site that needs a
    durable record moves up to `warn`/`error`; it does not get `console.log` hooked. The regression test
    pinning that policy predates this change and stays in place; §4.27 now cites it explicitly so a
    later "the bridge should catch everything" change has to fail a test rather than quietly reverse it.

    Ordering is pinned by test rather than by comment, since the defect _was_ an unpinned parent/child
    ordering assumption: `renderer/app/AppShell.test.tsx` runs the real patch and asserts that
    `Providers`' render-phase AudioManager warn reaches a `logsApi` stub, and separately that a log
    emitted _after_ StrictMode's remount still forwards — the render-phase warn fires before any
    StrictMode cleanup, so only a post-render log can prove the re-arm. Moving `<LoggingBootstrap />`
    back inside a provider, or back into an effect, fails a test instead of silently dropping logs
    again. `renderer/app/LoggingBootstrap.ssr.test.tsx` additionally pins that the render-phase install
    stays inert during the static-export prerender, where `window` does not exist — a regression there
    would fail `next build`, which no jsdom test observes.

    Adopter-visible in what the log file contains. A game whose renderer never warns before its
    providers settle sees no change in coverage; one that does now has the entry, with its stack. Log
    _format_ changes in one respect: an `Error` passed to `console.warn`/`console.error` no longer
    appears stringified inside `message` — its text lives in the entry's `error` field (and, for
    `error`/`fatal` levels, in the reconstructed `Error` the main logger receives), so lines that
    previously ended in `… Error: <message>` now carry that detail structurally.

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

- Updated dependencies [0243537]
- Updated dependencies [b53c262]
- Updated dependencies [f59644e]
- Updated dependencies [a2f7d10]
- Updated dependencies [8f6e8fd]
- Updated dependencies [6b600c2]
- Updated dependencies [88680bb]
- Updated dependencies [c4d095d]
- Updated dependencies [1655193]
- Updated dependencies [6cd3bbd]
    - @chimera-engine/simulation@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.4

## 1.0.0-rc.3

### Minor Changes

- Added a `gallery` glyph (2x2 rounded-tile grid) to the engine icon registry and
  switched the main-menu component-gallery button to a borderless ghost `IconButton`
  using it, dropping the now-dead `.component-gallery-icon` CSS.

### Patch Changes

- Silenced a spurious AudioManager console warning during static-export prerendering.
  `createAudioManagerForEnvironment` now returns the noop audio manager behind a
  `typeof window` guard when no `AudioContext` is available (Next static export runs
  `Providers` once per route in Node), matching the SSR guards already used in the
  providers module. The warn path is preserved for genuine client-side failures.
    - @chimera-engine/simulation@1.0.0-rc.3

## 1.0.0-rc.2

### Minor Changes

- Modernized the multiplayer lobby UI: seats now toggle ready via an icon control (backed by
  a new `check` glyph in the engine icon set), AI seats are merged into the roster, and the
  lobby banner and summary gain a frosted backdrop. Tactics adopts a two-column lobby layout
  on top of the shared renderer changes.
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

- Settings sections with nothing to change now show an empty-state message
  (`engine.settings.noSettings` → "No settings available."), mirroring the existing
  `noControls` behaviour. `SettingsTabPanel` is now data-driven via a `settingsItemWillRender`
  predicate — "empty" means every item renders null (e.g. the language selector self-hides
  below two languages), not merely a zero-length item list. `useDeclaredLanguages` is now
  ready-aware and exported so the section can gate without flashing.

### Patch Changes

- a68c5ba: The boot logo screen now hides the OS mouse cursor while it plays. `LogoVideoScreen` routes its cursor through a new `--ch-cursor-hidden: none` design token (kept in the `--ch-cursor-*` family so it stays game-overridable); every other screen keeps its system/game cursor unchanged.
- 4ce48c4: The shared `Modal` overlay now supports a token-driven backdrop blur. A new `--ch-overlay-backdrop-blur` design token feeds `backdrop-filter: blur(...)` on the overlay; it defaults to `0` (no blur, unchanged plain scrim). Tactics overrides it to `8px`, frosting the shell that shows through its semi-transparent modal scrim.
- Updated dependencies [7f237bb]
- Updated dependencies
    - @chimera-engine/simulation@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- M10 — first public release (`1.0.0`). Adopt the locked `1.X.Y` versioning scheme: every
  `@chimera-engine/*` engine package and the `create-chimera-game` initializer now share one
  version and re-publish together. This bump retires the independent `0.x` per-package semver
  and aligns the whole first-party set at `1.0.0`. Previewed on npm as `1.0.0-rc.0` under the
  `rc` dist-tag before the final release.

### Patch Changes

- 3250d73: `LogoVideoScreen` now skips on key press only — a mouse click no longer dismisses the brand/logo screen. The skip-on-input wiring drops its `window` `'click'` listener and keeps `'keydown'`; the watchdog timeout, video `ended`/`error`, and autoplay-rejection exit paths are unchanged.
- a8b5cb6: Close out F72 Spectator Mode (feature-review gate). Land the carried-over
  correctness fix from the #881 review: `renderer/app/game/page.tsx` now derives
  `isHost = false` for a spectator, so a spectator that follows the host's seat
  (and therefore projects `viewerId === hostId`) is no longer mistaken for the
  host — keeping the deterministic-replay export host-only (Invariants #71 / #98 /
  #114). Adds the end-to-end Playwright spec proving admit-as-spectator, the
  read-only followed view, the out-of-band perspective switch, and both mid-match
  reject reasons (`spectators_disabled`, `match_in_progress`), plus the new
  Spectator Mode Contract doc and the ratified invariants #114 (read-only viewers)
  and #115 (out-of-band `SPECTATE_TARGET_UPDATE`).
- Updated dependencies [e9f122f]
- Updated dependencies
- Updated dependencies [da1f1cd]
    - @chimera-engine/simulation@1.0.0-rc.0

## 0.10.0

### Minor Changes

- 5673e65: Add the `--ch-cursor-*` token family and route every engine cursor style through it (F69). `--ch-cursor-default: auto` and `--ch-cursor-pointer: pointer` join the existing `--ch-cursor-disabled` in `styles/tokens.css`; `styles/globals.css` applies the default token at the document root (cursor inherits, so shell chrome and the R3F canvas share one cursor set), and engine UI modules plus the default theme reference `var(--ch-cursor-pointer, pointer)` instead of hardcoding `cursor: pointer`. Behaviour-neutral with no overrides — computed cursors are identical to before; games may now legally override the cursor tokens (Invariant #85), which the hardware-cursor registry plumbing will use to inject `url(chimera://…)` values.
- c52b3f7: Wire game cursor declarations through the renderer game registry and inject hardware-cursor token overrides (F69). `LoadedRendererGameShell` gains an optional `cursor` field — the game's `GameManifest.cursor` declaration forwarded verbatim — and `loadRendererGame`/`loadRendererGameShell` now run a shell-internal injector as a registry-init side-effect (Invariant #93): each declared texture is resolved through the game-asset protocol (`chimera://renderer/game-assets/…`, Invariant #97), pre-decoded via the existing image warm-up seam so the first paint never flashes the system cursor, and written over the engine's `--ch-cursor-<role>` tokens as `url(<resolved>) <hotspot-x> <hotspot-y>, <role-fallback>` (fallbacks: `auto`/`pointer`/`not-allowed`). Game-relative texture paths are validated against the same local-game-asset policy as font and preload-image refs — absolute paths, protocol-relative URLs, and URL schemes are rejected before the path is joined with the game id. No declaration ⇒ strict no-op; the injector stays shell-internal (no new barrel export, Invariant #96).
- abdd11d: Ship the engine default logo screen (F70). New in the `components/ui` barrel: `LogoVideoScreen` (full-window stretched video that reports `onDone` exactly once on the first of: watchdog timeout, video `ended`, any click/keypress skip, or video `error`) and `LOGO_VIDEO_DEFAULT_DURATION_MS` (10 s watchdog). New shell page at `shell/logo-screen/page` — the engine's hard-coded boot logo flow that hands off to the main menu preserving `?gameId=` — for adopting games to re-export, plus the committed `public/chimera_logo.mp4` placeholder stub (adopting hosts commit their own copy). The renderer CSP now includes `media-src 'self'`.
- ea837b1: Unify keyboard-focus (`:focus-visible`) styling across the UI kit. All interactive primitives now draw their focus indicator at or inside the border-box — bordered components recolor their border to `--ch-focus-ring-color` (plus a transparent inset outline for forced-colors modes), borderless ones draw a visible inset outline — so scroll containers can never clip the indicator (previously the Tabs tablist clipped the offset halo ring into a stray sliver). `Button` and `Slider` gain focus styles they previously lacked, and all components now share the single `--ch-focus-ring-color` token, which defaults to `--ch-color-text-secondary` (distinct from the accent-hover color that already paints active tab chrome and primary button borders) and is intended to be overridden per game. The now-unused `--ch-focus-ring-offset` token is removed.

### Patch Changes

- 26da224: Fix "Return to lobby" doing nothing after a match ends (from the post-game summary or the post-game replay).
    - `@chimera-engine/simulation`: the `ActionPipeline` terminal-match gate now allows `engine:return_to_lobby` after a `gameResult` is recorded. It is the host-only abandon-to-lobby reset (the reverse of `start_game`) and does not mutate the recorded result, so it must not be rejected alongside gameplay/turn/undo actions — otherwise the host can never leave a finished match back to the lobby.
    - `@chimera-engine/renderer`: the in-game menu's leave action is now injectable through `GameShell` → `InGameMenuHost`, and the replay player supplies a context-aware leave (back to the lobby for a post-game replay, back to the replay library for a library-opened one). `GameStoreBootstrap` also returns to the lobby on a `phase:'lobby'` snapshot when on the replay player route, not just `/game`.

- Updated dependencies [483a4ab]
- Updated dependencies [abdd11d]
- Updated dependencies [70e4147]
- Updated dependencies [26da224]
    - @chimera-engine/simulation@0.10.0

## 0.9.0

### Minor Changes

- Initial package extraction from the Chimera monorepo (M9, F57–F66). The React / R3F
  renderer shell, store, and game-registration seam published as `@chimera-engine/renderer`,
  depending on `@chimera-engine/simulation` with React, Next, Three.js, and R3F as peers.
