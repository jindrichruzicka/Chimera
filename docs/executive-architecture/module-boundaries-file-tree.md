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

| Package                      | May import from                                                     | Must NOT import from                                              |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `simulation/`                | `shared/`                                                           | `renderer/`, `electron/`, `games/*`, any DOM API                  |
| `ai/`                        | `simulation/`, `shared/`                                            | `renderer/`, `electron/`, `games/*`, any DOM API                  |
| `renderer/`                  | `simulation/content` (types only), `shared/`, `renderer/` internals | `electron/main/`, `ai/engine/` (except IPC types), `games/*/data` |
| `games/<name>/`              | `simulation/`, `ai/`, `shared/`, own files                          | Other `games/` directories                                        |
| `electron/main/`             | All packages                                                        | DOM APIs                                                          |
| `networking/provider/local/` | Only within `local/`                                                | Engine or renderer internals                                      |

---

## Annotated File Tree

```
chimera/
├── electron/                        # Electron shell
│   ├── main/
│   │   ├── index.ts                 # App entry, window creation; injects dependencies and wires all subsystems
│   │   ├── ipc/                     # IPC handler registrations per preload namespace
│   │   │   ├── ipc-handlers.ts      # All contextBridge IPC registrations (one register* per namespace)
│   │   │   └── ipc-schemas.ts       # Zod schemas for IPC message payloads (validation at IPC boundaries)
│   │   ├── logging/                 # Structured logging (Pino) and crash reporting
│   │   │   ├── logger.ts            # Logger interface and factories (Pino sink, memory sink, noop); see §4.27
│   │   │   └── crash-reporter.ts    # process.on('uncaughtException'/'unhandledRejection') handler; see §4.27
│   │   ├── lobby/                   # Multiplayer lobby lifecycle and active provider management
│   │   │   └── LobbyManager.ts      # Owns the active MultiplayerProvider; lifecycle + IPC wiring
│   │   ├── runtime/                 # Simulation host and live-game runtime infrastructure
│   │   │   ├── SimulationHost.ts    # Hosts sim tick loop; calls AgentManager.tickAll() after each tick
│   │   │   ├── RealtimeTicker.ts    # SetInterval-based clock; runs game loop at specified Hz
│   │   │   ├── SessionRuntime.ts    # Manages session lifecycle: setup, teardown, player assignment
│   │   │   ├── HostSessionPipeline.ts # Orchestrates pings, broadcasts, heartbeat loop during active session
│   │   │   └── StateBroadcaster.ts  # Per-player snapshot projection via commitment scheme; network dispatch
│   │   ├── saves/                   # Game save persistence via repository pattern
│   │   │   ├── SaveManager.ts       # IPC handler; uses SaveRepository to handle save/load/list/delete
│   │   │   ├── FileSaveRepository.ts      # Default: userData/saves/<game-id>/; atomic .tmp rename
│   │   │   ├── InMemorySaveRepository.ts  # In-memory double; used by E2E fixtures for clean state
│   │   │   └── SavesIpcAdapter.ts   # Adapter that bridges SaveRepository to IPC
│   │   ├── settings/                # Application settings persistence
│   │   │   ├── SettingsManager.ts   # IPC handler; uses FileSettingsRepository for get/update/reset
│   │   │   └── FileSettingsRepository.ts  # Persists settings to userData/settings.json
│   │   └── profile/                 # Player profile and directory management
│   │       ├── ProfileManager.ts    # Profile repository + player directory owner; see §4.24
│   │       ├── FileProfileRepository.ts  # Persists profiles to userData/profiles/
│   │       ├── PlayerDirectory.ts   # Shared lobby player directory + presence tracking
│   │       └── ProfileGate.ts       # Profile validation and acceptance gate
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
│   ├── debug/                       # Debug-mode only — entire module tree-shaken out in production
│   │   ├── SnapshotRingBuffer.ts    # Observer: records last N full GameSnapshots after each ActionPipeline step
│   │   ├── SnapshotInspector.ts     # Facade: query API — get/reconstruct/diff snapshots; project to a PlayerId
│   │   ├── SnapshotDiff.ts          # Structural diff of two GameSnapshots (added/changed/removed fields)
│   │   └── DebugProtocol.ts         # Typed request/response message shapes for debug IPC channel
│   └── index.ts                     # Public API of simulation engine
│
├── games/                           # One subdirectory per game built on Chimera
│   └── <game-name>/
│       ├── state/
│       │   └── GameSnapshot.ts      # Extends BaseGameSnapshot with game-specific fields
│       ├── actions/                 # ActionDefinitions for every game-specific action type
│       │   ├── index.ts             # Calls registry.register(...) for all definitions
│       │   └── *.ts                 # One file per action (e.g. MoveUnitAction.ts)
│       ├── data/                    # Pure JSON content; no behaviour, never loaded at compiled time
│       │   ├── <collection-type>/   # One directory per collection (preferred for large sets)
│       │   └── <collection-type>.json # Flat array format (valid for small collections)
│       ├── schemas/                 # Optional Zod schemas for load-time data validation
│       ├── ai/                      # Game-specific AI implementation
│       │   ├── params/              # Extends AIParams with game-specific personality fields
│       │   ├── states/              # Concrete AIState implementations
│       │   ├── commands/            # Concrete AICommand implementations
│       │   └── index.ts             # Creates AIBrain with registered states + initial state
│       ├── projection/
│       │   └── VisibilityRules.ts   # Implements the VisibilityRules interface for this game
│       ├── screens/                 # Game-declared React UI; registered in index.ts; hosted by MatchShell
│       │   ├── index.ts             # Exports GameScreenRegistry { board, hud?, menus?, ... }
│       │   ├── BoardScreen.tsx      # The one mandatory screen
│       │   └── *.tsx                # Optional named screens (TechTree, Diplomacy, etc.)
│       ├── assets/                  # Binary assets — ONLY referenced by AssetRef strings in data/ JSON
│       │   ├── textures/            # .webp / .png
│       │   ├── models/              # .glb (Three.js-compatible binary GLTF)
│       │   ├── audio/               # .ogg (sfx) / .ogg (music)
│       │   ├── particles/           # .json (particle system configs)
│       │   └── sprites/             # .webp + .json atlas (sprite sheets)
│       ├── asset-manifest.ts        # Declares every AssetRef this game owns + priority (critical|deferred)
│       ├── settings-schema.ts       # Zod schema extending EngineSettings with game-specific fields
│       └── index.ts                 # Game entry: creates ActionRegistry, registers actions, loads content
│
├── networking/                      # Adapter between simulation and transport
│   └── provider/
│       ├── MultiplayerProvider.ts   # Interface: hostLobby() → HostedSession; joinLobby() → JoinedSession
│       ├── HostTransport.ts         # Interface: sendSnapshot, broadcastLobbyState, onActionReceived, onPlayerJoined/Left
│       ├── ClientTransport.ts       # Interface: sendAction, onSnapshotReceived, onLobbyStateChanged, onDisconnected
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
│   │   ├── match/page.tsx           # Thin shell: mounts MatchShell
│   │   ├── settings/page.tsx
│   │   └── debug/page.tsx           # debug-only: Inspector Window UI
│   ├── components/
│   │   ├── shell/                   # Engine-provided navigation chrome
│   │   │   ├── MatchShell.tsx       # Hosts the active game's screen registry; game-agnostic
│   │   │   ├── SceneRouter.tsx      # Watches sceneId / sceneTransition; see §4.18
│   │   │   ├── TransitionOverlay.tsx  # Fixed full-screen fade overlay; see §4.19
│   │   │   ├── SeatSwitcher.tsx     # Local multi-seat UI for pass-and-play
│   │   │   ├── RootErrorBoundary.tsx  # Top-level React error boundary; see §4.27
│   │   │   ├── ToastHost.tsx        # Renders transient notifications; see §4.30
│   │   │   ├── ChatPanel.tsx        # Lobby + in-match chat UI; see §4.29
│   │   │   └── perf/                # Performance HUD — toggled with F3; see §4.16
│   │   │       ├── PerfHud.tsx
│   │   │       ├── PerfProbe.tsx
│   │   │       └── perfStore.ts
│   │   ├── ui/                      # Pure 2D React UI primitives (buttons, modals)
│   │   └── r3f/                     # Reusable R3F building blocks
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
│   ├── audio/                       # Audio playback layer (§4.25)
│   │   ├── AudioManager.ts
│   │   ├── AudioBus.ts
│   │   ├── EventAudioBinding.ts
│   │   └── useSound.ts
│   ├── input/                       # Keyboard / gamepad input layer (§4.26)
│   │   ├── InputManager.ts
│   │   ├── KeyBindingRepository.ts
│   │   └── useInputAction.ts
│   ├── logging/
│   │   └── rendererLogger.ts        # see §4.27
│   ├── utils/
│   │   └── curves.ts                # Pure math: lerp, easeIn, easeOut, easeInOut; see §4.21
│   ├── hooks/
│   │   ├── useTween.ts              # see §4.21
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
│   └── constants.ts
│
├── tools/
│   ├── dev-server.ts                # Hot-reload dev harness
│   ├── dev-multiplayer.ts           # Spawns N Electron instances; see §4.32
│   ├── dev-profiles/                # Seed profiles (dev-p1.json, dev-p2.json, …)
│   ├── desync-logger.ts             # Snapshot diff log for debugging
│   ├── validate-assets.ts           # CI: verify every AssetRef string resolves to a file on disk
│   └── migrate-save.ts              # CLI: run SaveMigrator against a save file
│
└── e2e/                             # Playwright end-to-end test suite
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
        ├── match-flow.spec.ts
        ├── undo-redo.spec.ts
        ├── obfuscation.spec.ts
        ├── reconnect.spec.ts
        └── multiplayer-soak.spec.ts
```

---

## Key Invariants Referenced Here

- **Invariant #2** — `simulation/` has zero runtime dependencies on React, DOM, or networking.
- **Invariant #47** — `AssetManager` never imports from `games/*`.
- **Invariant #48** — `MatchShell.tsx` must never import from any `games/*` path.

---

## Cross-References

- [System Overview](system-overview-and-context.md) — process boundaries and context diagram
- [Architecture Invariants](architecture-invariants.md) — complete invariant list (88 entries)
- [Electron Shell and IPC Bridge](../core-components/electron-shell-ipc-bridge.md) — `electron/` in detail
- [Simulation Core](../core-components/simulation-core-action-pipeline.md) — `simulation/engine/` in detail
- [Renderer State Stores](../core-components/renderer-state-stores.md) — `renderer/state/` in detail
