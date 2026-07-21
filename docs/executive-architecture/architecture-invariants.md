---
title: 'Architecture Invariants'
description: 'All numbered invariants that must never be violated in the Chimera engine. Violations are BLOCK findings at review. Thematically indexed for quick navigation.'
tags: [invariants, architecture, rules, constraints, review-gate]
---

# Architecture Invariants

> These invariants are the hard rules of the Chimera engine. A single violation is a BLOCK finding.
> Related: [System Overview](system-overview-and-context.md) · [Module Boundaries](module-boundaries-file-tree.md)

---

## Thematic Index

| Theme                                  | Invariants                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Determinism & purity**               | 1, 2, 42, 43, 44, 54, 55, 70, 71, 75, 76, 104, 105, 106, 107, 110                                                                       |
| **State ownership & trust boundaries** | 3, 4, 5, 6, 8, 17, 23, 24, 26, 32, 33, 36, 57, 58, 59, 60, 61, 62, 66, 72, 73, 74, 78, 95, 99, 101, 103, 105, 108, 110, 111, 114, 115   |
| **Action pipeline & extensibility**    | 7, 10, 11, 12, 13, 16, 17, 18, 19, 25, 79, 89, 90, 103                                                                                  |
| **Content & assets**                   | 13, 14, 15, 20, 21, 22, 46, 97                                                                                                          |
| **Save / load / replay**               | 23, 24, 25, 26, 70, 71, 108                                                                                                             |
| **Settings, profiles, input**          | 32, 33, 34, 35, 36, 59, 60, 61, 62, 65, 66, 111, 112                                                                                    |
| **Debug, logging, crash**              | 27, 28, 29, 30, 31, 67, 68, 69                                                                                                          |
| **Rendering & UI boundaries**          | 47, 48, 49, 50, 51, 52, 53, 56, 57, 58, 63, 64, 74, 80, 81, 82, 83, 84, 85, 86, 87, 88, 91, 92, 93, 94, 96, 97, 100, 110, 111, 112, 113 |
| **Networking & multiplayer**           | 6, 8, 9, 37, 38, 39, 40, 41, 72, 73, 99, 104, 114, 115                                                                                  |
| **Lifecycle & dispose**                | 21, 64, 77, 78                                                                                                                          |

---

## Invariants 1–20

**1.** `simulation/` has zero runtime dependencies on React, DOM, or networking.

**2.** `applyAction`/`definition.reduce` are pure functions — same input, same output, always.

**3.** `GameSnapshot` never leaves the host's main process. `PlayerSnapshot` is the only state type that crosses any process or network boundary. Exception: the debug layer (`debug-bridge.ts`) returns full snapshots to the Inspector Window over `chimera:debug*` ("full truth — debug only", §4.12); it loads solely under the debug-mode gate (Invariant 27, whose exact expression §4.12 pins — it is deliberately not the imported `IS_DEBUG_MODE` constant) and validates every request sender against the Inspector's `webContents.id` (Invariant 29).

**4.** The renderer reads state; it never writes state directly.

**5.** All IPC methods are declared in `ipc-handlers.ts` and exposed only through `preload/api.ts`.

**6.** Network messages are validated before they touch the simulation.

**7.** `engine:undo` and `engine:redo` are `EngineAction` types — they go through the normal `ActionPipeline`. There is no side-door undo execution path.

**8.** `StateProjector.project()` is the mandatory gate between `GameSnapshot` and any outbound message. `StateBroadcaster` never reads `GameSnapshot` directly.

**9.** `CommitmentScheme.verify()` is always called client-side on receipt of a `REVEAL` message before the revealed value is trusted.

**10.** Game-defined action types and game definitions must be registered in `ActionRegistry` before the simulation tick loop starts. The engine never switches on raw `type` strings — all action delegation goes through `ActionRegistry.resolve()`, and game-level startup hooks go through `ActionRegistry.resolveGame()`.

**11.** The `engine:` action namespace is reserved. Games must not register action types starting with `engine:`.

**12.** `ActionPipeline` steps are invariant — parse before validate, validate before reduce. Games supply strategies; they do not control step ordering.

**13.** `ContentDatabase` is immutable after `ContentLoader.load()` returns, and the immutability is **deep**: `createContentDatabase` — the single freeze site every construction path funnels through — freezes each item **recursively**, so nested objects and arrays are frozen too, not just the item's own properties. A shallow `Object.freeze` does not satisfy this invariant; it holds only for content that happens to be flat today and silently lapses on the first nested field. The recursion domain is the JSON one Invariant #15 mandates — plain objects and arrays. A value JSON cannot produce, reachable only through the programmatic factory, is frozen but not descended into — the engine does not attempt deep immutability outside the content contract (an array-buffer view is skipped entirely, since `Object.freeze` throws on a non-empty typed array). It is never stored inside `GameSnapshot`. It is passed to `validate()` and `reduce()` through `PipelineContext`.

**14.** `ContentDatabase` is loaded and all schemas **and refs** validated before the tick loop starts. A failed load is a fatal startup error — the game does not start with incomplete content, and the engine **terminates** (`app.exit(1)`) rather than idling windowless, since the composition root launches `main()` as `void main(...)` where a bare throw is only an unhandled rejection. Ref integrity is checked **by default** in `ContentLoader.load()` (`ContentLoadOptions.validateRefs` defaults to `true`). Because content is untyped JSON, ref detection is structural, and its soundness rests on an **enforced** precondition rather than an assumption: every item id must match `ITEM_ID_SHAPE` (a non-empty run of non-whitespace — non-ASCII, dotted, slashed and colon-bearing ids are all legal), rejected as a `ContentSchemaError` by `createContentDatabase` — the same single factory that owns the Invariant #13 freeze, so the property holds for a directly-built database too. `ContentLoader` repeats the check at merge time for one reason: it runs before the duplicate check, so two id-less items are reported as malformed rather than as a `ContentConflictError` over a `Map` keyed on `undefined`. A string is then a ref exactly when its prefix names a known collection **and** its id half satisfies that same grammar — so a string the grammar rejects cannot name any item in the database, and skipping it can never skip a resolvable ref. What this guarantees, stated so it can be falsified: **every string reachable from a loaded item through object entries and array elements — keys as well as values, at any depth — whose prefix names a known collection and whose id half matches `ITEM_ID_SHAPE` must resolve, or the load fails.** Keys count because a map keyed by ref (`resistances: { 'damage-types:fire': 50 }`) is a first-class way to author per-ref data. Those two traversals are exactly what JSON can express, so over loaded content the sentence is total; a shape only a programmatic `inline` source can build — a symbol-keyed property, a non-index property on an array, a `Map`/`Set`'s contents — is not examined at all. What falls outside it is whatever that sentence does not cover, and is _not_ diagnosed at load, reaching `resolveRef()` at call time instead: an id half that is empty or contains whitespace (`units:`, `units:Fire Mage`), which by construction cannot name a legal item; a mistyped collection prefix (`unit:warrior` for `units:warrior`), which is not recognised as a ref at all; and a ref into a collection the loader never saw. The converse cost is inherent to detecting refs in untyped JSON and is accepted deliberately: a string that merely _looks_ like a ref — an i18n key `units:warrior_name`, a `data:`-style value — becomes a **fatal** load error in a game that has a `units` collection, because nothing distinguishes it from one. A game hits this only by naming a collection after another of its namespaces. `validateRefs: false` is the escape hatch, and otherwise a narrow opt-out for a deliberately partial load whose refs resolve against a database that call does not build; no production startup path may use it.

**15.** Game-defined content must never contain executable code. The engine loads JSON only; content files are pure data.

**16.** AI players submit `EngineAction` through `ActionPipeline` — there is no back-door mutation path for AI.

**17.** AI receives a `PlayerSnapshot` **produced by `StateProjector.project()`** by default (honest AI), on **every** state-delivery path — the seed handed to `AIStateMachine.setInitialState` at agent construction as much as the per-tick `AgentManager` fan-out (`tickAll` / `onGameStart` / `onGameEnd`). Structurally widening a `GameSnapshot` into `PlayerSnapshot` shape by spread is not a projection: it type-checks (TypeScript does not excess-property-check spread-in members) while carrying `seed`, `turnClock`, `turnNumber`, `hostPlayerId`, `timers`, `committedTurns`, and every game-local root field. Omniscient mode (`GameSnapshot` access) must be declared explicitly in the game's AI configuration and is logged at game start; the sanctioned omniscient spread lives solely in `AgentManager` and in `buildDefaultAIPlayerAgent`'s seed branch.

**18.** `AIParams` are passed by value (frozen) to every lifecycle method — AI state and command implementations must not mutate them.

**19.** At most one state transition is applied per AI tick. If multiple transitions are requested within a single tick, the last one wins; earlier requests are discarded and a warning is logged.

**20.** `simulation/` never resolves `AssetRef` values. `AssetRef` strings stored in `ContentDatabase` data objects are opaque to the simulation. Only `renderer/assets/AssetManager` may resolve them to loaded GPU or audio resources.

---

## Invariants 21–40

**21.** `AssetManager.dispose()` is called unconditionally on every game session end. Components must never hold direct references to loaded Three.js assets — all access goes through `useAsset()` or `AssetManager.get()`.

**22.** All `AssetRef` strings in content JSON files must pass `tools/validate-assets.ts` before merge. A data object referencing a non-existent file is a CI-blocking error, not a warning.

**23.** `FileSaveRepository.save()` always writes to a `.tmp` file and renames atomically. A save must never partially overwrite a previous valid save file.

**24.** `SessionRuntime.applyRestoredFile()` is the only entry point for replacing the live `GameSnapshot` from a file. The two-step load flow is: (1) `SaveManager.restoreFromSave()` reads and migrates the file from disk into a `SaveFile`, then (2) `SessionRuntime.applyRestoredFile(file)` replaces the live snapshot. Its two callers are the in-session load branch (same-match live apply) and the `SessionRestoreCoordinator` menu-restore flow (F68 #823) — both funnel through the composition root's single apply helper; the coordinator is a caller, not a bypass. No other code path may overwrite the running simulation state from disk.

**25.** `engine:save` and `engine:load` are validated `EngineAction` types — only the designated host player may dispatch them. Client-originated save/load actions are rejected by `validate()` before reaching the reducer.

**26.** `SaveFile.pendingCommitments` must be restored into `CommitmentScheme` on load. A loaded game without restored commitments must not process any `REVEAL` messages until commitments are present.

**27.** `CHIMERA_DEBUG` must never appear in the production packaging configuration. A **production runtime** is any process that is either packaged (`app.isPackaged`) **or** launched with `NODE_ENV=production` — electron-builder never sets `NODE_ENV`, so packaging alone must trigger the guard. Every production runtime must assert `IS_DEBUG_MODE === false` at startup and refuse to start if `process.env.CHIMERA_DEBUG` is set (`electron/main/startup-guard.ts` — `isProductionRuntime` / `assertProductionDebugGuard`, called with `app.isPackaged` from the `main()` composition root).

**28.** `window.__chimeraDebug` is exposed only by `debug-api.ts` and only to the Inspector Window. The game renderer's `api.ts` preload must never expose any debug **data** surface — no snapshots, projections, diffs, action logs, or perf stats. The data-free Inspector-window toggle (`system.toggleDebugInspector()`, a payload-less send on `chimera:debug:toggle-inspector`) is explicitly permitted; outside debug mode no listener is registered and the send is a no-op.

**29.** The debug `ipcMain` handler (`chimera:debug`) must validate `event.sender.id` against the Inspector Window's `webContents.id` on every request. Any request from a different sender returns `{ type: 'ERROR' }` immediately.

**30.** `SnapshotRingBuffer` has a fixed capacity. It must never grow unboundedly. Oldest entries are overwritten silently; the capacity is configurable but must be explicitly set — no dynamic growth.

**31.** `SnapshotInspector` and `SnapshotRingBuffer` are instantiated only when `IS_DEBUG_MODE` is true. The `debugObserver` field in `PipelineContext` is undefined in production; the optional-chain call `context.debugObserver?.()` is the only simulation-side debug coupling.

**32.** Settings are never stored inside `GameSnapshot`, `SaveFile`, or `PlayerSnapshot`. Settings have a completely separate lifecycle from gameplay state and are not replayed, diffed, or included in undo history.

**33.** `FileSettingsRepository.save()` always writes to a `.tmp` file and renames atomically. A settings write must never partially overwrite a previous valid settings file.

**34.** `SettingsManager.registerSchema()` must be called for a game before `getSettings()` or `updateSettings()` is called for that game. Calling `getSettings` for an unregistered `gameId` returns only engine defaults and logs a warning — it does not throw, ensuring graceful degradation.

**35.** The four top-level engine namespaces (`audio`, `display`, `gameplay`, `controls`) must reach `SettingsManager.registerSchema()` **intact**: each present in the game's `defaults`, an object, and owning every engine sub-key for that namespace. A game must not shadow a reserved namespace with its own value, supply a partial one, or omit one — all three degrade `SettingsMerger.mergeAll()` identically, since it walks the base tree and would drop both the namespace and the user's stored overrides for it. A bare key-name check cannot express this: `GameSettingsSchema<T extends EngineSettings>` means every game's `defaults` legitimately _contains_ all four keys (games spread `...ENGINE_DEFAULTS`). `registerSchema()` enforces intactness at startup, throws `SettingsNamespaceCollisionError`, and the engine composition root refuses to start on it. The check is structural — sub-key ownership only, never sub-value types or ranges; game `defaults` are trusted first-party input and are range-validated on no runtime path. `GameSettingsPageDefinition` `game-field.path` entries must be backed by the registered game settings schema; presentation metadata never admits unregistered settings keys.

**36.** Settings are never read by the simulation core (`simulation/`) or the `ActionPipeline`. Any game parameter that must affect simulation outcomes must be declared as a match config value and transmitted as part of lobby setup, not as a user setting.

**37.** `SaveManager` must be constructed with an injected `SaveRepository` instance. No code inside `save-manager.ts` imports `FileSaveRepository` or any other concrete class by name. The concrete implementation is chosen once in `electron/main/index.ts`.

**38.** `LobbyManager` must be constructed with an injected `MultiplayerProvider` instance. No code inside `lobby-manager.ts`, `ipc-handlers.ts`, `StateBroadcaster.ts`, or `MessageRouter.ts` imports `LocalWebSocketProvider` or any other concrete provider by name.

**39.** `StateBroadcaster` and `MessageRouter` must not import from `networking/server/` or `networking/client/`. They interact exclusively through `HostTransport` and `ClientTransport` interfaces. Provider-internal directories are off-limits to all other modules.

**40.** A `MultiplayerProvider` instance must not be disposed or replaced while a `HostedSession` or `JoinedSession` is active. `LobbyManager.closeLobby()` must complete before `provider.dispose()` is called. Provider swaps are a cold-boot concern only — no hot-swapping during a session.

---

## Invariants 41–60

**41.** `InMemorySaveRepository` must pass the identical contract test suite as `FileSaveRepository`. Any divergence between their observable behaviors for the same inputs is a bug in the in-memory implementation, not an acceptable simplification.

**42.** The simulation is action-driven. `GameSnapshot.tick` is incremented by exactly 1 per action applied by `ActionPipeline.process()`. It is never derived from `Date.now()`, `performance.now()`, or any wall-clock source.

**43.** `validate()` and `reduce()` must be pure given `(state, payload, playerId, ctx)`. They must not call `Math.random`, `Date.now`, `performance.now`, read environment variables, or access any I/O. The only permitted source of randomness is `ctx.rng`.

**44.** All numeric fields of `GameSnapshot` that participate in arithmetic, comparison, or checksums must be integers (including fixed-point representations of money, percentages, and fine-grained positions). Floating-point is forbidden in simulation state.

**45.** `ActionHistory` is bounded by `TurnMemento`. Retention is `TURN_MEMENTO_RETENTION = 4` turns (entries with `turnNumber < currentTurn - TURN_MEMENTO_RETENTION` are evicted by `pruneTo`). `pruneTo(cutoff: number)` is idempotent: calling it repeatedly with an identical or lower cutoff is a no-op; the comparison is strict `<`, never `<=`. A `MAX_ACTION_HISTORY_ENTRIES = 10_000` safety-net cap guards against pruning bugs: on overflow, `append()` evicts oldest entries AND emits an `action-history:overflow` warn log.

**46.** `ContentDatabase` is optional. Games that declare no content (e.g. Tic Tac Toe) pass no `db` to `PipelineContext`, and `ReduceContext.db` is `undefined` for them. `validate()` and `reduce()` must tolerate `ctx.db` being `undefined` if the game opts out.

**47.** `StateBroadcaster`, `MessageRouter`, `LobbyManager`, `SaveManager` and all other main-process orchestration modules must not import from `networking/provider/local/` or any other provider-specific subdirectory. Cross-module communication goes exclusively through `MultiplayerProvider`, `HostTransport`, and `ClientTransport`.

**48.** Game UI beyond the engine's built-in shell lives in `games/<name>/screens/` and is registered via `GameScreenRegistry`. `GameShell.tsx` is game-agnostic — it never imports from any specific game package.

**49.** Scene transitions are host-authoritative. `engine:scene_prepare` and `engine:scene_commit` are rejected if the dispatcher is not the host player. (See [Scene Transitions](../core-components/scene-transitions-fade.md).)

**50.** `SceneDescriptor.initialize()` and `teardown()` are pure reducers. They may not perform I/O, call `Date.now()`, or read from `Math.random()`. They receive `ReduceContext` and use `ctx.rng` for any randomness.

**51.** Clients never drive a scene change. A client that wishes to transition sends a domain action; host-side policy decides whether to honour it via `SceneManager.requestTransition()`.

**52.** Required assets for a scene MUST be declared in its `SceneDescriptor.requiredAssets`. Assets loaded on-demand inside the new scene will cause visual pop-in and are flagged by the `validate-assets` CI tool.

**53.** `TransitionOverlay` is a renderer-only component. The simulation and Electron main process have no knowledge of fade state. Fade timing must never gate an authoritative simulation event — the `SceneReadyAction` is dispatched _after_ the fade completes, not as a cause of it.

**54.** `GameTimer` lives in `GameSnapshot.timers`. It is serialised, loaded, and replayed. A timer's `remainingTicks` counter must never be derived from wall-clock time.

**55.** `TimerManager.advance()` is a pure function. The `engine:tick` reducer is the ONLY consumer of `TimerManager.advance()`. Game action reducers may create or cancel timers but must NOT call `TimerManager.advance()`.

**56.** `curves.ts`, `useTween`, and `useTweenCallback` are renderer-only modules. They must never be imported by anything under `simulation/`. Visual smoothing is a client-local concern; the authoritative state does not move smoothly.

**57.** Camera state is renderer-only. `GameSnapshot` must never contain camera position, look-at, zoom, or any other camera parameter. Camera configuration is driven by game board components in response to snapshot data — it is never driven by authoritative simulation actions.

**58.** `isHovered` in `useGameInteraction` is local component state. It must never be written to any Zustand store, IPC message, or simulation state. Hover is a transient renderer-local concern.

**59.** Player profile data (avatar, display name, locale, game-defined profile fields) is never stored in `GameSnapshot`, `PlayerSnapshot`, or `SaveFile`. It is a lobby-scoped cosmetic concern, separate from gameplay state, and is not replayed, diffed, or included in undo history.

**60.** `ProfileRepository` persists only the _local_ machine's profiles. The host's repository never receives or persists remote clients' profiles — remote profiles live only in the in-memory `PlayerDirectory` for the lifetime of the session and are discarded on lobby close.

---

## Invariants 61–80

**61.** `ProfileSanitizer.admit()` is the mandatory gate between an inbound `JOIN` / `PROFILE_UPDATE` attestation and the `PlayerDirectory`. Size caps, MIME whitelist, image decode check, display-name length, and game-schema validation all run inside `admit()`. A failed admission results in a `REJECT` response — the raw attestation is never exposed to any other subsystem.

**62.** Profile changes travel out-of-band from the `ActionPipeline`. `PROFILE_UPDATE` is not an `EngineAction`, does not advance `tick`, and does not participate in undo/redo or save/load. Any renderer component reading profile data must read it from the profile directory — never from `PlayerSnapshot`.

**63.** The simulation never produces audio. Audio playback is initiated only by the renderer in response to `GameEvent`s or direct UI interactions. No reducer, validator, or `ActionDefinition` may import from `renderer/audio/`.

**64.** `AudioManager.dispose()` is called unconditionally at engine shutdown (app exit). `Providers` (`renderer/app/providers.tsx`) is the unique owner of `dispose()` for the app-level `AudioManager`. At game session end (match phase `ended`), `GameShell` calls `AudioManager.stopAll()` to stop all active voices — it does **not** call `dispose()`. Active `AudioHandle`s become invalid after `dispose()`.

**65.** `InputManager` is renderer-only. The simulation has no knowledge of keyboard or gamepad state. Input translates into `EngineAction`s via `sendAction()` at the renderer boundary — never directly into reducers.

**66.** Key bindings are settings, not profile data. They follow the settings layered-merge contract (engine defaults ← game defaults ← user overrides) and are stored under `settings.controls.bindings`. They are not transmitted over the network and never appear in `GameSnapshot`.

**67.** Every main-process manager is constructed with an injected `Logger` child. No module emits logs via raw `console.*` — all structured logging flows through the injected logger. Two sanctioned exceptions, each of which must cite this invariant in an in-code comment: (a) the fatal startup refusals in `main()` that end in `app.exit(1)` — the Invariant #27/#77 guards, which run before the root logger exists and must be the first statement so no debug surface initialises first, and the Invariant #35 settings-registration refusal, which is sanctioned only as a **not-yet-migrated** site: it runs after the logger exists, so the shape below applies to it and the exception lapses once it is converted — each writes the refusal reason to `stderr` via `console.error` before `app.exit(1)`. The Invariant #14 content-load refusal takes **no** exception: it reports through the injected `logger` and drains the sink with a guarded `pinoSink.flushSync()` before `app.exit(1)`, so the reason lands in the log file. That is the required shape for any refusal raised after the logger exists — the sink write is buffered, so the flush is what makes the report real; (b) the preload layer (`electron/preload/shared/listener.ts`), which has no injected logger and reports validation drift to the renderer devtools console.

**68.** The crash reporter runs autosave before writing the crash dump when a live simulation is present. The crash dump file is created atomically (`.tmp` + rename) so a partially-written crash dump never exists.

**69.** No log entry, crash dump, or telemetry ever leaves the user's machine automatically. Export is an explicit, user-initiated action. The main process must not register network telemetry in 1.0.0.

**70.** `ReplayPlayer` uses the same `ActionPipeline` instance wiring as live play. Any "replay-only" shortcut code path is forbidden — a replay divergence is a determinism bug, not an acceptable replay-layer simplification. This invariant governs **deterministic replay playback only**; a _perspective_ replay (Invariant #98) is never re-simulated — playback walks its stored `PlayerSnapshot` frames in order and never touches `ActionPipeline` — so this rule does not apply to it.

**71.** Deterministic replay files (`ReplayFile`, no `kind` discriminator) contain full `EngineAction` payloads — never projected `PlayerSnapshot`s. Playback starts from seed + gameConfig and reconstructs state through the pipeline. A replay file without `seed` or `actions` is malformed and rejected at load. (The distinct _perspective_ replay format of Invariant #98 deliberately inverts this — it stores projected snapshots and no seed/actions — and is identified by its `kind: 'perspective'` discriminator.)

**72.** `CHAT` messages are not `EngineAction`s. They must not advance `tick`, invoke `ActionPipeline`, or be recorded in `ActionHistory` / replays / saves. Chat is a cosmetic communication channel, parallel to `PROFILE_UPDATE`.

**73.** `ChatRelay.relay()` is the mandatory gate between an inbound `CHAT` message and rebroadcast. Length cap, rate limit, and scope validation all run inside `relay()` — no bypass path exists.

**74.** `toastStore` is renderer-only state. Toast contents must never be derived from `GameSnapshot`, `PlayerSnapshot`, or `SaveFile`. Toasts are transient UI surfaces for the local viewer; other players do not see another player's toasts.

**75.** `FixedPoint` is the ONLY allowed fractional representation in `GameSnapshot` and `EngineAction.payload`. A game that stores `number` for a fractional gameplay quantity violates invariant 44 even if it rounds consistently — determinism requires the shared `bigint` Q32.32 representation.

**76.** `fromFloat()` is permitted only at content-load time for hard-coded constants. It must not be called inside `validate()`, `reduce()`, or any hot simulation path. Linting is enforced by a dedicated ESLint rule in CI.

**77.** The dev multiplayer harness is a development-only tool. `electron/main/index.ts` must refuse to start when `CHIMERA_DEV_HARNESS=1` is combined with a **production runtime** — packaged **or** `NODE_ENV=production`, the same `isProductionRuntime` predicate as Invariant #27 — and every harness flag must be ignored (with a warning) when `CHIMERA_DEV_HARNESS` is absent.

**78.** Each harness-spawned instance runs in an isolated Electron `userData` directory (`.dev-userdata/p<i>/`). Shared state between instances is forbidden — profiles, saves, settings, logs, and crash dumps must be per-instance so the harness behaves identically to multiple distinct machines. The host's announce file (the lobby-code handshake) lives inside the host's OWN `userData` dir and is read only by the orchestrator CLI — an instance never reads another instance's directory.

**79.** All `registerExtension()` calls must complete before `api.ts` is loaded. `buildExtensionsApi()` is called exactly once, immediately before `contextBridge.exposeInMainWorld`. A late registration after `buildExtensionsApi()` has run will mutate the internal registry but the frozen copy already handed to `exposeInMainWorld` will not reflect it.

**80.** `GameShell.tsx` and `InGameMenuHost.tsx` must never import from any `games/*` path. The `GameScreenRegistry` passed as a prop is the sole coupling point between the engine renderer and a game's React code; the `inGameMenu` slot reaches `InGameMenuHost` only through that registry (F55).

---

## Invariants 81–88

**81.** `GameScreenRegistry.board` is the only required slot. All other slots are optional. A game that provides only `board` is a fully valid Chimera game.

**82.** Within-scene panel navigation (`useNavigateToScreen`) is a renderer-local state change. It must never trigger an IPC call, advance `tick`, or dispatch an `EngineAction`.

**83.** All engine-provided React contexts use `createContext<T | null>(null)`. The consumer hook must throw a descriptive error if the context is `null`. `createContext<T>(null!)` (the "null-bang" pattern) is forbidden in engine code. Sanctioned carve-out: `IconContext` (the game-contributed icon set, Invariant #113) still uses the `null` default but exposes **no throwing consumer hook** — `<Icon>` reads it inline and **degrades** to the engine `ICON_REGISTRY` when `null`, because rendering `<Icon>` with no `IconProvider` mounted is a first-class supported case (the component gallery, unit tests, the engine-only shell).

**84.** Game screen components must not import `AssetManager`, `ContentDatabase`, or `AudioManager` as singleton module-level imports. All access goes through the context hooks (`useAssetManager()`, `useContentDatabase()`, `useAudioManager()`).

**85.** Game token override files may only redefine tokens declared in `renderer/styles/tokens.css`. Introducing new `--ch-*` custom property names in a game's override file is a module-boundary violation.

**86.** Engine UI components (`renderer/components/ui/`) must not contain hardcoded colour, spacing, or radius values. Every visual attribute must reference a `var(--ch-*)` token or a scoped CSS Module class — never an inline hex value. Icon glyphs (engine `ICON_REGISTRY` entries and game-contributed `GameIconSet` entries, Invariant #113) extend this at the SVG level: a glyph's `content` carries **no `fill`**, so it inherits `fill: currentColor` and `--ch-size-icon` sizing from the shared `.icon` rule and tracks its host control's colour token — a game glyph therefore renders identically to a built-in, including inside an `<IconButton>`.

**87.** Every screen component exported from `games/<name>/screens/index.ts` must be wrapped in `React.lazy()`. Eager static imports of large screen components into the registry module are forbidden — they defeat the bundle split and load all game UI on match entry.

**88.** `GameShell` wraps every active screen in a `<React.Suspense>` boundary. No game screen component may assume it renders without a Suspense ancestor.

**89.** `ctx.dispatch()` nesting depth is bounded by `MAX_NESTED_DISPATCH = 16`. `ActionPipeline` throws `RecursiveDispatchError` when this ceiling is exceeded. Only `engine:tick` may call `ctx.dispatch()`. This bound is reflected in `ReduceContext.dispatchDepth` and is invariant-backed per the ReduceContext JSDoc contract (lines 366–421 of `types.ts`): adding fields to `ReduceContext` requires a dedicated invariant in this document.

**90.** `ReduceContext.logger?: Logger` is engine-internal diagnostics surface, populated by `ActionPipeline` from its injected `Logger` instance. It is intentionally absent from the public `GameReduceContext` interface (Invariant #12, ISP) and is reachable only after a deliberate `isReduceContext()` narrowing call. Use is restricted to engine-reserved actions: today only `engine:tick` (which emits `warn`-level entries when a timer-fired action is rejected by `validate()` — non-fatal, see §4.20). Game reducers must never read or write this field; any future engine-reserved action that uses it must update this invariant.

---

## Invariants 91–115

**91.** Shell page components (`main-menu`, `lobby`, `settings`, `saves`, `component-gallery`) must not set hardcoded colour, spacing, or radius values in any inline `style` prop. Every visual attribute must reference a `var(--ch-*)` custom property (§4.35, §4.37).

**92.** Shell pages must use `<Button>` from `renderer/components/ui/` for all interactive actions. Raw `<button>` or `<input type="button">` elements with inline styles are prohibited in shell pages. (See [Renderer Shell Pages UI Contract](../core-components/renderer-shell-pages-ui-contract.md).)

**93.** Game token override CSS must not be imported directly by any shell page component. Token overrides enter the cascade exclusively as side-effects of game registry initialisation — importing `games/<name>/styles/tokens-override.css` from a shell page file is a module-boundary violation.

**94.** Engine shell pages (`main-menu`, `settings`, `saves`, `component-gallery`) must not import from any `games/*` path. The lobby page may import `LobbyConfig` parsing helpers but must not import game-specific screen modules, registries, or override stylesheets directly.

**95.** `chimera:game:get-current-snapshot` is a read-only renderer-to-main IPC replay channel. It may return only the most recent projected `PlayerSnapshot` already stored for renderer delivery, or `null` when no snapshot has been sent. It must never expose `GameSnapshot`, accept renderer payload that changes gameplay state, trigger `ActionPipeline`, or mutate simulation state.

**96.** Game renderer surfaces may import the shared renderer component library only through its three public barrels — `@chimera-engine/renderer/components/ui` (stateless design primitives, §4.35), `@chimera-engine/renderer/components/chat` (the shared chat component, §4.35.1), and `@chimera-engine/renderer/components/r3f` (engine components a game mounts inside its own `<Canvas>`, e.g. `PerfProbe`, §4.16). This allowance is limited to game screen components under `games/<name>/screens/*.tsx` and React shell contributions under `games/<name>/shell/*.tsx`. Game code must not import renderer stores, IPC bridges, `shell/` components, R3F components outside the r3f barrel, asset managers, hooks, stylesheets, individual component files behind any barrel, or other renderer internals; non-renderer game modules must not import renderer code.

**97.** Game-owned assets — audio, fonts, textures, models, and similar binary resources — must be committed and declared by the game package, not by `renderer/public`. Runtime renderer loading must resolve local `game-id/relative/path` references through the game-asset protocol. `GameFontFace.src` must not be an external URL, and runtime font loading must not fetch Google Fonts CSS or `fonts.gstatic.com` files; development-time downloads are allowed only through tooling that commits the resulting `.woff2` files into the game asset directory.

**98.** A _perspective_ replay (`PerspectiveReplayFile`, `kind: 'perspective'`) is the privacy-preserving counterpart to the deterministic `ReplayFile` of Invariant #71: it carries only already-projected `PlayerSnapshot` frames for a single, **locked, immutable** `viewerId` — never `seed`, `gameConfig`, or `actions` — so it exposes only what one player legitimately saw. A perspective replay is malformed (rejected at parse) if `viewerId` or `frames` is missing, if any `frame.snapshot.viewerId` differs from the file's locked `viewerId`, if any `frame.tick` disagrees with its embedded `frame.snapshot.tick`, or if frame ticks are not strictly increasing (playback walks `frames` in order, so duplicate or out-of-order ticks are rejected). The `kind` discriminator distinguishes it from the deterministic `ReplayFile` (which has no `kind`); both kinds coexist on disk (§4.28, ADR F44b).

**99.** Lobby match settings are **host-authored**; per-player attributes are **owner-authored**. `LobbyManager.setMatchSetting()` rejects (returns a rejected `Promise`) when the active session is not a hosted session — the host is the sole author of match settings, written through the host-only IPC channel `chimera:lobby:set-match-setting`. `LobbyManager.setPlayerAttribute()` instead enforces seat ownership: it rejects any `playerId` other than the caller's own ({@link LobbyManager.localPlayerId}); a hosted session merges the value into its own seat, while a joined (non-host) session forwards the own-seat intent to the authoritative host over the transport (`PLAYER_ATTRIBUTE_UPDATE`), and the host applies it to the **sender's** seat — derived from the connection, never a client-supplied id — via `HostTransport.onPlayerAttributeUpdate`. Both IPC channels are Zod-validated in `ipc-schemas.ts` and are the **sole** renderer write path. The merged `LobbyState.matchSettings` and `LobbyPlayerEntry.attributes` are broadcast to every peer on each change, so a joined client can author only its **own** seat's attributes (e.g. unit colour) and otherwise only reads the host's configuration — mirroring the owner-authored `ready` flow and extending the state-ownership rule of Invariant #36 to the lobby's pre-match config (§4.14, §4.37, F53).

**100.** Game `LobbyScreen` components (`games/<name>/shell/*LobbyScreen.tsx`) perform **no privileged writes directly**. They receive `setMatchSetting`/`setPlayerAttribute` as `GameLobbyScreenProps` (`shared/game-lobby-contract.ts`) and call those engine-provided setters, which route through the renderer lobby API (`useLobbyApi()`) and main-process IPC to `LobbyManager`. A game lobby screen must not write the IPC-mirrored `lobbyStore`, call `LobbyManager`, or open IPC channels itself, and it is reachable only as the registry-loaded `GameScreenRegistry.LobbyScreen` slot — mirroring the registry-indirection rule of Invariant #80 (§4.37, F53).

**101.** `GameSnapshot.setup` / `PlayerSnapshot.setup` (the agreed `GameSetupConfig` = match settings + per-player attributes) is **public host configuration** and is passed through `StateProjector.project()` **verbatim**: it carries no owner-only or per-viewer fields, so every viewer's projected snapshot exposes an identical `setup`. It is built from the agreed `LobbyState` (host-authored match settings + owner-authored per-player attributes) by `buildSetupFromLobbyState()` and carried into simulation via the `engine:start_game` action, keeping all peers in agreement — consistent with Invariant #36 (simulation-affecting parameters travel as match config, never as user settings) and Invariant #99 (§4.6, §4.14, §4.37, F53). The same verbatim-projection rule covers `GameSnapshot.matchId` / `PlayerSnapshot.matchId` (F68, #820): the host mints the stable match identity once per match start (`crypto.randomUUID()` in `onGameStartRequested`), carries it in the `engine:start_game` payload so deterministic replay reproduces it (Invariant #71), and `StateProjector.project()` passes it through verbatim — every viewer sees an identical `matchId`, `engine:return_to_lobby` preserves it, and the next `engine:start_game` mints a fresh one. The `SaveFile.session` manifest that records it alongside the seat roster is host-local orchestration metadata (Invariant #59 — raw ids and control kinds only, no profile data) and never appears in any projection or IPC payload (Invariant #1).

**102.** `GameReduceContext.endTurnGuard?` is the per-game end-turn gate, populated by `ActionPipeline` once from the active game's `GameDefinition.canEndTurn` hook (resolved via `ActionRegistry.resolveGame(gameId)`). It is consulted **only** by `engine:end_turn.validate()`, **after** the generic active-player checks, so a game can reject a premature end-turn (e.g. a commit-then-sync turn mode rejecting with `awaiting_commitment` until every seated player has committed for the current turn; §4.6/§8, F54) **without** the engine knowing any specific game. It satisfies the `GameReduceContext` JSDoc contract that adding a field to that ISP-narrow surface (Invariant #12) requires a dedicated invariant, mirroring #89 (`dispatchDepth`) and #90 (`logger`). Its sibling `GameReduceContext.endTurnAuthority?` — populated the same way, once, from the active game's `GameDefinition.mayEndTurn` hook — instead **replaces** the generic active-player check in `engine:end_turn.validate()` when present (absent ⇒ the default `playerId === turnClock.activePlayerId` stands), so a simultaneous turn mode can authorise **any** seated player to fire the reveal-only End Turn once every seat has committed (a commit-then-sync turn mode; §4.6/§8, F54), without the engine knowing any specific game. Game reducers must not read or repurpose `endTurnGuard` or `endTurnAuthority`; any future engine-reserved consumer must update this invariant (§4.7, F54).

**103.** A game opts into a **commit-then-sync** (simultaneous) turn mode via a synced, host-authored match setting that is **off by default** and carried in `snapshot.setup` (Invariant #101); the default sequential turn flow stays unchanged for that game and every other game. The host drives the whole commit→reveal→apply loop **solely** through the game-supplied `CommitmentTurnOrchestration` hooks (`stageOnCommit`, `shouldReveal`, `shouldAutoEndTurn`, `resolveRevealOrder`, `revealedActionsFor`) and never branches on a specific game id (reaffirms Invariant #2). In this mode `End Turn` is **reveal-only** — authorised through `GameReduceContext.endTurnGuard` / `endTurnAuthority` (Invariant #102) and enabled only once **every** seated participant (human and AI) has staged a commitment for the current turn (§4.6, §8, F54).

**104.** The reveal order returned by a game's `resolveRevealOrder` hook is a **pure, deterministic function of `(snapshot.seed, snapshot.tick)`** and is applied by the host **verbatim** — never host-discretionary — so a commit-then-sync turn reproduces under deterministic replay (reaffirms Invariant #71). `CommitmentScheme.verify()` (Invariant #9) remains the mandatory client-side gate run on every `REVEAL` before any revealed action is trusted or re-dispatched through `ActionPipeline` (§4.6, §8, F54).

**105.** Game-defined per-turn resource state (action budgets and similar) lives in `GameSnapshot`, is **seeded, refreshed, and decremented solely by the game's own reducers** (deterministic — Invariant #2), and reaches clients only through `StateProjector.project()` (Invariant #8). Such resources are never user settings (Invariant #36) and are never client-authored; they remain host-local truth like all other `GameSnapshot` state (Invariant #3) (§4.6, F54).

**106.** The `ai/` package is the **game-agnostic AI framework only** — its sole top-level members are `engine/` (the reusable state-machine / command / scheduler primitives), `__tests__/`, `index.ts`, and `CLAUDE.md`. Game-specific AI (concrete `AIState`/`AICommand`/policy implementations) lives in `games/<name>/ai/` (which **may** import `ai/`, `simulation/`, and `shared/`), never inside `ai/` itself. A re-introduced `ai/policies/<game>/` (or any other game-named subtree under `ai/`) is a module-boundary violation, mirroring the import-direction rule of Invariant #47 (`ai/` must not import from `games/*`) with a containment rule (§3, mechanical check 11).

**107.** The game-agnostic packages `ai/` and `shared/` must not **define** game-specific gameplay tokens — per-game constants (`<GAME>_*`, e.g. `TACTICS_*`) or per-game action-string namespaces (`'<gameId>:*'`, e.g. `'tactics:move_unit'`). Such constants are owned by their game and live in `apps/<game>/simulation/` (e.g. `apps/tactics/simulation/constants.ts`); the `engine:` namespace (Invariant #11) is the only reserved cross-cutting namespace. This keeps the pure engine packages free of any single game's vocabulary as the monolith is decomposed (§3, mechanical check 12).

**108.** `SaveFile.session` is **session-composition metadata**, never gameplay state: it is written only by the host's save capture (`SessionRuntime.captureSaveFile`, from the live lobby roster) and the v5→v6 migration backfill (`deriveSessionManifest`), and it is read only by session orchestration (`SessionRestoreCoordinator` / `sanitizeRestoreManifest` and the composition root's restore wiring). It is never projected, never read by any reducer or `validate()`, and never crosses IPC or the network as an object — the one sanctioned derived surface is the slim, schema-validated restore-status projection (`toRestoreStatusEvent` → `chimera:saves:restore-status`, #826), which carries only the `matchId` and the pending seat ids, never control kinds, slot indexes, or the manifest itself (Invariants #1, #59, #101). The `matchId` it mirrors is minted **host-side, once per match start**, in the `engine:start_game` dispatch path (Invariant #101). A restored session re-enters play **exclusively** via `hostLobby({ restore }) → applyRestoredFile → seatRestoredRoster` — the coordinator-driven menu flow (or the same-match in-session apply), both funnelling through the single Invariant #24 apply helper; no code path may fabricate a live session from a `SaveFile` any other way, and no restored seat may activate before the checkpoint is applied (the start-suppression gate keeps `onGameStart` off the pre-restore lobby snapshot) (§4.11, §4.14, F68).

**109.** Engine UI motion (Modal/Drawer open-close, button press feedback) is declared as **global `ch-*` keyframes** in `renderer/styles/animations.css` and parameterised **exclusively** by `--ch-*` motion tokens (`--ch-<component>-anim-<enter|exit>-<name|duration|easing>`, composed from the `--ch-duration-*`/`--ch-easing-*` primitives) — engine component CSS never hardcodes animation values and never declares module-local keyframes for token-referenced animations (CSS Modules hash keyframe names, which would break the token indirection; reaffirms #86). Games customise motion **only** by overriding those tokens per Invariant #85 — retiming via the duration/easing tokens, disabling via `0ms`, or retargeting a `*-name` token at a game-namespaced `@keyframes` declared in the game's own override CSS (entering the cascade via Invariant #93). All engine motion collapses to instant under `prefers-reduced-motion` because engine durations reference the zeroed primitives; a game override that sets **literal** durations must ship its own `@media (prefers-reduced-motion: reduce)` block, since game overrides load after (and therefore outrank) the engine's. Close animations never change overlay semantics: when no exit animation is computable (reduced motion, `0ms` override, jsdom), `open=false` unmounts synchronously (`useExitPresence`, §4.35).

**110.** The simulation is **language-agnostic**: game logic emits **stable identifiers, never user-facing strings**, and the i18n **runtime** (translation resolution, the ICU message formatter, the React binding — everything under `renderer/i18n/`) is a **renderer-only** concern that `simulation/`, `ai/`, and `networking/` must never import. The **only** i18n surface allowed in `simulation/` is the declarative language **contract** in `simulation/foundation/game-manifest-contract.ts` — the `GameLanguage` type, the optional `GameManifest.languages` field, and the pure `resolveGameLanguages()` / `firstLanguageCode()` resolvers (no `Intl`, no message templates, no bundle data). That is a language _declaration_, not a _runtime_. This extends the renderer-import ban of Invariant #1 and the settings-are-not-simulation rule of Invariant #36 to the localisation layer (§4.39, §3 mechanical check 18, F71).

**111.** Opting into i18n is **strictly additive**: a game that declares no `languages` (or fewer than two) is behaviour-neutral. `<LanguageSelector>` and its store-connected wrapper `SettingsLanguageSelector` render `null` (no selector renders anywhere, and the settings **Language** row is absent), the effective locale is never switched, and the app-wide `<I18nProvider>` resolves pure engine English at zero measurable cost — the provider mounts with inert-by-default props whether or not any game opts in. No un-opted game changes behaviour, and no default game acquires a Language control (§4.39, §4.13, F71).

**112.** Token resolution follows a fixed fallback chain — **`game override → engine English default → raw key`** (`resolveTranslation`). A game override **wins** for a token but **never deletes** the engine default: an un-overridden engine token always still resolves to its English default (the engine ships an English-only bundle, so un-overridden engine strings stay English rather than surfacing as tokens), and a token missing from every layer resolves to its **raw key** (surfacing the gap rather than rendering blank). Debug token-mode (Invariant #27/#28 debug graph) short-circuits every key to its raw token for auditing **without mutating any bundle**. This mirrors the layered-override-never-deletes rule of the settings merge (Invariant #34/#35) for the localisation layer (§4.39, §4.12, F71).

**113.** Game-contributed UI icons reach the engine `<Icon>` **exclusively** through the `LoadedRendererGameShell.icons` registry payload (`GameIconSet` — a game namespaces its keys `game.<gameId>.<name>`), resolved by `useActiveGameIcons` and published to `IconContext` by the app-wide `ActiveGameIconProvider` (mounted in `AppShell`). The engine `<Icon>`/`ICON_REGISTRY` and the whole `renderer/components/ui/icons/` module never import `apps/*`/`games/*` (extends Invariants #80/#94), and the public `components/ui` barrel deliberately **withholds** `ICON_REGISTRY` (games consume icons only through `<Icon name>`). Resolution is **game-first, engine-fallback** (`gameIcons?.[name] ?? ICON_REGISTRY[name]`), so a game can render its own glyph by name or re-skin a built-in by re-keying it; an **unknown** name (no engine or game glyph) renders nothing and dev-warns rather than crashing. Game glyphs carry no `fill` and render with `currentColor` + `--ch-size-icon`, behaving identically to a built-in inside an `<IconButton>` (this is the icon analog of the `LobbyScreen` registry-indirection rule #100, and extends #86; the `IconContext` null-default carve-out is noted on #83) (§4.35, F71-adjacent).

**114.** A **spectator** is a read-only session viewer, never a participant: it is never added to `GameSnapshot.players`, the host's seat ledger (`registeredPlayers` / `activePlayers` / the slot ledger), saves (`SaveFile.session`, Invariant #108), or replays; it receives no `HumanPlayerAgent`, never advances the match-start gate, and any `EngineAction` on its connection is dropped (spoofed-envelope protection). Admission is opt-in and gated twice at the host's join classifier (`classifyJoin`, `electron/main/lobby/joinClassifier.ts`, injected at the composition root where the host knows the manifest and live snapshot so `LobbyManager`/providers stay provider-agnostic — Invariant #38): a fresh join into a **running** match becomes a spectator **only** when the game declares the capability via `resolveSpectatorSupport(manifest)` (`GameManifest.spectators.mode: 'perspective'`) **and** the host enabled the reserved, `engine.`-namespaced, host-authored match setting `engine.allowSpectators` (`readAllowSpectators`, off by default, synced verbatim in `snapshot.setup` — Invariants #99 / #101); otherwise the join is cleanly rejected (`spectators_disabled` when the capability is present but the toggle is off, `match_in_progress` when the game declares no capability). Lobby-phase and reconnect joins are always players, unchanged. An admitted spectator is bounded per session (`DEFAULT_MAX_SPECTATORS`, shared by both providers — Invariant #41), follows exactly one seated player tracked in the host-local `SpectatorRegistry` (`spectatorId → followedSeatId`, pure orchestration state that likewise never enters the snapshot, saves, or replays), and is delivered that seat's already-projected `PlayerSnapshot` through the single `StateProjector.project()` gate (Invariant #8) — the same perspective projection as any seated viewer (Invariant #98), never `GameSnapshot` (Invariant #3). The renderer treats a spectator as read-only: `GameShell` locks controls and withholds the host-only save, `renderer/app/game/page.tsx` derives `isHost = false` for a spectator (a spectator following the host's seat has `viewerId === hostId`, so the role must override the id match — keeping the deterministic-replay export host-only, Invariants #71 / #98) and no-ops `sendAction` (§4.14, §4.6, F72).

**115.** The spectate-target switch is an **out-of-band, cosmetic** channel, never simulation — the direct analog of the CHAT / PROFILE_UPDATE out-of-band rule (Invariants #72 / #62). `SPECTATE_TARGET_UPDATE` is **never** an `EngineAction`, never advances `tick`, and never enters `ActionHistory`, saves, or replays. A spectator requests a new followed seat through `window.__chimera.spectate.setFollowedTarget` → `chimera:spectate:set-target` → `LobbyManager.setSpectatorTarget` → transport `sendSpectateTarget` → host `onSpectateTargetUpdate`; the host derives the spectator from the **connection**, never a client-supplied id (Invariant #99), validates the target is a currently-seated player, re-points the `SpectatorRegistry` entry (Invariant #114), and unicasts the newly-followed seat's projection (`broadcastSpectator`) so the switch is immediate. The switch changes only which already-projected perspective the viewer receives — it mutates no simulation state and is invisible to every other peer (§4.14, §4.6, F72).

---

## Cross-References

- [System Overview](system-overview-and-context.md) — §1 executive architecture
- [Module Boundaries](module-boundaries-file-tree.md) — §3 file tree
- Full section cross-refs are listed inline per invariant using the pattern `(See §X.Y)`.
