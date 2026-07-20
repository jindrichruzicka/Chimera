---
title: 'Module Boundaries and File Tree'
description: 'Annotated monorepo file tree with module ownership rules, naming conventions, and hard import boundary table. Every violation is a BLOCK finding at review.'
tags: [module-boundaries, file-tree, architecture, monorepo, import-rules]
---

# Module Boundaries and File Tree

> Related: [System Overview](system-overview-and-context.md) · [Architecture Invariants](architecture-invariants.md)

---

## Naming Conventions

Filename case encodes the primary export type:

- **PascalCase** (`ActionPipeline.ts`) — exports a class or interface with the same name
- **camelCase** (`gameStore.ts`, `useAsset.ts`) — exports a Zustand store, hook, or renderer utility
- **kebab-case** (`lobby-manager.ts`) — Node.js-style module with no single dominant export symbol (Electron main, tooling scripts, test fixtures)

---

## Module Boundary Table

These boundaries are **hard constraints**. Any violation is a BLOCK finding at review.

| Package                      | May import from                                                                                                                                                                                                                                                                                                                                                                                         | Must NOT import from                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `simulation/`                | `shared/`                                                                                                                                                                                                                                                                                                                                                                                               | `renderer/`, `electron/`, `apps/*`, any DOM API                                                 |
| `ai/`                        | `simulation/`, `shared/`                                                                                                                                                                                                                                                                                                                                                                                | `renderer/`, `electron/`, `apps/*`, any DOM API                                                 |
| `renderer/`                  | `simulation/content` (types only), `shared/`, `renderer/` internals; test files may also `import type` from `simulation/settings` for cross-boundary compatibility guards (no runtime coupling)                                                                                                                                                                                                         | `electron/main/`, `ai/engine/` (except IPC types), `apps/*/data`                                |
| `apps/<game>/`               | `simulation/`, `ai/`, `shared/`, own files; renderer surfaces in `screens/` and React shell contributions in `shell/` may also import the public component-library barrels `@chimera-engine/renderer/components/ui` (primitives), `@chimera-engine/renderer/components/chat` (the shared chat component), and `@chimera-engine/renderer/components/r3f` (engine in-Canvas components, e.g. `PerfProbe`) | Other `apps/` game directories; renderer internals outside the public component-library barrels |
| `electron/main/`             | All packages                                                                                                                                                                                                                                                                                                                                                                                            | DOM APIs                                                                                        |
| `networking/provider/local/` | Only within `local/`                                                                                                                                                                                                                                                                                                                                                                                    | Engine or renderer internals                                                                    |

---

## Annotated File Tree

```
chimera/
├── electron/                        # Electron shell
│   ├── main/
│   │   ├── index.ts                 # App entry, window creation; injects dependencies and wires all subsystems
│   │   ├── debug-bridge.ts          # debug-only: chimera:debug IPC bridge + lazy Inspector window; behind the folded debug gate, pruned from packaged bundles (§4.12)
│   │   ├── ipc/                     # IPC handler registrations per preload namespace
│   │   │   ├── ipc-handlers.ts      # All contextBridge IPC registrations (one register* per namespace)
│   │   │   └── ipc-schemas.ts       # Zod schemas for IPC message payloads (validation at IPC boundaries)
│   │   ├── logging/                 # Structured logging (Pino) and crash reporting
│   │   │   ├── logger.ts            # Logger interface and factories (Pino sink, memory sink, noop); see §4.27
│   │   │   └── crash-reporter.ts    # process.on('uncaughtException'/'unhandledRejection') handler; see §4.27
│   │   ├── lobby/                   # Multiplayer lobby lifecycle and active provider management
│   │   │   ├── LobbyManager.ts      # Owns the active MultiplayerProvider; lifecycle + IPC wiring
│   │   │   ├── joinClassifier.ts    # Pure classifyJoin(): running-match join → player | spectator | reject (Invariant #114)
│   │   │   └── SpectatorRegistry.ts # Host-local spectatorId → followedSeatId ledger; never in snapshot/saves/replays (Invariant #114)
│   │   ├── runtime/                 # Simulation host and live-game runtime infrastructure
│   │   │   ├── SimulationHost.ts    # Hosts sim tick loop; calls AgentManager.tickAll() after each tick
│   │   │   ├── RealtimeTicker.ts    # SetInterval clock for manifest.realtime games; host starts/stops per match (§4.2.1)
│   │   │   ├── SessionRuntime.ts    # Manages session lifecycle: setup, teardown, player assignment
│   │   │   ├── HostSessionPipeline.ts # Orchestrates pings, broadcasts, heartbeat loop during active session
│   │   │   └── StateBroadcaster.ts  # Per-player snapshot projection via commitment scheme; network dispatch + spectator perspective fan-out (broadcastWave/broadcastSpectator, Invariant #114)
│   │   ├── saves/                   # Game save persistence via repository pattern
│   │   │   ├── SaveManager.ts       # IPC handler; uses SaveRepository to handle save/load/list/delete
│   │   │   ├── FileSaveRepository.ts      # Default: userData/saves/<game-id>/; atomic .tmp rename
│   │   │   ├── InMemorySaveRepository.ts  # In-memory double; used by E2E fixtures for clean state
│   │   │   └── SavesIpcAdapter.ts   # Adapter that bridges SaveRepository to IPC
│   │   ├── settings/                # Application settings persistence
│   │   │   ├── SettingsManager.ts   # IPC handler; uses FileSettingsRepository for get/update/reset
│   │   │   └── FileSettingsRepository.ts  # Persists settings to userData/settings.json
│   │   ├── profile/                 # Player profile and directory management
│   │   │   ├── ProfileManager.ts    # Profile repository + player directory owner; see §4.24
│   │   │   ├── FileProfileRepository.ts  # Persists profiles to userData/profiles/
│   │   │   ├── PlayerDirectory.ts   # Shared lobby player directory + presence tracking
│   │   │   └── ProfileGate.ts       # Profile validation and acceptance gate
│   │   └── dev/                     # Dev-harness graph; reached only via the CHIMERA_DEV_HARNESS-gated dynamic import (§4.32)
│   │       ├── DevHarnessCoordinator.ts  # Auto host/join/seed/ready/start flow over the LobbyManager port
│   │       └── dev-fixture-loader.ts     # Seed-profile + scenario loading, atomic announce write
│   ├── dev-harness/                 # `chimera-dev-mp` bin + harness library (spawn planning, announce handshake); see §4.32
│   ├── preload/
│   │   ├── api.ts                   # Composes the following namespaces below into window.__chimera
│   │   ├── api-types.ts             # Type-only module: ChimeraAPI, ChimeraExtensions, all namespace interfaces
│   │   ├── extensions-api.ts        # registerExtension() + buildExtensionsApi() — extension registration infrastructure
│   │   ├── game-api.ts              # window.__chimera.game — action dispatch + snapshot stream
│   │   ├── lobby-api.ts             # window.__chimera.lobby — host/join/leave/discover
│   │   ├── saves-api.ts             # window.__chimera.saves — slot list/save/load/delete
│   │   ├── settings-api.ts          # window.__chimera.settings — get/update/reset/onChange
│   │   ├── profile-api.ts           # window.__chimera.profile — local profile + lobby directory
│   │   ├── replay-api.ts            # window.__chimera.replay — export/load/playback
│   │   ├── chat-api.ts              # window.__chimera.chat — send / onMessage
│   │   ├── logs-api.ts              # window.__chimera.logs — renderer forwards structured logs to main
│   │   ├── system-api.ts            # window.__chimera.system — connection status, platform, quit
│   │   └── debug-api.ts             # debug-only: window.__chimeraDebug surface (Inspector Window only)
│
├── ai/                              # Pure TS AI framework — zero DOM, zero React, zero network
│   ├── engine/
│   │   ├── PlayerAgent.ts           # Interface: HumanPlayerAgent | AIPlayerAgent (Strategy)
│   │   ├── AgentManager.ts          # Maps PlayerId → PlayerAgent; calls tickAll() after each sim tick
│   │   ├── AIBrain.ts               # Facade: wires AIStateMachine + CommandScheduler + CommandContext
│   │   ├── AIStateMachine.ts        # State Pattern: state registry, current state, transition()
│   │   ├── AIState.ts               # AIState<TParams>: onEnter, onTick, onIdle, onExit
│   │   ├── CommandScheduler.ts      # Queue: advances current AICommand each tick; fires onIdle on empty
│   │   ├── AICommand.ts             # AICommand<TParams,TPayload>: start, tick, end, fail + CommandProgress
│   │   └── CommandContext.ts        # CommandContext: dispatch(EngineAction) + transitionState()
│   └── index.ts                     # Public API of ai engine
│
├── simulation/                      # Pure TS, zero DOM, zero React, zero network
│   ├── engine/
│   │   ├── GameState.ts             # BaseGameSnapshot — base state shape all games extend
│   │   ├── ActionEnvelope.ts        # EngineAction generic envelope; TypedAction<T,P> helper
│   │   ├── ActionRegistry.ts        # Registry: type string → ActionDefinition plus GameDefinition startup hooks
│   │   ├── ActionPipeline.ts        # Template Method: parsePayload → validate → reduce (invariant)
│   │   ├── EngineActions.ts         # Reserved engine ActionDefinitions: undo, redo, end_turn, sync, tick
│   │   ├── StateReducer.ts          # Delegates to ActionRegistry — no game-specific switch statements
│   │   ├── ActionHistory.ts         # Append-only log, pruned to the most recent TurnMemento window
│   │   ├── TurnMemento.ts           # Saves full snapshots at each player's turn-start
│   │   ├── UndoManager.ts           # Undo/redo stack via memento + event log replay
│   │   ├── SimulationClock.ts       # Advances `tick` per applied action
│   │   ├── StateBroadcaster.ts      # Projects snapshot per player; calls HostTransport.sendSnapshot()
│   │   ├── DeterministicRng.ts      # Seeded PRNG derived from (snapshot.seed, tick); passed via ReduceContext
│   │   ├── GameTimer.ts             # Tick-based deterministic timer registry; TimerManager helper; see §4.20
│   │   ├── FixedPoint.ts            # Q32.32 fixed-point integer math (mul, div, sqrt, sin, cos); see §4.31
│   │   ├── prediction/              # Optional — real-time games only; turn-based games omit this module
│   │   │   ├── ClientPredictor.ts   # Optimistic local application of own actions (predictable: true)
│   │   │   └── ReconcileBuffer.ts   # Replays unconfirmed actions on top of authoritative snapshots
│   ├── projection/                  # StateProjector + commitment scheme — fog-of-war, cryptographic commitment (§8)
│   │   ├── index.ts                 # Public API: exports types for state projection
│   │   ├── types.ts                 # ObservedEntityState, ObservedPlayerState, VisibilityRules, VisibilityScope
│   │   └── types.test.ts            # Test coverage for projection types
│   ├── content/                      # OPTIONAL — games with no static content omit this
│   │   ├── DataRef.ts               # DataRef<T> branded type; buildRef() / parseRef() helpers
│   │   ├── AssetRef.ts              # AssetRef<T> branded type — phantom-typed path string; zero renderer deps
│   │   ├── ContentDatabase.ts       # Immutable query interface; createContentDatabase() factory
│   │   └── ContentLoader.ts         # Loads JSON sources, validates, merges, builds ContentDatabase
│   ├── persistence/                 # Save/load — pure serialisation logic, zero FS/IPC deps
│   │   ├── SaveFile.ts              # SaveFile schema: checkpoint snapshot + delta action log + metadata
│   │   ├── SaveSerializer.ts        # Strategy interface: serialize(SaveFile) / deserialize(string)
│   │   ├── JsonSaveSerializer.ts    # Default: pretty JSON (human-readable, debuggable)
│   │   ├── CompressedSaveSerializer.ts # zlib gzip wrapper around JsonSaveSerializer
│   │   └── SaveMigrator.ts          # Applies versioned migrations when loading an older save schema
│   ├── settings/                    # Settings schema and merge logic — zero DOM, zero IPC deps
│   │   ├── SettingsSchema.ts        # EngineSettings base interface; GameSettingsSchema<T> generic
│   │   ├── SettingsMerger.ts        # Layered merge: engine defaults ← game defaults ← user overrides
│   │   └── SettingsRepository.ts   # Repository interface: load / save / reset per game-id
│   ├── profile/                     # Client-local player identity (§4.24) — pure schema + sanitisation, zero IO
│   │   ├── ProfileSchema.ts         # EngineProfile base (displayName, avatar, locale); GameProfileSchema<T> generic
│   │   ├── ProfileSanitizer.ts      # Host-side admission: size caps, schema, image content check
│   │   └── ProfileRepository.ts     # Repository interface: load / save / listLocalSlots
│   ├── replay/                      # Deterministic replay format (§4.28) — pure serialisation, zero IO
│   │   ├── ReplayFile.ts            # ReplayFile schema: seed + ActionHistory + metadata
│   │   ├── ReplaySerializer.ts      # Strategy: serialize / deserialize; JSON + gzip variants
│   │   └── ReplayPlayer.ts          # Feeds actions back through ActionPipeline at configurable speed
│   ├── input/                       # Input action schema (§4.26) — shared between renderer and settings
│   │   ├── InputAction.ts           # InputAction ID namespaces (engine:*, game:*); registry contract
│   │   └── InputBindingSchema.ts    # EngineBindings base; GameBindingSchema<T> generic; default bindings
│   ├── debug/                       # Debug-mode only — gate folds to false in packaged builds; graph pruned, not shipped
│   │   ├── SnapshotRingBuffer.ts    # Observer: records last N full GameSnapshots after each ActionPipeline step
│   │   ├── SnapshotInspector.ts     # Facade: query API — get/reconstruct/diff snapshots; project to a PlayerId
│   │   ├── SnapshotDiff.ts          # Structural diff of two GameSnapshots (added/changed/removed fields)
│   │   └── DebugProtocol.ts         # Typed request/response message shapes for debug IPC channel
│   └── index.ts                     # Public API of simulation engine
│
├── apps/                            # One application per game built on Chimera (layer-3 consumers;
│   └── <game>/                      #   `create-chimera-game` scaffolds this exact layout from templates/blank)
│       ├── simulation/              # Deterministic gameplay — pure, no DOM/IPC/renderer imports; covered by the
│       │   │                        #   apps/*/simulation ESLint purity + boundary zones (Invariants #1, #43)
│       │   ├── actions.ts           # ActionDefinitions (validators + reducers) registered on the ActionRegistry
│       │   ├── constants.ts         # Game tokens: gameId, '<gameId>:*' action namespace, board extents, setting keys
│       │   ├── entities.ts          # Deterministic initial entity/board setup (optional for stateless games)
│       │   ├── visibility-rules.ts  # Implements the VisibilityRules interface for host-side state projection
│       │   └── <subsystem>/         # Gameplay subsystems as the game grows (turn gating, resource ledgers, ...)
│       ├── ai/                      # Game-specific AI policy (imports @chimera-engine/ai + own simulation/ only)
│       ├── content/                 # Typed content-collection definitions consumed by the Content DB
│       ├── data/                    # Pure JSON content; loaded by the host at startup, shipped by electron-builder
│       │   ├── <collection-type>/   # One directory per collection (preferred for large sets)
│       │   └── <collection-type>.json # Flat array format (valid for small collections)
│       ├── assets/                  # Binary assets (audio, fonts, icons, textures) — referenced by AssetRef strings
│       ├── scene/                   # R3F scene contributions (board meshes, selection markers, camera model)
│       ├── screens/                 # Game-declared React UI (board + HUD); exported via screens/index.tsx registry
│       ├── shell/                   # Declarative shell contributions (main menu, settings page, fonts, backgrounds)
│       ├── styles/                  # Design-token overrides (tokens-override.css + registration)
│       ├── lobby/                   # Lobby-setup contribution (agent slots, match settings)
│       ├── renderer/                # Per-app Next.js app (output: export) + register.ts game-registration seam
│       ├── electron/                # Electron main composition root (main.ts) + build-main.ts esbuild bundler
│       ├── e2e/                     # Playwright E2E suite (fixtures, page objects, specs)
│       ├── asset-manifest.ts        # Declares every AssetRef this game owns + priority (critical|deferred)
│       ├── manifest.ts              # GameManifest: displayName/window title, realtime + tickRateMs, optional icon + cursor + logoScreen + languages + spectators
│       ├── settings-schema.ts       # Zod schema extending EngineSettings with game-specific fields
│       └── package.json             # App identity + scripts; engine packages as devDependencies (#817),
│                                    #   plus tsconfig.json / tsconfig.build.json / electron-builder.yml
│
├── networking/                      # Adapter between simulation and transport
│   └── provider/
│       ├── MultiplayerProvider.ts   # Interface: hostLobby() → HostedSession; joinLobby() → JoinedSession
│       ├── HostTransport.ts         # Interface: sendSnapshot, broadcastLobbyState, onActionReceived, onPlayerJoined/Left + onSpectateTargetUpdate (Invariant #115)
│       ├── ClientTransport.ts       # Interface: sendAction, onSnapshotReceived, onLobbyStateChanged, onDisconnected + sendSpectateTarget (Invariant #115)
│       ├── spectator-policy.ts       # Shared DEFAULT_MAX_SPECTATORS admission cap (both providers, Invariant #114)
│       ├── local/                   # LocalWebSocketProvider — default; fully encapsulated
│       │   ├── LocalWebSocketProvider.ts
│       │   ├── server/              # ws server internals — no imports from outside local/
│       │   └── client/              # ws client internals
│       └── steam/                   # Future placeholder — Steamworks SDK provider
│           └── SteamNetworkProvider.ts
│
├── renderer/                        # Next.js static export app
│   ├── app/                         # Next.js App Router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # Main menu entry
│   │   ├── lobby/page.tsx
│   │   ├── match/page.tsx           # Thin shell: mounts GameShell
│   │   ├── settings/page.tsx
│   │   └── debug/page.tsx           # debug-only: server gate — notFound() in packaged builds; UI in DebugInspectorClient.tsx
│   ├── components/
│   │   ├── shell/                   # Engine-provided navigation chrome
│   │   │   ├── GameShell.tsx       # Hosts the active game's screen registry; game-agnostic
│   │   │   ├── SpectatorHud.tsx     # Read-only spectator overlay: followed-seat name + Tab switch hotkey (Invariants #114/#115)
│   │   │   ├── SceneRouter.tsx      # Watches sceneId / sceneTransition; see §4.18
│   │   │   ├── TransitionOverlay.tsx  # Fixed full-screen fade overlay; see §4.19
│   │   │   ├── RootErrorBoundary.tsx  # Top-level React error boundary; see §4.27
│   │   │   ├── ToastHost.tsx        # Renders transient notifications; see §4.30
│   │   │   ├── perf/                # Performance HUD — toggled with F3; see §4.16
│   │   │   │   ├── PerfHud.tsx
│   │   │   │   ├── PerfProbe.tsx
│   │   │   │   └── perfStore.ts
│   │   │   └── debug/               # Debug Inspector F9 toggle — headless; see §4.12
│   │   │       └── DebugInspectorToggle.tsx
│   │   ├── audio/                   # Event-driven audio playback components (e.g. EventAudioPlayer)
│   │   ├── chat/                    # PUBLIC chat component (Tier 2); barrel: @chimera-engine/renderer/components/chat; mounted by game HUDs only; see §4.35.1
│   │   │   ├── index.ts             # Public barrel
│   │   │   └── ChatPanel.tsx        # In-match chat UI; see §4.29
│   │   ├── ui/                      # PUBLIC UI primitive library (Tier 1); barrel: @chimera-engine/renderer/components/ui (includes <LanguageSelector>, §4.39)
│   │   └── r3f/                     # Reusable R3F building blocks; PUBLIC barrel: @chimera-engine/renderer/components/r3f (curated in-Canvas components only)
│   │       ├── index.ts             # Public barrel (currently exports PerfProbe; internals below stay unexported)
│   │       ├── GameCanvas.tsx       # <Canvas> root; cameraMode + cameraPreset props; see §4.22
│   │       ├── InteractionBlocker.tsx  # Context provider; see §4.23
│   │       └── primitives/          # Shared meshes / materials
│   ├── state/
│   │   ├── gameStore.ts             # Zustand: receives PlayerSnapshot from IPC
│   │   ├── lobbyStore.ts
│   │   ├── uiStore.ts
│   │   ├── saveStore.ts
│   │   ├── settingsStore.ts
│   │   ├── profileStore.ts          # see §4.24
│   │   ├── chatStore.ts             # see §4.29
│   │   └── toastStore.ts            # see §4.30
│   ├── assets/                      # Asset loading layer
│   │   ├── AssetManager.ts
│   │   ├── AssetResolver.ts
│   │   ├── AssetPreloader.ts
│   │   └── useAsset.ts
│   ├── game/
│   │   ├── rendererGameRegistry.ts  # Game shell/screen/asset registration bridge
│   │   ├── gameShellAssetSource.ts  # Local game-asset-ref resolver for shell fonts/images/cursors
│   │   ├── GameFontLoader.ts        # Loads GameFontFace self-hosted fonts through the renderer protocol
│   │   ├── GameImageWarmup.ts       # Fetch+decode warm-up for shell.preloadImages (§4.37.13)
│   │   └── gameCursorStyles.ts      # shell.cursor → --ch-cursor-* hardware-cursor overrides (§4.37.14)
│   ├── audio/                       # Audio playback layer (§4.25)
│   │   ├── AudioManager.ts
│   │   ├── AudioBus.ts
│   │   ├── EventAudioBinding.ts
│   │   └── useSound.ts
│   ├── input/                       # Keyboard / gamepad input layer (§4.26)
│   │   ├── InputManager.ts
│   │   ├── KeyBindingRepository.ts
│   │   └── useInputAction.ts
│   ├── i18n/                         # Renderer-only i18n runtime (§4.39); public barrel: @chimera-engine/renderer/i18n
│   │   ├── index.ts                 # Public barrel (re-export only, side-effect-free)
│   │   ├── translation-bundle.ts    # resolveTranslation() fallback chain: game override → engine English → raw
│   │   ├── format-message.ts        # Pure ICU-subset formatter (param, plural, select)
│   │   ├── engine-keys.ts           # engine.<area>.<name> token catalogue
│   │   ├── engine-bundle.en.ts      # engineBundleEn — the sole engine (English) bundle
│   │   ├── i18n-context.ts          # I18nContext, TranslateFn
│   │   ├── I18nProvider.tsx         # Locale resolve + bundle merge + t
│   │   ├── TokenModeI18nProvider.tsx  # Store-connected wrapper (debug token-mode + active-game bundle)
│   │   ├── useTranslate.ts          # useTranslate() — throws outside I18nProvider (#83)
│   │   └── useActiveGameTranslations.ts  # Resolves active game's locale/languages/override bundle
│   ├── shell/
│   │   └── SettingsLanguageSelector.tsx  # Store-connected wrapper for the settings Language field (§4.39)
│   ├── logging/
│   │   └── rendererLogger.ts        # see §4.27
│   ├── utils/
│   │   └── curves.ts                # Pure math: lerp, easeIn, easeOut, easeInOut; see §4.21
│   ├── hooks/
│   │   ├── useTween.ts              # see §4.21
│   │   ├── useTweenCallback.ts      # see §4.21
│   │   ├── useCamera.ts             # see §4.22
│   │   ├── useGameInteraction.ts    # see §4.23
│   │   └── useFadeTransition.ts     # see §4.19
│   └── bridge/
│       └── ipcClient.ts             # Wraps window.__chimera, typed
│
├── shared/                          # Types shared across all packages
│   ├── messages.ts                  # Typed WS message shapes (client ↔ server)
│   ├── snapshot.ts                  # GameSnapshot (full truth) + PlayerSnapshot (projected view)
│   ├── logging.ts                   # LogLevel, LogEntry; see §4.27
│   ├── game-manifest-contract.ts    # GameManifest (display name, window title, realtime/tickRateMs, icon, cursor, logoScreen, languages, spectators) + resolvers (§4.2.1)
│   ├── dev-fixture-contract.ts      # Dev-harness fixture schemas (DevScenario, DevAnnounce) + pure helpers; see §4.32
│   └── constants.ts
│
├── tools/
│   ├── dev-server.ts                # Hot-reload dev harness
│   ├── fetch-google-fonts.ts        # Dev-time Google Fonts downloader; writes committed self-hosted .woff2 files
│   ├── desync-logger.ts             # Snapshot diff log for debugging
│   ├── validate-assets.ts           # CI: verify AssetRef strings and GameFontFace files resolve to disk
│   └── migrate-save.ts              # CLI: run SaveMigrator against a save file
│
└── apps/tactics/e2e/                # Playwright end-to-end test suite (owned by the tactics consumer app)
    ├── playwright.config.ts
    ├── fixtures/
    │   ├── electron.fixture.ts
    │   ├── lobby.fixture.ts
    │   └── game.fixture.ts
    ├── pages/                       # Page Object Models
    ├── helpers/
    │   ├── ipc-spy.ts
    │   ├── ws-inspector.ts
    │   ├── snapshot-assert.ts
    │   └── tick-driver.ts
    └── tests/
        ├── lobby.spec.ts
        ├── game-flow.spec.ts
        ├── undo-redo.spec.ts
        ├── obfuscation.spec.ts
        ├── reconnect.spec.ts
        └── multiplayer-soak.spec.ts
```

---

## Key Invariants Referenced Here

- **Invariant #2** — `simulation/` has zero runtime dependencies on React, DOM, or networking.
- **Invariant #47** — `AssetManager` never imports from `apps/*` game code.
- **Invariant #48** — `GameShell.tsx` must never import from any `apps/*` game path.

---

## Cross-References

- [System Overview](system-overview-and-context.md) — process boundaries and context diagram
- [Architecture Invariants](architecture-invariants.md) — complete invariant list
- [Electron Shell and IPC Bridge](../core-components/electron-shell-ipc-bridge.md) — `electron/` in detail
- [Simulation Core](../core-components/simulation-core-action-pipeline.md) — `simulation/engine/` in detail
- [Renderer State Stores](../core-components/renderer-state-stores.md) — `renderer/state/` in detail
- [Spectator Mode Contract](../core-components/spectator-mode-contract.md) — read-only spectators, the join classifier, and perspective projection (F72)
