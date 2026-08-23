# @chimera-engine/tactics

## 0.9.1-rc.2

### Patch Changes

- 49a69db: Add music cue observation and cue-aligned transitions (§4.25), so a game can say "do this at
  the next musical boundary" instead of only "do this now".

    Two mechanisms, and the separation between them is the feature: **observe to decide, schedule
    to execute.** `AudioManager.observeCues` and the `useAudioCues` hook deliver a voice's
    `cue` / `loop` / `end` emissions from one on-demand `requestAnimationFrame` sampler — started
    by the first observation, cancelled by the last, so a game that observes no cue pays no frame
    cost. `crossfadeAtCue` and `fadeOutAtCue` arm a transition now and execute it at the voice's
    next arrival at the named cue, through native `source.start(when)` / `source.stop(when)`
    against `AudioContext.currentTime` rather than a wall-clock timer. `secondsUntilCue` answers
    the read direction of the same timeline.

    Starting a transition from an observation callback is the mistake the split exists to prevent:
    an emission is at best a frame late, so the swap would land off the beat. The new Invariants
    #135 and #136 state each half, and `docs/core-components/audio-system.md` documents which
    mechanism answers which question.

    The audio barrel gains `useAudioCues`, the cue-event and handler types, and the two
    cue-aligned option types; `useMusicTrack`'s control object gains `crossfadeAtCue` and
    `fadeOutAtCue`. No new subpath, and no cue-authoring change — `validate-assets` and Invariant
    #125 are untouched, and existing sheets pass as they stand.

    `apps/tactics` is the reference adopter: its ambience beds now hand over at the `loopEnd` they
    already loop on, so a turn passing mid-phrase no longer cuts the music.

    The fail-soft diagnostics on the shared fade-out path now name the verb the caller invoked
    rather than always saying `fadeOut`. A crossfade's linked fade-out, `fadeOutAtCue`, and a
    cue-aligned crossfade's linkage all reach that path without being a `fadeOut` call, so an
    operator reading one had no route back to the call that produced it. Message wording only —
    no behaviour moves.

    Additive throughout — nothing removed or renamed.

## 0.9.1-rc.1

### Patch Changes

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

- bb41334: GameCanvas is now the only canvas root a game mounts (Invariant #127), and gained the curated surface the own-`<Canvas>` hatch existed to provide:
    - `className?: string` — forwarded to the r3f wrapper `<div>` for canvas chrome. r3f pins position and size as inline styles on that div, so placement and explicit size live on a game-owned wrapper element.
    - `onPointerMissed?: (event: MouseEvent) => void` — forwarded to `<Canvas>` (deselect-on-empty-click).
    - `role?: 'main' | 'overlay'` (default `'main'`) — first-class multi-canvas: an overlay (minimap, preview) mounts no `PerfProbe`, so the perf HUD keeps measuring the main scene; every role is paced by the `display.targetFps` cap. Two concurrently-mounted mains are reported by name (`DuplicateMainGameCanvasError`) through the renderer logger — logged, not thrown, deferred one frame and cancelled if the pair resolves first.

    `GameCanvasProps` stays curated: no `CanvasProps` rest-spread, and `gl`/`dpr`/`shadows`/`style`/`frameloop`/`camera` pass-through is rejected at the type level. The tactics demo board's corner minimap is the reference overlay adoption.

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

- 76f546d: **A game app's `scene/` is now `components/`, and it holds every reusable piece of the game's UI — not only the parts that render inside the Canvas.**

    `scene/` named a technology. The split it produced ran along the wrong seam: a mesh went in `scene/`, but a shared React panel, a hook two screens had to agree on, and an ambience component that only ever plays audio all had nowhere to go and piled up in `screens/` next to the registry entries. `screens/` was reading as "React UI" when what it actually contains is the set of components the `GameScreenRegistry` names.

    The new line is about reuse, not about rendering target:
    - **`screens/`** — only what the screen registry names: playfield, HUD, in-game menu, post-game summary, result banner.
    - **`components/`** — everything those screens are built from. Shared React components, shared hooks and stores, and the `three` / `@react-three/fiber` primitives a screen renders as children of its `<GameCanvas>`.

    In `apps/tactics` that moved the whole former `scene/` (ground plane, minimap, unit primitive, selection ring, camera and scene model, the model showcase) plus `TacticsAmbience` and `useCommitmentBuffer` out of `screens/`. The blank template's growth directories are now `ai/`, `data/` and `components/`.

    **`components/` is an Invariant #96 renderer surface.** This is the substantive rule change, and it follows from the merge: a shared component that plays a cue needs `@chimera-engine/renderer/audio` exactly as a screen does, so the old "a module in `scene/` may not import from `@chimera-engine/renderer` at all" cannot survive alongside it. `chimera/no-game-renderer-internals` now admits `apps/<name>/components/*.{jsx,tsx}` alongside `screens/` and `shell/`; the extension gate is unchanged, so a plain-`.ts` helper in any of the three is still not a surface, and every non-surface directory in a game app stays blocked whatever the extension. The invariant checker's Checks 6, 17, 23 and 24 widened to the same directory, and `chimera-validate-assets` now walks `apps/<name>/components/` for on-demand asset loads — anchored at the `apps/<name>/<surface>` position rather than added to the bare-segment set, since `components` is a name that recurs at any depth.

    One zone deliberately did **not** widen: `chimera/no-hardcoded-design-values` still reaches `screens/` only. `components/` holds the in-Canvas primitives, whose `three` material colours are not CSS values and cannot be expressed as `var(--ch-*)`, so widening the rule as written would red the directory it was widened onto. The consequence — a DOM component in `components/` has its colour and size literals unchecked — is now stated in `docs/core-components/dev-tooling.md` next to the pre-existing `shell/` half of the same gap, and in the scaffold README.

- 3fd9271: Remove the `isDefault` flag from `RendererGameContribution`, and with it the engine's notion of a default game. Game context reaches the renderer only as an external `?gameId=` (the launcher stamps it, `withShellGameId` carries it across navigation); the engine names, stores, and derives no game of its own.

    Breaking changes to `@chimera-engine/renderer/game`: `RendererGameContribution.isDefault` is gone — delete the field from your `register.ts` (scaffolds generated by `create-chimera-game` no longer emit it). `getDefaultRendererGameId()` and `NoDefaultRendererGameError` are removed with no replacement: the registry answers "load this explicit gameId", never "which game am I?". `LobbyConfig.gameId` is now `string | null`.

    Behaviour fix: the lobby was the one route that invented a game when the URL supplied none, so a lobby reached without `?gameId=` presented engine-default chrome while silently hosting the flagged default game underneath. It now resolves `gameId` from the URL alone, like every other shell route — one id drives both the host request and the shell branding, and with no game context the `Host` action is disabled (joining is unaffected, since the host's response carries the game). `useActiveShellGameId` drops its lobby-route carve-out, which existed only to defend against that invented default.

    Two further places where the game-agnostic renderer named a concrete game are fixed. `SaveStoreBootstrap` defaulted its game id to the literal `'tactics'` and is mounted propless in the root layout, so every route — including a game-less `/main-menu` — issued `saves.list('tactics')` over IPC; it now takes the active shell game id and stays unwired when there is none. The replays page fell back to `'tactics'` when the URL carried no `?gameId=`; it now lists nothing, which also removes the two call sites that re-resolved the URL specifically to dodge that fabricated fallback.

    Unchanged: the engine defaults a game opts into by contributing no shell — the default main menu, settings, lobby, and background a fresh scaffold renders. That is game context present with no customization, not the absence of game context.

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

## 0.9.1-rc.0

### Patch Changes

- Modernized the multiplayer lobby UI: seats now toggle ready via an icon control (backed by
  a new `check` glyph in the engine icon set), AI seats are merged into the roster, and the
  lobby banner and summary gain a frosted backdrop. Tactics adopts a two-column lobby layout
  on top of the shared renderer changes.
- 4ce48c4: The shared `Modal` overlay now supports a token-driven backdrop blur. A new `--ch-overlay-backdrop-blur` design token feeds `backdrop-filter: blur(...)` on the overlay; it defaults to `0` (no blur, unchanged plain scrim). Tactics overrides it to `8px`, frosting the shell that shows through its semi-transparent modal scrim.
- Settings sections with nothing to change now show an empty-state message
  (`engine.settings.noSettings` → "No settings available."), mirroring the existing
  `noControls` behaviour. `SettingsTabPanel` is now data-driven via a `settingsItemWillRender`
  predicate — "empty" means every item renders null (e.g. the language selector self-hides
  below two languages), not merely a zero-length item list. `useDeclaredLanguages` is now
  ready-aware and exported so the section can gate without flashing.

## 0.9.0

### Minor Changes

- Initial extraction into a standalone consumer app (M9, F57–F66). The tactics reference
  game that exercises the packaged `@chimera-engine/*` builds end to end. Private — never
  published; versioned alongside the engine packages it consumes.
