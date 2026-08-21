# create-chimera-game

## 1.0.0-rc.8

## 1.0.0-rc.7

## 1.0.0-rc.6

### Minor Changes

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

- 2b0aea3: The `build:app` Electron bundle plan moves into a new engine export, behind thin app-owned drivers (§4.12).

    `@chimera-engine/electron` gains a public `./build-main` subpath holding the bundle plan every
    consumer app's `build:app` runs: the packaging `define` that folds the debug gate dead
    (Invariant #27), the esbuild alias / `nodePaths` derivation, the output layout, and the bundle list.
    It is the same engine-owns-the-logic / app-owns-the-paths split as `./packaged-bundle` beside it,
    and for the same reason: the plan was previously shipped as two code-identical copies in this repo
    plus a third minted into every scaffolded game, where it froze at scaffold time. A fix to the
    `define` reached an existing adopter only if they hand-merged a file they had been told never to
    edit, and the shipped copy was invisible to every static tool here — lint-ignored, outside
    `tsconfig.json`, outside vitest — reaching the real assertions only through a single string-equality
    line.

    `apps/<game>/electron/build-main.ts` and the blank template's copy are now ~60-line drivers holding
    only what the engine must not: the app's paths, its module resolution, and esbuild itself. `esbuild`
    stays app-side and the published dependency surface is unchanged — the plan declares its own
    structural `EsbuildBundleOptions` rather than importing esbuild's types, which a new test ratchets
    in both the source and the emitted `dist` (a type-only import would erase before `verify:publish`'s
    depcheck could see it).

    `buildAppBundles` gains a plan-shaped `overrides` escape hatch — `mainEntry`, extra `alias` entries,
    per-label `external` additions, and `extraBundles` for a utility-process worker or a second preload.
    It is deliberately plan-shaped and not esbuild-shaped: no hook reaches esbuild's option set, because
    the packaged-build assertions execute the shipped invocation rather than reading it, and an
    "extra esbuild options" hook would re-open exactly the hole that closes. `verifyPackagedBundle`
    gains a matching `extraShipped`, so an extra bundle that ships is scanned for the debug layer and
    accepted in the `electron-builder.yml` `files:` allowlist instead of being rejected as unexpected.

    For scaffolded games this resolves a contradiction the template shipped: `build-main.ts` said "never
    edit it after scaffolding" while `verify-packaged-bundle.ts` said the opposite. The driver is yours
    to edit; the plan it drives is not, and now it does not have to be.

    One published type changes shape: `ElectronBuilderCheckOptions.extraShipped` is REQUIRED, not
    optional. It is the parameter type of `electronBuilderDistFailures` and `electronBuilderControlGaps`,
    which are exported for testing the predicates directly — a caller passing `{ appDir, outfiles }` now
    needs `extraShipped: []`. Nothing that drives the gate through `verifyPackagedBundle` is affected;
    that entry point keeps the field optional and normalizes it. The requirement is deliberate: it is what
    makes a re-spelled subset of the app's planned file set a compile error rather than a step that
    silently stops seeing an extra bundle.

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

- 76f546d: **A game app's `scene/` is now `components/`, and it holds every reusable piece of the game's UI — not only the parts that render inside the Canvas.**

    `scene/` named a technology. The split it produced ran along the wrong seam: a mesh went in `scene/`, but a shared React panel, a hook two screens had to agree on, and an ambience component that only ever plays audio all had nowhere to go and piled up in `screens/` next to the registry entries. `screens/` was reading as "React UI" when what it actually contains is the set of components the `GameScreenRegistry` names.

    The new line is about reuse, not about rendering target:
    - **`screens/`** — only what the screen registry names: playfield, HUD, in-game menu, post-game summary, result banner.
    - **`components/`** — everything those screens are built from. Shared React components, shared hooks and stores, and the `three` / `@react-three/fiber` primitives a screen renders as children of its `<GameCanvas>`.

    In `apps/tactics` that moved the whole former `scene/` (ground plane, minimap, unit primitive, selection ring, camera and scene model, the model showcase) plus `TacticsAmbience` and `useCommitmentBuffer` out of `screens/`. The blank template's growth directories are now `ai/`, `data/` and `components/`.

    **`components/` is an Invariant #96 renderer surface.** This is the substantive rule change, and it follows from the merge: a shared component that plays a cue needs `@chimera-engine/renderer/audio` exactly as a screen does, so the old "a module in `scene/` may not import from `@chimera-engine/renderer` at all" cannot survive alongside it. `chimera/no-game-renderer-internals` now admits `apps/<name>/components/*.{jsx,tsx}` alongside `screens/` and `shell/`; the extension gate is unchanged, so a plain-`.ts` helper in any of the three is still not a surface, and every non-surface directory in a game app stays blocked whatever the extension. The invariant checker's Checks 6, 17, 23 and 24 widened to the same directory, and `chimera-validate-assets` now walks `apps/<name>/components/` for on-demand asset loads — anchored at the `apps/<name>/<surface>` position rather than added to the bare-segment set, since `components` is a name that recurs at any depth.

    One zone deliberately did **not** widen: `chimera/no-hardcoded-design-values` still reaches `screens/` only. `components/` holds the in-Canvas primitives, whose `three` material colours are not CSS values and cannot be expressed as `var(--ch-*)`, so widening the rule as written would red the directory it was widened onto. The consequence — a DOM component in `components/` has its colour and size literals unchecked — is now stated in `docs/core-components/dev-tooling.md` next to the pre-existing `shell/` half of the same gap, and in the scaffold README.

- bf8ee26: A scaffolded game now enforces Chimera's architecture invariants on day one.

    Until now a new game shipped no ESLint config at all, so its own `lint` script was a hard
    error and every `chimera/*` rule was lost the moment the game left the monorepo — a
    `fromFloat()` in a reducer or a hardcoded hex in a screen went unflagged. The template now
    emits an `eslint.config.mjs` composing `standaloneLintConfig()` from
    `@chimera-engine/electron/eslint`, a `styles/tokens-override.css` stub under the path the
    token rule guards, a screen `*.module.css` the playfield actually uses, and a project-root `lint` script forwarding to the app — joining the four
    dev-tool forwards, for a different reason: `eslint`'s bin is already at the root, but the
    config that drives it lives in the app.

    Five rules are live from the first commit: `fromFloat()` out of `simulation/` and `ai/`
    (with test files exempt, so a fixture builder does not red), design values through
    `var(--ch-*)` tokens in `screens/` and its CSS modules, only engine-declared tokens in the
    override stylesheet, the renderer's public barrels only, and no raw r3f `<Canvas>`
    (`GameCanvas` is the only canvas root a game mounts).

    The config is emitted for a **standalone** project only. A `--workspace` game inherits the
    monorepo's root config, which is the stricter of the two; a file in the app directory would
    resolve before it and not merge with it, so shipping one there would have taken the
    `no-restricted-syntax` determinism guard, the import boundaries, `no-console` on the
    composition root and the type-checked TypeScript set away from a game living inside the
    repo — under `pnpm -r lint` and in CI, both of which run `eslint .` from each package
    directory.

    The stub overrides the accent family — base, hover and strong together, because different
    components read different members of it and moving one alone themes some of the UI and not
    the rest. It is meant to be edited; it is not
    meant to be deleted, since the token rule matches that file by name.

    The ESLint VS Code extension is now recommended, and every doc-comment claiming the scaffold
    ships no eslint config is corrected.

    Type-aware linting is deliberately off: no Chimera rule reads type information, and
    `parserOptions.projectService` reds a fresh scaffold on `electron/main.ts`,
    `electron/build-main.ts`, `electron/verify-packaged-bundle.ts` and the config itself — all
    outside the app's TypeScript program. The config says what to add to turn it on.

    `verify:scaffold` now proves both halves against an installed project: the untouched
    scaffold lints green, and a planted violation of every curated rule — including both arms of
    the design-value rule — is reported by its own rule id in its own file.

- c5b80ca: Make all four `@chimera-engine/electron` dev tools reachable from a scaffolded project's root, and fix `fetch:fonts` dying before it ran.

    The scaffolded `fetch:fonts` script documented its argument inline as `--url <google-css-url>`. A package script is handed to `sh`, which reads the angle brackets as a **redirection** — so `pnpm fetch:fonts` opened a file named `google-css-url`, failed, and reported `sh: google-css-url: No such file or directory`. The message names neither the script nor the bin, so it reads as `chimera-fetch-fonts` being missing from the scaffold. The script now carries no `--url` placeholder; the CSS URL is passed as a trailing argument (`pnpm fetch:fonts --url "<css url>"`), which pnpm appends to the delegated script, so nothing has to be hand-edited before the first run.

    The standalone project root forwarded only `dev:mp`, leaving `fetch:fonts`, `icons:generate`, and `validate:assets` reachable solely as `pnpm --filter @chimera-engine/<game> <script>` — a form nothing in the scaffold's own output taught. The emitted root now forwards all four, matching the monorepo, where each is a plain root script. The forwards are bare delegations (no build chain: these tools read source and assets, never build output) and end on the delegated script so trailing arguments reach the bin.

    `verify:scaffold`'s fonts arm now drives `pnpm fetch:fonts --url …` from the project root instead of invoking the bin with a hand-built argv, so it covers the root forward, the shipped script, and pnpm's argument forwarding — the chain that was broken while the arm stayed green. It additionally refuses any `fetch:fonts` script containing a shell redirection character, and the blank-template suite refuses one in **any** template script and cross-checks every `chimera-*` command the template invokes against the bins `@chimera-engine/electron` declares.

- dec448e: A scaffolded game can regenerate its own platform icon set: the blank template now ships
  an app-level `icons:generate` script running
  `chimera-generate-icons --source assets/icons/icon.png --out assets/icons`. Run it from
  the app package (`pnpm --filter @chimera-engine/<game> icons:generate`); the master is the
  `assets/icons/icon.png` the template already commits, and the generator writes the
  `chimera-*` set alongside it without touching it.

    No codec is added to the scaffold. `sharp` is an optional peer of
    `@chimera-engine/electron` and is not installed directly — it is a multi-megabyte native
    binary, and most games never regenerate their icons — so the script is wired and correct,
    and reports `pnpm add -D sharp` if it cannot resolve one.

    The template's `electron-builder.yml` now documents what actually consumes what, rather
    than implying the generated set is what brands the app. Replacing the single committed
    `assets/icons/icon.png` is the whole rebrand for both icons a player sees: electron-builder
    derives the installer `.icns`/`.ico` from it, and the manifest `icon` makes it the runtime
    window and dock icon. The generated set feeds exactly one thing — the `resolveAppIcon`
    fallback at `<app>/assets/icons/chimera.png` — while still being packaged in full, and the
    comments now say both. The `from:` block that ships that fallback keeps pointing at the
    engine's icon set, now pinned as a `from:`/`to:` pair by a new test; the yml explains why
    it cannot already point at the game's own asset dir.

- bb9ebdb: A scaffolded game can validate its own asset references from day one: the blank template
  now ships an app-level `validate:assets` script running `chimera-validate-assets ../..`.
  pnpm runs package scripts with cwd = `apps/<kebab>` and the validator resolves its
  positional argument against that cwd, so `../..` lands on the project root — whose `apps/*`
  discovery then finds the game and resolves `apps/<kebab>/assets/…` exactly as it does in
  the monorepo. No new tool mode: the scaffold keeps the `apps/<kebab>` shape, so the
  existing discovery works unchanged. The script is app-level because the depth depends on
  it, and because a standalone project's root manifest carries no `@chimera-engine/electron`
  for pnpm to link a bin from. A blank game declares no assets yet, so the script reports
  `Checked 0 asset refs` until the adopter adds some — it is wired and correct, not a
  demonstration.

    `chimera-validate-assets` now REFUSES a root with no `apps/` directory instead of
    reporting success. Games are discovered at `<root>/apps/<gameId>/`, so such a root could
    report "Checked 0 asset refs; all files exist." and exit 0 — the answer "nothing is broken"
    about a tree in which no game could be found. That is reachable by hand rather than
    hypothetical: running the bin bare from a game package defaults the root to that package.
    `apps/` is the discriminator precisely because a game package never has one, while both
    supported layouts do. The refusal names the cause and the invocation that fixes it. A root
    that HAS `apps/` is scanned exactly as before, whatever it turns out to contain — including
    reporting 0 refs, which for a freshly scaffolded game is the honest answer.

- 0515bb8: Scaffolded games get the Invariant #27 packaged-bundle guard, driven from a new engine export (§4.12).

    `@chimera-engine/electron` gains a public `./packaged-bundle` subpath — the single home of the
    debug-bundle marker set and the self-validating `verifyPackagedBundle` verification. The debug
    graph the markers describe is engine code, so the strings that prove its absence are engine
    internals; consolidating them here (instead of copying them into each consumer app) removes the
    multi-copy drift where the weaker copy stops naming a module and its checks keep passing. The
    runner carries its negative controls inline: on every run, the dev rebuild that restores the
    app's `dist/` must be rejected by every predicate — per predicate — and a synthetic widened
    `files:` allowlist by every allowlist check, so a gutted or rotted check fails the gate itself
    on the same run. It also now checks the app's `electron-builder.yml` `files:` allowlist (no
    `dist/` globs, no listed debug preload, the shipped bundles named individually).

    The blank template ships a thin `verify:packaged-bundle` gate over that export. A scaffolded
    game's `build-main.ts` and `electron-builder.yml` are adopter-editable, and either edit could
    silently reship the debug layer — dropping the packaging `define` keeps every build green while
    the Inspector graph returns to the shipped bundle; widening `files:` to `dist/**` ships whatever
    an earlier dev build left behind. `pnpm verify:packaged-bundle` in the generated app now fails
    on both, reading the bytes a real packaging build emits. The engine repo's `verify:scaffold`
    runs the generated app's gate, so a broken template guard fails engine CI rather than a
    downstream adopter's packaging run.

    The monorepo's own `tools/verify-packaged-bundle.ts` becomes a thin driver over the same export;
    its behaviour is unchanged apart from the added allowlist checks.

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

- e485605: Fix the generated `.icns` and `.ico`, whose power-of-two entries were each one pixel short
  in height — which broke the Windows build outright and left the macOS icon stretched and
  speckled.

    The generator handed the whole master to `png2icons` and let it resize internally. That
    resize derives each output height as `floor(srcHeight * (target / srcWidth))`, and for some
    master widths the double round-trip through that ratio lands a hair below the integer, so
    the floor drops a pixel. Which widths, and which target sizes within them, is not a tidy
    rule — over the widths 256–2048 and this tool's ten target sizes, 292 of 1793 widths lose
    at least one. The engine's master, at 1825, is one of them: `32 / 1825 * 1825` is
    `31.999999999999996`, and every power-of-two target came out short — `.icns` at 32×31,
    64×63, 128×127, 256×255, 512×511, 1024×1023, and `.ico` the same at its power-of-two sizes
    while 24, 48, 72 and 96 stayed square. A 1024px test fixture divides evenly at every size,
    which is why the suite never saw it.

    Two consequences, the first of which was not cosmetic:
    - **The Windows build failed.** electron-builder validates `win.icon` through its
      `app-builder` binary, which rejects an icon whose largest entry is under 256×256. At
      256×255 that is `ERR_ICON_TOO_SMALL` — a hard build failure, not a warning.
    - **macOS rendered a stretched, aliased icon.** The shell scales a non-square entry back to
      square at display time. On top of that, `png2icons` decimated the 1825px master to 16–64px
      in a single bicubic step with no low-pass prefilter, which aliases hard and blows isolated
      pixels out at high-contrast edges.

    Both containers are now assembled by the tool itself, byte by byte, around exact-size square
    renders produced by `sharp` — the same renders the loose PNGs are written from, so a size
    that appears in more than one output cannot be right in one and wrong in another. libvips
    shrinks before it resamples, so the small entries are clean. Each render is verified against
    its own PNG header before it is used: an off-by-one in a resize is invisible in every
    downstream byte, since the container assembles perfectly well around a wrong-sized payload.

    `png2icons` is gone — from the dependency tree, from `@chimera-engine/electron`'s optional
    peers, and from the scaffold's opt-in instructions, which are now just `pnpm add -D sharp`.

    The `.icns` carries `ic07`–`ic14`, all PNG, which is exactly the set electron-builder's own
    generator emits. `ic04`/`ic05` are deliberately absent rather than overlooked: those slots
    are raw `ARGB`, and macOS' IconServices — the path Finder and the Dock use, unlike `NSImage`
    — rejects a PNG there and falls back to the generic application icon. Omitting them costs
    nothing on a Retina display, where 16pt and 32pt render from `ic11`/`ic12`. The `.ico` ladder
    is 16, 24, 32, 48, 64, 96, 128 and 256.

    Also fixed in the same path: the resize padded with sharp's default background, which is
    **opaque black**, so any game whose master is not square got black letterbox bars down two
    edges of every loose PNG. (The containers escaped it only because they were built from the
    raw master by a different code path — the one this change removes, which would have carried
    the bars into every entry.) The pad is now explicitly transparent.

    The `verify:scaffold` generate-icons arm no longer requires the run to fail. With `png2icons`
    gone the only codec is `sharp`, which a Next-based scaffold already installs as a transitive
    optional dependency — so the run there generates the set for real. Both outcomes are now
    graded, and the arm asserts on work done rather than exit status: an exit 0 is a failure
    unless the set is actually on disk, which is precisely the no-op-entry-guard defect the arm
    was built to catch.

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

- 3fd9271: Remove the `isDefault` flag from `RendererGameContribution`, and with it the engine's notion of a default game. Game context reaches the renderer only as an external `?gameId=` (the launcher stamps it, `withShellGameId` carries it across navigation); the engine names, stores, and derives no game of its own.

    Breaking changes to `@chimera-engine/renderer/game`: `RendererGameContribution.isDefault` is gone — delete the field from your `register.ts` (scaffolds generated by `create-chimera-game` no longer emit it). `getDefaultRendererGameId()` and `NoDefaultRendererGameError` are removed with no replacement: the registry answers "load this explicit gameId", never "which game am I?". `LobbyConfig.gameId` is now `string | null`.

    Behaviour fix: the lobby was the one route that invented a game when the URL supplied none, so a lobby reached without `?gameId=` presented engine-default chrome while silently hosting the flagged default game underneath. It now resolves `gameId` from the URL alone, like every other shell route — one id drives both the host request and the shell branding, and with no game context the `Host` action is disabled (joining is unaffected, since the host's response carries the game). `useActiveShellGameId` drops its lobby-route carve-out, which existed only to defend against that invented default.

    Two further places where the game-agnostic renderer named a concrete game are fixed. `SaveStoreBootstrap` defaulted its game id to the literal `'tactics'` and is mounted propless in the root layout, so every route — including a game-less `/main-menu` — issued `saves.list('tactics')` over IPC; it now takes the active shell game id and stays unwired when there is none. The replays page fell back to `'tactics'` when the URL carried no `?gameId=`; it now lists nothing, which also removes the two call sites that re-resolved the URL specifically to dodge that fabricated fallback.

    Unchanged: the engine defaults a game opts into by contributing no shell — the default main menu, settings, lobby, and background a fresh scaffold renders. That is game context present with no customization, not the absence of game context.

- e8b8251: A scaffolded project no longer inherits the engine's image codec. `sharp` is the
  monorepo's own icon-generation tooling, and the frozen toolchain snapshot a standalone
  root declares is derived from the monorepo's root devDependencies — so every scaffolded
  game was installing that multi-megabyte platform-specific native binary directly, for a
  tool it had opted out of.

    That defeated the optional-peer declaration on `@chimera-engine/electron` upstream of
    itself: the peer was correct, and the root manifest handed the codec over before the
    peer declaration was ever consulted. It is now excluded from the snapshot, and a game
    opts in the documented way with `pnpm add -D sharp`.

    `sharp` remains present transitively — Next declares it as an `optionalDependency`, which
    is why the emitted root still names it under `ignoredBuiltDependencies` — but it is no
    longer a direct dependency the project asked for.

    Found by the new `verify:scaffold` `generate-icons` arm on its first run against a real
    installed probe.

- ce4e9b3: A scaffolded game's `pnpm test:e2e` now reds on a flaky spec instead of exiting 0.

    The template's Playwright config set `retries: 1` with no `failOnFlakyTests`. Playwright
    reports a spec that failed its first attempt and passed the retry as `N flaky` on stdout
    and exits 0, so an adopter's e2e gate reported a clean run for a spec that had failed —
    and nothing signalled that the shipped config differed from the engine's own, which had
    already closed this.

    `retries: 1` is kept. `use.trace` is `'on-first-retry'`, which records a trace only when a
    retry is taken, so a zero-retry config would trade a green-on-flake for a blind first
    failure. With the flag, the retry still produces the trace and the run reds.

## 1.0.0-rc.5

### Patch Changes

- Fixed a standalone-scaffold e2e bug where Playwright runners that invoke the `playwright`
  bin directly — the VS Code Test Explorer, `npx playwright test`, and the generated
  `.vscode/launch.json` configs — bypassed the app's `test:e2e` npm script, the only place
  `CHIMERA_VERIFY_PACK_NODE_MODULES` was set. Without that env, the e2e `global-setup`
  re-added the monorepo-only `@chimera-engine/electron/main` esbuild alias, which does not
  exist in a scaffold, so the build failed with "Could not resolve @chimera-engine/electron/main".
  The scaffolded `e2e/playwright.config.ts` now self-sets
  `process.env.CHIMERA_VERIFY_PACK_NODE_MODULES ??= 'node_modules'` at the top of the config,
  which Playwright evaluates before `globalSetup` in the same process — so every runner resolves
  the packed engine, not just the ones going through `test:e2e`. The rewrite throws if the
  `defineConfig` marker drifts, failing loud instead of silently reintroducing the bug.

## 1.0.0-rc.4

### Patch Changes

- 81bba4c: Freeze the scaffold's toolchain at **exact** versions instead of caret ranges. A fresh
  `create-chimera-game` project declared the toolchain as ranges (e.g. `next: ^15.5.15`), so an
  out-of-monorepo install resolved newer upstream patches the engine was never built against —
  `next@15.5.20` broke the generated app's Next static export ("Could not find the module …
  `SaveStoreBootstrap` in the React Client Manifest"). The emitted root's `TOOLCHAIN_DEPS` are
  now pinned to the exact versions the monorepo builds against, the scaffolded app's own
  non-engine deps (`electron`, `electron-builder`) are pinned at emission time (a caret there
  splits resolution the same way once the monorepo bumps a major), and the root now carries the
  tested `packageManager` + `engines` envelope. A regeneration gate keeps the frozen snapshot
  exact and in sync with the monorepo lockfile.

## 1.0.0-rc.3

### Minor Changes

- Scaffolded games gain full VS Code debug/run parity: the generated `.vscode/` now
  ships the complete launch set (Run/Clean, a Debug compound with renderer-process
  attach, Vitest x3, Playwright x2, and per-platform Package configs) plus the matching
  `package:<game>:<platform>` root scripts the Package configs drive. The blank
  template's `electron-builder.yml` filters `!**/*.map` so debug source maps are never
  shipped in packaged builds.

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

- Scaffolded apps ship first-class debug support:
    - `pnpm start:debug` (the launcher's `--debug` flag sets dev + `CHIMERA_DEBUG` env), main
      and renderer source maps, and a generated `.vscode/` for IDE debugging.
    - Fixed the F9 inspector in standalone builds: `build:app` now falls back to the
      `debug-api.js` sibling of the resolved api preload, so the Inspector preload comes
      from the installed `@chimera-engine/electron` layout when no engine source tree exists.

## 1.0.0-rc.1

### Patch Changes

- f88e40a: Fix the scaffolded app crashing at startup when `ELECTRON_RUN_AS_NODE` is set in the environment (some IDE/agent terminals and CI runners export it globally). In that state the `electron` binary runs as plain Node.js, so `require('electron')` resolves to the executable path string and every Electron API is `undefined` — a raw `electron apps/<game>` then died at module load with a cryptic `TypeError: Cannot read properties of undefined`, which reads as "launching the app crashes the terminal".
    - `create-chimera-game` now emits a `scripts/launch.mjs` launcher and a root `pnpm start` script that strip `ELECTRON_RUN_AS_NODE` before spawning Electron, so the documented run step works from any terminal. The README + next-steps now point at `pnpm start`.
    - `@chimera-engine/electron` gains a startup `assertElectronRuntime` guard that turns the cryptic `TypeError` into an actionable message naming the cause and the fix (`unset ELECTRON_RUN_AS_NODE`, or use `pnpm start`).

## 1.0.0-rc.0

### Major Changes

- M10 — first public release (`1.0.0`). Adopt the locked `1.X.Y` versioning scheme: every
  `@chimera-engine/*` engine package and the `create-chimera-game` initializer now share one
  version and re-publish together. This bump retires the independent `0.x` per-package semver
  and aligns the whole first-party set at `1.0.0`. Previewed on npm as `1.0.0-rc.0` under the
  `rc` dist-tag before the final release.

### Minor Changes

- 88c00c5: `create-chimera-game <name>` now scaffolds the standalone project **into the current directory** instead of a new `<name>/` subdirectory. The intended flow is "make a folder, open it, run the initializer there", so the app (`apps/<kebab>/`) and the emitted project root (`package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.mts`) land directly in `<cwd>` with no redundant wrapper directory, and `pnpm install` runs there. To avoid clobbering an existing project, the CLI refuses when the current directory already contains a `package.json`. `--workspace` (in-monorepo) and `--out <dir>` (the `verify:scaffold` gate) are unchanged.

## 0.2.0

### Minor Changes

- 6f4a402: Mirror the F70 logo-screen adoption in the blank template so every scaffolded game boots Chimera-branded out of the box: the manifest declares an active `logoScreen: { route: '/logo-screen' }`, `renderer/app/logo-screen/page.tsx` re-exports the engine default logo page, and the engine brand video ships as a committed `renderer/public/chimera_logo.mp4` copy. Packaged boots land on the logo screen; dev boots are untouched. Remove the manifest field to opt out, point the route at your own page for a custom intro sequence, or replace the mp4 with your own brand cut — that media is then game-owned (Invariant #97).

### Patch Changes

- 710983f: Document the F69 `GameManifest.cursor` declaration in the blank template's manifest: the JSDoc now explains the cursor roles (`default` | `pointer` | `disabled`), the game-asset-relative image convention (Invariant #97), and the hotspot default, alongside a commented-out `cursors/default.png` example. No cursor textures ship with the template — a scaffolded game opts in by uncommenting the example and adding its own PNGs under `assets/cursors/`; until then the plain system cursor stays.

## 0.1.0

### Minor Changes

- Initial release: scaffold a new Chimera game. By default emits a SELF-CONTAINED project — its
  own toolchain `package.json`, `pnpm-workspace.yaml`, `vitest.config.mts`, and a `tsconfig.json`
  carrying the frozen root `compilerOptions`, with the app's `@chimera-engine/*` deps on their published
  `^x.y.z` ranges — that installs and boots with **no monorepo clone**. `--workspace` instead adds
  an in-monorepo app (what `pnpm create:game` runs). The published package bundles the blank
  template and a frozen toolchain snapshot, so `npm create chimera-game` works standalone; the
  `verify:scaffold` gate boots the emitted project from packed tarballs end-to-end.
