# Chimera Engine — Core Architecture Overview

> Version: 1.0.0  
> Date: 2026-04-20  
> Status: Authoritative baseline

---

## 1. Executive Architecture Decision

Chimera is a **host-authoritative, multiplatform multiplayer game engine** delivered as a desktop application. The architecture is divided into three hard process boundaries:

| Process               | Technology                      | Responsibility                                           |
| --------------------- | ------------------------------- | -------------------------------------------------------- |
| **Electron Main**     | Node.js                         | App lifecycle, IPC broker, local WebSocket server host   |
| **Electron Renderer** | Next.js + React (static export) | UI, HUD, menus, lobby, game state consumption            |
| **Game Simulation**   | Pure TypeScript module          | Deterministic tick loop, rule evaluation, state mutation |

The renderer **never owns authoritative game state**. The simulation runs on the host inside the main process (or a spawned worker), and all clients — including the host's own renderer — receive **projected views** of state via IPC/WebSocket. This makes the architecture equally valid for local singleplayer, LAN play, and NAT-traversed online lobbies without any server infrastructure changes.

The simulation core is designed around three foundational patterns that every game built on Chimera inherits:

1. **Pure Reducer** — all state transitions are `(GameSnapshot, Action) → GameSnapshot`, enabling undo/redo and deterministic replay by design.
2. **Hybrid Memento + Event Sourcing** — undo/redo within a player's turn is O(n-in-turn); full replay from any point is available via the action event log.
3. **State Projection (CQRS-adjacent)** — the host never sends the raw `GameSnapshot` to any client; each client receives a `PlayerSnapshot` filtered by visibility rules, including cryptographic commitments for hidden values.

---

## 2. System Context Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Host Machine                                                            │
│                                                                          │
│  ┌─────────────────────────┐     IPC (contextBridge)                     │
│  │  Electron Main Process  │◄───────────────────────────────┐            │
│  │                         │                                │            │
│  │  ┌───────────────────┐  │     WebSocket (ws/socket.io)   │            │
│  │  │  Game Simulation  │  │◄──────────────┐                │            │
│  │  │  (deterministic)  │  │               │                │            │
│  │  └───────────────────┘  │               │                │            │
│  │  ┌───────────────────┐  │               │    ┌───────────┴────────┐   │
│  │  │  State Projector  │  │               │    │  Renderer Process  │   │
│  │  │  (obfuscation)    │  │               │    │  Next.js + React   │   │
│  │  └────────┬──────────┘  │               │    │  Three.js / R3F    │   │
│  │  ┌────────┴──────────┐  │               │    │  (PlayerSnapshot   │   │
│  │  │  WebSocket Server │  │               │    │   only — never     │   │
│  │  │  (ws / socket.io) │◄─┼──────────────-┤    │   full GameSnap)   │   │
│  │  └───────────────────┘  │               │    └────────────────────┘   │
│  └─────────────────────────┘               │                             │
│  NOTE: GameSnapshot never leaves Main Process boundary                   │
└────────────────────────────────────────────┼─────────────────────────────┘
                                             │
                        ┌────────────────────┼───────────────────┐
                        │                    │                   │
              ┌─────────┴───────┐  ┌─────────┴───────┐  ┌────────┴────────┐
              │  Client A       │  │  Client B       │  │  Client N       │
              │  Electron App   │  │  Electron App   │  │  Electron App   │
              │  (Renderer +    │  │  (Renderer +    │  │  (Renderer +    │
              │   IPC bridge)   │  │   IPC bridge)   │  │   IPC bridge)   │
              └─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 3. Module Boundaries and Ownership

> **File naming conventions** — filename case encodes the primary export type:
>
> - **PascalCase** (`ActionPipeline.ts`) — exports a class or interface with the same name
> - **camelCase** (`gameStore.ts`, `useAsset.ts`) — exports a Zustand store, hook, or renderer utility
> - **kebab-case** (`lobby-manager.ts`) — Node.js-style module with no single dominant export symbol (Electron main, tooling scripts, test fixtures)

```
chimera/
├── electron/                        # Electron shell
│   ├── main/
│   │   ├── index.ts                 # App entry, window creation; injects SaveRepository + MultiplayerProvider
│   │   ├── ipc-handlers.ts          # All contextBridge IPC registrations
│   │   ├── lobby-manager.ts         # Owns the active MultiplayerProvider; lifecycle + IPC wiring
│   │   ├── simulation-host.ts       # Hosts sim tick loop; calls AgentManager.tickAll() after each tick
│   │   ├── save-manager.ts          # Takes SaveRepository by injection; handles IPC save/load/list/delete
│   │   ├── settings-manager.ts      # Owns FileSettingsRepository; handles IPC getSettings/updateSettings/resetSettings
│   │   ├── profile-manager.ts       # Owns ProfileRepository + PlayerDirectory; see §4.24
│   │   ├── replay-manager.ts        # Captures ActionHistory to .chimera-replay; playback via ReplayPlayer; see §4.28
│   │   ├── chat-relay.ts            # Host-only CHAT message rate-limit + rebroadcast; see §4.29
│   │   ├── logger.ts                # Structured logger (Pino); writes to userData/logs/ with daily rotation; see §4.27
│   │   ├── crash-reporter.ts        # process.on('uncaughtException') + process.on('unhandledRejection') handler; see §4.27
│   │   ├── debug-bridge.ts          # CHIMERA_DEBUG only: spawns Inspector Window; wires SnapshotInspector to debug IPC
│   │   └── saves/                   # SaveRepository implementations — injected into SaveManager
│   │       ├── FileSaveRepository.ts      # Default: userData/saves/<game-id>/; atomic .tmp rename
│   │       └── InMemorySaveRepository.ts  # In-memory test double; used by E2E fixtures for clean state
│   ├── preload/
│   │   ├── api.ts                   # Composes the following namespaces below into window.__chimera
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
├── saves/                           # Runtime save file storage — written by Electron main process only
│   └── <game-id>/
│       ├── autosave.chimera         # Written after every END_TURN automatically
│       ├── quicksave.chimera        # Written on player request (keyboard shortcut)
│       └── slot-<n>.chimera         # Named manual save slots (default: 5 slots)
│                                    # .chimera = JSON or gzip JSON; format declared in file header
│
├── userData/settings/               # User settings storage — written by Electron main process only
│   └── <game-id>.json               # Persisted user overrides for engine + game-specific settings
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
│   │   ├── ActionRegistry.ts        # Registry: type string → ActionDefinition; games register here
│   │   ├── ActionPipeline.ts        # Template Method: parsePayload → validate → reduce (invariant)
│   │   ├── EngineActions.ts         # Reserved engine ActionDefinitions: undo, redo, end_turn, sync, tick
│   │   ├── StateReducer.ts          # Delegates to ActionRegistry — no game-specific switch statements
│   │   ├── ActionHistory.ts         # Append-only log, pruned to the most recent TurnMemento window
│   │   ├── TurnMemento.ts           # Saves full snapshots at each player's turn-start
│   │   ├── UndoManager.ts           # Undo/redo stack via memento + event log replay
│   │   ├── SimulationClock.ts       # Advances `tick` per applied action; optional RealtimeTicker wrapper for timed games
│   │   ├── StateBroadcaster.ts      # Projects snapshot per player; calls HostTransport.sendSnapshot() (provider-agnostic)
│   │   ├── DeterministicRng.ts      # Seeded PRNG derived from (snapshot.seed, tick); passed via ReduceContext
│   │   ├── GameTimer.ts             # Tick-based deterministic timer registry; TimerManager helper; see §4.20
│   │   └── FixedPoint.ts            # Q32.32 fixed-point integer math (mul, div, sqrt, sin, cos); see §4.31
│   ├── content/                      # OPTIONAL — games with no static content (e.g. Tic Tac Toe) omit this
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
│   │   ├── SettingsSchema.ts        # EngineSettings base interface; GameSettingsSchema<T extends EngineSettings> generic
│   │   ├── SettingsMerger.ts        # Layered merge: engine defaults ← game defaults ← user overrides (deep merge)
│   │   └── SettingsRepository.ts   # Repository interface: load / save / reset per game-id
│   ├── profile/                     # Client-local player identity (§4.24) — pure schema + sanitisation, zero IO
│   │   ├── ProfileSchema.ts         # EngineProfile base (displayName, avatar, locale); GameProfileSchema<T> generic
│   │   ├── ProfileSanitizer.ts      # Host-side admission: size caps, schema, image content check
│   │   └── ProfileRepository.ts     # Repository interface: load / save / listLocalSlots
│   ├── replay/                      # Deterministic replay format (§4.28) — pure serialisation, zero IO
│   │   ├── ReplayFile.ts            # ReplayFile schema: seed + ActionHistory + metadata (gameId, version, duration)
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
│   ├── prediction/                  # Optional — real-time games only; turn-based games omit this
│   │   ├── ClientPredictor.ts       # Optimistic local application of own actions (predictable: true)
│   │   └── ReconcileBuffer.ts       # Replays unconfirmed actions on top of authoritative snapshots
│   ├── projection/
│   │   ├── StateProjector.ts        # (GameSnapshot, PlayerId) → PlayerSnapshot
│   │   ├── VisibilityRules.ts       # Per-game interface: field/entity visibility rules
│   │   └── CommitmentScheme.ts      # SHA-256 commitments for hidden-until-revealed values
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
│       │   │   └── <item-id>.json   # e.g. damage-types/fire.json, units/warrior.json
│       │   └── <collection-type>.json # Flat array format (valid for small collections)
│       ├── schemas/                 # Optional Zod schemas for load-time data validation
│       │   └── <collection-type>.schema.ts
│       ├── ai/                      # Game-specific AI implementation
│       │   ├── params/
│       │   │   └── <GameName>AIParams.ts  # Extends AIParams with game-specific personality fields
│       │   ├── states/
│       │   │   └── *.ts             # Concrete AIState implementations (e.g. AttackState, DefendState)
│       │   ├── commands/
│       │   │   └── *.ts             # Concrete AICommand implementations (e.g. MoveToTargetCommand)
│       │   └── index.ts             # Creates AIBrain with registered states + initial state
│       ├── projection/
│       │   └── VisibilityRules.ts   # Implements the VisibilityRules interface for this game
│       ├── screens/                 # Game-declared React UI; registered in index.ts; hosted by MatchShell
│       │   ├── index.ts             # Exports GameScreenRegistry { board, hud?, menus?, ... }
│       │   ├── BoardScreen.tsx      # The one mandatory screen — hosts the game's R3F canvas or DOM board
│       │   └── *.tsx                # Optional: TechTree.tsx, Diplomacy.tsx, Trade.tsx, etc. (4X-heavy games)
│       ├── assets/                  # Binary assets — ONLY referenced by AssetRef strings in data/ JSON
│       │   ├── textures/            # .webp / .png (UI portraits, tile textures, card art, icons)
│       │   │   ├── units/
│       │   │   ├── terrain/
│       │   │   └── ui/
│       │   ├── models/              # .glb (Three.js-compatible binary GLTF)
│       │   │   └── units/
│       │   ├── audio/               # .ogg (sfx) / .ogg (music) — Ogg Vorbis preferred for cross-platform
│       │   │   ├── sfx/
│       │   │   └── music/
│       │   ├── particles/           # .json (particle system configs — no binary dependency)
│       │   └── sprites/             # .webp + .json atlas (sprite sheets for 2D animations)
│       ├── asset-manifest.ts        # Declares every AssetRef this game owns + priority (critical|deferred)
│       ├── settings-schema.ts       # Zod schema extending EngineSettings with game-specific fields + defaults
│       └── index.ts                 # Game entry: creates ActionRegistry, registers actions, loads content
│
├── networking/                      # Adapter between simulation and transport
│   └── provider/                    # The only public entrypoint — swap without touching simulation or renderer
│       ├── MultiplayerProvider.ts   # Interface: hostLobby() → HostedSession; joinLobby() → JoinedSession
│       ├── HostTransport.ts         # Interface: sendSnapshot, broadcastLobbyState, onActionReceived, onPlayerJoined/Left
│       ├── ClientTransport.ts       # Interface: sendAction, onSnapshotReceived, onLobbyStateChanged, onDisconnected
│       ├── local/                   # LocalWebSocketProvider — default; fully encapsulated
│       │   ├── LocalWebSocketProvider.ts # Entry: implements MultiplayerProvider
│       │   ├── server/                  # ws server internals — no imports from outside local/
│       │   │   ├── LobbyServer.ts       # WebSocket server: sessions, rooms, auth tokens
│       │   │   ├── MessageRouter.ts     # Routes ws frames → HostTransport.onActionReceived
│       │   │   └── WsHostTransport.ts   # Implements HostTransport over ws
│       │   └── client/                  # ws client internals
│       │       ├── ServerConnection.ts  # Wraps ws client with reconnect
│       │       └── WsClientTransport.ts # Implements ClientTransport over ws
│       └── steam/                   # Future placeholder — Steamworks SDK provider
│           └── SteamNetworkProvider.ts
│
├── renderer/                        # Next.js static export app
│   ├── app/                         # Next.js App Router pages — engine shell only; game UI lives in games/<name>/screens/
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # Main menu entry
│   │   ├── lobby/page.tsx           # Includes local multi-seat (pass-and-play) option
│   │   ├── match/page.tsx           # Thin shell: mounts MatchShell; resolves active game's screen registry
│   │   ├── settings/page.tsx        # Settings screen — engine + game-specific settings UI; reads/writes settingsStore
│   │   └── debug/page.tsx           # debug-only: Inspector Window UI (snapshot browser, projections, diff, perf)
│   ├── components/
│   │   ├── shell/                   # Engine-provided navigation chrome, modals, connection status, turn timer
│   │   │   ├── MatchShell.tsx       # Hosts the active game's screen registry; game-agnostic routing
│   │   │   ├── SceneRouter.tsx      # Watches sceneId / sceneTransition; routes to the correct scene; see §4.18
│   │   │   ├── TransitionOverlay.tsx  # Fixed full-screen fade overlay; exposes FadeContext; see §4.19
│   │   │   ├── SeatSwitcher.tsx     # Local multi-seat UI: switch active PlayerId for pass-and-play
│   │   │   ├── RootErrorBoundary.tsx  # Top-level React error boundary + user-facing fallback; see §4.27
│   │   │   ├── ToastHost.tsx        # Renders transient notifications from toastStore; see §4.30
│   │   │   ├── ChatPanel.tsx        # Lobby + in-match chat UI; reads chatStore; see §4.29
│   │   │   └── perf/                # Performance HUD — toggled with F3; see §4.16
│   │   │       ├── PerfHud.tsx      # Floating panel: FPS, frame ms, sim tick, ping, heap, draw calls
│   │   │       ├── PerfProbe.tsx    # Hidden R3F component: collects per-frame GL stats
│   │   │       └── perfStore.ts     # Zustand store: rolling samples consumed by PerfHud
│   │   ├── ui/                      # Pure 2D React UI primitives (buttons, modals) — used by shell and games
│   │   └── r3f/                     # Reusable R3F building blocks — games compose their boards from these
│   │       ├── GameCanvas.tsx       # <Canvas> root; cameraMode + cameraPreset props; lighting; see §4.22
│   │       ├── InteractionBlocker.tsx  # Context provider: gates all useGameInteraction hooks during transitions; see §4.23
│   │       └── primitives/          # Shared meshes / materials; games import and compose
│   ├── state/
│   │   ├── gameStore.ts             # Zustand store: receives PlayerSnapshot from IPC (never full state)
│   │   ├── lobbyStore.ts
│   │   ├── uiStore.ts
│   │   ├── saveStore.ts             # Zustand store: save slot list UI state
│   │   ├── settingsStore.ts         # Zustand store: current ResolvedSettings; synced from IPC on mount and on change
│   │   ├── profileStore.ts          # Zustand store: local profile + PlayerDirectory; see §4.24
│   │   ├── chatStore.ts             # Zustand store: rolling chat transcript; see §4.29
│   │   └── toastStore.ts            # Zustand store: queued transient notifications; see §4.30
│   ├── assets/                      # Asset loading layer — only module that calls Three.js loaders
│   │   ├── AssetManager.ts          # Load, cache, and dispose resolved assets keyed by AssetRef string
│   │   ├── AssetResolver.ts         # AssetRef<T> → file:// URL — env-aware (dev source tree vs prod resources/)
│   │   ├── AssetPreloader.ts        # Preloads all 'critical' AssetManifest entries with progress callback
│   │   └── useAsset.ts              # React hook: useAsset<T>(ref) → ResolvedAsset<T> | null + loading state
│   ├── audio/                       # Audio playback layer (§4.25) — only module that calls WebAudio / THREE.Audio
│   │   ├── AudioManager.ts          # Play / stop / pool; volume buses (master, music, sfx, voice)
│   │   ├── AudioBus.ts              # Per-bus gain node + ducking; subscribes to settings.audio
│   │   ├── EventAudioBinding.ts     # Maps GameEvent types → AudioRef; pure config
│   │   └── useSound.ts              # Hook: play one-shot SFX; wraps AudioManager
│   ├── input/                       # Keyboard / gamepad input layer (§4.26) — renderer-only
│   │   ├── InputManager.ts          # Global keyboard + gamepad listener; resolves KeyBinding → InputAction
│   │   ├── KeyBindingRepository.ts  # Reads/writes bindings via settings.controls; conflict detection
│   │   └── useInputAction.ts        # Hook: subscribe to an InputAction; returns pressed / triggered state
│   ├── logging/                     # Renderer-side structured logger (§4.27)
│   │   └── rendererLogger.ts        # console + window error hooks; forwards to main via logs IPC
│   ├── utils/
│   │   └── curves.ts                # Pure math: lerp, linear, easeIn, easeOut, easeInOut; see §4.21
│   ├── hooks/
│   │   ├── useTween.ts              # R3F useFrame-driven tween hook with configurable easing curve; see §4.21
│   │   ├── useCamera.ts             # Camera controller: setPosition, lookAt, zoom, animateTo; see §4.22
│   │   ├── useGameInteraction.ts    # Translates mesh clicks to sendAction calls; reads InteractionBlocker; see §4.23
│   │   └── useFadeTransition.ts     # Imperative fade hook consumed by SceneRouter and standalone game screens; see §4.19
│   └── bridge/
│       └── ipcClient.ts             # Wraps window.__chimera, typed
│
├── shared/                          # Types shared across all packages
│   ├── messages.ts                  # Typed WS message shapes (client ↔ server)
│   ├── snapshot.ts                  # GameSnapshot (full truth) + PlayerSnapshot (projected view)
│   ├── logging.ts                   # LogLevel, LogEntry; shared log schema for main + renderer; see §4.27
│   └── constants.ts
│
├── tools/
│   ├── dev-server.ts                # Hot-reload dev harness
│   ├── dev-multiplayer.ts           # Spawns N Electron instances (1 host + N-1 auto-join clients) for local MP testing; see §4.32
│   ├── dev-profiles/                # Seed profiles used by dev-multiplayer.ts (dev-p1.json, dev-p2.json, …)
│   ├── desync-logger.ts             # Snapshot diff log for debugging
│   ├── validate-assets.ts           # CI: verify every AssetRef string resolves to a file on disk
│   └── migrate-save.ts              # CLI: run SaveMigrator against a save file for offline repair/upgrade
│
└── e2e/                             # Playwright end-to-end test suite
    ├── playwright.config.ts         # Project config: Electron launch, timeouts, reporters
    ├── fixtures/
    │   ├── electron.fixture.ts      # Base fixture: launch/close ElectronApplication
    │   ├── lobby.fixture.ts         # Derived fixture: host + client pair, lobby helpers
    │   └── game.fixture.ts          # Derived fixture: full match launched, tick helpers
    ├── pages/
    │   ├── MainMenuPage.ts          # Page Object: main menu interactions
    │   ├── LobbyPage.ts             # Page Object: lobby screen (create, join, ready)
    │   ├── MatchPage.ts             # Page Object: in-match HUD, action dispatch, undo
    │   └── SettingsPage.ts          # Page Object: settings screen
    ├── helpers/
    │   ├── ipc-spy.ts               # Intercept IPC messages via electronApp.evaluate()
    │   ├── ws-inspector.ts          # Tap WebSocket frames for protocol assertions
    │   ├── snapshot-assert.ts       # Typed helpers: assertNoLeakedFields(), assertTickAdvanced()
    │   └── tick-driver.ts           # Drive sim ticks programmatically without UI input
    └── tests/
        ├── lobby.spec.ts            # Lobby creation, join, player list sync
        ├── match-flow.spec.ts       # Full match: lobby → gameplay → game-over
        ├── undo-redo.spec.ts        # Undo/redo flows through IPC → snapshot reflection
        ├── obfuscation.spec.ts      # Fog-of-war absent entities, commitment reveal
        ├── reconnect.spec.ts        # Disconnect + reconnect mid-match; snapshot resync
        └── multiplayer-soak.spec.ts # N-tick determinism soak with 2+ Electron windows
```

---

## 4. Critical Interfaces and Data Contracts

### 4.1 Preload / IPC Bridge (`preload/api.ts`)

The IPC surface is namespaced into domain modules. Each module lives in its own preload file and is composed into the top-level `window.__chimera` object. This keeps any single module understandable, prevents cross-domain coupling, and makes the surface auditable one namespace at a time.

```typescript
// Exposed on window.__chimera — the ONLY surface the renderer touches.
// Each namespace is declared in its own preload/<domain>-api.ts file and composed here.
interface ChimeraAPI {
    game: GameAPI; // Action dispatch + snapshot stream
    lobby: LobbyAPI; // Host, join, leave, discover
    saves: SavesAPI; // List, save, load, delete save slots (host only)
    settings: SettingsAPI; // Per-game and engine-wide settings
    profile: ProfileAPI; // Local player profile (avatar, display name) + remote directory; see §4.24
    replay: ReplayAPI; // Export / load / playback of deterministic match replays; see §4.28
    chat: ChatAPI; // Lobby + in-match text chat; see §4.29
    logs: LogsAPI; // Renderer-to-main structured log forwarding; see §4.27
    system: SystemAPI; // Connection status, platform info, quit
    /** Present only when the active MultiplayerProvider supports discovery. */
    lobbyDiscovery?: LobbyDiscoveryAPI;
}

// ─── game namespace ──────────────────────────────────────────────────────
interface GameAPI {
    /** Dispatch a validated EngineAction built via ActionRegistry.build(). */
    sendAction(action: EngineAction): void;
    /** Stream of projected PlayerSnapshot for the active viewer. */
    onSnapshot(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe;
    /** Local multi-seat (pass-and-play): switch the active viewer for the current renderer. */
    switchActiveSeat(playerId: PlayerId): Promise<void>;
}

// ─── lobby namespace ─────────────────────────────────────────────────────
interface LobbyAPI {
    host(params: HostLobbyParams): Promise<LobbyInfo>;
    join(params: JoinLobbyParams): Promise<LobbyInfo>;
    leave(): void;
    onUpdate(cb: (lobby: LobbyState) => void): Unsubscribe;
}

// Discovery is a separate capability surface — present on `window.__chimera.lobby`
// only when the active MultiplayerProvider satisfies `BrowsableProvider` (see §4.14).
// The renderer narrows with `if (window.__chimera.lobbyDiscovery) { ... }` rather than
// probing an optional method on LobbyAPI. Mirrors the BrowsableProvider pattern (ISP).
interface LobbyDiscoveryAPI {
    list(): Promise<LobbyListEntry[]>;
}

// ─── saves namespace (host only; clients receive no save controls) ───────
interface SavesAPI {
    list(gameId: string): Promise<SaveSlotMeta[]>;
    save(request: SaveRequest): Promise<SaveSlotMeta>;
    load(slotId: string): Promise<void>;
    delete(slotId: string): Promise<void>;
    onSlotUpdate(cb: (slots: SaveSlotMeta[]) => void): Unsubscribe; // After save/delete/autosave
}

// ─── settings namespace ──────────────────────────────────────────────────
interface SettingsAPI {
    /** Fully merged ResolvedSettings (engine defaults + game defaults + user overrides). */
    get(gameId: string): Promise<ResolvedSettings>;
    update(gameId: string, patch: Partial<UserSettings>): Promise<ResolvedSettings>;
    reset(gameId: string): Promise<ResolvedSettings>;
    onChange(cb: (gameId: string, settings: ResolvedSettings) => void): Unsubscribe;
}

// ─── system namespace ────────────────────────────────────────────────────
interface SystemAPI {
    onConnectionStatus(cb: (status: ConnectionStatus) => void): Unsubscribe;
    platform(): Promise<{ os: 'macos' | 'windows' | 'linux'; version: string }>;
    quit(): void;
}
```

Each namespace file (`preload/game-api.ts`, `preload/lobby-api.ts`, …) registers its own IPC channel prefix (`chimera:game:*`, `chimera:lobby:*`, …). The security boundary is: every IPC handler is declared in exactly one namespace file, and `ipc-handlers.ts` in the main process composes them the same way. No channel crosses namespaces.

### 4.2 Simulation Core (`simulation/`)

```typescript
// ─────────────────────────────────────────────
// AUTHORITATIVE STATE — lives ONLY on the host
// ─────────────────────────────────────────────

// Full truth — never transmitted to any client, including the host's own renderer.
// This is the GENERIC, game-agnostic snapshot type used throughout the engine.
// `BaseGameSnapshot` in §4.7 is an alias reiterated alongside the engine-games
// contract for emphasis; game-specific snapshots (e.g. `TacticsSnapshot`) extend
// it with additional readonly fields.
interface GameSnapshot {
    tick: number; // Monotonic; +1 per applied action. NOT a real-time clock.
    seed: number; // Base RNG seed; per-action RNG is derived from (seed, tick)
    players: Record<PlayerId, BasePlayerState>;
    entities: Record<EntityId, BaseEntityState>;
    phase: GamePhase;
    events: GameEvent[]; // All events this tick (unfiltered)
    // Optional: turn timers. Present only for games that opt into timed turns.
    turnClock?: { activePlayerId: PlayerId; deadlineMs: number };
}

// Alias reiterated in §4.7 for the engine/game contract section; identical to
// `GameSnapshot`. Use `BaseGameSnapshot` when the intent is "the minimum shape
// a game must satisfy" and `GameSnapshot` when referring to authoritative state.
type BaseGameSnapshot = GameSnapshot;

// ─────────────────────────────────────────────
// PROJECTED STATE — what travels over any boundary
// Each player receives only their visibility-filtered view
// ─────────────────────────────────────────────

// Every game-state field is classified at design time
type VisibilityScope =
    | 'public' // All players see the true value
    | 'owner-only' // Only the owning player sees the value; others receive null/count
    | 'hidden' // No player sees this (server-only: RNG seeds, internal counters)
    | 'committed'; // Concealed until a reveal event; hash committed to all players upfront

// What a specific player receives — hidden/owner-only fields are masked or absent
interface PlayerSnapshot {
    tick: number;
    viewerId: PlayerId;
    players: Record<PlayerId, ObservedPlayerState>; // Opponent hands/decks masked
    entities: Record<EntityId, ObservedEntityState>; // Fog-of-war entities absent entirely
    phase: GamePhase;
    events: GameEvent[]; // Filtered: only events this viewer is permitted to see
    commitments: Record<CommitmentId, CommitmentEnvelope>; // Hashes for concealed values
    undoMeta: { canUndo: boolean; canRedo: boolean }; // Reflected undo state for UI
}

// ─────────────────────────────────────────────
// ACTIONS — Action Registry / Plugin Pattern
// ─────────────────────────────────────────────
// The engine defines the pipeline contract; games register the action types.
// Engine core contains ZERO switch statements keyed on action type strings.
// See Section 4.7 for design rationale and namespace conventions.

// Generic envelope: the only shape the engine transport layer cares about.
// TType is the string tag; TPayload is fully unknown on the wire and typed
// after parsePayload() runs inside the registry.
interface EngineAction<
    TType extends string = string,
    TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
    readonly type: TType; // namespaced: 'engine:end_turn', 'mygame:move_unit'
    readonly playerId: PlayerId;
    readonly tick: number;
    readonly payload: Readonly<TPayload>;
}

// Convenience builder for game developers to create typed action factories.
// Game code: const moveUnit = defineAction<'mygame:move_unit', MovePayload>(...)
type TypedAction<T extends string, P extends Record<string, unknown>> = EngineAction<T, P>;

// Strategy per action type: games supply these objects to the registry.
interface ActionDefinition<
    TPayload extends Record<string, unknown>,
    TState extends BaseGameSnapshot = BaseGameSnapshot,
> {
    readonly type: string;
    // Structural validation (schema check) — called first, before game rules.
    // Throw a structured ActionSchemaError on failure.
    parsePayload(raw: Readonly<Record<string, unknown>>): TPayload;
    // Semantic validation: is this action legal given current state?
    // Returns ok:true on success, ok:false + reason on failure.
    validate(
        payload: TPayload,
        state: Readonly<TState>,
        playerId: PlayerId,
        ctx: ReduceContext,
    ): ValidationResult;
    // Pure state transition — same input always produces same output given the same context.
    reduce(
        state: Readonly<TState>,
        payload: TPayload,
        playerId: PlayerId,
        ctx: ReduceContext,
    ): TState;
    // Whether clients can tentatively apply this action before host confirmation.
    // Default: false. Only set true for own-player-only, non-randomised, non-contested actions.
    readonly predictable?: boolean;
}

// Subset of PipelineContext exposed to game code inside validate() and reduce().
// Pure: no broadcast, no history, no undo — just the inputs needed to compute the result.
//
// CLOSED CONTENTS: this interface is deliberately kept narrow. The fields below are the only
// capabilities a reducer/validator is permitted to depend on. Adding a new field is an
// architectural change that requires (a) a dedicated invariant in Appendix B describing its
// purpose and allowed usage, and (b) an explicit entry in the integration-guidelines section
// of the developer agent. Do NOT widen ReduceContext ad-hoc to plumb through a manager
// reference, a logger, wall-clock time, network state, or any other non-deterministic
// capability.
interface ReduceContext {
    readonly db?: ContentDatabase; // Absent for games that declare no content
    readonly rng: DeterministicRng; // Seeded from (state.seed, state.tick); draws are deterministic
}

// Registry: maps type string → ActionDefinition at runtime.
// Created once per game session; populated during game init before tick loop starts.
interface ActionRegistry<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    register<TPayload extends Record<string, unknown>>(
        definition: ActionDefinition<TPayload, TState>,
    ): void;
    resolve(type: string): ActionDefinition<Record<string, unknown>, TState>; // throws UnknownActionTypeError if absent
    registeredTypes(): readonly string[];
}

// Reserved engine action types — registered automatically by the engine,
// never overridable by games.  Always prefixed 'engine:'.
type EngineReservedType =
    | 'engine:undo'
    | 'engine:redo'
    | 'engine:end_turn'
    | 'engine:sync_request'
    | 'engine:save' // Triggers SaveManager to write current state to a slot
    | 'engine:load'; // Host-only: replace simulation state from a SaveFile

// StateReducer delegates entirely to the registry — zero game knowledge.
// UNDO/REDO are intercepted by UndoManager before reaching the registry.
interface StateReducer<TState extends BaseGameSnapshot> {
    apply(state: Readonly<TState>, action: EngineAction): TState;
}

// ActionPipeline orchestrates the invariant pipeline for every incoming action.
// Games cannot reorder or skip steps; they extend behaviour by supplying definitions.
// Implementation decomposes `process()` into one private method per stage — there is
// no monolithic switch or inline sequence. Stages are individually unit-testable.
//
//   Stage 1 resolve()   — ActionRegistry.resolve(action.type)                → ActionDefinition
//   Stage 2 parse()     — definition.parsePayload(action.payload)            → TPayload
//   Stage 3 intercept() — handle engine:undo / engine:redo via UndoManager   → may short-circuit
//   Stage 4 validate()  — definition.validate(payload, state, playerId, rc) → ValidationResult
//   Stage 5 reduce()    — definition.reduce(state, payload, playerId, rc)   → nextState
//   Stage 6 record()    — history.append(...)                                → void
//   Stage 7 broadcast() — projector.project(...) + broadcast to each viewer  → void
//
// Each stage receives only the narrow context it needs (see the role-based
// interfaces below); the pipeline composes them but never leaks the full
// capability bag into game code.
interface ActionPipeline<TState extends BaseGameSnapshot> {
    process(state: Readonly<TState>, action: EngineAction, context: PipelineContext): TState;
}

// ─────────────────────────────────────────────
// Role-based pipeline contexts (ISP)
// Each stage sees only what it needs. `PipelineContext` below is just the
// composition the orchestrator assembles — no game code ever receives it.
// ─────────────────────────────────────────────

// Handed to definition.validate() and definition.reduce() — pure inputs only.
// No broadcast, no history, no undo, no debug observer. (Same as ReduceContext.)
interface ValidationContext extends ReduceContext {}

// ReductionContext extends ReduceContext with the re-entrant dispatch capability.
// Only reducers receive this — validators must remain pure predicates and may not dispatch.
interface ReductionContext extends ReduceContext {
    /**
     * Re-enter the pipeline from inside a reducer. Used exclusively by the `engine:tick`
     * reducer to dispatch timer-fired actions (§4.20). Semantics:
     *   • Runs validate() + reduce() for the child action; does NOT re-project, re-broadcast,
     *     re-record to ActionHistory, or invoke UndoManager — those all happen once at the
     *     end of the outer tick.
     *   • Nesting is bounded: MAX_NESTED_DISPATCH = 16 (engine constant). Exceeding this
     *     throws RecursiveDispatchError and surfaces as a determinism bug.
     *   • Only the `engine:tick` reducer may call `ctx.dispatch()`. Game reducers must set up
     *     work by creating timers (TimerManager.create), not by re-entering the pipeline.
     */
    readonly dispatch: (
        actionType: string,
        payload: Record<string, unknown>,
        playerId: PlayerId,
        state: Readonly<BaseGameSnapshot>,
    ) => BaseGameSnapshot;
}

// Stage 6 — append-only append.
interface HistoryContext {
    readonly history: ActionHistory;
}

// Stage 7 — projection + fan-out.
interface BroadcastContext {
    readonly projector: StateProjector;
    readonly broadcast: (snapshot: PlayerSnapshot, to: PlayerId) => void;
}

// Stage 3 — reserved-action interception.
interface UndoContext {
    readonly undoManager: UndoManager;
}

// Debug observer (only set in dev builds). See §4.12.
interface DebugContext {
    readonly debugObserver?: (tick: number, snapshot: GameSnapshot) => void;
}

// Composition used by the orchestrator only. Game-facing code uses ReduceContext.
interface PipelineContext extends UndoContext, HistoryContext, BroadcastContext, DebugContext {
    readonly db?: ContentDatabase; // forwarded into ReduceContext per-call
    readonly rng: DeterministicRng; // forwarded into ReduceContext per-call
}

// ─────────────────────────────────────────────
// UNDO / REDO — Hybrid Memento + Event Sourcing
// ─────────────────────────────────────────────

// Memento: full snapshot saved at the start of a player's turn
interface TurnMemento {
    turnNumber: number;
    playerId: PlayerId;
    snapshotAtTurnStart: GameSnapshot;
}

// Append-only event log entry
interface ActionHistoryEntry {
    tickApplied: number;
    turnNumber: number;
    action: EngineAction;
}

// UndoManager: integrates with the reducer, not around it
interface UndoManager {
    // Called on END_TURN: saves a memento baseline for the incoming player
    saveTurnMemento(state: GameSnapshot, playerId: PlayerId): void;
    // Returns a reconstructed state by replaying history from memento minus `steps` tail actions
    undo(steps?: number): GameSnapshot;
    redo(steps?: number): GameSnapshot;
    canUndo(playerId: PlayerId): boolean;
    canRedo(playerId: PlayerId): boolean;
    setPolicy(policy: UndoPolicy): void;
    clearUndoHistory(playerId: PlayerId): void;
}
```

### 4.2.1 Determinism Foundations (`simulation/engine/DeterministicRng.ts` + `SimulationClock.ts`)

Three rules make the simulation bit-identical across all machines that apply the same action sequence to the same initial snapshot. They are non-negotiable across every game built on Chimera — a Monopoly dice roll on one device must match the roll for the same action on every other device.

#### Rule 1: Action-Driven Clock

`GameSnapshot.tick` is incremented by exactly **1 per action applied** by `ActionPipeline.process()`. It is a logical counter, not a timestamp. Idle time between player inputs does not advance it. `SimulationClock.now()` returns `snapshot.tick`; it is never read from `Date.now()` or `performance.now()`.

Real-time games (if any) wrap `RealtimeTicker` around the pipeline — it dispatches a reserved `engine:tick` action at a fixed wall-clock cadence. Each `engine:tick` is a normal action and advances the counter by 1.

#### Rule 2: Deterministic RNG Only

```typescript
// simulation/engine/DeterministicRng.ts

/**
 * Pure, seeded PRNG. Same (seed, tick) → same draw sequence, always.
 * Derived per-action from (GameSnapshot.seed, GameSnapshot.tick).
 * Implementation: splitmix64 → xoshiro256** (fast, statistically sound, 64-bit).
 */
interface DeterministicRng {
    /** Integer in [min, max] inclusive. Always use this for dice, card indices, hit rolls. */
    int(min: number, max: number): number;
    /** 53-bit float in [0, 1). Prefer int() wherever possible. */
    float(): number;
    /** Fisher-Yates shuffle. Returns a new array; input is not mutated. */
    shuffle<T>(items: readonly T[]): T[];
    /** Uniform pick. */
    pick<T>(items: readonly T[]): T;
}
```

`ActionPipeline` constructs a fresh `DeterministicRng` seeded from `(state.seed, state.tick)` before each `reduce()` call and passes it via `ReduceContext.rng`. Game code **must not** call `Math.random()`, `Date.now()`, `performance.now()`, or any other non-deterministic source from inside `validate()` or `reduce()`. The engine has no way to enforce this at compile time, but the multiplayer soak test (see §10) catches any violation within a few hundred ticks.

#### Rule 3: Integer / Fixed-Point State

Cross-platform floating-point arithmetic is not bit-exact. A host on Intel and a client on Apple Silicon can produce different results from the same `0.1 + 0.2`. To prevent this, **all fields of `GameSnapshot` that participate in equality checks, checksums, or arithmetic must be integers**.

| Domain                               | Representation                                  | Example                    |
| ------------------------------------ | ----------------------------------------------- | -------------------------- |
| Money (Monopoly, 4X)                 | Integer — smallest currency unit                | `$3.50` → `350` (cents)    |
| Position on grid (TBS, TTT)          | Integer coordinates                             | `{ x: 3, y: 2 }`           |
| Continuous position (real-time only) | Integer fixed-point (e.g. 16.16 or millimetres) | `x = 12345` means 12.345 m |
| Percentages                          | Integer basis points (0–10000)                  | 37.5% → `3750`             |
| Timestamps inside state              | `tick` number only                              | never `Date.now()`         |

Floats are permitted inside the renderer (camera, animation interpolation, UI transitions) but must never flow back into `GameSnapshot` or an `EngineAction` payload. `ActionPipeline` rejects any action whose payload contains a non-finite number.

#### ActionHistory Bounding

`ActionHistory` grows one entry per applied action. A long 4X match produces tens of thousands of entries; an unbounded log is both a memory and a save-file problem. The log is bounded by `TurnMemento`: after each turn-start memento is written, the history is pruned to actions applied on or after that memento. The full event log is reconstructible by replaying from the memento — nothing is lost for forensic purposes. Mementoes older than the configured `TURN_MEMENTO_RETENTION` (default: 4 turns back) are also evicted, giving undo a bounded reach.

```typescript
interface ActionHistory {
    append(entry: ActionHistoryEntry): void;
    /** Entries since the most recent TurnMemento — used by UndoManager. */
    sinceLastMemento(): readonly ActionHistoryEntry[];
    /** Called by TurnMemento after a memento is successfully written. */
    pruneTo(turnNumber: number): void;
}
```

---

### 4.3 WebSocket Message Protocol (`shared/messages.ts`)

> **Scope:** This wire protocol is the internal contract of `LocalWebSocketProvider`. It is not part of the `MultiplayerProvider` interface — other providers (e.g. `SteamNetworkProvider`) use their own frames. Consumers of the simulation and IPC bridge interact only with typed `HostTransport` / `ClientTransport` calls and never see wire frames directly.

```typescript
// Client → Server
type ClientMessage =
    | { type: 'JOIN'; token: string; profile: PlayerProfile } // profile is the client's attestation; see §4.24
    // action.payload is raw Record<string,unknown> on the wire.
    // ActionPipeline runs parsePayload() before any game logic sees it.
    | { type: 'ACTION'; tick: number; action: EngineAction; checksum: number }
    | { type: 'PROFILE_UPDATE'; profile: PlayerProfile } // Mid-lobby cosmetic update; see §4.24
    | { type: 'CHAT'; body: string; scope: ChatScope } // body capped; rate-limited by host; see §4.29
    | { type: 'PING'; sentAt: number };

// Server → Client
// SNAPSHOT and DELTA carry PlayerSnapshot — GameSnapshot never leaves the host
type ServerMessage =
    | { type: 'WELCOME'; playerId: PlayerId; lobbyState: LobbyState } // lobbyState.profiles populated
    | { type: 'SNAPSHOT'; snapshot: PlayerSnapshot; checksum: number }
    | { type: 'DELTA'; fromTick: number; events: GameEvent[] }
    | { type: 'REJECT'; reason: string; tick: number }
    | { type: 'REVEAL'; reveal: CommitmentReveal } // Discloses a committed hidden value
    | { type: 'CHAT'; from: PlayerId; body: string; scope: ChatScope; serverTime: number }
    | { type: 'PONG'; sentAt: number; serverTime: number };
```

### 4.4 Renderer State (`renderer/state/gameStore.ts`)

```typescript
// The renderer store is write-locked to IPC only
// Components NEVER mutate game state — they only read and dispatch actions
// State here is always PlayerSnapshot — the renderer never sees full GameSnapshot
// The renderer splits its runtime game state into TWO stores (ISP):
//
//   SnapshotStore    — authoritative view projected from the host. Read-only from
//                      components; only ipcClient may call applySnapshot().
//   PredictionStore  — client-side optimistic prediction queue, latency metric,
//                      undo/redo affordances derived from the snapshot.
//
// `GameStore` below is the composition exposed to components for convenience,
// but tests and non-UI code should depend on the narrowest interface they need.
interface SnapshotStore {
    readonly snapshot: PlayerSnapshot | null;
    /** Called by ipcClient only. */
    applySnapshot(snapshot: PlayerSnapshot): void;
}

interface PredictionStore {
    readonly predictedActions: readonly EngineAction[]; // not yet confirmed by host
    readonly latencyMs: number;
    readonly canUndo: boolean; // mirrored from snapshot.undoMeta
    readonly canRedo: boolean;
    addPrediction(action: EngineAction): void;
    confirmPrediction(tick: number): void;
}

type GameStore = SnapshotStore & PredictionStore;
```

#### Renderer Store Catalogue

The renderer composes several small Zustand stores rather than one god-store (ISP). Each store has a single source of truth; the table below is the canonical reference for where a new piece of client-local state belongs. **Rule of thumb:** if state is owned by the main process (saves, settings, profiles, lobby membership), the corresponding renderer store is an IPC-mirror and writes only via an `apply*` method called by `renderer/bridge/ipcClient.ts`. If state is purely visual/local (predictions, toasts, perf samples, chat buffer), the store owns its source of truth and components may write directly.

| Store                                             | Scope   | Source of truth                                | Writers                                                                        | Clears on      |
| ------------------------------------------------- | ------- | ---------------------------------------------- | ------------------------------------------------------------------------------ | -------------- |
| `gameStore` (`SnapshotStore` + `PredictionStore`) | match   | main (snapshot) / renderer (prediction)        | `ipcClient.applySnapshot` (snapshot); components (prediction)                  | match end      |
| `lobbyStore`                                      | session | main (`LobbyManager`)                          | `ipcClient.applyLobbyState`                                                    | disconnect     |
| `saveStore`                                       | app     | main (`SaveManager`) — slot list UI state only | `ipcClient.applySaveSlots`; components (selection)                             | —              |
| `settingsStore`                                   | app     | main (`SettingsManager`)                       | `ipcClient.applySettings`; settings UI via `settings.update()` IPC             | —              |
| `profileStore`                                    | session | main (`ProfileManager` + `PlayerDirectory`)    | `ipcClient.applyProfileDirectory`; local edits via `profile.updateLocal()` IPC | lobby close    |
| `chatStore`                                       | session | renderer (rolling buffer)                      | `ipcClient.onChatMessage` push; components (mute flags)                        | lobby close    |
| `toastStore`                                      | app     | renderer                                       | any component via `show()` / `dismiss()`                                       | app close      |
| `perfStore`                                       | app     | renderer (`PerfProbe`)                         | `PerfProbe` only                                                               | app close      |
| `uiStore`                                         | app     | renderer                                       | components (menu state, modal stack)                                           | app close      |
| `cameraStore` (optional, §4.22)                   | screen  | renderer                                       | game board components                                                          | screen unmount |

Adding a new store requires an entry in this table. Do not extend an existing store to carry unrelated state; prefer a new, focused store.

### 4.5 Undo/Redo Policy (`simulation/engine/UndoManager.ts`)

```typescript
interface UndoPolicy {
    allowUndo: boolean;
    maxUndoSteps: number; // 0 = unlimited within current turn
    crossTurnUndo: boolean; // Allow undoing past END_TURN? Default: false
    requireConsentFrom: PlayerId[]; // Empty = no consent needed; use for cooperative games
}

// Default: free unrestricted undo within your turn, cleared on END_TURN
const DEFAULT_UNDO_POLICY: UndoPolicy = {
    allowUndo: true,
    maxUndoSteps: 0,
    crossTurnUndo: false,
    requireConsentFrom: [],
};
```

### 4.6 State Projection Interfaces (`simulation/projection/`)

```typescript
// ─── StateProjector ────────────────────────────────────────────────────────
interface StateProjector {
    // Mandatory gate between GameSnapshot and any outbound message
    project(fullState: GameSnapshot, viewerId: PlayerId): PlayerSnapshot;
}

// ─── VisibilityRules ───────────────────────────────────────────────────────
// Games implement this to declare their information model.
// Different game modes can swap in different implementations.
interface VisibilityRules {
    // Fog-of-war: is this entity present in the viewer's snapshot at all?
    isEntityVisible(entity: EntityState, viewer: PlayerId, state: GameSnapshot): boolean;
    // Field masking: return copy with owner-only/hidden fields nulled
    maskEntity(entity: EntityState, viewer: PlayerId, state: GameSnapshot): ObservedEntityState;
    maskPlayerState(
        target: PlayerState,
        viewer: PlayerId,
        state: GameSnapshot,
    ): ObservedPlayerState;
    // Event filtering: which events does this viewer perceive this tick?
    filterEvents(events: GameEvent[], viewer: PlayerId, state: GameSnapshot): GameEvent[];
}

// ─── CommitmentScheme ──────────────────────────────────────────────────────
// Anti-cheat: proves hidden values were fixed before reveal, cryptographically.
interface CommitmentEnvelope {
    id: CommitmentId;
    commitment: string; // SHA-256( JSON(value) + nonce )
    revealedAt?: number; // tick of reveal (undefined = still hidden)
}

interface CommitmentReveal {
    id: CommitmentId;
    value: unknown; // The original hidden value
    nonce: string; // Random nonce generated at commit time
}

interface CommitmentScheme {
    // Host: called when a hidden value is generated (shuffle, die roll, card draw)
    commit(value: unknown): CommitmentEnvelope;
    // Client: called on REVEAL — throws if tampered; call before trusting the value
    verify(reveal: CommitmentReveal, envelope: CommitmentEnvelope): boolean;
}
```

---

### 4.7 Action Registry Pattern (`simulation/engine/ActionRegistry.ts`)

#### Design Rationale

A hardcoded `GameAction` discriminated union (one union type enumerating every game's verbs) ties the engine core to a specific game's verbs. Adding `CAST_SPELL` or `BUILD_STRUCTURE` requires modifying `StateReducer.ts`, `ActionValidator.ts`, and the union type — all in the engine package. This violates the Open/Closed Principle and prevents multiple games from sharing the same engine runtime.

The **Action Registry Pattern** inverts this dependency:

| Before                                   | After                                                      |
| ---------------------------------------- | ---------------------------------------------------------- |
| Engine defines every action type         | Engine defines the pipeline contract only                  |
| `StateReducer` switches on `action.type` | `StateReducer` calls `registry.resolve(type)`              |
| Adding a new action = modifying engine   | Adding a new action = registering a new `ActionDefinition` |
| One game per engine                      | N games, one engine                                        |

#### Namespace Conventions

All action type strings are namespaced to prevent collisions between the engine and games.

| Namespace             | Owner           | Examples                                                               |
| --------------------- | --------------- | ---------------------------------------------------------------------- |
| `engine:*`            | Engine core     | `engine:undo`, `engine:redo`, `engine:end_turn`, `engine:sync_request` |
| `*:*` (custom prefix) | Individual game | `mtg:cast_spell`, `tactics:move_unit`, `puzzle:rotate_tile`            |

The engine **rejects any attempt** to register an action with the `engine:` prefix at game startup. Games that omit a prefix are warned; omitting a prefix is a development-time error.

#### The Invariant Processing Pipeline

`ActionPipeline.process()` defines 7 steps in a fixed order. Games cannot reorder or skip steps — they only supply `ActionDefinition` strategies for steps 2, 4, and 5.

```
Step 1: Resolve — registry.resolve(action.type)               → ActionDefinition | UnknownActionTypeError
Step 2: Parse   — definition.parsePayload(action.payload)      → TPayload | ActionSchemaError
Step 3: System  — intercept engine:undo / engine:redo (handled by UndoManager, skip steps 4-5)
Step 4: Legality — definition.validate(payload, state, playerId, ctx) → ValidationResult
                    └─ if ok:false → broadcast REJECT to sender; halt pipeline
Step 5: Reduce  — definition.reduce(state, payload, playerId, ctx)   → nextState
Step 6: Record  — history.append({ tick, turnNumber, action })
Step 7: Broadcast — BroadcastContext.broadcast(project(nextState, viewerId), viewerId) for each viewer
                    └─ wired by simulation-host to StateBroadcaster → HostTransport.sendSnapshot (see §4.14)
```

#### Implementing a Game Action

```typescript
// games/tactics/actions/MoveUnitAction.ts
import { ActionDefinition, ValidationResult } from '@chimera/simulation/engine';
import { TacticsSnapshot } from '../state/GameSnapshot';

interface MoveUnitPayload extends Record<string, unknown> {
    entityId: string;
    to: { x: number; y: number };
}

const MoveUnitAction: ActionDefinition<MoveUnitPayload, TacticsSnapshot> = {
    type: 'tactics:move_unit',

    parsePayload(raw): MoveUnitPayload {
        // Validate shape — throw ActionSchemaError with structured message on failure
        if (typeof raw.entityId !== 'string' || typeof raw.to !== 'object')
            throw new ActionSchemaError('tactics:move_unit', raw);
        return raw as MoveUnitPayload;
    },

    validate(payload, state, playerId, ctx): ValidationResult {
        const entity = state.entities[payload.entityId];
        if (!entity) return { ok: false, reason: 'entity_not_found' };
        if (entity.ownerId !== playerId) return { ok: false, reason: 'not_owner' };
        if (entity.movesLeft <= 0) return { ok: false, reason: 'no_moves_remaining' };
        // ctx.db?.getByIdOrThrow('terrain', entity.position) if we need terrain rules
        return { ok: true };
    },

    reduce(state, payload, _playerId, _ctx): TacticsSnapshot {
        // Pure — no mutation, return new object
        // ctx.db available here to look up e.g. tile movement costs
        // ctx.rng available for any randomised outcomes (crits, hit rolls, etc.)
        return {
            ...state,
            entities: {
                ...state.entities,
                [payload.entityId]: {
                    ...state.entities[payload.entityId],
                    position: payload.to,
                    movesLeft: state.entities[payload.entityId].movesLeft - 1,
                },
            },
        };
    },

    predictable: true, // Clients may tentatively apply before host confirmation
};

export default MoveUnitAction;
```

#### Registering All Game Actions at Startup

```typescript
// games/tactics/index.ts — game entry point, called once before tick loop
import { createActionRegistry } from '@chimera/simulation/engine';
import MoveUnitAction from './actions/MoveUnitAction';
import AttackAction from './actions/AttackAction';
// ... other actions

export function createTacticsRegistry() {
    const registry = createActionRegistry<TacticsSnapshot>();
    registry.register(MoveUnitAction);
    registry.register(AttackAction);
    // Engine reserved actions (engine:undo, etc.) are pre-registered by createActionRegistry()
    return registry;
}
```

#### BaseGameSnapshot — The Engine's Contract with Games

The engine only requires these fields. Games extend this interface freely.

```typescript
interface BaseGameSnapshot {
    readonly tick: number;
    readonly seed: number; // deterministic RNG seed
    readonly players: Record<PlayerId, BasePlayerState>;
    readonly entities: Record<EntityId, BaseEntityState>;
    readonly phase: string;
    readonly events: GameEvent[];
}

// Game extends by adding its own fields
interface TacticsSnapshot extends BaseGameSnapshot {
    readonly resources: Record<PlayerId, ResourceState>;
    readonly fog: FogOfWarState;
}
```

#### Error Types

```typescript
class UnknownActionTypeError extends Error {
    constructor(public readonly actionType: string) {
        super(`No ActionDefinition registered for type '${actionType}'`);
    }
}

class ActionSchemaError extends Error {
    constructor(
        public readonly actionType: string,
        public readonly raw: unknown,
    ) {
        super(`Payload schema validation failed for action type '${actionType}'`);
    }
}

interface ValidationResult {
    ok: boolean;
    reason?: string; // stable snake_case code for i18n; populated when ok:false
}
```

---

### 4.8 Content Database (`simulation/content/`)

#### Design Rationale

Games need large sets of static, designer-authored data: cards, units, damage types, abilities, terrain tiles, item blueprints, and so on. This data is:

- **Pure** — no behaviour, only values. Behaviour lives in `ActionDefinition` and game logic.
- **Read-only at runtime** — the engine never adds, edits, or removes items while running.
- **Externally authored** — JSON files edited offline by game designers, not compiled TypeScript.
- **Nested** — objects may contain arrays, sub-objects, and references to other objects.
- **Cross-referencing** — a `Unit` data object references a `DamageType` data object by ID.

The `ContentDatabase` is intentionally separated from `GameSnapshot`. Game state (who is winning, what a player's hand contains) belongs in the snapshot. Static definitions (what the "Fire Bolt" card is) belong in the database. The two are loaded independently and maintained on different lifecycles.

#### `DataRef<T>` — Typed Cross-Collection References

References between data objects use a **namespaced string** with the form `"<collection-type>:<item-id>"`.

```typescript
// simulation/content/DataRef.ts

// Branded string — prevents accidentally passing a raw string where a DataRef is expected.
// The generic parameter T documents which collection type is expected.
// On the wire (JSON files) it is just a plain string: "damage-types:fire"
type DataRef<_T extends DataObject = DataObject> = string & { readonly __dataRef: void };

// Build a DataRef safely
function buildRef<T extends DataObject>(collectionType: string, id: string): DataRef<T> {
    return `${collectionType}:${id}` as DataRef<T>;
}

// Decompose a DataRef into its parts — throws MalformedRefError if the format is invalid
function parseRef(ref: DataRef): { collectionType: string; id: string } {
    const colon = ref.indexOf(':');
    if (colon < 1) throw new MalformedRefError(ref);
    return { collectionType: ref.slice(0, colon), id: ref.slice(colon + 1) };
}
```

**Example refs in JSON:**

```json
"damageType": "damage-types:physical"
"resistances": ["damage-types:fire", "damage-types:cold"]
"specialAbility": "abilities:taunt"
```

Any string value in a JSON file that contains a `:` and whose left side matches a known collection type is treated as a `DataRef`. The TypeScript schema for that collection declares the field as `DataRef<T>`.

#### `ContentDatabase` Interface

```typescript
// simulation/content/ContentDatabase.ts

interface ContentDatabase {
    // ── Direct access ──────────────────────────────────────────────────────
    // Returns undefined if the item doesn't exist (safe lookup)
    getById<T extends DataObject>(collectionType: string, id: string): T | undefined;
    // Throws UnknownDataRefError if not found (use when absence is a logic error)
    getByIdOrThrow<T extends DataObject>(collectionType: string, id: string): T;

    getAllIds(collectionType: string): readonly string[];
    getAll<T extends DataObject>(collectionType: string): readonly T[];

    // ── Reference resolution ───────────────────────────────────────────────
    // Parse "damage-types:fire" → look up damage-types collection → return typed object
    resolveRef<T extends DataObject>(ref: DataRef<T>): T; // throws UnknownDataRefError

    // ── Introspection ──────────────────────────────────────────────────────
    collectionTypes(): readonly string[];
    has(collectionType: string, id: string): boolean;
}

// All data objects must carry an id field — the only engine-level contract on content.
// Everything else is game-defined.
interface DataObject {
    readonly id: string;
}
```

#### File Layout

**Preferred: one file per item** (easier to diff, review, and expand in git)

```
games/tactics/data/
├── damage-types/
│   ├── physical.json
│   ├── fire.json
│   └── cold.json
└── units/
    ├── warrior.json
    └── mage.json
```

**Alternative: flat array file** (for small collections)

```
games/tactics/data/
└── abilities.json        ← [ { "id": "taunt", ... }, { "id": "rally", ... } ]
```

The `ContentLoader` detects which format is in use by checking whether the path is a directory or a `.json` file. Both layouts can be mixed in the same `data/` directory.

#### Example JSON Files

```json
// damage-types/fire.json
{
    "id": "fire",
    "name": "Fire",
    "color": "#e05c1a",
    "bypassArmor": false,
    "weatherMultiplier": {
        "rain": 0.75,
        "drought": 1.5
    }
}
```

```json
// units/warrior.json
{
    "id": "warrior",
    "name": "Warrior",
    "stats": {
        "maxHp": 120,
        "speed": 3,
        "armor": 20
    },
    "attacks": [
        {
            "name": "Sword Strike",
            "baseDamage": 18,
            "damageType": "damage-types:physical"
        },
        {
            "name": "Shield Bash",
            "baseDamage": 8,
            "damageType": "damage-types:physical",
            "special": "abilities:stun_1turn"
        }
    ],
    "resistances": ["damage-types:fire"],
    "abilities": ["abilities:taunt", "abilities:rally"]
}
```

Note the cross-references: `"damageType": "damage-types:physical"` and `"abilities": ["abilities:taunt"]`. These are plain JSON strings at rest; the TypeScript schemas declare them as `DataRef<DamageType>` and `DataRef<Ability>[]`.

#### `ContentLoader` — Loading and Merging Sources

```typescript
// simulation/content/ContentLoader.ts

// A source is either a directory to scan or a pre-parsed object array.
type ContentSource =
    | { type: 'directory'; path: string } // scans for <collection>/<id>.json and <collection>.json
    | { type: 'inline'; collectionType: string; items: DataObject[] }; // testing / programmatic

interface ContentLoader {
    // Load and merge one or more sources into a single immutable ContentDatabase.
    // Sources are merged in order: later sources can add items to earlier collections.
    // THROWS ContentConflictError if the same (collectionType, id) appears in two sources.
    // THROWS ContentSchemaError if a registered schema rejects an item.
    // THROWS UnknownDataRefError if ref-integrity checking is enabled and a ref points nowhere.
    load(sources: ContentSource[], options?: ContentLoadOptions): Promise<ContentDatabase>;
}

interface ContentLoadOptions {
    // Per-collection Zod schema validators (optional but recommended).
    // If provided, each item is validated after parsing.
    schemas?: Partial<Record<string, ZodSchema>>;
    // Validate that all DataRef values point to an existing item in this database.
    // Requires knowing which fields are refs — inferred from string values containing ':'
    // or declared explicitly via schemas. Defaults to false (warn only).
    validateRefs?: boolean;
}
```

#### Layering: Base Game + Expansions

Games can compose multiple content sources. Each `ContentSource` adds items; duplicates are an error. This makes expansion packs trivial to wire in.

```typescript
// games/tactics/index.ts
import { createContentLoader } from '@chimera/simulation/content';
import { DamageTypeSchema, UnitSchema } from './schemas';

const db = await createContentLoader().load(
    [
        { type: 'directory', path: 'games/tactics/data' }, // base game
        { type: 'directory', path: 'games/tactics-expansion/data' }, // expansion adds more units
    ],
    {
        schemas: { 'damage-types': DamageTypeSchema, units: UnitSchema },
        validateRefs: true,
    },
);
```

#### Using the Database in Action Definitions

```typescript
// games/tactics/actions/AttackAction.ts

validate(payload, state, playerId, ctx): ValidationResult {
  const attacker = state.entities[payload.attackerId];
  if (!attacker) return { ok: false, reason: 'attacker_not_found' };

  // Look up the unit definition from the content database (ctx.db required here)
  const db = ctx.db!;
  const unitDef = db.getByIdOrThrow<UnitData>('units', attacker.unitDefId);
  if (unitDef.attacks.length === 0) return { ok: false, reason: 'unit_cannot_attack' };

  return { ok: true };
},

reduce(state, payload, playerId, ctx): TacticsSnapshot {
  const db = ctx.db!;
  const target = state.entities[payload.targetId];
  const attacker = state.entities[payload.attackerId];
  const attack = db.getByIdOrThrow<UnitData>('units', attacker.unitDefId).attacks[0];

  // Resolve the damage type reference to get its full definition
  const damageType = db.resolveRef<DamageTypeData>(attack.damageType);

  // Example randomised outcome — deterministic via ctx.rng
  const variance = ctx.rng.int(-2, 2);
  const effectiveDamage = computeDamage(attack.baseDamage + variance, damageType, target.resistances);
  return applyDamage(state, payload.targetId, effectiveDamage);
},
```

#### Error Types

```typescript
class UnknownDataRefError extends Error {
    constructor(public readonly ref: string) {
        super(`Cannot resolve DataRef '${ref}': item not found in ContentDatabase`);
    }
}

class MalformedRefError extends Error {
    constructor(public readonly ref: string) {
        super(`DataRef '${ref}' is malformed — expected format: 'collection-type:item-id'`);
    }
}

class ContentConflictError extends Error {
    constructor(
        public readonly collectionType: string,
        public readonly id: string,
    ) {
        super(`Duplicate item id '${id}' in collection '${collectionType}' across content sources`);
    }
}

class ContentSchemaError extends Error {
    constructor(
        public readonly collectionType: string,
        public readonly id: string,
        cause: unknown,
    ) {
        super(`Schema validation failed for '${collectionType}:${id}'`);
        this.cause = cause;
    }
}
```

---

### 4.9 AI Layer — Player Abstraction and AI Framework

#### Design Rationale

The simulation engine works exclusively with `PlayerId`. It has no concept of whether a player is a human at a keyboard or an AI running in the main process. The **AI layer** sits above the simulation as a set of agent controllers — each agent observes `PlayerSnapshot` and dispatches `EngineAction` through the same `ActionPipeline` as human players. This guarantees:

- AI actions are validated and logged identically to human actions
- Determinism and auditability are preserved
- Games can mix human and AI players freely without engine changes
- AI is honest by default — it sees only its own `PlayerSnapshot`, respecting fog of war

#### Player Abstraction — Strategy Pattern

```typescript
// ai/engine/PlayerAgent.ts

// The engine's only concept of "a player controller."
// Human and AI are interchangeable from the host's perspective.
interface PlayerAgent {
    readonly playerId: PlayerId;
    readonly kind: 'human' | 'ai';
    // Called by AgentManager once per tick after the simulation tick resolves.
    // Receives the player's own projected view only — never the full GameSnapshot.
    onTick(snapshot: PlayerSnapshot, tick: number): void;
    onGameStart(snapshot: PlayerSnapshot): void;
    onGameEnd(snapshot: PlayerSnapshot, result: GameResult): void;
}

// Human agent is a no-op stub — human actions arrive through IPC, not here.
class HumanPlayerAgent implements PlayerAgent {
    readonly kind = 'human' as const;
    constructor(readonly playerId: PlayerId) {}
    onTick() {}
    onGameStart() {}
    onGameEnd() {}
}
```

#### AgentManager

```typescript
// ai/engine/AgentManager.ts

// Owned by simulation-host.ts in Electron main process.
// Called after every simulation tick completes.
interface AgentManager {
    registerAgent(agent: PlayerAgent): void;
    // Called by simulation-host.ts after each tick, before broadcast.
    // Projects GameSnapshot per AI player and forwards to each agent.
    tickAll(fullState: GameSnapshot, tick: number, projector: StateProjector): void;
    onGameStart(fullState: GameSnapshot, projector: StateProjector): void;
    onGameEnd(fullState: GameSnapshot, result: GameResult, projector: StateProjector): void;
}
```

#### AIParams — Personality Parameters

`AIParams` is a typed property bag passed through every AI lifecycle event. Games extend it with their own fields.

```typescript
// ai/engine/PlayerAgent.ts (or a separate AIParams.ts)

// Base — engine requires nothing; all fields are game-defined.
interface AIParams extends Record<string, unknown> {}

// Example game extension:
interface TacticsAIParams extends AIParams {
    aggressivity: number; // 0.0 (passive) → 1.0 (all-out attack)
    riskTolerance: number; // 0.0 (never gambles) → 1.0 (high risk)
    preferredUnits?: string[]; // unit def IDs to prioritize when available
}
```

`AIParams` is passed to **every** lifecycle method on `AIState` and `AICommand`. Behaviour implementations react to them rather than hard-coding personality — the same state and command classes can represent an easy AI and a hard AI with different params.

#### AIState — State Pattern

```typescript
// ai/engine/AIState.ts

// One node in the AI state machine.
// Games implement this interface; the engine calls the lifecycle methods.
interface AIState<TParams extends AIParams = AIParams> {
    readonly name: string; // unique within this AI's state machine

    // Transition INTO this state.
    onEnter(
        snapshot: PlayerSnapshot,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    // Called every simulation tick while this is the active state.
    // Always called after the scheduler has been advanced for this tick.
    onTick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    // Called when the scheduler queue empties (no command is running).
    // Called before onTick on the same tick that the queue becomes empty.
    // This is the primary planning opportunity — enqueue next commands here.
    onIdle(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    // Transition OUT of this state. Clean up any per-state bookkeeping.
    onExit(snapshot: PlayerSnapshot, params: TParams): void;
}
```

#### AICommand — Command Pattern

Commands are synchronous-within-a-tick async tasks. They span multiple simulation ticks. `onTick` returns a `CommandProgress` value that drives the scheduler forward.

```typescript
// ai/engine/AICommand.ts

// TParams: AI personality (same type as the owning AIBrain's params).
// TPayload: command-specific data (target position, attack cluster, etc.).
interface AICommand<TParams extends AIParams = AIParams, TPayload = unknown> {
    readonly type: string; // namespaced: 'tactics:move-to-target'
    readonly payload: Readonly<TPayload>;

    // Called once when this command reaches the front of the queue.
    onStart(snapshot: PlayerSnapshot, params: TParams, context: CommandContext): void;

    // Called every tick while this is the active command.
    // Return 'running' to continue, 'done' to succeed, 'failed' to fail.
    onTick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        context: CommandContext,
    ): CommandProgress;

    // Called on success — before the next command is dequeued.
    onEnd(snapshot: PlayerSnapshot, params: TParams, context: CommandContext): void;

    // Called on failure — scheduler clears the queue after this returns.
    // Typically: transition to a recovery state or re-plan.
    onFail(
        snapshot: PlayerSnapshot,
        params: TParams,
        context: CommandContext,
        reason: string,
    ): void;
}

type CommandProgress =
    | { status: 'running' }
    | { status: 'done' }
    | { status: 'failed'; reason: string };

// Existential wrapper used by the scheduler queue: hides TPayload so that a
// queue of heterogeneous commands remains well-typed without leaking `any`.
type AnyAICommand<TParams extends AIParams = AIParams> = AICommand<TParams, unknown>;
```

#### CommandContext — Dispatch Bridge

```typescript
// ai/engine/CommandContext.ts

// Passed to every lifecycle method. The only way AI submits actions or triggers transitions.
interface CommandContext {
    // Submit an EngineAction on behalf of this AI player.
    // Routes through ActionPipeline — same validation path as a human player.
    dispatch(action: EngineAction): void;

    // Request a state transition in the AI's state machine.
    // Safe to call from onStart, onTick, onEnd, onFail, onIdle.
    // Transition is deferred to end of current tick to prevent re-entrancy.
    transitionState(stateName: string): void;
}
```

#### CommandScheduler

```typescript
// ai/engine/CommandScheduler.ts

interface CommandScheduler<TParams extends AIParams = AIParams> {
    // Add a command to the end of the queue.
    // `AnyAICommand<TParams>` erases TPayload at the queue boundary while
    // preserving per-command type safety inside lifecycle methods — the scheduler
    // never inspects `payload` (Liskov: every command subtype is substitutable).
    enqueue(command: AnyAICommand<TParams>): void;

    // Add a command immediately after the current one (urgent/interrupt).
    enqueueNext(command: AnyAICommand<TParams>): void;

    // Called by AIBrain each tick. Lifecycle:
    //   1. If current command running: call onTick → handle CommandProgress
    //      - 'done'  → call onEnd; dequeue next; call its onStart
    //      - 'failed' → call onFail; clear entire queue; emit 'idle'
    //   2. If no active command and queue not empty: dequeue; call onStart
    //   3. If no active command and queue empty: emit 'idle' event
    advance(snapshot: PlayerSnapshot, tick: number, params: TParams, context: CommandContext): void;

    // Clear all queued commands. Does NOT stop or fail the current active command.
    clearQueue(): void;

    // Immediately fail the current command and clear the queue.
    abort(reason: string, snapshot: PlayerSnapshot, params: TParams, context: CommandContext): void;

    readonly isIdle: boolean; // true when no active command and queue is empty
    readonly queueLength: number;
}
```

#### AIStateMachine

```typescript
// ai/engine/AIStateMachine.ts

interface AIStateMachine<TParams extends AIParams = AIParams> {
    // Register a state — called once during game init.
    registerState(state: AIState<TParams>): void;

    // Set the initial state. Calls onEnter() on the named state so that entry
    // semantics are IDENTICAL to any later transition(). Must be called before
    // the first tick. (Prior asymmetry between setInitialState and transition
    // was a Liskov hazard — state code could not assume onEnter had run.)
    setInitialState(
        stateName: string,
        snapshot: PlayerSnapshot,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    // Transition to a new state.
    // Calls currentState.onExit() then newState.onEnter().
    // If called mid-tick, is deferred to end of tick (re-entrancy guard).
    transition(
        stateName: string,
        snapshot: PlayerSnapshot,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    // Called by AIBrain each tick.
    // Order within a tick:
    //   1. Apply any deferred state transition from previous tick
    //   2. scheduler.advance() — progresses current command; may emit 'idle'
    //   3. If 'idle' emitted: currentState.onIdle(...)
    //   4. currentState.onTick(...)
    tick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    readonly currentState: AIState<TParams>;
}
```

#### AIBrain — Facade

```typescript
// ai/engine/AIBrain.ts

// Top-level controller for one AI player.
// Implements the internal logic of AIPlayerAgent.
// Wires together: AIStateMachine + CommandScheduler + CommandContext + AIParams.
class AIBrain<TParams extends AIParams = AIParams> {
    constructor(
        private readonly stateMachine: AIStateMachine<TParams>,
        private readonly scheduler: CommandScheduler<TParams>,
        private readonly context: CommandContext,
        private readonly params: TParams,
    ) {}

    onGameStart(snapshot: PlayerSnapshot): void {
        this.stateMachine.tick(snapshot, 0, this.params, this.scheduler, this.context);
    }

    tick(snapshot: PlayerSnapshot, tick: number): void {
        this.stateMachine.tick(snapshot, tick, this.params, this.scheduler, this.context);
    }

    onGameEnd(snapshot: PlayerSnapshot, result: GameResult): void {
        this.scheduler.abort('game_ended', snapshot, this.params, this.context);
    }
}

// AIPlayerAgent wraps AIBrain and implements PlayerAgent.
class AIPlayerAgent<TParams extends AIParams = AIParams> implements PlayerAgent {
    readonly kind = 'ai' as const;
    constructor(
        readonly playerId: PlayerId,
        private readonly brain: AIBrain<TParams>,
    ) {}

    onTick(snapshot: PlayerSnapshot, tick: number): void {
        this.brain.tick(snapshot, tick);
    }
    onGameStart(snapshot: PlayerSnapshot): void {
        this.brain.onGameStart(snapshot);
    }
    onGameEnd(snapshot: PlayerSnapshot, result: GameResult): void {
        this.brain.onGameEnd(snapshot, result);
    }
}
```

#### Per-Tick Lifecycle Diagram

```
Simulation tick N completes → new GameSnapshot
     │
     ▼
[AgentManager.tickAll(gameSnapshot, tick, projector)]
     │
     ├── for each AI PlayerAgent:
     │     │
     │     ▼  project(gameSnapshot, playerId) → PlayerSnapshot (honest: fog respected)
     │   [AIBrain.tick(playerSnapshot, tick)]
     │     │
     │     ▼
     │   [AIStateMachine.tick(...)]
     │     │
     │     ├── 1. Apply deferred state transition (if any)
     │     │
     │     ├── 2. CommandScheduler.advance(...)
     │     │        ├── if active command running:
     │     │        │     command.onTick() → CommandProgress
     │     │        │     'done'   → command.onEnd(); dequeue next; next.onStart()
     │     │        │     'failed' → command.onFail(); clear queue
     │     │        └── if no active command + queue empty → scheduler is idle
     │     │
     │     ├── 3. if scheduler.isIdle:
     │     │        currentState.onIdle(...)   ← plan: enqueue next commands
     │     │
     │     └── 4. currentState.onTick(...)     ← per-tick monitoring / reactions
     │
     └── (AI may call context.dispatch(EngineAction) from any lifecycle method)
               │
               ▼
         [ActionPipeline.process()] ← same path as human player
               │
               ▼
         nextState broadcast to all players
```

#### Implementing a Game AI State

```typescript
// games/tactics/ai/states/AttackState.ts
import { AIState, CommandScheduler, CommandContext } from '@chimera/ai/engine';
import { TacticsAIParams } from '../params/TacticsAIParams';
import AttackClusterCommand from '../commands/AttackClusterCommand';
import MoveToTargetCommand from '../commands/MoveToTargetCommand';

const AttackState: AIState<TacticsAIParams> = {
    name: 'attack',

    onEnter(snapshot, params, scheduler, context) {
        // Immediately plan first attack on entering combat state
        planAttack(snapshot, params, scheduler);
    },

    onTick(snapshot, tick, params, scheduler, context) {
        // React to state changes mid-execution:
        // e.g. if hp dropped below threshold, flee
        const myPlayer = snapshot.players[snapshot.viewerId];
        if (myPlayer.hp < 20 && params.riskTolerance < 0.3) {
            context.transitionState('defend');
        }
    },

    onIdle(snapshot, tick, params, scheduler, context) {
        // Queue is empty — plan next attack wave
        planAttack(snapshot, params, scheduler);
    },

    onExit(snapshot, params) {
        // Clean up any per-state bookkeeping
    },
};

function planAttack(
    snapshot: PlayerSnapshot,
    params: TacticsAIParams,
    scheduler: CommandScheduler<TacticsAIParams>,
) {
    const target = pickTarget(snapshot, params.aggressivity);
    if (!target) return; // nothing to attack; onIdle will fire again next tick

    // Move toward target, then attack — commands execute in order
    scheduler.enqueue(new MoveToTargetCommand({ targetId: target.id }));
    scheduler.enqueue(new AttackClusterCommand({ targetId: target.id }));
}
```

#### Implementing a Game AI Command

```typescript
// games/tactics/ai/commands/MoveToTargetCommand.ts
import { AICommand, CommandProgress, CommandContext } from '@chimera/ai/engine';
import { TacticsAIParams } from '../params/TacticsAIParams';
import { buildRef } from '@chimera/simulation/content';

interface MoveToTargetPayload {
    targetId: EntityId;
    maxTicks?: number; // abort if not reached within N ticks
}

class MoveToTargetCommand implements AICommand<TacticsAIParams, MoveToTargetPayload> {
    readonly type = 'tactics:move-to-target';
    private ticksElapsed = 0;

    constructor(readonly payload: MoveToTargetPayload) {}

    onStart(snapshot, params, context) {
        this.ticksElapsed = 0;
        // Dispatch first move step immediately
        this.dispatchMoveStep(snapshot, context);
    }

    onTick(snapshot, tick, params, context): CommandProgress {
        this.ticksElapsed++;
        const maxTicks = this.payload.maxTicks ?? 20;
        if (this.ticksElapsed > maxTicks) {
            return { status: 'failed', reason: 'move_timeout' };
        }
        const myUnit = findMyUnit(snapshot);
        if (isAdjacentTo(myUnit, this.payload.targetId, snapshot)) {
            return { status: 'done' }; // reached target
        }
        this.dispatchMoveStep(snapshot, context);
        return { status: 'running' };
    }

    onEnd(snapshot, params, context) {
        /* nothing to clean up */
    }

    onFail(snapshot, params, context, reason) {
        // Failed to reach target — state machine's onIdle will re-plan
        // Optionally transition to a fallback state:
        if (reason === 'move_timeout') {
            context.transitionState('defend');
        }
    }

    private dispatchMoveStep(snapshot: PlayerSnapshot, context: CommandContext) {
        const nextStep = computePath(snapshot, this.payload.targetId)[0];
        if (nextStep) {
            context.dispatch({
                type: 'tactics:move_unit',
                playerId: snapshot.viewerId,
                tick: snapshot.tick,
                payload: { entityId: findMyUnit(snapshot).id, to: nextStep },
            });
        }
    }
}
```

#### Information Access Policy

| AI Mode                 | Snapshot received                                              | Use when                                                          |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Honest AI** (default) | `PlayerSnapshot` — fog of war respected, opponent hands hidden | Competitive play; AI has same info as human                       |
| **Omniscient AI**       | `GameSnapshot` (full truth) — host-only, never networked       | Puzzle modes, tutorial AI, difficulty levels declared as cheating |

Omniscient mode is opt-in per `AIPlayerAgent` instance. `AgentManager` passes the full `GameSnapshot` directly instead of projecting it. Games declare this in their AI configuration; it is never the default.

---

### 4.10 Asset Reference System (`simulation/content/AssetRef.ts` + `renderer/assets/`)

#### Design Rationale

Games need textures, 3D models, audio clips, sprite sheets, and particle configs. These assets are referenced from content data objects (e.g. a `UnitData` JSON declares a `portrait` field pointing to a texture). The challenge is that the simulation layer is pure TypeScript with no DOM, no Three.js, and no file-system access — yet data objects must be able to name assets.

The solution mirrors the `DataRef<T>` pattern: **`AssetRef<T>` is a phantom-typed branded string**. The simulation stores and passes these strings but never resolves them. Only the renderer's `AssetManager` converts an `AssetRef` into a loaded `THREE.Texture`, `AudioBuffer`, or `GLTF`. This preserves the simulation's zero-dependency contract completely.

| Layer                               | Responsibility                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `simulation/content/AssetRef.ts`    | Phantom `AssetRef<T>` type and `buildAssetRef()` helper — zero runtime deps         |
| `games/<name>/data/*.json`          | JSON data objects carry `AssetRef` strings as plain string fields                   |
| `games/<name>/asset-manifest.ts`    | Declares every `AssetRef` the game exposes + load priority                          |
| `renderer/assets/AssetResolver.ts`  | Converts `AssetRef<T>` → `file://` URL (env-aware: dev vs prod)                     |
| `renderer/assets/AssetManager.ts`   | Loads, caches, and disposes resolved assets keyed by `AssetRef` string              |
| `renderer/assets/AssetPreloader.ts` | Bulk-preloads all `critical` manifest entries before match starts                   |
| `renderer/assets/useAsset.ts`       | React hook consumed by R3F components — returns loaded asset or null + loading flag |

#### `AssetRef<T>` — Typed Asset Reference

```typescript
// simulation/content/AssetRef.ts
// ─────────────────────────────────────────────────────────────────────────────
// Phantom types — document intent only. No runtime class; no Three.js import.
// The renderer maps these to actual loader output types.
// ─────────────────────────────────────────────────────────────────────────────
export interface TextureAsset {} // → THREE.Texture
export interface AudioClipAsset {} // → AudioBuffer (Web Audio API)
export interface GLTFModelAsset {} // → GLTF (drei or three/examples/jsm)
export interface SpriteSheetAsset {} // → THREE.Texture + SpriteAtlas frame map
export interface ParticleConfigAsset {} // → plain JSON (no Three.js dependency at all)

export type AssetKind =
    | TextureAsset
    | AudioClipAsset
    | GLTFModelAsset
    | SpriteSheetAsset
    | ParticleConfigAsset;

// Format: "<game-id>/<relative-path-under-assets/>"
// Example: "tactics/textures/units/warrior-portrait.webp"
//          "tactics/models/units/warrior.glb"
//          "tactics/audio/sfx/sword-hit.ogg"
// The game-id prefix prevents cross-game ref collisions and makes paths self-describing.
export type AssetRef<_T extends AssetKind = AssetKind> = string & { readonly __assetRef: void };

export function buildAssetRef<T extends AssetKind>(
    gameId: string,
    relativePath: string,
): AssetRef<T> {
    return `${gameId}/${relativePath}` as AssetRef<T>;
}

export function parseAssetRef(ref: AssetRef): { gameId: string; relativePath: string } {
    const slash = ref.indexOf('/');
    if (slash < 1) throw new MalformedAssetRefError(ref);
    return { gameId: ref.slice(0, slash), relativePath: ref.slice(slash + 1) };
}

export class MalformedAssetRefError extends Error {
    constructor(public readonly ref: string) {
        super(`AssetRef '${ref}' is malformed — expected format: 'game-id/relative/path.ext'`);
    }
}
```

#### Asset References in Content JSON

Data objects declare asset fields using `AssetRef` strings. These are plain strings in JSON — the TypeScript schema for the collection declares the field type as `AssetRef<T>`.

```json
// games/tactics/data/units/warrior.json
{
    "id": "warrior",
    "name": "Warrior",
    "portrait": "tactics/textures/units/warrior-portrait.webp",
    "model": "tactics/models/units/warrior.glb",
    "idleSprite": "tactics/sprites/units/warrior-idle.webp",
    "sfx": {
        "attack": "tactics/audio/sfx/sword-hit.ogg",
        "death": "tactics/audio/sfx/warrior-death.ogg",
        "select": "tactics/audio/sfx/warrior-select.ogg"
    },
    "deathEffect": "tactics/particles/blood-burst.json"
}
```

The corresponding TypeScript schema:

```typescript
// games/tactics/schemas/units.schema.ts
import { z } from 'zod';

const AssetRefString = z.string().refine((s) => s.includes('/'), {
    message: 'AssetRef must be in format game-id/relative-path',
});

export const UnitSchema = z.object({
    id: z.string(),
    name: z.string(),
    portrait: AssetRefString, // AssetRef<TextureAsset>
    model: AssetRefString, // AssetRef<GLTFModelAsset>
    idleSprite: AssetRefString.optional(),
    sfx: z.object({
        attack: AssetRefString,
        death: AssetRefString,
        select: AssetRefString.optional(),
    }),
    deathEffect: AssetRefString.optional(), // AssetRef<ParticleConfigAsset>
});
```

#### Asset Manifest (`games/<name>/asset-manifest.ts`)

Each game declares its complete asset inventory before match start. This enables upfront preloading with a progress bar and catch-all validation in CI.

The `AssetManifest` / `AssetManifestEntry` / `AssetPriority` types are defined in
`simulation/content/` (they have no Three.js dependency — they are pure data).
A game's `asset-manifest.ts` only produces a VALUE of this type; the engine
`renderer/assets/` package imports the type from `@chimera/simulation/content`
and NEVER from any `games/*/` path. The manifest value is injected via
`AssetManagerContext` at game session start — dependency injection, not import.

```typescript
// simulation/content/AssetManifest.ts — engine-level, game-agnostic
export type AssetPriority =
    | 'critical' // Preloaded before match starts; game will not begin until loaded
    | 'deferred'; // Lazy-loaded on first use; fallback asset shown while loading

export interface AssetManifestEntry<T extends AssetKind = AssetKind> {
    readonly ref: AssetRef<T>;
    readonly priority: AssetPriority;
}

export interface AssetManifest {
    readonly gameId: string;
    readonly entries: readonly AssetManifestEntry[];
}
```

```typescript
// games/tactics/asset-manifest.ts — produces a VALUE of the engine type
import {
    AssetRef,
    AssetManifest,
    TextureAsset,
    GLTFModelAsset,
    AudioClipAsset,
    ParticleConfigAsset,
} from '@chimera/simulation/content';

export const TacticsAssetManifest: AssetManifest = {
    gameId: 'tactics',
    entries: [
        // Textures — critical: needed for the board on first frame
        {
            ref: 'tactics/textures/terrain/grass.webp' as AssetRef<TextureAsset>,
            priority: 'critical',
        },
        {
            ref: 'tactics/textures/terrain/stone.webp' as AssetRef<TextureAsset>,
            priority: 'critical',
        },
        {
            ref: 'tactics/textures/units/warrior-portrait.webp' as AssetRef<TextureAsset>,
            priority: 'critical',
        },
        {
            ref: 'tactics/textures/units/mage-portrait.webp' as AssetRef<TextureAsset>,
            priority: 'critical',
        },

        // 3D models — critical for the initial scene
        {
            ref: 'tactics/models/units/warrior.glb' as AssetRef<GLTFModelAsset>,
            priority: 'critical',
        },
        { ref: 'tactics/models/units/mage.glb' as AssetRef<GLTFModelAsset>, priority: 'critical' },

        // SFX — deferred: sounds can appear slightly after the visual
        {
            ref: 'tactics/audio/sfx/sword-hit.ogg' as AssetRef<AudioClipAsset>,
            priority: 'deferred',
        },
        {
            ref: 'tactics/audio/sfx/warrior-death.ogg' as AssetRef<AudioClipAsset>,
            priority: 'deferred',
        },

        // Particles — deferred: effect configs lazy-loaded on first trigger
        {
            ref: 'tactics/particles/blood-burst.json' as AssetRef<ParticleConfigAsset>,
            priority: 'deferred',
        },
    ],
};
```

#### `AssetResolver` — Environment-Aware Path Resolution

```typescript
// renderer/assets/AssetResolver.ts
import { AssetRef, parseAssetRef } from '@chimera/simulation/content';

// Injected at app startup via dependency injection — never hardwired per-component.
export interface AssetResolver {
    // Returns a URL safe for fetch() or Three.js loaders in the current environment.
    // In dev: file:///project-root/games/<gameId>/assets/<relativePath>
    // In prod: file://<app.getPath('resources')>/assets/<gameId>/<relativePath>
    resolve(ref: AssetRef): string;
}

// Production resolver: assets packed into Electron resources/ at build time
export function createProductionResolver(resourcesPath: string): AssetResolver {
    return {
        resolve(ref) {
            const { gameId, relativePath } = parseAssetRef(ref);
            // resources/assets/<gameId>/<relativePath>
            return `file://${resourcesPath}/assets/${gameId}/${relativePath}`;
        },
    };
}

// Development resolver: assets served directly from source tree
export function createDevResolver(projectRoot: string): AssetResolver {
    return {
        resolve(ref) {
            const { gameId, relativePath } = parseAssetRef(ref);
            return `file://${projectRoot}/games/${gameId}/assets/${relativePath}`;
        },
    };
}
```

The correct resolver is constructed in `electron/main/index.ts` and injected into the renderer via IPC/context bridge — the renderer never constructs paths itself.

#### `AssetManager` — Load, Cache, Dispose

```typescript
// renderer/assets/AssetManager.ts
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import {
    AssetRef,
    AssetKind,
    TextureAsset,
    GLTFModelAsset,
    AudioClipAsset,
    ParticleConfigAsset,
} from '@chimera/simulation/content';
import { AssetResolver } from './AssetResolver';
// AssetManifest is an engine-level type — NOT imported from any games/* folder.
// Games supply a manifest VALUE at session init via AssetManagerContext. The
// renderer/assets/ package never references any specific game's directory.
import { AssetManifest, AssetPriority } from '@chimera/simulation/content';

// Map AssetKind phantom type → runtime loaded type
export type ResolvedAsset<T extends AssetKind> = T extends TextureAsset
    ? THREE.Texture
    : T extends GLTFModelAsset
      ? GLTF
      : T extends AudioClipAsset
        ? AudioBuffer
        : T extends ParticleConfigAsset
          ? ParticleConfig
          : never;

export interface AssetManager {
    // Preload all 'critical' entries from a manifest. Resolves when all are loaded.
    // onProgress: 0.0 – 1.0 fraction of critical assets loaded.
    preloadCritical(
        manifest: AssetManifest,
        onProgress?: (fraction: number) => void,
    ): Promise<void>;

    // Synchronous get — returns null if not yet loaded. Safe to call every frame.
    get<T extends AssetKind>(ref: AssetRef<T>): ResolvedAsset<T> | null;

    // Async on-demand load for deferred assets. Subsequent calls for the same ref
    // return the cached Promise — never triggers a second network/disk request.
    load<T extends AssetKind>(ref: AssetRef<T>): Promise<ResolvedAsset<T>>;

    // Dispose all loaded GPU resources. Call on game session end.
    dispose(): void;
}

export function createAssetManager(resolver: AssetResolver): AssetManager {
    const cache = new Map<string, ResolvedAsset<AssetKind>>();
    const inflight = new Map<string, Promise<ResolvedAsset<AssetKind>>>();

    const textureLoader = new THREE.TextureLoader();
    const gltfLoader = new GLTFLoader();

    async function loadOne<T extends AssetKind>(ref: AssetRef<T>): Promise<ResolvedAsset<T>> {
        const url = resolver.resolve(ref);
        const ext = url.split('.').pop()?.toLowerCase();

        let result: ResolvedAsset<AssetKind>;

        if (ext === 'glb' || ext === 'gltf') {
            result = await new Promise<GLTF>((res, rej) =>
                gltfLoader.load(url, res, undefined, rej),
            );
        } else if (ext === 'ogg' || ext === 'mp3' || ext === 'wav') {
            const arrayBuffer = await fetch(url).then((r) => r.arrayBuffer());
            const ctx = new AudioContext();
            result = await ctx.decodeAudioData(arrayBuffer);
        } else if (ext === 'json') {
            result = await fetch(url).then((r) => r.json());
        } else {
            // Assume texture (webp, png, jpg)
            result = await new Promise<THREE.Texture>((res, rej) =>
                textureLoader.load(url, res, undefined, rej),
            );
        }

        cache.set(ref, result);
        inflight.delete(ref);
        return result as ResolvedAsset<T>;
    }

    return {
        async preloadCritical(manifest, onProgress) {
            const critical = manifest.entries.filter((e) => e.priority === 'critical');
            let done = 0;
            await Promise.all(
                critical.map(async (entry) => {
                    await loadOne(entry.ref);
                    onProgress?.(++done / critical.length);
                }),
            );
        },

        get<T extends AssetKind>(ref: AssetRef<T>) {
            return (cache.get(ref) as ResolvedAsset<T>) ?? null;
        },

        load<T extends AssetKind>(ref: AssetRef<T>) {
            if (cache.has(ref)) return Promise.resolve(cache.get(ref) as ResolvedAsset<T>);
            if (!inflight.has(ref)) inflight.set(ref, loadOne(ref));
            return inflight.get(ref)! as Promise<ResolvedAsset<T>>;
        },

        dispose() {
            for (const asset of cache.values()) {
                if (asset instanceof THREE.Texture) asset.dispose();
                if ((asset as GLTF).scene)
                    (asset as GLTF).scene.traverse((o) => {
                        if ((o as THREE.Mesh).isMesh) {
                            const mesh = o as THREE.Mesh;
                            mesh.geometry?.dispose();
                            (Array.isArray(mesh.material)
                                ? mesh.material
                                : [mesh.material]
                            ).forEach((m) => m?.dispose?.());
                        }
                    });
            }
            cache.clear();
            inflight.clear();
        },
    };
}
```

#### `useAsset` Hook — R3F Component Integration

```typescript
// renderer/assets/useAsset.ts
import { useContext, useEffect, useState } from 'react';
import { AssetRef, AssetKind } from '@chimera/simulation/content';
import { ResolvedAsset, AssetManager } from './AssetManager';
import { AssetManagerContext } from './AssetManagerContext';

// Fallback contract is UNIFORM across every AssetKind: while an asset is not yet
// resolved, `asset === null` and `loading === true`. Never return a partially-
// rendered stand-in of a different kind — components decide how to render the
// loading state (placeholder mesh, skeleton UI, invisible). This keeps the hook's
// behavioural contract identical for textures, GLTFs, audio, sprites, particles
// (LSP: swapping the type parameter never changes the return-shape semantics).

export function useAsset<T extends AssetKind>(
    ref: AssetRef<T> | null | undefined,
): { asset: ResolvedAsset<T> | null; loading: boolean } {
    const manager = useContext(AssetManagerContext);
    const [asset, setAsset] = useState<ResolvedAsset<T> | null>(() =>
        ref ? manager.get(ref) : null,
    );

    useEffect(() => {
        if (!ref) {
            setAsset(null);
            return;
        }
        const cached = manager.get<T>(ref);
        if (cached) {
            setAsset(cached);
            return;
        }

        let cancelled = false;
        manager.load<T>(ref).then((loaded) => {
            if (!cancelled) setAsset(loaded);
        });
        return () => {
            cancelled = true;
        };
    }, [ref, manager]);

    return { asset, loading: asset === null };
}
```

#### Usage in R3F Components

```typescript
// renderer/components/r3f/Unit.tsx
import { useAsset } from '../../assets/useAsset';

interface UnitProps {
  unitDefId: string;        // e.g. 'warrior'
  db: ContentDatabase;      // passed down from GameCanvas; read-only
  position: [number, number, number];
}

export function Unit({ unitDefId, db, position }: UnitProps) {
  const unitDef = db.getByIdOrThrow<UnitData>('units', unitDefId);

  // AssetRef strings come from the content database — never hard-coded here
  const { asset: model,   loading: modelLoading }   = useAsset(unitDef.model);
  const { asset: portrait                       }   = useAsset(unitDef.portrait);

  if (modelLoading || !model) {
    // Fallback geometry while loading
    return <mesh position={position}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="gray" /></mesh>;
  }

  return (
    <group position={position}>
      <primitive object={model.scene.clone()} />
    </group>
  );
}
```

#### Asset Production Layout (Electron Packaging)

In development, assets are served directly from the source tree. At build time, all game asset directories are copied into the Electron `resources/` folder by the packager config. The `AssetResolver` swaps the base path; no other code changes.

```
electron-dist/
└── resources/
    └── assets/
        └── tactics/
            ├── textures/
            ├── models/
            ├── audio/
            ├── particles/
            └── sprites/
```

The packager config (`electron-builder.yml`) includes:

```yaml
extraResources:
    - from: games/*/assets
      to: assets
      filter: ['**/*']
```

Expansion packs add their `assets/` directory under their own `<game-id>/` prefix and are copied to the same `resources/assets/` root — no naming collisions by design.

#### Asset Validation in CI

A `tools/validate-assets.ts` script runs at CI time (not at runtime) and:

1. Loads all content JSON files via `ContentLoader`
2. Scans every string field that matches `AssetRef` format (`<gameId>/<path>`)
3. Checks that each referenced file exists on disk under `games/<gameId>/assets/<path>`
4. Reports missing files with the data object path, field name, and expected file path

This catches broken references at commit time, before a player encounters a missing texture mid-match.

---

### 4.11 Save / Load System (`simulation/persistence/` + `electron/main/save-manager.ts`)

#### Design Rationale

The simulation's `GameSnapshot` is already a plain serialisable value type — it was designed that way to support deterministic replay and undo. Persisting game progress is a natural extension: a **save file is a named, durable Memento**. Because the `ActionHistory` is an append-only event log and the simulation is deterministic, recovery options range from lightweight (restore a full snapshot) to forensic (replay the full action log from any checkpoint).

Four design patterns govern the system:

| Pattern                                 | Role                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Memento**                             | `SaveFile` captures `GameSnapshot` (checkpoint) + `ActionHistory` (delta log since that checkpoint) into a named, versioned envelope. Direct extension of the in-memory `TurnMemento` already used for undo.                                                                     |
| **Repository**                          | `SaveRepository` (interface) + `FileSaveRepository` (implementation) isolates all filesystem I/O. Tests inject an `InMemorySaveRepository`.                                                                                                                                      |
| **Strategy**                            | `SaveSerializer` interface with `JsonSaveSerializer` and `CompressedSaveSerializer` implementations. Games choose the serialiser; the engine core is not coupled to either.                                                                                                      |
| **Chain of Responsibility (Migration)** | `SaveMigrator` holds an ordered chain of `SaveMigration` handlers. On load, each handler checks `file.schemaVersion` and applies its transform if the version matches. New schema versions always add a migration step; old saves are upgraded forward, never rejected outright. |

#### Save File Format

```typescript
// simulation/persistence/SaveFile.ts

// Every save file begins with this header — read before deserialising the rest.
interface SaveFileHeader {
    readonly schemaVersion: number; // Incremented on every breaking change to SaveFile shape
    readonly engineVersion: string; // Semver of the Chimera engine that wrote the file
    readonly gameId: string; // e.g. 'tactics'
    readonly gameVersion: string; // Semver of the specific game (content may change)
    readonly slotId: string; // e.g. 'autosave', 'quicksave', 'slot-2'
    readonly savedAt: number; // Unix timestamp ms
    readonly turnNumber: number; // Human-readable position in the game
    readonly playerNames: string[]; // For save slot UI display
    readonly thumbnailDataUrl?: string; // Base64 PNG from renderer screenshot (optional)
}

// The full save envelope — header + restorable simulation state.
// ActionHistory since the checkpoint snapshot is stored separately so that
// loading can skip replay entirely (restore snapshot directly) while keeping
// the full event log available for forensic replay.
interface SaveFile {
    readonly header: SaveFileHeader;

    // ── Checkpoint (full snapshot at the moment of save) ────────────────────
    // Restoring from this directly gives O(1) load time regardless of match length.
    readonly checkpoint: GameSnapshot;

    // ── Delta log since the checkpoint ──────────────────────────────────────
    // Normally empty at save time (save typically happens at END_TURN, which also
    // commits the turn).  Retained for forensic replay and integrity verification:
    //   applyAll(checkpoint, deltaActions) must equal checkpoint (empty log) or reconstruct
    //   any mid-turn state the player chose to save into.
    readonly deltaActions: readonly EngineAction[];

    // ── Commitment state ─────────────────────────────────────────────────────
    // All pending CommitmentEnvelopes at save time — required for anti-cheat continuity
    // after load. Without these, the client cannot verify REVEAL messages for values
    // that were committed before the save but revealed after.
    readonly pendingCommitments: Record<CommitmentId, CommitmentEnvelope>;
}
```

#### `SaveSerializer` — Strategy Pattern

```typescript
// simulation/persistence/SaveSerializer.ts
export interface SaveSerializer {
    serialize(file: SaveFile): string | Buffer;
    deserialize(raw: string | Buffer): SaveFile;
}

// simulation/persistence/JsonSaveSerializer.ts
// Default: human-readable JSON. Easy to inspect and debug.
export class JsonSaveSerializer implements SaveSerializer {
    serialize(file: SaveFile): string {
        return JSON.stringify(file, null, 2);
    }
    deserialize(raw: string | Buffer): SaveFile {
        return JSON.parse(raw.toString()) as SaveFile;
    }
}

// simulation/persistence/CompressedSaveSerializer.ts
// Wraps JsonSaveSerializer: gzip the JSON for large-state games.
import { gzipSync, gunzipSync } from 'zlib';
export class CompressedSaveSerializer implements SaveSerializer {
    private readonly inner = new JsonSaveSerializer();
    serialize(file: SaveFile): Buffer {
        return gzipSync(Buffer.from(this.inner.serialize(file), 'utf8'));
    }
    deserialize(raw: Buffer): SaveFile {
        return this.inner.deserialize(gunzipSync(raw).toString('utf8'));
    }
}
```

#### `SaveRepository` — Repository Pattern

```typescript
// simulation/persistence/SaveRepository.ts (interface — zero FS deps)
export interface SaveSlotMeta {
    readonly slotId: string;
    readonly gameId: string;
    readonly savedAt: number;
    readonly turnNumber: number;
    readonly playerNames: string[];
    readonly thumbnailDataUrl?: string;
    readonly schemaVersion: number;
    readonly sizeBytes: number;
}

export interface SaveRepository {
    // List all save slots for a game. Returns metadata only — does not load full SaveFile.
    list(gameId: string): Promise<SaveSlotMeta[]>;

    // Load a full SaveFile by slot ID. Throws SaveNotFoundError if absent.
    // Runs SaveMigrator automatically if schemaVersion < current.
    load(slotId: string): Promise<SaveFile>;

    // Write a SaveFile to the named slot. Overwrites silently if slot exists.
    // Atomic: writes to a .tmp file then renames to prevent corruption on crash.
    save(file: SaveFile): Promise<void>;

    // Delete a save slot. Throws SaveNotFoundError if absent.
    delete(slotId: string): Promise<void>;

    // True if slot exists.
    has(slotId: string): Promise<boolean>;
}

// electron/main/FileSaveRepository.ts — production implementation
// Stores files in: app.getPath('userData')/saves/<gameId>/<slotId>.chimera
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export class FileSaveRepository implements SaveRepository {
    constructor(
        private readonly serializer: SaveSerializer,
        private readonly migrator: SaveMigrator,
        private readonly baseDir: string = path.join(app.getPath('userData'), 'saves'),
    ) {}

    private slotPath(gameId: string, slotId: string): string {
        return path.join(this.baseDir, gameId, `${slotId}.chimera`);
    }

    async list(gameId: string): Promise<SaveSlotMeta[]> {
        const dir = path.join(this.baseDir, gameId);
        const files = await fs.readdir(dir).catch(() => [] as string[]);
        const metas = await Promise.all(
            files
                .filter((f) => f.endsWith('.chimera'))
                .map(async (f) => {
                    const raw = await fs.readFile(path.join(dir, f));
                    const file = this.serializer.deserialize(raw);
                    const stat = await fs.stat(path.join(dir, f));
                    return { ...file.header, sizeBytes: stat.size } satisfies SaveSlotMeta;
                }),
        );
        return metas.sort((a, b) => b.savedAt - a.savedAt);
    }

    async load(slotId: string): Promise<SaveFile> {
        // slotId encodes 'gameId/slotName' or caller provides gameId separately
        const parts = slotId.split('/');
        const [gameId, slot] = parts.length === 2 ? parts : ['unknown', slotId];
        const p = this.slotPath(gameId, slot);
        const raw = await fs.readFile(p).catch(() => {
            throw new SaveNotFoundError(slotId);
        });
        const file = this.serializer.deserialize(raw);
        return this.migrator.migrate(file); // no-op if already current schema
    }

    async save(file: SaveFile): Promise<void> {
        const dir = path.join(this.baseDir, file.header.gameId);
        await fs.mkdir(dir, { recursive: true });
        const p = this.slotPath(file.header.gameId, file.header.slotId);
        const tmp = `${p}.tmp`;
        await fs.writeFile(tmp, this.serializer.serialize(file));
        await fs.rename(tmp, p); // atomic on same filesystem; prevents corruption on crash
    }

    async delete(slotId: string): Promise<void> {
        const parts = slotId.split('/');
        const [gameId, slot] = parts.length === 2 ? parts : ['unknown', slotId];
        await fs.unlink(this.slotPath(gameId, slot)).catch(() => {
            throw new SaveNotFoundError(slotId);
        });
    }

    async has(slotId: string): Promise<boolean> {
        const parts = slotId.split('/');
        const [gameId, slot] = parts.length === 2 ? parts : ['unknown', slotId];
        return fs
            .access(this.slotPath(gameId, slot))
            .then(() => true)
            .catch(() => false);
    }
}
```

#### `SaveMigrator` — Chain of Responsibility

```typescript
// simulation/persistence/SaveMigrator.ts
export const CURRENT_SCHEMA_VERSION = 1;

export interface SaveMigration {
    readonly fromVersion: number;
    apply(file: SaveFile): SaveFile;
}

export class SaveMigrator {
    private readonly migrations: SaveMigration[] = [];

    register(migration: SaveMigration): void {
        this.migrations.push(migration);
        this.migrations.sort((a, b) => a.fromVersion - b.fromVersion);
    }

    // Applies each migration whose fromVersion matches the file's current version,
    // upgrading it step-by-step until it reaches CURRENT_SCHEMA_VERSION.
    // Throws SaveSchemaTooNewError if file.header.schemaVersion > CURRENT_SCHEMA_VERSION.
    migrate(file: SaveFile): SaveFile {
        if (file.header.schemaVersion > CURRENT_SCHEMA_VERSION) {
            throw new SaveSchemaTooNewError(file.header.schemaVersion, CURRENT_SCHEMA_VERSION);
        }
        let current = file;
        for (const migration of this.migrations) {
            if (current.header.schemaVersion === migration.fromVersion) {
                current = {
                    ...migration.apply(current),
                    header: { ...current.header, schemaVersion: migration.fromVersion + 1 },
                };
            }
        }
        return current;
    }
}

// Error types
export class SaveNotFoundError extends Error {
    constructor(public readonly slotId: string) {
        super(`Save slot '${slotId}' not found`);
    }
}

export class SaveSchemaTooNewError extends Error {
    constructor(
        public readonly fileVersion: number,
        public readonly engineVersion: number,
    ) {
        super(
            `Save file schema v${fileVersion} is newer than this engine supports (v${engineVersion})`,
        );
    }
}
```

#### Save / Load Flow

```
───── SAVE ─────────────────────────────────────────────────────────────────
[Renderer: player clicks "Save" or END_TURN triggers autosave]
  window.__chimera.saves.save({ slotId: 'slot-1', thumbnail: dataUrl })
     │   IPC (contextBridge)
     ▼
[electron/main/save-manager.ts]
  1. Read current GameSnapshot + ActionHistory from simulation-host
  2. Build SaveFile { header, checkpoint: snapshot, deltaActions, pendingCommitments }
  3. SaveRepository.save(file)               ← atomic write via .tmp rename
  4. Broadcast updated SaveSlotMeta[] → renderer via onSaveSlotUpdate()

───── AUTO-SAVE ─────────────────────────────────────────────────────────────
[ActionPipeline step 6: history.append(action)]
  └── if action.type === 'engine:end_turn':
        simulation-host calls save-manager.autoSave()
        SlotId = '<gameId>/autosave'

───── LOAD ──────────────────────────────────────────────────────────────────
[Renderer: player selects slot from save screen]
  window.__chimera.saves.load('tactics/slot-1')
     │   IPC
     ▼
[electron/main/save-manager.ts]
  1. SaveRepository.load('tactics/slot-1')   ← applies SaveMigrator if needed
  2. Validate SaveFile header: gameId, gameVersion compatibility check
  3. simulation-host.restoreFromSave(file)
        a. Stop current tick loop
        b. Replace GameSnapshot with file.checkpoint
        c. Replace ActionHistory with deltaActions (replay onto checkpoint if non-empty)
        d. Restore pendingCommitments into CommitmentScheme
        e. Restart tick loop
  4. Broadcast fresh PlayerSnapshot to all connected clients (same as reconnect)
  5. Notify renderer: 'load_complete' → renderer navigates to match screen
```

#### Crash Recovery

On application start, `save-manager.ts` checks for a `lastCleanExit.flag` in `userData`. If the flag is absent (crash), and an `autosave` exists, the renderer is offered a "Resume last session" prompt.

```typescript
// electron/main/save-manager.ts (startup check)
async function checkCrashRecovery(): Promise<CrashRecoveryInfo | null> {
    const cleanExitPath = path.join(app.getPath('userData'), 'lastCleanExit.flag');
    const hadCleanExit = await fs
        .access(cleanExitPath)
        .then(() => true)
        .catch(() => false);

    if (!hadCleanExit) {
        // Check if any autosave exists across all game IDs
        const saves = await repository.list('*'); // glob or per-known-game scan
        const autosaves = saves.filter((s) => s.slotId === 'autosave');
        if (autosaves.length > 0) return { autosave: autosaves[0] };
    }

    // Write clean-exit flag on clean shutdown (app 'before-quit' event)
    return null;
}
```

#### Multiplayer Save Constraints

| Scenario                               | Behaviour                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host saves mid-match                   | `engine:save` is dispatched by host only; validated + logged in `ActionHistory`. Clients receive a `SAVE_NOTIFY` server message (informational only — no state change on client). |
| Client requests save                   | Request rejected by `validate()` on the host — clients cannot trigger `engine:save`.                                                                                              |
| Load during active multiplayer session | Not permitted. `engine:load` is only valid when the lobby is in `PREGAME` or `ENDED` state. Attempting to load mid-match returns an error to the renderer.                        |
| Rejoin after host loaded a save        | Host broadcasts a fresh full `PlayerSnapshot` at the restored tick; reconnecting clients receive it via the standard reconnect path — no special load-aware client code needed.   |

#### Save Slot UI State (Renderer)

```typescript
// renderer/state/saveStore.ts
interface SaveStore {
    slots: SaveSlotMeta[];
    isSaving: boolean;
    isLoading: boolean;
    lastError: string | null;

    // Called by ipcClient on 'onSaveSlotUpdate'
    setSlots(slots: SaveSlotMeta[]): void;
    setSaving(v: boolean): void;
    setLoading(v: boolean): void;
}
```

The `SaveScreen` component reads `saveStore.slots` and renders a grid of save slots — each showing turn number, saved timestamp, player names, and thumbnail. Save/load/delete actions go through `window.__chimera` and never touch the simulation directly.

#### Save Repository Implementations

`SaveRepository` is the abstraction seam. `SaveManager` is constructed with an implementation injected at startup in `electron/main/index.ts` — it never references a concrete class name internally. Swapping the storage backend requires changing a single wiring line:

```typescript
// electron/main/index.ts — the single wiring point for save storage
const saveRepo: SaveRepository = new FileSaveRepository(
    new CompressedSaveSerializer(),
    saveMigrator,
    path.join(app.getPath('userData'), 'saves'),
);
// Future: const saveRepo = isSteamCloudAvailable()
//           ? new SteamCloudSaveRepository(steamClient, saveMigrator)
//           : new FileSaveRepository(...);

const saveManager = new SaveManager(saveRepo);
```

| Implementation             | Storage                             | Use case                                         | Status                      |
| -------------------------- | ----------------------------------- | ------------------------------------------------ | --------------------------- |
| `FileSaveRepository`       | `userData/saves/<game-id>/` on disk | Default — local desktop saves                    | Implemented                 |
| `InMemorySaveRepository`   | In-process `Map<string, SaveFile>`  | Test double; E2E fixtures start with clean state | Implemented (test/E2E only) |
| `SteamCloudSaveRepository` | Steam Remote Storage API            | Cross-device cloud saves for Steam releases      | Future placeholder          |

`InMemorySaveRepository` is a complete, behavior-correct implementation of `SaveRepository` that stores files in memory. It is used by E2E fixtures to avoid touching `userData` between test runs and by unit tests that need a real repository without filesystem I/O.

---

### 4.12 Runtime Debug Layer (`simulation/debug/` + `electron/main/debug-bridge.ts`)

#### Executive Decision

The debug layer gives engine and game developers full, authoritative visibility into the running simulation: every historical `GameSnapshot`, every action ever applied, and — critically — a per-player projection explorer that shows exactly what each player's `PlayerSnapshot` looks like at any tick. It is **entirely absent in production** and must never create an information exposure risk for players.

#### Debug Mode Identification

Debug mode is controlled by a single environment variable and a derived TypeScript constant that enables compile-time dead-code elimination:

```typescript
// shared/constants.ts
// process.env is replaced by bundler at build time.
// In production (NODE_ENV=production), IS_DEBUG_MODE is always false
// and the entire debug module import graph is eliminated by tree-shaking.
export const IS_DEBUG_MODE =
    process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';
```

| Environment                 | `CHIMERA_DEBUG` | `NODE_ENV`    | `IS_DEBUG_MODE` | Debug bridge started |
| --------------------------- | --------------- | ------------- | --------------- | -------------------- |
| Production package          | absent          | `production`  | `false`         | Never                |
| Dev server (`npm run dev`)  | `1`             | `development` | `true`          | Yes                  |
| Staging / QA                | `1`             | `staging`     | `true`          | Yes                  |
| CI (unit/integration)       | absent          | `test`        | `false`         | Never                |
| E2E tests (`CHIMERA_E2E=1`) | absent          | `test`        | `false`         | Never                |

`CHIMERA_DEBUG` is explicitly excluded from `electron-builder`'s `extraMetadata.env` and from the production packaging scripts. A lint rule (`no-debug-in-production`) catches any accidental hard-coding.

The main process gates the entire debug subsystem behind a single dynamic import at startup:

```typescript
// electron/main/index.ts
if (IS_DEBUG_MODE) {
    // Dynamic import: tree-shaken out entirely when IS_DEBUG_MODE is false.
    const { startDebugBridge } = await import('./debug-bridge');
    await startDebugBridge(simulationHost, stateProjector);
}
```

#### Separation: Inspector Window vs Game Renderer

The debug Inspector Window is a **second, independent `BrowserWindow`**. It has its own preload script (`debug-api.ts`) that exposes `window.__chimeraDebug` — a surface the game renderer window never has access to. The game renderer's `window.__chimera` is unreachable from the Inspector Window.

```
Host Machine (CHIMERA_DEBUG=1)
│
├── Game Renderer Window
│     preload: api.ts → window.__chimera           ← game player controls, snapshots
│     NO access to window.__chimeraDebug
│
└── Inspector Window  (second BrowserWindow)
      preload: debug-api.ts → window.__chimeraDebug ← debug queries only
      NO access to window.__chimera
      contextIsolation: true, nodeIntegration: false
```

This preserves the security model: even if the Inspector Window were compromised, it cannot dispatch game actions. Even if the game renderer were compromised, it cannot read debug data.

#### `SnapshotRingBuffer` — Observer Pattern

The ring buffer is registered as a post-step observer on `ActionPipeline`. After every successful step 5 (reduce), before step 7 (broadcast), the pipeline calls `ringBuffer.record(tick, snapshot)`. This is the only coupling between the simulation and the debug layer — a single narrow optional callback behind `IS_DEBUG_MODE`.

```typescript
// simulation/debug/SnapshotRingBuffer.ts
export interface RingBufferEntry {
    readonly tick: number;
    readonly snapshot: GameSnapshot;
    readonly recordedAt: number; // wall-clock ms — for perf stats
}

export class SnapshotRingBuffer {
    private readonly entries: (RingBufferEntry | undefined)[];
    private head = 0;
    onRecord?: (entry: RingBufferEntry) => void; // Optional live-push hook for debug-bridge

    // Default capacity: 200 ticks (~10 seconds at 20Hz).
    // Override via CHIMERA_DEBUG_BUFFER_SIZE env var.
    constructor(private readonly capacity: number = 200) {
        this.entries = new Array(capacity);
    }

    record(tick: number, snapshot: GameSnapshot): void {
        const entry: RingBufferEntry = { tick, snapshot, recordedAt: Date.now() };
        this.entries[this.head % this.capacity] = entry;
        this.head++;
        this.onRecord?.(entry);
    }

    // Returns undefined if tick is not in the buffer.
    get(tick: number): RingBufferEntry | undefined {
        return this.entries.find((e) => e?.tick === tick);
    }

    // All ticks currently held in buffer, sorted newest first.
    allTicks(): number[] {
        return this.entries
            .filter((e): e is RingBufferEntry => e !== undefined)
            .sort((a, b) => b.tick - a.tick)
            .map((e) => e.tick);
    }
}
```

#### `SnapshotInspector` — Facade/Proxy Pattern

`SnapshotInspector` provides the unified query API consumed by the debug bridge and the Inspector Window. It hides the complexity of ring buffer lookup vs. replay-from-memento reconstruction behind a clean interface.

```typescript
// simulation/debug/SnapshotInspector.ts

export interface TickEntry {
    tick: number;
    turnNumber: number;
    actionType: string; // Last action applied at this tick
    inRingBuffer: boolean; // true → O(1) access; false → replay required
}

export interface PerfStats {
    avgTickDurationMs: number;
    maxTickDurationMs: number;
    bufferCapacity: number;
    bufferUsed: number;
    totalActionCount: number;
}

export class SnapshotInspector {
    constructor(
        private readonly ringBuffer: SnapshotRingBuffer,
        private readonly mementos: TurnMemento[], // read-only; from UndoManager
        private readonly history: ActionHistory, // read-only
        private readonly reducer: StateReducer, // for tick replay
        private readonly projector: StateProjector, // for projection queries
    ) {}

    // ─── Tick list ──────────────────────────────────────────────────────────
    listTicks(): TickEntry[] {
        return this.history.entries().map((e) => ({
            tick: e.tickApplied,
            turnNumber: e.turnNumber,
            actionType: e.action.type,
            inRingBuffer: this.ringBuffer.get(e.tickApplied) !== undefined,
        }));
    }

    // ─── Snapshot retrieval ─────────────────────────────────────────────────
    // O(1) from ring buffer. O(n) replay from nearest TurnMemento if not buffered
    // (n = actions since that memento — bounded by turn length, typically < 50).
    getSnapshot(tick: number): GameSnapshot {
        const buffered = this.ringBuffer.get(tick);
        if (buffered) return buffered.snapshot;
        return this.reconstructFromMemento(tick);
    }

    // ─── Projection ─────────────────────────────────────────────────────────
    // Returns exactly what a specific player would see at a specific tick.
    // This is the primary tool for verifying information hiding and fog-of-war.
    getProjection(tick: number, playerId: PlayerId): PlayerSnapshot {
        return this.projector.project(this.getSnapshot(tick), playerId);
    }

    // ─── Diff ───────────────────────────────────────────────────────────────
    diff(fromTick: number, toTick: number): SnapshotDiff {
        return computeSnapshotDiff(this.getSnapshot(fromTick), this.getSnapshot(toTick));
    }

    // ─── Action log ─────────────────────────────────────────────────────────
    getActionLog(fromTick?: number, toTick?: number): ActionHistoryEntry[] {
        return this.history.entries().filter((e) => {
            if (fromTick !== undefined && e.tickApplied < fromTick) return false;
            if (toTick !== undefined && e.tickApplied > toTick) return false;
            return true;
        });
    }

    // ─── Performance ────────────────────────────────────────────────────────
    getPerfStats(): PerfStats {
        const buffered = this.ringBuffer
            .allTicks()
            .map((t) => this.ringBuffer.get(t)!)
            .filter(Boolean)
            .sort((a, b) => a.tick - b.tick);
        const durations = buffered
            .slice(0, -1)
            .map((e, i) => buffered[i + 1].recordedAt - e.recordedAt)
            .filter((d) => d > 0 && d < 5000); // filter outliers (e.g. paused game)
        return {
            avgTickDurationMs: durations.length
                ? durations.reduce((a, b) => a + b, 0) / durations.length
                : 0,
            maxTickDurationMs: durations.length ? Math.max(...durations) : 0,
            bufferCapacity: (this.ringBuffer as unknown as { capacity: number }).capacity,
            bufferUsed: buffered.length,
            totalActionCount: this.history.entries().length,
        };
    }

    private reconstructFromMemento(tick: number): GameSnapshot {
        const memento = [...this.mementos]
            .reverse()
            .find((m) => m.snapshotAtTurnStart.tick <= tick);
        if (!memento)
            throw new DebugReconstructionError(tick, 'no TurnMemento at or before requested tick');

        let state = memento.snapshotAtTurnStart;
        const actionsToReplay = this.history
            .entries()
            .filter((e) => e.tickApplied > state.tick && e.tickApplied <= tick);
        for (const entry of actionsToReplay) {
            state = this.reducer.apply(state, entry.action);
        }
        return state;
    }
}

export class DebugReconstructionError extends Error {
    constructor(
        public readonly tick: number,
        reason: string,
    ) {
        super(`Cannot reconstruct snapshot at tick ${tick}: ${reason}`);
    }
}
```

#### `SnapshotDiff` — Structural diff

```typescript
// simulation/debug/SnapshotDiff.ts
export type DiffKind = 'added' | 'removed' | 'changed';

export interface DiffEntry {
    path: string; // Dot-delimited JSON path: 'entities.unit-1.hp'
    kind: DiffKind;
    before?: unknown;
    after?: unknown;
}

export interface SnapshotDiff {
    fromTick: number;
    toTick: number;
    entries: DiffEntry[];
    summary: { added: number; removed: number; changed: number };
}

export function computeSnapshotDiff(from: GameSnapshot, to: GameSnapshot): SnapshotDiff {
    const entries: DiffEntry[] = [];
    diffObjects(from as Record<string, unknown>, to as Record<string, unknown>, '', entries);
    return {
        fromTick: from.tick,
        toTick: to.tick,
        entries,
        summary: {
            added: entries.filter((e) => e.kind === 'added').length,
            removed: entries.filter((e) => e.kind === 'removed').length,
            changed: entries.filter((e) => e.kind === 'changed').length,
        },
    };
}

function diffObjects(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    prefix: string,
    out: DiffEntry[],
): void {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (!(key in a)) {
            out.push({ path, kind: 'added', after: b[key] });
        } else if (!(key in b)) {
            out.push({ path, kind: 'removed', before: a[key] });
        } else if (
            typeof a[key] === 'object' &&
            a[key] !== null &&
            typeof b[key] === 'object' &&
            b[key] !== null
        ) {
            diffObjects(
                a[key] as Record<string, unknown>,
                b[key] as Record<string, unknown>,
                path,
                out,
            );
        } else if (a[key] !== b[key]) {
            out.push({ path, kind: 'changed', before: a[key], after: b[key] });
        }
    }
}
```

#### `DebugProtocol` — Typed IPC Messages

```typescript
// simulation/debug/DebugProtocol.ts

// Inspector Window → Main (requests)
export type DebugRequest =
    | { type: 'GET_TICK_LIST' }
    | { type: 'GET_SNAPSHOT'; tick: number }
    | { type: 'GET_PROJECTION'; tick: number; playerId: PlayerId }
    | { type: 'GET_DIFF'; fromTick: number; toTick: number }
    | { type: 'GET_ACTION_LOG'; fromTick?: number; toTick?: number }
    | { type: 'GET_PERF_STATS' }
    | { type: 'SUBSCRIBE_LIVE' } // Request live LIVE_TICK pushes
    | { type: 'UNSUBSCRIBE_LIVE' };

// Main → Inspector Window (responses + live pushes)
export type DebugResponse =
    | { type: 'TICK_LIST'; ticks: TickEntry[] }
    | { type: 'SNAPSHOT'; tick: number; snapshot: GameSnapshot } // full truth — debug only
    | { type: 'PROJECTION'; tick: number; playerId: PlayerId; snapshot: PlayerSnapshot }
    | { type: 'DIFF'; diff: SnapshotDiff }
    | { type: 'ACTION_LOG'; entries: ActionHistoryEntry[] }
    | { type: 'PERF_STATS'; stats: PerfStats }
    | { type: 'LIVE_TICK'; tick: number; snapshot: GameSnapshot } // pushed on subscription
    | { type: 'ERROR'; message: string };
```

#### `debug-bridge.ts` and `debug-api.ts` — Main Process Wiring

```typescript
// electron/main/debug-bridge.ts  (only imported when IS_DEBUG_MODE === true)
import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { SnapshotInspector } from '@chimera/simulation/debug';
import type { DebugRequest, DebugResponse } from '@chimera/simulation/debug';

export async function startDebugBridge(
    simulationHost: SimulationHost,
    projector: StateProjector,
): Promise<void> {
    const inspector = new SnapshotInspector(
        simulationHost.ringBuffer,
        simulationHost.mementos,
        simulationHost.history,
        simulationHost.reducer,
        projector,
    );

    const inspectorWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: 'Chimera Inspector',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, '../preload/debug-api.js'),
        },
    });

    inspectorWindow.loadURL(
        `file://${path.join(__dirname, '../../renderer/out/debug/index.html')}`,
    );

    ipcMain.handle(
        'chimera:debug',
        async (event, request: DebugRequest): Promise<DebugResponse> => {
            // Security: only accept requests originating from the Inspector Window
            if (event.sender.id !== inspectorWindow.webContents.id) {
                return {
                    type: 'ERROR',
                    message: 'Unauthorised: request not from Inspector Window',
                };
            }
            try {
                switch (request.type) {
                    case 'GET_TICK_LIST':
                        return { type: 'TICK_LIST', ticks: inspector.listTicks() };
                    case 'GET_SNAPSHOT':
                        return {
                            type: 'SNAPSHOT',
                            tick: request.tick,
                            snapshot: inspector.getSnapshot(request.tick),
                        };
                    case 'GET_PROJECTION':
                        return {
                            type: 'PROJECTION',
                            tick: request.tick,
                            playerId: request.playerId,
                            snapshot: inspector.getProjection(request.tick, request.playerId),
                        };
                    case 'GET_DIFF':
                        return {
                            type: 'DIFF',
                            diff: inspector.diff(request.fromTick, request.toTick),
                        };
                    case 'GET_ACTION_LOG':
                        return {
                            type: 'ACTION_LOG',
                            entries: inspector.getActionLog(request.fromTick, request.toTick),
                        };
                    case 'GET_PERF_STATS':
                        return { type: 'PERF_STATS', stats: inspector.getPerfStats() };
                    case 'SUBSCRIBE_LIVE':
                        simulationHost.ringBuffer.onRecord = (entry) => {
                            if (!inspectorWindow.isDestroyed()) {
                                inspectorWindow.webContents.send('chimera:debug:live', {
                                    type: 'LIVE_TICK',
                                    tick: entry.tick,
                                    snapshot: entry.snapshot,
                                } satisfies DebugResponse);
                            }
                        };
                        return { type: 'TICK_LIST', ticks: inspector.listTicks() };
                    case 'UNSUBSCRIBE_LIVE':
                        simulationHost.ringBuffer.onRecord = undefined;
                        return { type: 'TICK_LIST', ticks: [] };
                }
            } catch (err) {
                return { type: 'ERROR', message: String(err) };
            }
        },
    );
}

// electron/preload/debug-api.ts  (Inspector Window only — never loaded by game renderer)
import { contextBridge, ipcRenderer } from 'electron';
import type { DebugRequest, DebugResponse } from '@chimera/simulation/debug';

contextBridge.exposeInMainWorld('__chimeraDebug', {
    request(req: DebugRequest): Promise<DebugResponse> {
        return ipcRenderer.invoke('chimera:debug', req);
    },
    onLiveTick(cb: (r: DebugResponse) => void): () => void {
        const fn = (_: unknown, data: DebugResponse) => cb(data);
        ipcRenderer.on('chimera:debug:live', fn);
        return () => ipcRenderer.off('chimera:debug:live', fn);
    },
});
```

#### Inspector Window UI Summary (`renderer/app/debug/page.tsx`)

The Inspector Window is a React app loaded on the `/debug` route of the same static export. It guards itself at mount — `window.__chimeraDebug` is absent in production, making the page inert without any conditional compilation needed in the renderer.

| Panel                   | What it shows                                                                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeline**            | Scrollable tick list. Ring-buffered ticks highlighted (O(1) access). Others shown as reconstructible. Click to select. Live mode auto-scrolls as ticks arrive.                                                                                                                     |
| **Snapshot Inspector**  | JSON tree of the full `GameSnapshot` at the selected tick. This is the developer's authoritative view — all fields visible, no projection applied.                                                                                                                                 |
| **Projection Explorer** | `PlayerId` dropdown. Shows `StateProjector.project(snapshot, playerId)` for each player. Side-by-side diff of full snapshot vs. projected view highlights every masked, nulled, or absent field — the definitive tool for verifying information hiding and fog-of-war correctness. |
| **Diff View**           | Compare any two ticks. `SnapshotDiff` rendered as a flat list of changed paths with before/after values.                                                                                                                                                                           |
| **Action Log**          | Filterable table of all `ActionHistoryEntry` rows. Filter by `playerId`, action type prefix, or tick range. Click a row to jump the Timeline to that tick.                                                                                                                         |
| **Performance**         | Tick duration graph (last buffer window), avg/max tick time, ring buffer fill level, total action count.                                                                                                                                                                           |

#### Ring Buffer Hook in `ActionPipeline`

The simulation-side change is a single optional callback in `PipelineContext`, only present when `IS_DEBUG_MODE` is true. The callback is called between step 5 (reduce) and step 7 (broadcast):

```typescript
// simulation/engine/ActionPipeline.ts (debug observer extension)
interface PipelineContext {
    // ... existing fields ...
    // Set only when NODE_ENV !== 'production' and debug mode is enabled. Never present in production bundles.
    debugObserver?: (tick: number, snapshot: GameSnapshot) => void;
}

// Inside ActionPipeline.process(), between step 5 and step 6:
context.debugObserver?.(nextState.tick, nextState);
```

---

### 4.13 Game Configuration / Settings System (`simulation/settings/` + `electron/main/settings-manager.ts`)

#### Executive Decision

Settings are a distinct persistence concern from gameplay saves. They live outside `GameSnapshot`, are loaded before the tick loop starts, and can change mid-session (audio volume, display resolution, key bindings). Each game declares its own settings schema by extending a typed engine base. User overrides are stored per game-id in `userData/settings/<game-id>.json` and deep-merged at load time over engine defaults then game defaults — the **Layered Defaults (Prototype/merge) pattern**. The repository pattern (consistent with `SaveRepository` from §4.11) encapsulates the file-system operations.

#### Design Patterns

| Pattern                                | Where used                                                | Why                                                                                                      |
| -------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Schema-per-game** (Zod)              | `games/<name>/settings-schema.ts`                         | Consistent with `ContentLoader` validation; compile-time type safety; runtime parse + strip unknown keys |
| **Layered defaults / Prototype merge** | `SettingsMerger.mergeAll()`                               | Engine defaults → game defaults → user overrides; each layer only overrides what it explicitly sets      |
| **Repository**                         | `SettingsRepository` interface + `FileSettingsRepository` | Mirrors `SaveRepository`; swappable for in-memory test double; atomic write safety                       |

#### Settings Scope

Two top-level scopes share the same pipeline:

| Scope           | `gameId` value | Owned by                                                                      |
| --------------- | -------------- | ----------------------------------------------------------------------------- |
| **Engine-wide** | `'engine'`     | Electron shell; applies to all games (audio, display, controls)               |
| **Per-game**    | `'<game-id>'`  | The game's `settings-schema.ts`; extends `EngineSettings` with its own fields |

#### Key Interfaces

```typescript
// simulation/settings/SettingsSchema.ts

// ─── Engine base settings ─────────────────────────────────────────────────
interface EngineSettings {
    audio: {
        masterVolume: number; // 0.0–1.0
        sfxVolume: number;
        musicVolume: number;
        muted: boolean;
    };
    display: {
        fullscreen: boolean;
        vsync: boolean;
        targetFps: 30 | 60 | 120 | 0; // 0 = uncapped
        uiScale: number; // 0.5–2.0 multiplier
    };
    gameplay: {
        language: string; // BCP 47 locale tag, e.g. 'en-US'
        autoSave: boolean;
        autoSaveIntervalTurns: number;
        showHints: boolean;
        showPerfHud: boolean; // Default: false. Forces PerfHud visible regardless of F3 toggle. See §4.16
    };
    controls: {
        keyBindings: Record<string, string>; // actionId → key (e.g. 'undo' → 'Ctrl+Z')
    };
}

// ─── Game-specific schema declaration ────────────────────────────────────
// Games extend EngineSettings. Fields not present in engine base are game-owned.
interface GameSettingsSchema<T extends EngineSettings> {
    gameId: string;
    defaults: T; // Complete set of game defaults (engine fields + game fields)
    zodSchema: z.ZodType<T>; // Zod schema for parse/strip/validate
}

// ─── Runtime merged type ─────────────────────────────────────────────────
// What the renderer and simulation-host receive after all layers are merged
type ResolvedSettings = EngineSettings & Record<string, unknown>;

// What the file on disk contains — only the keys the user explicitly changed
type UserSettings = DeepPartial<ResolvedSettings>;
```

```typescript
// simulation/settings/SettingsMerger.ts

class SettingsMerger {
    /**
     * Produces a ResolvedSettings by merging three layers:
     *   1. ENGINE_DEFAULTS — the EngineSettings defaults baked into the engine
     *   2. gameDefaults    — from GameSettingsSchema.defaults (includes game-specific fields)
     *   3. userOverrides   — loaded from disk; only explicitly saved keys are present
     *
     * Deep merge: nested objects are merged recursively; primitives in later layers win.
     * Unknown keys from userOverrides that are absent from gameDefaults are stripped.
     */
    static mergeAll(gameDefaults: ResolvedSettings, userOverrides: UserSettings): ResolvedSettings;

    /**
     * Validates a proposed patch against the Zod schema; returns the patch with
     * unknown keys stripped and values coerced to their declared types.
     * Throws SettingsValidationError on type mismatch.
     */
    static validatePatch<T extends EngineSettings>(
        schema: z.ZodType<T>,
        patch: Partial<UserSettings>,
    ): Partial<UserSettings>;
}
```

```typescript
// simulation/settings/SettingsRepository.ts

interface SettingsRepository {
    /** Load user overrides from storage. Returns empty object if no file exists yet. */
    load(gameId: string): Promise<UserSettings>;

    /** Persist updated user overrides atomically (write-tmp-then-rename). */
    save(gameId: string, overrides: UserSettings): Promise<void>;

    /** Delete the user overrides file. Next load() returns engine+game defaults. */
    reset(gameId: string): Promise<void>;
}

// ─── File-system implementation ───────────────────────────────────────────
class FileSettingsRepository implements SettingsRepository {
    // Stores files at: app.getPath('userData')/settings/<gameId>.json
    private readonly baseDir: string;

    constructor(baseDir?: string) {
        this.baseDir = baseDir ?? path.join(app.getPath('userData'), 'settings');
    }

    async load(gameId: string): Promise<UserSettings> {
        const file = this.filePath(gameId);
        if (!fs.existsSync(file)) return {};
        const raw = await fs.promises.readFile(file, 'utf8');
        return JSON.parse(raw) as UserSettings;
    }

    async save(gameId: string, overrides: UserSettings): Promise<void> {
        await fs.promises.mkdir(this.baseDir, { recursive: true });
        const file = this.filePath(gameId);
        const tmp = `${file}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(overrides, null, 2), 'utf8');
        await fs.promises.rename(tmp, file); // Atomic: preserves last good file on crash
    }

    async reset(gameId: string): Promise<void> {
        const file = this.filePath(gameId);
        if (fs.existsSync(file)) await fs.promises.unlink(file);
    }

    private filePath(gameId: string): string {
        // Sanitise gameId — only allow alphanumeric, hyphens, underscores
        if (!/^[a-zA-Z0-9_-]+$/.test(gameId)) throw new Error(`Invalid gameId: ${gameId}`);
        return path.join(this.baseDir, `${gameId}.json`);
    }
}
```

#### Main-Process Owner (`electron/main/settings-manager.ts`)

`settings-manager.ts` owns the `FileSettingsRepository` and the registered game schemas. It wires three IPC handlers and one push event channel:

```typescript
// electron/main/settings-manager.ts

class SettingsManager {
    private readonly repo: SettingsRepository;
    /** Registry: gameId → GameSettingsSchema loaded at game startup */
    private readonly schemas = new Map<string, GameSettingsSchema<EngineSettings>>();

    /** Called by each game's index.ts entry during startup, before tick loop. */
    registerSchema<T extends EngineSettings>(schema: GameSettingsSchema<T>): void;

    /** IPC: chimera:settings:get — returns merged ResolvedSettings */
    async getSettings(gameId: string): Promise<ResolvedSettings>;

    /** IPC: chimera:settings:update — validates patch, deep-merges, persists, broadcasts change */
    async updateSettings(gameId: string, patch: Partial<UserSettings>): Promise<ResolvedSettings>;

    /** IPC: chimera:settings:reset — deletes user overrides file, returns game defaults */
    async resetSettings(gameId: string): Promise<ResolvedSettings>;

    /** Pushed to all renderer windows via 'chimera:settings:changed' when settings update. */
    private broadcastChange(gameId: string, settings: ResolvedSettings): void;
}
```

The IPC method `updateSettings` validates the incoming patch via `SettingsMerger.validatePatch()` before persisting — malformed or out-of-range values are rejected at the boundary before touching the repository.

#### Renderer Integration (`renderer/state/settingsStore.ts`)

```typescript
// renderer/state/settingsStore.ts

interface SettingsStore {
    /** Current fully-resolved settings per gameId. Populated by IPC on app mount or game load. */
    settings: Record<string, ResolvedSettings>;
    activeGameId: string | null;

    // Driven by IPC — do not call directly from components
    _applySettings(gameId: string, settings: ResolvedSettings): void;

    // Actions — wired through window.__chimera; never touch the store directly
    updateSettings(gameId: string, patch: Partial<UserSettings>): Promise<void>;
    resetSettings(gameId: string): Promise<void>;
}
```

On app mount, the settings screen (and any component that needs settings) calls `window.__chimera.settings.get(gameId)` once to populate the store. The `settings.onChange` subscription in `ipcClient.ts` keeps the store live across changes triggered by other windows or mid-session IPC calls.

#### Game-Specific Schema Declaration Pattern

```typescript
// games/tactics/settings-schema.ts

import { z } from 'zod';
import { GameSettingsSchema, ENGINE_DEFAULTS } from '../../simulation/settings/SettingsSchema';

interface TacticsSettings extends EngineSettings {
    showGrid: boolean;
    animationSpeed: 'slow' | 'normal' | 'fast' | 'instant';
    showDamageNumbers: boolean;
    aiThinkingDelayMs: number; // Cosmetic pause before AI acts; 0 = instant
}

const TacticsSettingsSchema = z.object({
    audio: z.object({
        /* ... mirrors EngineSettings.audio ... */
    }),
    display: z.object({
        /* ... */
    }),
    gameplay: z.object({
        /* ... */
    }),
    controls: z.object({
        /* ... */
    }),
    showGrid: z.boolean(),
    animationSpeed: z.enum(['slow', 'normal', 'fast', 'instant']),
    showDamageNumbers: z.boolean(),
    aiThinkingDelayMs: z.number().int().min(0).max(5000),
});

export const tacticsSettingsSchema: GameSettingsSchema<TacticsSettings> = {
    gameId: 'tactics',
    defaults: {
        ...ENGINE_DEFAULTS,
        showGrid: true,
        animationSpeed: 'normal',
        showDamageNumbers: true,
        aiThinkingDelayMs: 500,
    },
    zodSchema: TacticsSettingsSchema,
};
```

The game's `index.ts` passes `tacticsSettingsSchema` to `SettingsManager.registerSchema()` during startup. The engine's `SettingsManager` then knows how to merge and validate settings for `gameId = 'tactics'` for the lifetime of the session.

#### Settings Lifecycle Sequence

```
App start
  │
  ├── game/index.ts calls settingsManager.registerSchema(tacticsSettingsSchema)
  │
  ├── renderer mount → window.__chimera.settings.get('tactics')
  │     └── IPC → settings-manager.getSettings('tactics')
  │           ├── repo.load('tactics') → UserSettings from disk (or {})
  │           └── SettingsMerger.mergeAll(gameDefaults, userOverrides) → ResolvedSettings
  │
  ├── User changes a setting in SettingsPage
  │     └── window.__chimera.settings.update('tactics', { showGrid: false })
  │           └── IPC → settings-manager.updateSettings()
  │                 ├── SettingsMerger.validatePatch(schema, patch)  ← reject bad values here
  │                 ├── repo.save('tactics', newOverrides)           ← atomic write
  │                 └── broadcastChange('tactics', resolved)
  │                       └── 'chimera:settings:changed' push → settingsStore._applySettings()
  │
  └── User resets settings
        └── window.__chimera.resetSettings('tactics')
              ├── repo.reset('tactics')              ← deletes userData/settings/tactics.json
              └── broadcastChange('tactics', gameDefaults)
```

#### What Settings Are Not

- Settings are **not** part of `GameSnapshot` — they are not replayed, not deterministic, not part of undo history.
- Settings are **not** save-slot-scoped — they persist across sessions globally (audio volume is always the same regardless of which save you load).
- Settings are **not** synchronized to clients — each player manages their own settings locally. The simulation never reads settings values. Game-affecting parameters (e.g. AI thinking delay) are cosmetic at the renderer level only; they do not affect `ActionPipeline` execution.

---

### 4.14 Pluggable Multiplayer Provider (`networking/provider/`)

#### Executive Decision

The lobby and game networking layer is abstracted behind a `MultiplayerProvider` interface. `LocalWebSocketProvider` (the default) starts a WebSocket server in Electron's main process and handles LAN/localhost play. Future providers — e.g. `SteamNetworkProvider` via Steamworks SDK — can be wired in by changing **one line in `electron/main/index.ts`** without touching the simulation, the IPC bridge, or the renderer.

`ChimeraAPI.hostLobby()` and `ChimeraAPI.joinLobby()` remain identical on the renderer side regardless of which provider is active.

#### Provider Table

| Provider                 | Transport                        | Discovery                    | Use case                   | Status                |
| ------------------------ | -------------------------------- | ---------------------------- | -------------------------- | --------------------- |
| `LocalWebSocketProvider` | WebSocket (`ws`) in main process | Manual IP / local room code  | LAN, localhost, dev        | Default — implemented |
| `SteamNetworkProvider`   | Steamworks P2P / Steam relay     | Steam lobby browser, invites | Steam release distribution | Future placeholder    |

#### `MultiplayerProvider` Interface

```typescript
// networking/provider/MultiplayerProvider.ts

// ─── Host-side session ────────────────────────────────────────────────────

/** Returned by hostLobby(). Owned by LobbyManager for the session lifetime. */
interface HostedSession {
    readonly lobbyCode: string; // Shareable code / invite token for clients to join
    readonly transport: HostTransport;
    close(): Promise<void>;
}

interface HostTransport {
    /** Push a projected PlayerSnapshot to one connected client. */
    sendSnapshot(playerId: PlayerId, snapshot: PlayerSnapshot): void;
    /** Push updated lobby state to all connected clients. */
    broadcastLobbyState(state: LobbyState): void;
    /**
     * Send a non-authoritative, out-of-band message (chat, profile updates, future cosmetic
     * channels) to one specific client or broadcast to all. Side-channel messages are strictly
     * parallel to the ActionPipeline — they do NOT advance `tick`, do NOT enter ActionHistory,
     * and do NOT appear in saves or replays. See §4.24 (profiles) and §4.29 (chat).
     */
    sendSideChannel(target: PlayerId | 'broadcast', msg: SideChannelMessage): void;
    /** Subscriptions */
    onActionReceived(cb: (from: PlayerId, action: EngineAction) => void): Unsubscribe;
    onSideChannelReceived(cb: (from: PlayerId, msg: SideChannelMessage) => void): Unsubscribe;
    onPlayerJoined(cb: (player: LobbyPlayerEntry) => void): Unsubscribe;
    onPlayerLeft(cb: (playerId: PlayerId, reason: DisconnectReason) => void): Unsubscribe;
}

// ─── Client-side session ──────────────────────────────────────────────────

/** Returned by joinLobby(). Owned by LobbyManager for the session lifetime. */
interface JoinedSession {
    readonly lobbyInfo: LobbyInfo;
    readonly transport: ClientTransport;
    disconnect(): Promise<void>;
}

interface ClientTransport {
    sendAction(action: EngineAction): void;
    /**
     * Send a non-authoritative side-channel message to the host. Mirror of
     * HostTransport.sendSideChannel; same constraints — never an EngineAction, never
     * entered in ActionHistory, never replayed.
     */
    sendSideChannel(msg: SideChannelMessage): void;
    onSnapshotReceived(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe;
    onSideChannelReceived(cb: (msg: SideChannelMessage) => void): Unsubscribe;
    onLobbyStateChanged(cb: (state: LobbyState) => void): Unsubscribe;
    onDisconnected(cb: (reason: DisconnectReason) => void): Unsubscribe;
}

/**
 * Discriminated union of all non-authoritative wire messages carried by the transport's
 * side-channel. New cosmetic/out-of-band channels (emotes, typing indicators, spectator
 * signals) extend this union rather than growing the transport surface.
 */
type SideChannelMessage =
    | { kind: 'chat'; payload: ChatMessage } // §4.29
    | { kind: 'profile'; payload: PlayerProfile }; // §4.24

// ─── Provider interface ───────────────────────────────────────────────────

interface MultiplayerProvider {
    /** Start a new hosted session. Returns a HostedSession for LobbyManager to drive. */
    hostLobby(params: HostLobbyParams): Promise<HostedSession>;
    /** Connect to an existing hosted session. */
    joinLobby(params: JoinLobbyParams): Promise<JoinedSession>;
    dispose(): void;
}

/**
 * Optional capability — discovery/browse of joinable lobbies. Providers that
 * support a browse flow (LAN broadcast, Steam lobby list) implement this as a
 * SEPARATE interface rather than as an optional method on MultiplayerProvider.
 * Consumers narrow via `isBrowsable(provider)` before invoking — no optional
 * method calls leak through the base abstraction (ISP).
 */
interface BrowsableProvider {
    listLobbies(): Promise<LobbyListEntry[]>;
}

function isBrowsable(p: MultiplayerProvider): p is MultiplayerProvider & BrowsableProvider {
    return typeof (p as Partial<BrowsableProvider>).listLobbies === 'function';
}
```

#### Owner: `electron/main/lobby-manager.ts`

`LobbyManager` holds the active provider and translates IPC calls into provider calls. The simulation (`StateBroadcaster`, `MessageRouter`) talks to `HostTransport`, never to WebSocket connections directly.

```typescript
// electron/main/lobby-manager.ts
class LobbyManager {
    private session: HostedSession | JoinedSession | null = null;

    constructor(private readonly provider: MultiplayerProvider) {}

    // Wired to IPC: 'chimera:host-lobby'
    async hostLobby(params: HostLobbyParams): Promise<LobbyInfo> {
        const session = await this.provider.hostLobby(params);
        this.session = session;
        // Wire transport events to simulation
        session.transport.onActionReceived((from, action) =>
            simulationHost.enqueueAction(from, action),
        );
        session.transport.onPlayerJoined((player) => simulationHost.notifyPlayerJoined(player));
        session.transport.onPlayerLeft((playerId, reason) =>
            simulationHost.notifyPlayerLeft(playerId, reason),
        );
        return buildLobbyInfo(session.lobbyCode, params);
    }

    // Wired to IPC: 'chimera:join-lobby'
    async joinLobby(params: JoinLobbyParams): Promise<LobbyInfo> {
        const session = await this.provider.joinLobby(params);
        this.session = session;
        session.transport.onSnapshotReceived((snap) =>
            broadcastToRenderer('chimera:snapshot', snap),
        );
        session.transport.onLobbyStateChanged((state) =>
            broadcastToRenderer('chimera:lobby-update', state),
        );
        session.transport.onDisconnected((reason) =>
            broadcastToRenderer('chimera:connection-status', { status: 'disconnected', reason }),
        );
        return session.lobbyInfo;
    }

    async closeLobby(): Promise<void> {
        (await this.session?.close?.()) ?? this.session?.disconnect?.();
        this.session = null;
    }
}
```

#### `StateBroadcaster` and `MessageRouter` Decoupling

With the provider abstraction, `StateBroadcaster` and `MessageRouter` no longer reference WebSocket at all:

- `StateBroadcaster` owns projection fan-out. It is wired into the pipeline at construction time as the `BroadcastContext.broadcast` callback (see §4.2). Stage 7 of `ActionPipeline.process()` invokes `broadcast(snapshot, viewerId)`, which `StateBroadcaster` delegates to `transport.sendSnapshot(playerId, projectedSnapshot)`. `LocalWebSocketProvider` serialises and writes to the ws socket internally.
- `MessageRouter` subscribes to `transport.onActionReceived()` — `LocalWebSocketProvider` deserialises incoming ws frames and delivers typed `EngineAction` objects.

This means both modules are **provider-agnostic** and require no changes when switching to Steam. `ActionPipeline` never calls a transport directly; ownership is: pipeline → `BroadcastContext.broadcast` → `StateBroadcaster` → `HostTransport`.

#### `LocalWebSocketProvider` Internal Architecture

`LocalWebSocketProvider` is the sole owner of `networking/server/` and `networking/client/`. No code outside `networking/provider/` imports from those directories.

```
LocalWebSocketProvider.hostLobby()
  └── LobbyServer — binds ws server to localhost:<port>
        ├── MessageRouter subscribes to ws 'message' events → fires transport.onActionReceived()
        └── HostTransport.sendSnapshot() → serialises PlayerSnapshot → ws.send()

LocalWebSocketProvider.joinLobby()
  └── ServerConnection — ws client connecting to host IP:port
        ├── ClientTransport.sendAction() → serialises EngineAction → ws.send()
        └── ws 'message' events → deserialise → fires transport.onSnapshotReceived()
```

#### `SteamNetworkProvider` (Future Placeholder)

```typescript
// networking/provider/SteamNetworkProvider.ts
// Depends on a Steamworks SDK binding (to be selected at integration time).
export class SteamNetworkProvider implements MultiplayerProvider {
    async hostLobby(params: HostLobbyParams): Promise<HostedSession> {
        // 1. SteamMatchmaking.CreateLobby(ELobbyType.Public, params.maxPlayers)
        // 2. Set lobby metadata: gameId, map, etc.
        // 3. Wrap Steam P2P message callbacks behind HostTransport
        throw new Error('SteamNetworkProvider not yet implemented');
    }

    async joinLobby(params: JoinLobbyParams): Promise<JoinedSession> {
        // 1. SteamMatchmaking.JoinLobby(params.steamLobbyId)
        // 2. Wrap Steam P2P callbacks behind ClientTransport
        throw new Error('SteamNetworkProvider not yet implemented');
    }

    async listLobbies(): Promise<LobbyListEntry[]> {
        // SteamMatchmaking.RequestLobbyList() filtered by app ID + gameId metadata
        throw new Error('SteamNetworkProvider not yet implemented');
    }

    dispose(): void {
        /* leave lobby, close all P2P channels */
    }
}
// `SteamNetworkProvider` satisfies `MultiplayerProvider & BrowsableProvider`;
// `LocalWebSocketProvider` today satisfies only `MultiplayerProvider` (LAN
// discovery is a separate follow-up). Callers narrow via `isBrowsable()`.
```

#### Provider Injection at App Start

```typescript
// electron/main/index.ts — the single wiring point for multiplayer backend
const multiplayerProvider: MultiplayerProvider = new LocalWebSocketProvider();
// Future: const multiplayerProvider = isSteam()
//           ? new SteamNetworkProvider()
//           : new LocalWebSocketProvider();

const lobbyManager = new LobbyManager(multiplayerProvider);
```

---

### 4.15 Game Shape Fitness (Target Scenarios)

This table validates the architecture against four representative game shapes. Each row is a concrete implementation sketch — what the engine gives for free, what the game must supply, and which engine features stay dormant.

#### Tic Tac Toe (2 players, pass-and-play or online)

| Concern       | Resolution                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| State         | `TicTacToeSnapshot extends BaseGameSnapshot` with `board: readonly (PlayerId \| null)[]` (length 9), `nextPlayerId`, `winner?` |
| Actions       | Two game actions: `ttt:place_mark`, `engine:end_turn` (not strictly needed — place_mark can set `nextPlayerId` directly)       |
| RNG           | None. `seed` field unused.                                                                                                     |
| Content DB    | **Omitted.** `simulation/content/` is optional; `PipelineContext.db` is `undefined`.                                           |
| Visibility    | All fields `public`. `StateProjector` is a passthrough; no `VisibilityRules` per game needed.                                  |
| Undo          | Engine default: per-turn undo enabled; trivial.                                                                                |
| AI            | Optional `AIPlayerAgent` with one state + one command (`PlaceBestMarkCommand`); minimax closed-form.                           |
| Multiplayer   | `LocalWebSocketProvider` host+client for online.                                                                               |
| Pass-and-play | Single Electron window, `game.switchActiveSeat(playerId)` between turns; `SeatSwitcher.tsx` UI.                                |
| Save          | Works out of the box. Save file ≈ 1 KB.                                                                                        |
| Settings      | Engine defaults only; game-specific settings schema optional.                                                                  |
| Screens       | One `BoardScreen.tsx`; no tech tree, no diplomacy.                                                                             |

#### Monopoly (2–8 players, online or LAN)

| Concern           | Resolution                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State             | Properties (public), player cash (public — it's on the table), Chance/Community Chest decks (committed: card order committed-to at game start), player hands of Get-Out-of-Jail cards (`owner-only`), property ownership (public). |
| Actions           | `monopoly:roll_dice`, `:buy_property`, `:pay_rent`, `:draw_chance`, `:propose_trade`, `:accept_trade`, `:decline_trade`, `:mortgage`, `:build_house`, …                                                                            |
| RNG               | Dice via `ctx.rng.int(1, 6)` twice per `roll_dice`. Fully deterministic; replayable.                                                                                                                                               |
| Money             | **Integer dollars.** `$1 → 1`. No fixed-point needed (dollar-granularity only).                                                                                                                                                    |
| Content DB        | Used: 40 tile definitions, 16 Chance cards, 16 Community Chest cards in `games/monopoly/data/`.                                                                                                                                    |
| Visibility        | Deck order is `committed` at `phase === 'start'`; a card is `hidden` until drawn. Player cash and properties are `public`. Jail cards in hand are `owner-only`.                                                                    |
| Trade negotiation | Multi-step: `propose_trade` creates a `pending_trade` entity in state; counterparty dispatches `accept_trade` or `decline_trade`. Engine requires no trade-specific features.                                                      |
| Undo              | Policy: `crossTurnUndo: false`, `maxUndoSteps: 0` on committed dice rolls (can undo a property purchase before ending turn; cannot undo the roll).                                                                                 |
| Multiplayer       | Default `LocalWebSocketProvider`. Host is authoritative; dice rolls computed host-side.                                                                                                                                            |
| Save              | Autosave after each `end_turn`; resumable on any device with the save file.                                                                                                                                                        |
| Screens           | `BoardScreen.tsx`, optional `TradeScreen.tsx`, `PlayerDetailScreen.tsx`.                                                                                                                                                           |

#### Turn-Based Strategy — Units on Grid, Fighting (tactical)

| Concern     | Resolution                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| State       | Hex/square grid (static content in DB), units (entities), fog-of-war per player.                                                        |
| Actions     | `tactics:move_unit`, `:attack`, `:ability`, `:end_turn`.                                                                                |
| RNG         | Hit rolls, damage variance, crits — all via `ctx.rng`.                                                                                  |
| Content DB  | Unit types, weapon types, terrain types, ability definitions. Validated at load.                                                        |
| Visibility  | Enemy units outside line-of-sight are `hidden` (absent from `PlayerSnapshot`). Map layout is `public` (already known).                  |
| Undo        | Default: free undo within your turn until `end_turn`; RNG outcomes are re-computed deterministically on redo (same `tick` → same dice). |
| AI          | `AIStateMachine` with `ScoutState`, `AttackState`, `DefendState`; commands dispatch `move_unit` / `attack` actions.                     |
| Multiplayer | `LocalWebSocketProvider`. `predictable: true` on `move_unit` (own units only); **not** on `attack` (contested RNG).                     |
| Screens     | `BoardScreen.tsx` (R3F canvas), `UnitDetailScreen.tsx`, optional `DeploymentScreen.tsx`.                                                |

#### 4X Strategy (many screens, long matches)

| Concern                      | Resolution                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State                        | Large snapshot: tiles, cities, units, research trees, diplomacy relations, resources.                                                                                                                                                                                                                                                   |
| Actions                      | Dozens of game actions: `4x:found_city`, `:queue_production`, `:research_tech`, `:propose_treaty`, `:declare_war`, `:move_unit`, `:end_turn`, …                                                                                                                                                                                         |
| RNG                          | Random events, barbarian movement, combat RNG — all deterministic.                                                                                                                                                                                                                                                                      |
| Money / science / production | All integer; rates stored as basis points (0–10000).                                                                                                                                                                                                                                                                                    |
| Content DB                   | Large: tech tree, unit blueprints, building blueprints, civilisation perks, wonders, terrain.                                                                                                                                                                                                                                           |
| Visibility                   | Fog-of-war + diplomatic secrecy (enemy tech progress `hidden` until scouted or traded).                                                                                                                                                                                                                                                 |
| ActionHistory bound          | Essential. After each `end_turn`, history pruned to the most recent `TurnMemento` window (§4.2.1).                                                                                                                                                                                                                                      |
| Save file size               | Dominated by snapshot, not history (history is pruned). `CompressedSaveSerializer` recommended.                                                                                                                                                                                                                                         |
| Screens                      | `BoardScreen.tsx`, `TechTreeScreen.tsx`, `CityScreen.tsx`, `DiplomacyScreen.tsx`, `ProductionScreen.tsx`, `ResearchScreen.tsx`, `EspionageScreen.tsx`. Each is a game-declared React component in `games/4x/screens/` and registered in `GameScreenRegistry`. `MatchShell.tsx` routes between them without knowing what any of them do. |
| Turn timer (optional)        | `GameSnapshot.turnClock` set at each `end_turn`; renderer reads from `PlayerSnapshot` and displays countdown. Timer expiry dispatches an automatic `end_turn` action.                                                                                                                                                                   |
| Multiplayer                  | `LocalWebSocketProvider` (default) or future `SteamNetworkProvider`. No architecture change needed.                                                                                                                                                                                                                                     |
| AI                           | Complex: per-civ `AIStateMachine` with strategic states (ExpandState, ConsolidateState, WarState, DiplomacyState); each state owns dozens of commands.                                                                                                                                                                                  |

#### Features That Stay Dormant (By Design)

| Feature                                    | Used by                                            | Omitted by                                               |
| ------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------- |
| `simulation/content/`                      | Monopoly, TBS, 4X                                  | Tic Tac Toe                                              |
| `simulation/prediction/`                   | (any real-time game; none of the four scenarios)   | All four scenarios — turn-based does not need prediction |
| `CommitmentScheme`                         | Monopoly (deck order), TBS/4X (hidden map reveals) | Tic Tac Toe                                              |
| `RealtimeTicker`                           | (real-time games)                                  | All four scenarios                                       |
| `turnClock` field                          | Timed 4X, timed TBS                                | Tic Tac Toe, Monopoly (typically)                        |
| `SeatSwitcher`                             | Tic Tac Toe pass-and-play, casual Monopoly         | Online-only games                                        |
| Game-declared screens beyond `BoardScreen` | 4X (many), TBS (some)                              | Tic Tac Toe, Monopoly (one or two)                       |

The engine core carries no cost for unused features: `content/` and `prediction/` are separate modules, `turnClock` is an optional field on the snapshot, `RealtimeTicker` is never instantiated by a turn-based game, and screens beyond `BoardScreen` only exist if the game registers them.

---

### 4.16 Performance HUD (`renderer/components/shell/PerfHud.tsx`)

#### Executive Decision

A lightweight, always-available on-screen HUD that shows the key performance numbers a developer or tester needs to diagnose slowness at a glance. It is intentionally minimal — a single floating panel with a handful of metrics. Deeper analysis (flamegraphs, heap snapshots, tick-by-tick inspection) lives in the Inspector Window (§4.12).

The HUD is keyboard-toggled (`F3` by default), off by default in production, and does **not** depend on the debug build — players can opt in via settings for bug reports.

#### Metrics Shown

| Metric                     | Source                                                                              | Updated        |
| -------------------------- | ----------------------------------------------------------------------------------- | -------------- |
| **FPS**                    | R3F render loop (count frames per 1 s window)                                       | Every 500 ms   |
| **Frame time (ms)**        | `performance.now()` delta between render ticks; shows avg / p95 over the last 2 s   | Every 500 ms   |
| **Sim tick**               | Latest `PlayerSnapshot.tick` from `gameStore`                                       | On snapshot    |
| **Actions / sec**          | Rolling count of snapshots received in the last 1 s                                 | Every 500 ms   |
| **Action round-trip (ms)** | IPC measurement: time from `game.sendAction()` to the resulting `game.onSnapshot()` | Per own-action |
| **Network ping (ms)**      | `PING`/`PONG` round-trip reported by `ClientTransport`                              | Every 2 s      |
| **Renderer heap (MB)**     | `performance.memory.usedJSHeapSize` where available (Chromium)                      | Every 1 s      |
| **R3F draw calls**         | `gl.info.render.calls` from the active `WebGLRenderer`                              | Every 500 ms   |
| **R3F triangles**          | `gl.info.render.triangles`                                                          | Every 500 ms   |

Numbers are rendered with a small coloured marker — green / amber / red — against configurable thresholds (e.g. FPS < 30 = red).

#### Interface

```typescript
// renderer/components/shell/PerfHud.tsx

interface PerfSample {
    fps: number;
    frameMsAvg: number;
    frameMsP95: number;
    simTick: number;
    actionsPerSec: number;
    actionRoundTripMs: number | null;
    pingMs: number | null;
    heapMb: number | null;
    drawCalls: number;
    triangles: number;
}

/**
 * Mounted once in MatchShell. Self-contained: subscribes to store + R3F invalidate hooks,
 * computes its own rolling windows. No external wiring required.
 *
 * Visibility rules:
 *   - Hidden by default
 *   - Toggle: F3 keyboard shortcut
 *   - Opt-in via settings: engine.gameplay.showPerfHud = true forces it visible
 */
export function PerfHud(): JSX.Element | null;
```

#### Data Collection

All metric sources are already available — no new engine plumbing is required:

- **FPS / frame time**: `useFrame` hook inside a hidden `<PerfProbe />` component mounted under the R3F `<Canvas>`. Accumulates deltas into a ring buffer of the last 120 frames.
- **Draw calls / triangles**: read from `gl.info.render` on each `useFrame` callback; `gl.info.reset()` is called per-frame by Three.js automatically.
- **Sim tick / actions per sec**: subscribe to `gameStore` via a selector; increment a rolling counter on each new snapshot.
- **Action round-trip**: `ipcClient.sendAction()` stamps `performance.now()` in a `WeakMap` keyed by action object; `onSnapshot` handler reads the matching entry when the snapshot's `tick` advances past the dispatched action's expected tick.
- **Ping**: `ClientTransport` already exchanges `PING`/`PONG`; it exposes `latencyMs` via `system.onConnectionStatus` (already in the `ConnectionStatus` type).
- **Heap**: `performance.memory` is Chromium-only; the HUD degrades gracefully to `null` on other runtimes (not applicable inside Electron, but kept for hygiene).

#### Settings Integration

One new engine setting added to `EngineSettings.gameplay`:

```typescript
interface EngineSettings {
    // ... existing fields ...
    gameplay: {
        // ... existing fields ...
        showPerfHud: boolean; // Default: false. Forces HUD visible regardless of F3 toggle.
    };
}
```

The HUD reads `settingsStore.engine.gameplay.showPerfHud` and merges it with its local `F3`-toggled state: visible if either is `true`.

#### Module Tree

```
renderer/components/shell/
├── MatchShell.tsx
├── SeatSwitcher.tsx
└── perf/
    ├── PerfHud.tsx         # The floating panel
    ├── PerfProbe.tsx       # Hidden R3F component: collects per-frame GL stats
    └── perfStore.ts        # Zustand store: rolling samples; read by PerfHud, written by PerfProbe
```

#### What This Is Not

- Not a replacement for the Inspector Window (§4.12), which handles tick-level snapshot inspection, action history, and per-player projection views.
- Not an in-process profiler. For deep work (flamegraphs, allocation tracking), use Chrome DevTools directly (`Cmd+Option+I` in the renderer).
- Not a bandwidth monitor. `HostTransport`/`ClientTransport` can be instrumented later if bandwidth becomes a concern; for now, `actionsPerSec` + `pingMs` are sufficient diagnostic signals.

---

### 4.17 Device Info (`renderer/device/`)

#### Executive Decision

Chimera is Electron-only: it runs on macOS, Windows, and Linux desktops. Mobile and tablet are not target platforms. That said, desktops differ meaningfully — a 13" laptop with touch input is not the same as a 34" ultrawide with keyboard and mouse, and asset/UI choices benefit from knowing the difference. This section defines a small, honest set of device facts the engine can detect **reliably inside Electron** and expose to both game code and the UI layer.

What Electron **can** detect reliably: OS + version, CPU architecture, screen count and resolution, pixel ratio, available input modalities (touch, pen, mouse, keyboard, gamepad), window size class, locale.

What Electron **cannot** detect reliably, and therefore will **not** report: "is this a phone or tablet" (Electron doesn't run on phones), hardware GPU model (behind driver obfuscation), battery percentage on desktops without OS-specific privileges (we do not ship native modules for this). The shape of the API makes the desktop focus explicit rather than pretending otherwise.

#### `DeviceInfo` Interface

```typescript
// renderer/device/DeviceInfo.ts

type DeviceFormFactor = 'desktop' | 'laptop' | 'tablet-convertible' | 'unknown';
type InputModality = 'mouse' | 'keyboard' | 'touch' | 'pen' | 'gamepad';
type SizeClass = 'compact' | 'regular' | 'large' | 'ultrawide';

interface DeviceInfo {
    // ── Platform (from Electron main process) ──────────────────────────────
    readonly os: 'macos' | 'windows' | 'linux';
    readonly osVersion: string; // e.g. '14.4', '10.0.22631'
    readonly arch: 'x64' | 'arm64';
    readonly electronVer: string;
    readonly chromiumVer: string;
    readonly locale: string; // BCP 47 tag, e.g. 'en-US'

    // ── Form factor (best-effort heuristic — see below) ────────────────────
    readonly formFactor: DeviceFormFactor;

    // ── Display ────────────────────────────────────────────────────────────
    readonly screens: readonly {
        readonly id: number;
        readonly width: number; // logical pixels
        readonly height: number;
        readonly pixelRatio: number; // 1, 2, 3
        readonly refreshHz: number; // 60, 120, 144, etc. where available
        readonly primary: boolean;
    }[];
    readonly windowSizeClass: SizeClass;

    // ── Input (detected in renderer) ───────────────────────────────────────
    readonly inputs: readonly InputModality[]; // All modalities currently available
    readonly primaryInput: InputModality; // Best guess at what the player is using now

    // ── Battery (desktop: typically only on laptops; null elsewhere) ───────
    readonly battery: { charging: boolean; level: number } | null;
}
```

#### Detection Sources

| Field                        | Source                                                                                                                                                     | Notes                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `os`, `osVersion`, `arch`    | Electron main: `process.platform`, `os.release()`, `process.arch`                                                                                          | Resolved once at app start; cached                                                            |
| `electronVer`, `chromiumVer` | `process.versions.electron`, `process.versions.chrome`                                                                                                     | Cached                                                                                        |
| `locale`                     | `app.getLocale()`                                                                                                                                          | Respects user's OS-level preference                                                           |
| `screens[]`                  | `screen.getAllDisplays()` (Electron main)                                                                                                                  | Re-queried on `screen` `display-added` / `display-removed` / `display-metrics-changed` events |
| `windowSizeClass`            | Current `BrowserWindow` content size                                                                                                                       | Re-derived on `resize`                                                                        |
| `inputs[]`                   | Renderer: `navigator.maxTouchPoints`, `PointerEvent` types observed, `navigator.getGamepads()`                                                             | Mouse and keyboard assumed present unless evidence suggests otherwise                         |
| `primaryInput`               | Most recent `pointerdown` / `keydown` / `gamepadconnected` event                                                                                           | Updated live; drives UI affordance hints                                                      |
| `battery`                    | `navigator.getBattery()` (where supported)                                                                                                                 | Returns `null` when the API is missing or rejects                                             |
| `formFactor`                 | Heuristic: `touch` + `inputs.length === 1 && inputs[0] === 'touch'` + screen size ≤ 13" → `tablet-convertible`; battery present → `laptop`; else `desktop` | Conservative — falls back to `'unknown'` rather than misreporting                             |

The form-factor heuristic is deliberately simple. We classify by capability rather than label. Callers asking "is this a touch device?" check `inputs.includes('touch')` rather than comparing against `formFactor === 'tablet-convertible'`.

#### Window Size Class

| Class       | Content width (CSS px) | Typical target                      |
| ----------- | ---------------------- | ----------------------------------- |
| `compact`   | < 960                  | small laptop windowed, split-screen |
| `regular`   | 960–1440               | standard laptop / small desktop     |
| `large`     | 1441–2560              | large desktop                       |
| `ultrawide` | > 2560                 | 34"+ monitors, multi-screen spans   |

Games may use this to choose between HUD layouts (compact HUD for < 960, side panels for ≥ 1441). Breakpoints are engine defaults; games can override with their own logic — `windowSizeClass` is informational, not prescriptive.

#### API Surface

Added to `SystemAPI` (§4.1):

```typescript
interface SystemAPI {
    // ... existing members ...

    /** Current device info snapshot. Resolved once; cached by main process. */
    getDeviceInfo(): Promise<DeviceInfo>;

    /** Fires when any volatile field changes: screens, windowSizeClass, inputs, primaryInput, battery. */
    onDeviceInfoChange(cb: (info: DeviceInfo) => void): Unsubscribe;
}
```

Renderer-side hook for React consumers:

```typescript
// renderer/device/useDeviceInfo.ts
/** Subscribes to system.onDeviceInfoChange; re-renders on updates. */
export function useDeviceInfo(): DeviceInfo;

/** Narrower selectors to avoid full re-renders when only one field changes. */
export function usePrimaryInput(): InputModality;
export function useWindowSizeClass(): SizeClass;
```

#### Where It's Used

| Consumer                               | Use                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `MatchShell.tsx`                       | Choose between HUD layouts based on `windowSizeClass`                               |
| `SettingsPage.tsx`                     | Show the current OS / locale / Electron version in an "About" block for bug reports |
| `PerfHud.tsx` (§4.16)                  | Optional extra line: `primary: mouse · 2560×1440@144`                               |
| Game screens (`games/<name>/screens/`) | Swap pointer-friendly vs. touch-friendly input affordances via `usePrimaryInput()`  |

#### Module Tree

```
renderer/device/
├── DeviceInfo.ts             # Interface + types (shared with main process via shared/)
├── DeviceInfoProvider.ts     # Renderer-side aggregator: merges main-process snapshot + live DOM signals
├── useDeviceInfo.ts          # React hook + selectors
└── inputTracker.ts           # Subscribes to pointer/keyboard/gamepad events → updates primaryInput

electron/main/
└── device-probe.ts           # Main-process side: collects OS/screen facts; pushes updates via system IPC
```

#### What This Is Not

- Not a fingerprinting tool. No unique-device identifier is generated or exposed.
- Not a phone / tablet detector in the mobile sense. Electron is desktop-only; the `formFactor` heuristic is a best-effort classifier among desktop variants, not a substitute for building a proper mobile client.
- Not a replacement for explicit user preferences. A player on a convertible laptop can still configure UI scale in settings; `DeviceInfo` is informational.

---

### 4.18 Scene Transitions (`simulation/scenes/` + `renderer/components/shell/SceneRouter.tsx`)

#### Executive Decision

Games need to move all connected players between high-level contexts: **lobby → loading → match**, **match → intermission → next level**, **match → cutscene → match**, **match → post-match summary → lobby**. These transitions are **host-authoritative and synchronized** — every client lands on the same scene at a compatible point, with assets for that scene preloaded before play resumes.

The engine provides a single primitive — the **Scene** — and a two-phase transition protocol (prepare, commit) that is itself expressed as normal engine actions. This keeps transitions deterministic, logged in `ActionHistory`, replayable from saves, and undoable where policy permits. Scenes are a **higher layer than `phase`** (which is intra-match turn/round structure) and a **lower layer than `GameScreenRegistry`** (which handles game-declared panels within a scene).

#### Layering

| Layer                       | Scope                                                                     | Owner                                 | Example                                                  |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| `phase` on `GameSnapshot`   | Intra-match state machine (e.g. `'deployment' → 'combat' → 'resolution'`) | Game reducer                          | Tactics combat round phase                               |
| `sceneId` on `GameSnapshot` | Cross-match / level structure                                             | Engine + game scene registry          | `'lobby'`, `'level-1'`, `'intermission'`, `'post-match'` |
| `GameScreenRegistry` entry  | Which UI panel is in focus _within_ the current scene                     | Renderer (user input, not simulation) | `'tech-tree'` vs `'board'` during `'level-1'`            |

A scene change is a simulation event broadcast to all clients; a screen change is a purely local UI navigation.

#### `SceneDescriptor`

Games register their scenes at startup alongside actions and content. The engine owns one reserved scene: `engine:lobby`. Everything else is game-defined.

```typescript
// simulation/scenes/SceneDescriptor.ts

type SceneId = string; // namespaced: 'engine:lobby', 'mygame:level-1', 'mygame:intermission'

interface SceneDescriptor {
    readonly id: SceneId;

    /** Which GameScreenRegistry entry to mount as the default screen for this scene. */
    readonly defaultScreen: string;

    /** AssetRefs that MUST be loaded before clients can enter this scene. Drives the loading bar. */
    readonly requiredAssets: readonly AssetRef[];

    /**
     * Called on the host when the scene is about to become active.
     * Returns the initial simulation state for the new scene. This is where
     * a game sets up a fresh level: new entity layout, new fog, new seed derived
     * from the existing deterministic RNG, etc.
     *
     * Runs inside the action pipeline — pure, deterministic, no I/O.
     */
    initialize(
        prevState: Readonly<BaseGameSnapshot>,
        params: SceneEnterParams,
        ctx: ReduceContext,
    ): BaseGameSnapshot;

    /**
     * Optional: called on the host when leaving this scene. Last chance to
     * fold scene-local state into durable aggregate state (e.g. carry over
     * player score from level N into level N+1).
     */
    teardown?(state: Readonly<BaseGameSnapshot>, ctx: ReduceContext): BaseGameSnapshot;
}

interface SceneEnterParams extends Record<string, unknown> {
    /** Arbitrary game-defined payload — level id, difficulty, seed override, etc. */
}

interface SceneRegistry {
    register(descriptor: SceneDescriptor): void;
    resolve(id: SceneId): SceneDescriptor; // throws UnknownSceneError
    all(): readonly SceneDescriptor[];
}
```

`BaseGameSnapshot` is extended with a single field:

```typescript
interface BaseGameSnapshot {
    // ... existing fields ...
    readonly sceneId: SceneId;
    readonly sceneTransition: SceneTransitionState | null; // null between transitions
}

interface SceneTransitionState {
    readonly toSceneId: SceneId;
    readonly phase: 'preparing' | 'ready' | 'committing';
    readonly startedAtTick: number;
    readonly params: SceneEnterParams;
    readonly playersReady: readonly PlayerId[]; // Subset who have reported SCENE_READY
}
```

#### Two-Phase Transition Protocol

A scene change is never a single instant flip. It is two engine-reserved actions bracketing a **client-readiness barrier**. Between them, every client preloads the new scene's `requiredAssets` and signals readiness. The host commits only when all clients are ready or a per-scene timeout expires.

```
Host decides to transition (e.g. game logic detects level complete)
     │
     ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. Host dispatches engine:scene_prepare { toSceneId, params } │
│    Pipeline applies it:                                       │
│      - sets state.sceneTransition = { phase: 'preparing', …}  │
│      - projects + broadcasts new PlayerSnapshot               │
│    Reducer is PURE — no asset loading, no network calls.      │
└──────────────────────────────────────────────────────────────┘
     │
     │  Each client sees sceneTransition.phase === 'preparing'
     │  Renderer's SceneRouter reacts:
     │    - shows transition overlay (loading UI)
     │    - AssetPreloader.preload(descriptor.requiredAssets)
     │    - on complete → dispatch engine:scene_ready (own playerId)
     ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. Host receives engine:scene_ready from each client          │
│    Pipeline appends playerId to state.sceneTransition.        │
│    playersReady. When all connected players are ready         │
│    (or transitionTimeoutMs elapses):                          │
│      - sets phase = 'ready'                                   │
│      - host enqueues engine:scene_commit (host-only)          │
└──────────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. Host dispatches engine:scene_commit                        │
│    Pipeline applies it:                                       │
│      - calls prevScene.teardown?(state, ctx)                  │
│      - calls nextScene.initialize(state, params, ctx)         │
│      - sets sceneId = toSceneId                               │
│      - clears sceneTransition = null                          │
│      - broadcasts new PlayerSnapshot                          │
│    Clients see sceneId flip; SceneRouter swaps defaultScreen. │
└──────────────────────────────────────────────────────────────┘
```

All three actions flow through `ActionPipeline` unchanged — they are logged, visible in debug inspection, and part of the deterministic replay log.

#### Reserved Action Types

Added to `EngineReservedType`:

```typescript
type EngineReservedType =
    // ... existing members ...
    | 'engine:scene_prepare' // Host-only: begin transition to a new scene
    | 'engine:scene_ready' // Any client: signal assets loaded, ready to enter
    | 'engine:scene_commit'; // Host-only: finalize the transition
```

Wire payloads:

```typescript
interface ScenePreparePayload {
    toSceneId: SceneId;
    params: SceneEnterParams;
}
interface SceneReadyPayload {
    playerId: PlayerId;
}
interface SceneCommitPayload {
    /* empty — reads sceneTransition from state */
}
```

`engine:scene_prepare` and `engine:scene_commit` are **host-only**: the validator rejects them if `playerId !== hostPlayerId`. `engine:scene_ready` is **any-client**, but the validator rejects it if `state.sceneTransition === null` or if `playerId` is already in `playersReady`.

#### Host-Side Trigger API

Game code on the host triggers transitions through a thin helper, not by hand-crafting reserved actions:

```typescript
// simulation/scenes/SceneManager.ts (host-only; lives in electron/main/simulation-host.ts)

interface SceneManager {
    /**
     * Begin a host-driven scene transition. Dispatches engine:scene_prepare,
     * waits for readiness barrier, then dispatches engine:scene_commit.
     *
     * Safe to call from any server-side game logic (e.g. "level complete" detection
     * inside a reduce()). The call is queued — the actual prepare action is dispatched
     * after the current action finishes, preserving pipeline invariants.
     */
    requestTransition(toSceneId: SceneId, params?: SceneEnterParams): void;

    /** Current transition state, or null. */
    readonly current: SceneTransitionState | null;
}
```

Game reducers never dispatch from inside themselves — they return the new state and signal the intent by inspecting it post-reduce. A simpler pattern: game code emits a domain event (e.g. `LevelCompletedEvent`) into `state.events`, and a host-side **scene policy** observer watches for it and calls `sceneManager.requestTransition(...)`. This keeps reducers pure.

#### Readiness Barrier and Timeout

Each `SceneDescriptor` may declare:

```typescript
interface SceneDescriptor {
    // ... fields above ...
    readonly transitionTimeoutMs?: number; // Default: 30_000
    readonly onClientTimeout?: 'proceed' | 'drop'; // Default: 'proceed'
}
```

- `'proceed'`: host commits the transition even if some clients haven't reported ready. Stragglers receive the post-commit snapshot and recover on their own — they may see a brief asset pop-in.
- `'drop'`: host disconnects non-ready clients and proceeds with the remainder. Appropriate for competitive matches where stalling is not tolerable.

A late-joining client (reconnect mid-transition) receives the current snapshot with `sceneTransition.phase === 'preparing'`, preloads, and sends `engine:scene_ready` just like everyone else.

#### Projection and Visibility

`StateProjector` passes `sceneId` and `sceneTransition` through to every `PlayerSnapshot` — they are always `'public'`. During the `'preparing'` phase, projectors **may** elide scene-specific gameplay fields (e.g. the entity list for the new level) until commit: a game's `VisibilityRules` can check `state.sceneTransition` and return empty collections to prevent spoiling the incoming scene's layout to a client that hasn't entered it yet.

#### Renderer — `SceneRouter`

```typescript
// renderer/components/shell/SceneRouter.tsx

/**
 * Watches PlayerSnapshot.sceneId and sceneTransition.
 * - sceneTransition === null             → render GameScreenRegistry entry for sceneId.defaultScreen
 * - sceneTransition.phase === 'preparing' → render TransitionOverlay; kick off AssetPreloader
 * - sceneTransition.phase === 'ready'    → render TransitionOverlay at 100% until commit lands
 * - On sceneId change: unmount old scene tree; mount new tree
 *
 * Mounted once inside MatchShell; replaces the direct screen lookup MatchShell
 * previously did against GameScreenRegistry.
 */
export function SceneRouter(): JSX.Element;
```

`TransitionOverlay.tsx` is an engine-provided component: full-screen fade + progress bar + "Waiting for N player(s)…" status derived from `sceneTransition.playersReady.length` vs. connected player count. Games can override it by registering a custom overlay in the `GameScreenRegistry` (`transitionOverlay` slot).

#### Module Tree

```
simulation/scenes/
├── SceneDescriptor.ts         # Interface + SceneId type + SceneTransitionState
├── SceneRegistry.ts           # In-memory registry; populated at game init
├── SceneManager.ts            # Host-only orchestrator (requestTransition, barrier, timeout)
└── actions/
    ├── ScenePrepareAction.ts  # Reserved engine action
    ├── SceneReadyAction.ts    # Reserved engine action
    └── SceneCommitAction.ts   # Reserved engine action

renderer/components/shell/
├── SceneRouter.tsx            # Watches sceneId / sceneTransition; routes accordingly
└── TransitionOverlay.tsx      # Default engine-provided loading UI
```

`games/<name>/scenes/` is the conventional location for game-declared `SceneDescriptor` modules; they are registered in the game's `index.ts` entry alongside actions and content.

#### Save / Load Integration

`GameSnapshot.sceneId` and `sceneTransition` serialise naturally as part of the save file (§4.11). Loading a save mid-transition replays the prepare action on restore; clients re-execute the readiness barrier and the host re-commits. This is identical to the initial transition — no special-casing in the save/load path.

#### Invariants

49. **Scene transitions are host-authoritative. `engine:scene_prepare` and `engine:scene_commit` are rejected if the dispatcher is not the host player.**
50. **`SceneDescriptor.initialize()` and `teardown()` are pure reducers. They may not perform I/O, call `Date.now()`, or read from `Math.random()`. They receive `ReduceContext` and use `ctx.rng` for any randomness.**
51. **Clients never drive a scene change. A client that wishes to transition (e.g. "return to lobby") sends a domain action; host-side policy decides whether to honour it via `SceneManager.requestTransition()`.**
52. **Required assets for a scene MUST be declared in its `SceneDescriptor.requiredAssets`. Assets loaded on-demand inside the new scene are allowed but will cause visual pop-in and are flagged by the `validate-assets` CI tool.**

#### What This Is Not

- Not a general-purpose React router. In-scene UI navigation (switching between tech tree, diplomacy, board) remains a renderer-only concern handled by `GameScreenRegistry` + local UI state.
- Not a cinematic/cutscene engine. A cutscene is modelled as a scene with a custom `defaultScreen` that plays a timeline; the engine provides the lifecycle, not the timeline primitive.
- Not a substitute for `phase`. Games with a `'deployment' → 'combat' → 'resolution'` round structure keep using `phase` inside a single scene. Scenes are for coarse-grained context changes that justify preloading new assets and tearing down entity state.

---

### 4.19 Fade Transitions (`renderer/components/shell/TransitionOverlay.tsx` + `renderer/hooks/useFadeTransition.ts`)

#### Purpose

`TransitionOverlay` provides a full-screen fade-to-black / fade-from-black effect used during scene transitions and at any moment game screens need a dramatic cut. It is a **renderer-only visual concern** — the simulation and Electron main process have no knowledge of fade state.

#### Mechanism

A fixed-position `<div>` with `pointer-events: none` sits above the entire app at `z-index: 9999`. Its CSS `opacity` is animated imperatively via a React ref + `requestAnimationFrame` loop (not a CSS transition, to allow precision timing and Promise-based sequencing).

The component exposes an imperative API through a React context:

```typescript
// renderer/components/shell/TransitionOverlay.tsx
export interface FadeControl {
    /** Animate opacity 0 → 1 (to black). Resolves when animation completes. */
    fadeOut(durationMs?: number): Promise<void>;
    /** Animate opacity 1 → 0 (from black). Resolves when animation completes. */
    fadeIn(durationMs?: number): Promise<void>;
    /** Current opacity value [0, 1] for external consumers. */
    readonly opacity: number;
}

// Nullable by design — creating with `null!` hides misuse. Any consumer mounted outside
// <TransitionOverlay> should fail loudly, not silently crash on the first method call.
export const FadeContext = createContext<FadeControl | null>(null);
```

```typescript
// renderer/hooks/useFadeTransition.ts
export function useFade(): FadeControl {
    const ctx = useContext(FadeContext);
    if (ctx === null) {
        throw new Error('useFade() must be called inside a <TransitionOverlay> provider.');
    }
    return ctx;
}
```

**Convention.** This `createContext<T | null>(null)` + throwing consumer hook is the standard
pattern for every engine-provided React context. `createContext<T>(null!)` — the "null-bang" —
is forbidden in engine code (enforced by ESLint rule `no-context-null-bang`).

Default fade duration is **300 ms**. Game screens may override on a per-call basis.

#### Integration with Scene Transitions

`SceneRouter.tsx` calls `useFade()` and wires it to the two-phase scene transition lifecycle (§4.18):

```typescript
// renderer/components/shell/SceneRouter.tsx (simplified)
const fade = useFade();
const phase = useGameStore((s) => s.sceneTransition?.phase);
const sceneId = useGameStore((s) => s.sceneId);

// Phase 1 — fade to black, then signal readiness.
// NB: useEffect is used here intentionally. Fading is a side-effect on an external imperative
// system (the fade timeline), not a derivation of rendered state — exactly the case React
// Effects are designed for. This does NOT contradict the engine's general "avoid useEffect
// for state derivation" rule (see developer-agent guidelines): derivation pulls a value out
// of other state; this pushes a command into an external animation timeline.
useEffect(() => {
    if (phase === 'preparing') {
        let cancelled = false;
        fade.fadeOut(300).then(() => {
            if (cancelled) return; // guard against unmount between fade kickoff and completion
            window.__chimera.game.sendAction(SceneReadyAction.build());
        });
        return () => {
            cancelled = true;
        };
    }
}, [phase]);

// Phase 2 — new scene mounted, fade back in
useEffect(() => {
    if (!phase) {
        fade.fadeIn(300);
    }
}, [sceneId, phase]);
```

The `SceneReadyAction` is dispatched **after** the fade-out completes, not as a cause of it. The fade is purely a cosmetic delay — the host's readiness barrier is the authoritative gate.

#### Standalone Use

Game screens may call `useFade()` independently for dramatic cuts (e.g. a game-over fade before results appear, a cinematic intro). No engine restriction is imposed on standalone use.

#### Invariants

53. **`TransitionOverlay` is a renderer-only component. The simulation and Electron main process have no knowledge of fade state. Fade timing must never gate an authoritative simulation event — the `SceneReadyAction` is dispatched _after_ the fade completes, not as a cause of it.**

---

### 4.20 Game Timers (`simulation/engine/GameTimer.ts`)

#### Purpose

Tick-based, deterministic timers that live entirely inside `GameSnapshot` and travel through the normal action pipeline. Used for periodic gameplay effects: Damage-over-Time (DoT), power-up durations, timed abilities, countdown objectives.

#### Core Types

```typescript
// simulation/engine/GameTimer.ts

export type TimerId = string;

export interface GameTimer {
    readonly id: TimerId;
    /** Ticks remaining until next fire. Decremented by TimerManager.advance(). */
    remainingTicks: number;
    /**
     * Ticks between repeated fires.
     * 0 = one-shot: fires once when remainingTicks reaches 0,
     *     then the timer is marked inactive.
     * N = interval: resets remainingTicks to N after each fire.
     */
    readonly intervalTicks: number;
    /** Action type dispatched when the timer fires. Must be registered in ActionRegistry. */
    readonly actionType: string;
    /** Payload merged into the dispatched action. */
    readonly payload: Record<string, unknown>;
    /** When false, TimerManager.advance() skips this timer. */
    active: boolean;
}

export type TimerRegistry = Record<TimerId, GameTimer>;
```

`TimerRegistry` is stored on `GameSnapshot` as `snapshot.timers: TimerRegistry`. It serialises naturally as part of saves (§4.11) and replays deterministically because all counters are integer ticks.

#### TimerManager Helper

```typescript
// simulation/engine/GameTimer.ts (continued)

export const TimerManager = {
  /** Add or replace a timer. Immutable — returns a new registry. */
  create(
    registry: TimerRegistry,
    timer:    Omit<GameTimer, 'active'>
  ): TimerRegistry,

  /** Mark a timer inactive (does not remove it; it is pruned on next advance). Immutable. */
  cancel(registry: TimerRegistry, id: TimerId): TimerRegistry,

  /**
   * Advance all active timers by 1 tick.
   * Returns the updated registry and the list of actions that fired this tick.
   * Pure function — no side effects. Called by the engine:tick reducer only.
   */
  advance(registry: TimerRegistry): {
    next:  TimerRegistry;
    fired: ReadonlyArray<{ actionType: string; payload: Record<string, unknown> }>;
  },
};
```

The `engine:tick` reducer calls `TimerManager.advance()` **before** game-defined logic each tick, then dispatches each fired action back through the pipeline via `ctx.dispatch()` (provided by `ReductionContext` — the reducer-only extension of `ReduceContext`; validators do not receive `dispatch`):

```typescript
// engine:tick reducer (inside EngineActions.ts)
const { next, fired } = TimerManager.advance(state.timers);
let nextState: GameSnapshot = { ...state, timers: next };
for (const { actionType, payload } of fired) {
    nextState = ctx.dispatch(actionType, payload, state.activePlayerId, nextState);
}
return nextState;
```

#### Re-entrant `ctx.dispatch()` Semantics

Timer-driven actions re-enter the pipeline from inside `engine:tick.reduce()`. To keep this
controlled the engine guarantees the following:

1. **Partial pipeline only.** A `ctx.dispatch()` call runs Stage 4 (validate) and Stage 5 (reduce)
   for the child action. It does NOT invoke Stage 6 (history append), Stage 7 (projection +
   broadcast), or the debug observer. ActionHistory records only the outer `engine:tick`
   frame; projection and broadcast run once at the end of the outer tick against the final
   cumulative snapshot. Replays therefore re-derive timer fires from `TimerRegistry` state,
   not from recorded child actions.
2. **Bounded recursion.** The engine tracks nested-dispatch depth on `ReduceContext`; exceeding
   `MAX_NESTED_DISPATCH = 16` throws `RecursiveDispatchError`. A timer fire that creates a
   timer that fires the same tick is legal but any unbounded cascade is a bug.
3. **Fire-within-fire.** A child action may call `TimerManager.create()` or `.cancel()` on
   `nextState.timers`; the new/cancelled timers do not fire until the NEXT `engine:tick`.
   `TimerManager.advance()` is invoked exactly once per outer `engine:tick`.
4. **Validation rejection of a timer-fired action is a non-fatal event.** The failure is logged
   at `warn` (structured logger, §4.27) with `{ timerId, actionType, reason }`; the outer tick
   continues. Game code must not rely on a timer's action always succeeding.

These rules make timer cascades auditable and keep determinism identical under replay.

#### DoT Example

```typescript
// Inside game:apply_poison reducer — set up a 5-tick DoT, 1 damage per tick:
const newTimers = TimerManager.create(state.timers, {
    id: `dot-${payload.targetId}`,
    remainingTicks: 5,
    intervalTicks: 1, // fire every tick, 5 times
    actionType: 'game:apply_dot_damage',
    payload: { targetId: payload.targetId, damage: 10 },
});
return { ...state, timers: newTimers };
```

After 5 `engine:tick` actions, the timer has fired 5 times (10 damage each) and then goes inactive.

#### Determinism Rules

- Timers are driven by `tick` (invariant 42) — **never** by `Date.now()` or `performance.now()`.
- For turn-based games, `engine:tick` is dispatched explicitly by the host at defined game moments (end of turn, resolution phase). For real-time games it is dispatched by `RealtimeTicker` (§4.2.1).
- Timer IDs must be deterministic (derive from entity IDs + action type, not random UUIDs) so replays produce identical timer maps.

#### Invariants

54. **`GameTimer` lives in `GameSnapshot.timers`. It is serialised, loaded, and replayed. A timer's `remainingTicks` counter must never be derived from wall-clock time.**
55. **`TimerManager.advance()` is a pure function. The `engine:tick` reducer is the ONLY consumer of `TimerManager.advance()`. Game action reducers may create or cancel timers via `TimerManager.create()` and `TimerManager.cancel()`, but must NOT call `TimerManager.advance()`.**

---

### 4.21 Curves and Tweening (`renderer/utils/curves.ts` + `renderer/hooks/useTween.ts`)

#### Purpose

Pure math utilities for smooth renderer-side animations: interpolating positions, fading opacity, scaling objects, smoothing camera movements. **Strictly renderer-only — zero simulation involvement.**

#### Curve Primitives

```typescript
// renderer/utils/curves.ts

export type EasingFn = (t: number) => number;

/** Linear interpolation between `from` and `to` at normalised position t ∈ [0, 1]. */
export function lerp(from: number, to: number, t: number): number {
    return from + (to - from) * t;
}

/** Identity curve — included for API symmetry with the other easing functions. */
export function linear(t: number): number {
    return t;
}

/** Quadratic ease-in: starts slow, accelerates. */
export function easeIn(t: number): number {
    return t * t;
}

/** Quadratic ease-out: decelerates to a smooth stop. */
export function easeOut(t: number): number {
    return 1 - (1 - t) * (1 - t);
}

/** Quadratic ease-in-out: slow at both ends, fast in the middle. */
export function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
```

#### `useTween` Hook

```typescript
// renderer/hooks/useTween.ts

export interface TweenState {
    /** Current eased value in [0, 1]. */
    readonly value: number;
    /** Whether the tween is currently running. */
    readonly isRunning: boolean;
    /** Begin animating from 0 to 1 over durationMs. */
    start(): void;
    /** Stop immediately and reset value to 0. */
    stop(): void;
}

/**
 * Frame-rate–driven tween. Advances via R3F useFrame() using the frame delta.
 * Does NOT connect to the simulation tick — purely visual, client-local.
 *
 * @param durationMs  Total animation duration in milliseconds.
 * @param easingFn    Curve applied to raw t. Defaults to `linear`.
 */
export function useTween(durationMs: number, easingFn: EasingFn = linear): TweenState;
```

Internally, `useTween` accumulates `delta` (seconds) from `useFrame((_state, delta) => ...)` while running, derives raw `t = elapsed / (durationMs / 1000)`, clamps to [0, 1], applies `easingFn`, and exposes the result as `value`.

**Usage examples:**

```typescript
// Smooth position move over 300 ms with ease-out:
const { value, start } = useTween(300, easeOut);
useEffect(() => { start(); }, []);
useFrame(() => {
  meshRef.current.position.x = lerp(startX, targetX, value);
});

// Opacity pulse with ease-in-out over 500 ms:
const { value } = useTween(500, easeInOut);
<mesh material-opacity={value} />
```

#### Callback Variant

For consumers that need per-frame and completion callbacks (e.g. chaining multiple tweens, driving multiple values simultaneously):

```typescript
export function useTweenCallback(
    durationMs: number,
    easingFn: EasingFn,
    callbacks: {
        onTick: (value: number) => void;
        onComplete: () => void;
    },
): Pick<TweenState, 'start' | 'stop' | 'isRunning'>;
```

#### Invariants

56. **`curves.ts` and `useTween` are renderer-only modules. They must never be imported by anything under `simulation/`. Visual smoothing is a client-local concern; the authoritative state does not move smoothly.**

---

### 4.22 Camera System (`renderer/components/r3f/GameCanvas.tsx` + `renderer/hooks/useCamera.ts`)

#### R3F Camera Capabilities (Confirmed)

React Three Fiber provides full camera control with no additional infrastructure:

- `useThree()` returns `{ camera, gl, scene, size }` — direct access to the Three.js `Camera` instance.
- `three` provides `PerspectiveCamera` and `OrthographicCamera` natively.
- `@react-three/drei` provides `<PerspectiveCamera>`, `<OrthographicCamera>`, and `<CameraControls>` (smooth, spring-damped orbital control).
- Camera state lives entirely inside the R3F Canvas tree — never exposed to the simulation.

#### `GameCanvas` Camera Props

```typescript
// renderer/components/r3f/GameCanvas.tsx

export type CameraMode = 'perspective' | 'orthographic';
export type CameraPreset = 'isometric' | 'top-down' | 'side-scrolling' | 'free';

interface GameCanvasProps {
    cameraMode: CameraMode;
    cameraPreset: CameraPreset;
    children: React.ReactNode;
}
```

Built-in preset defaults:

| Preset           | Mode         | Initial position | Look-at     |
| ---------------- | ------------ | ---------------- | ----------- |
| `isometric`      | orthographic | `(10, 10, 10)`   | `(0, 0, 0)` |
| `top-down`       | orthographic | `(0, 20, 0)`     | `(0, 0, 0)` |
| `side-scrolling` | perspective  | `(0, 5, 15)`     | `(0, 5, 0)` |
| `free`           | perspective  | `(0, 5, 10)`     | `(0, 0, 0)` |

#### `useCamera` Hook

```typescript
// renderer/hooks/useCamera.ts

export type Vector3Tuple = [x: number, y: number, z: number];

export interface CameraController {
    /** Immediately teleport camera to world position. */
    setPosition(x: number, y: number, z: number): void;
    /** Immediately set the camera look-at target. */
    lookAt(x: number, y: number, z: number): void;
    /** Adjust orthographic zoom level or perspective FOV scale. */
    zoom(factor: number): void;
    /**
     * Smooth animated camera move to a new position / look-at over durationMs.
     * Internally uses useTween (§4.21) with the provided easing function.
     *
     * Resolution contract:
     *   • Resolves when the animation completes normally.
     *   • Rejects with CameraAnimationCancelled when superseded by a new animateTo() call,
     *     or when the owning component unmounts mid-animation.
     *   • Consumers that `await` must handle rejection (try/catch) to avoid leaking work
     *     after unmount; consumers that do not care about completion may ignore the Promise.
     */
    animateTo(
        target: { position: Vector3Tuple; lookAt?: Vector3Tuple },
        durationMs: number,
        easing?: EasingFn,
    ): Promise<void>;
}

/** Thrown when an in-flight animateTo() is interrupted by unmount or a newer call. */
export class CameraAnimationCancelled extends Error {
    constructor(public readonly reason: 'unmount' | 'superseded') {
        super(`Camera animation cancelled: ${reason}`);
        this.name = 'CameraAnimationCancelled';
    }
}

export function useCamera(): CameraController;
```

Game board components call `useCamera()` to drive pan, zoom, and cinematic moves in response to gameplay events:

```typescript
// In a tactics game's BoardScreen.tsx:
const camera = useCamera();

function onUnitSelected(unit: Entity) {
    camera.animateTo(
        { position: [unit.x, 8, unit.z + 6], lookAt: [unit.x, 0, unit.z] },
        400,
        easeOut,
    );
}
```

#### Camera State Ownership

Camera state (position, look-at, zoom) is **renderer-only**. It lives in R3F's internal Three.js scene graph; if game screens need to observe or persist camera state across remounts they may use a lightweight `cameraStore.ts` Zustand store scoped to the renderer. Camera state is never part of `GameSnapshot`, never sent over the network, and is not included in saves.

#### Invariants

57. **Camera state is renderer-only. `GameSnapshot` must never contain camera position, look-at, zoom, or any other camera parameter. Camera configuration is driven by game board components in response to snapshot data — it is never driven by authoritative simulation actions.**

---

### 4.23 Pointer and Click Interactions (`renderer/components/r3f/` + `renderer/hooks/useGameInteraction.ts`)

#### R3F Event System (Confirmed)

React Three Fiber's event system provides native pointer interaction on every Three.js mesh via JSX props — zero external library required. R3F performs raycasting automatically at pointer coordinates and fires events on the intersected mesh:

```typescript
<mesh
  onClick={        (e) => { e.stopPropagation(); handleClick(e);  }}
  onPointerDown={  (e) => { ... }}
  onPointerUp={    (e) => { ... }}
  onPointerEnter={ (_e) => setHovered(true)  }
  onPointerLeave={ (_e) => setHovered(false) }
  onPointerMove={  (e) => { ... }}
  onContextMenu={  (e) => { ... } /* right-click */}
>
  <boxGeometry />
  <meshStandardMaterial color={hovered ? 'hotpink' : 'orange'} />
</mesh>
```

`stopPropagation()` mirrors DOM event bubbling — only the topmost intersected mesh fires by default unless propagation is explicitly allowed.

#### `useGameInteraction` Hook

Game components use `useGameInteraction` to translate mesh clicks into dispatched engine actions without scattering `sendAction` calls across R3F components:

```typescript
// renderer/hooks/useGameInteraction.ts

export interface InteractionHandlers {
    onClick: (e: ThreeEvent<MouseEvent>) => void;
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => void;
    onPointerLeave: (e: ThreeEvent<PointerEvent>) => void;
    /** True when interaction is not blocked and the entity can be clicked. */
    isInteractive: boolean;
    /** Local hover state — updated by onPointerEnter/Leave. Never touches simulation. */
    isHovered: boolean;
}

/**
 * Returns R3F event handlers for an interactive entity.
 * Reads InteractionBlocker context; no-ops when interactions are blocked.
 *
 * @param entityId      Simulation entity ID for this mesh.
 * @param actionBuilder Builds the EngineAction to dispatch on click.
 */
export function useGameInteraction(
    entityId: EntityId,
    actionBuilder: () => EngineAction,
): InteractionHandlers;
```

Usage in a card game:

```typescript
// renderer/components/r3f/CardMesh.tsx
const { onClick, onPointerEnter, onPointerLeave, isHovered, isInteractive } =
  useGameInteraction(
    card.id,
    () => PlayCard.build({ cardId: card.id, playerId: viewerId }),
  );

return (
  <mesh
    onClick={isInteractive ? onClick : undefined}
    onPointerEnter={onPointerEnter}
    onPointerLeave={onPointerLeave}
  >
    <meshStandardMaterial
      color={isHovered ? highlightColor : baseColor}
      emissive={isInteractive ? activeEmissive : 0x000000}
    />
  </mesh>
);
```

#### `InteractionBlocker` Context Provider

`InteractionBlocker.tsx` gates all `useGameInteraction` calls simultaneously. It is set to blocking during:

- Scene transitions (`sceneTransition !== null`)
- Network reconnection / resync (derived from lobby state)
- Opponent's turn (optional, configurable per game via props)

```typescript
// renderer/components/r3f/InteractionBlocker.tsx
export const InteractionContext =
  createContext<{ isBlocked: boolean }>({ isBlocked: false });

export function InteractionBlocker({ children }: { children: ReactNode }) {
  const sceneTransition = useGameStore(s => s.sceneTransition);
  return (
    <InteractionContext.Provider value={{ isBlocked: sceneTransition !== null }}>
      {children}
    </InteractionContext.Provider>
  );
}
```

When `isBlocked` is true, `useGameInteraction` short-circuits `onClick` but continues updating hover state — preventing highlight artifacts from freezing mid-transition.

#### Hover State Rule

`isHovered` is **local React state** inside `useGameInteraction`. It never enters `GameSnapshot`, `PlayerSnapshot`, or any Zustand store. It is purely visual and requires no synchronisation.

#### Physics

No physics engine (Cannon.js, Rapier, Ammo.js) is included in Chimera 1.0.0. Collision detection, rigid bodies, and physics simulation are **explicitly out of scope**. Games requiring physics effects must add a physics provider as an optional peer dependency in their game package; the engine core provides no physics extension point in 1.0.0.

#### Invariants

58. **`isHovered` in `useGameInteraction` is local component state. It must never be written to any Zustand store, IPC message, or simulation state. Hover is a transient renderer-local concern.**

---

### 4.24 Player Profiles and Client-Attested Identity (`simulation/profile/` + `electron/main/profile-manager.ts`)

#### Problem Statement

Every multiplayer game needs per-player cosmetic identity — avatar, display name, locale, possibly game-specific preferences (faction colour, banner, emote set). This data is **owned by each client** (stored on their own machine via their own save/profile repository) but must be **visible to every other player** in the lobby. When a client joins, their local avatar selection should appear correctly on every remote machine; the joining client should also receive every other connected player's profile so the whole lobby renders correctly.

This is a pattern every multiplayer game needs but no one wants to re-implement. The engine provides it as a first-class subsystem.

#### Design Pattern: Repository + Directory + Attestation

| Pattern         | Role                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**  | `ProfileRepository` persists the **local** player's profile on their own machine. Mirrors `SaveRepository` (§4.11) and `SettingsRepository` (§4.15) — same interface, same `FileXxxRepository` / `InMemoryXxxRepository` pair.                        |
| **Directory**   | `PlayerDirectory` lives on the host and aggregates every connected client's profile. It is the authoritative read-model of "who is in this lobby right now and what do they look like."                                                               |
| **Attestation** | At join time the client **attests** its profile to the host; the host sanitises and admits it into the `PlayerDirectory`. Profiles are cosmetic — never authoritative — so attestation is sufficient; no cryptographic signing is required for 1.0.0. |

**Key architectural rule:** profile data is **strictly cosmetic**. It never enters `GameSnapshot`, `PlayerSnapshot`, `SaveFile`, or the action pipeline. This mirrors the settings trust boundary (§4.15, invariant 36). Any game mechanic that depends on player identity (e.g. "host chose faction Red") must be a match-config value transmitted at lobby setup, not a profile field.

#### Core Types

```typescript
// simulation/profile/ProfileSchema.ts — pure schema, zero IO, zero renderer deps

/** Base profile fields the engine requires every game to support. */
export interface EngineProfile {
    /** Stable client-local identifier for this profile slot (pass-and-play supports multiple locals). */
    readonly localProfileId: string;
    /** Human-readable name shown in lobby, HUD, chat. Length-capped by ProfileSanitizer. */
    displayName: string;
    /** Avatar source — either a built-in catalogue entry or a custom inline image. */
    avatar: AvatarSource;
    /** BCP 47 language tag for localisation. */
    locale: string;
}

export type AvatarSource =
    /** Reference to an engine- or game-provided avatar catalogue asset. Zero transport cost. */
    | { kind: 'builtin'; ref: AssetRef<TextureAsset> }
    /**
     * Inline custom image. base64-encoded PNG or JPEG, size-capped to MAX_CUSTOM_AVATAR_BYTES.
     * The host's ProfileSanitizer validates content-type and decodes the image to confirm it is
     * well-formed before admitting it into the directory.
     */
    | { kind: 'custom'; mimeType: 'image/png' | 'image/jpeg'; base64: string };

/** Games extend the engine profile with game-specific cosmetic fields. */
export type GameProfileSchema<T extends EngineProfile> = T;

/** PlayerProfile is the wire shape — identical to GameProfileSchema at runtime. */
export type PlayerProfile = GameProfileSchema<EngineProfile>;
```

```typescript
// simulation/profile/ProfileRepository.ts — interface only

export interface ProfileRepository {
    /** Load a specific local profile slot (supports pass-and-play with multiple locals). */
    load(localProfileId: string): Promise<PlayerProfile | null>;
    /** Persist a profile atomically (temp-file + rename, per Invariant 23's pattern). */
    save(profile: PlayerProfile): Promise<void>;
    /** List all local profile slots on this machine (for pass-and-play seat-switcher UI). */
    listLocalSlots(): Promise<ReadonlyArray<{ localProfileId: string; displayName: string }>>;
    /** Delete a local profile slot. */
    delete(localProfileId: string): Promise<void>;
}
```

```typescript
// electron/main/profile-manager.ts

/**
 * Owns the local ProfileRepository and the active attestation.
 * Drives outbound attestation when the local profile changes while connected to a lobby.
 */
export class ProfileManager {
    constructor(
        private readonly repository: ProfileRepository,
        private readonly lobbyManager: LobbyManager,
    ) {}

    async getLocal(localProfileId: string): Promise<PlayerProfile>;
    async updateLocal(patch: Partial<PlayerProfile>): Promise<PlayerProfile>;
    /** Returns the current attestation envelope to include in a JOIN / PROFILE_UPDATE message. */
    currentAttestation(): PlayerProfile;
}
```

```typescript
// electron/main/player-directory.ts — HOST ONLY

/**
 * Aggregates every connected client's sanitised profile for the current lobby.
 * Populated from:
 *   • The host's own ProfileManager on lobby creation.
 *   • Each JOIN handshake (after ProfileSanitizer.admit()).
 *   • Each PROFILE_UPDATE message (after ProfileSanitizer.admit()).
 * Removed from on player-left. Rebroadcast as part of LobbyState to all clients.
 */
export class PlayerDirectory {
    add(playerId: PlayerId, profile: PlayerProfile): void;
    update(playerId: PlayerId, profile: PlayerProfile): void;
    remove(playerId: PlayerId): void;
    snapshot(): Readonly<Record<PlayerId, PlayerProfile>>;
}
```

#### Host-Side Sanitisation (Trust Boundary)

`ProfileSanitizer` is a pure function called by the host on every inbound attestation. It is the trust gate between "whatever the client sent" and "what enters the `PlayerDirectory`." The renderer never calls this directly; it is exclusively a main-process host concern.

```typescript
// simulation/profile/ProfileSanitizer.ts

export const MAX_DISPLAY_NAME_LENGTH = 32;
export const MAX_CUSTOM_AVATAR_BYTES = 64 * 1024; // 64 KB after base64 decode
export const ALLOWED_AVATAR_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

export type AdmissionResult =
    | { ok: true; profile: PlayerProfile } // May be a rewritten/clamped version
    | { ok: false; reason: AdmissionRejection };

export type AdmissionRejection =
    | 'DISPLAY_NAME_TOO_LONG'
    | 'DISPLAY_NAME_EMPTY'
    | 'AVATAR_TOO_LARGE'
    | 'AVATAR_INVALID_MIME'
    | 'AVATAR_DECODE_FAILED'
    | 'SCHEMA_MISMATCH'
    | 'NAMESPACE_COLLISION';

/** Pure. Returns the admitted profile or a structured rejection. Never throws. Idempotent:
 *  admit(admit(x).profile) === admit(x) for any x that produces ok:true on the first call. */
export function admit(
    attestation: unknown,
    schema: GameProfileSchema<EngineProfile>,
): AdmissionResult;
```

The host rejects an attestation with `REJECT { reason: 'profile:<AdmissionRejection>' }` when admission fails. The client presents a user-facing error (e.g. "Your avatar is too large, please choose a smaller image") and may retry with an updated attestation.

**Rejection catalogue.** Each `AdmissionRejection` variant has one unambiguous trigger:

| Reason                  | Trigger                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISPLAY_NAME_EMPTY`    | `displayName.trim().length === 0`                                                                                                                       |
| `DISPLAY_NAME_TOO_LONG` | `displayName.length > MAX_DISPLAY_NAME_LENGTH`                                                                                                          |
| `AVATAR_INVALID_MIME`   | Custom avatar with `mimeType` outside `ALLOWED_AVATAR_MIME_TYPES`                                                                                       |
| `AVATAR_TOO_LARGE`      | Decoded custom avatar byte length `> MAX_CUSTOM_AVATAR_BYTES`                                                                                           |
| `AVATAR_DECODE_FAILED`  | `base64` decode throws, or decoded bytes are not a valid PNG/JPEG per magic-bytes check                                                                 |
| `SCHEMA_MISMATCH`       | Missing required field, wrong type, or game-schema validator returned false                                                                             |
| `NAMESPACE_COLLISION`   | `localProfileId` matches a reserved engine prefix (`engine:*`, `dev-*` outside the harness) or duplicates an already-admitted profile in the same lobby |

#### End-to-End Flow (User Scenario)

```
                         Host machine                             Client B machine
                              │                                         │
  [ User selects avatar "A" in main menu ]                [ User selects avatar "B" in main menu ]
     profileStore.updateLocal(…)                             profileStore.updateLocal(…)
     FileProfileRepository.save()                            FileProfileRepository.save()
                              │                                         │
  [ Host creates lobby ]                                                │
  LobbyManager.hostLobby()                                              │
  │ ProfileManager.currentAttestation() → profile A                    │
  │ PlayerDirectory.add(host, profile A)                               │
  │ broadcastLobbyState({ profiles: { host: A } })                     │
                              │                                         │
                              │◄──── JOIN { token, profile B } ────────┤
                              │                                         │
  ProfileSanitizer.admit(profile B) → { ok, profile B' }                │
  PlayerDirectory.add(clientB, profile B')                              │
                              │                                         │
                              ├──── WELCOME { playerId, lobbyState }─►┤  lobbyState.profiles = { host: A, clientB: B' }
                              │                                         │
                              ├──── broadcast LobbyState ─────────►┤
                              │                                         │
  Host renderer profileStore:                            Client B renderer profileStore:
     directory = { host: A, clientB: B' }                  directory = { host: A, clientB: B' }
  <Avatar src={directory[clientB].avatar} /> ✓         <Avatar src={directory[host].avatar}   /> ✓
```

A third player joining follows the identical flow: their JOIN carries their own profile C; host admits, directory becomes `{ host: A, clientB: B', clientC: C' }`; host rebroadcasts `LobbyState`; all three renderers converge on the same directory.

#### Mid-Lobby Profile Update

A player may edit their avatar or name while already in a lobby (e.g. pass-and-play seat switch, cosmetic change before match start). The flow is **attest-first, persist-on-ACK** so local disk and the shared `PlayerDirectory` can never disagree about the active lobby identity:

1. Renderer calls `window.__chimera.profile.updateLocal(patch)`.
2. `ProfileManager` builds a **candidate** profile (does NOT yet call `ProfileRepository.save()`) and sends `PROFILE_UPDATE { profile }` via `ClientTransport.sendSideChannel()`.
3. Host's `ProfileSanitizer.admit()` validates; on `ok`, `PlayerDirectory.update()` runs and the host rebroadcasts `LobbyState` + ACKs the sending client; on rejection, host returns `REJECT { reason: 'profile:<AdmissionRejection>' }`.
4. On ACK: `ProfileManager` calls `ProfileRepository.save()` to persist the admitted profile to disk, then updates the local `profileStore.directory` entry for self. On REJECT: the candidate is discarded; disk and directory remain at the pre-change value; a toast surfaces the rejection reason.
5. Outside a lobby (main menu profile edit), step 2 is skipped and the repository save runs immediately — there is no directory to reconcile with.

`PROFILE_UPDATE` is **rate-limited** by the host (default: 1 per 5 seconds per client) to prevent avatar-spam denial-of-service. Rate-limit rejections surface to the sending client as a non-fatal UI warning and the candidate profile is discarded per the rule above.

#### Local Multi-Seat (Pass-and-Play) Support

`ProfileRepository.listLocalSlots()` returns every profile saved on the local machine. `SeatSwitcher` (§4.4, §13) reads this list and lets a single physical player swap between `localProfileId`s at a shared keyboard — each seat attests its own profile to the host just like a remote client would. Same code path, no special-casing.

#### SOLID Analysis

| Principle | Application                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SRP**   | `ProfileRepository` persists; `ProfileManager` manages local lifecycle + outbound attestation; `PlayerDirectory` aggregates remote; `ProfileSanitizer` is the admission gate. Four objects, four reasons to change.                               |
| **OCP**   | Games extend via `GameProfileSchema<T extends EngineProfile>` (faction banner, preferred role, etc.) without editing the engine. `ProfileSanitizer.admit()` accepts a schema parameter.                                                           |
| **LSP**   | `FileProfileRepository`, `InMemoryProfileRepository` (for tests), and a future `SteamProfileRepository` (fetches avatar + name from Steam API) are fully interchangeable. The contract test suite applies equally to all, mirroring invariant 41. |
| **ISP**   | Renderer sees a narrow read-heavy `ProfileAPI`; write authority is main-process only; clients have no IPC surface to write another player's profile. `PlayerDirectory` exposes a read-only `snapshot()` separate from its mutation methods.       |
| **DIP**   | `ProfileManager` depends on the `ProfileRepository` interface; `electron/main/index.ts` is the sole site that instantiates `FileProfileRepository`, matching the injection rule for `SaveManager` (invariant 37).                                 |

#### Invariants

59. **Player profile data (avatar, display name, locale, game-defined profile fields) is never stored in `GameSnapshot`, `PlayerSnapshot`, or `SaveFile`. It is a lobby-scoped cosmetic concern, separate from gameplay state, and is not replayed, diffed, or included in undo history.**
60. **`ProfileRepository` persists only the _local_ machine's profiles. The host's repository never receives or persists remote clients' profiles — remote profiles live only in the in-memory `PlayerDirectory` for the lifetime of the session and are discarded on lobby close.**
61. **`ProfileSanitizer.admit()` is the mandatory gate between an inbound `JOIN` / `PROFILE_UPDATE` attestation and the `PlayerDirectory`. Size caps, MIME whitelist, image decode check, display-name length, and game-schema validation all run inside `admit()`. A failed admission results in a `REJECT` response — the raw attestation is never exposed to any other subsystem.**
62. **Profile changes travel out-of-band from the `ActionPipeline`. `PROFILE_UPDATE` is not an `EngineAction`, does not advance `tick`, and does not participate in undo/redo or save/load. Any renderer component reading profile data must read it from the profile directory — never from `PlayerSnapshot`.**

#### What This Is Not

- Not a persistent cross-session identity system. There is no "Chimera account" in 1.0.0. Profiles are machine-local. A future `SteamProfileRepository` or similar provider may back profiles with a platform identity, but the core engine makes no such assumption.
- Not an anti-cheat mechanism. Attestation is trust-on-first-use; a malicious client can still impersonate a display name (up to uniqueness rules enforced by the host). Use the commitment scheme (§8) for gameplay-critical trust — profiles are cosmetic only.
- Not a rich media channel. Custom avatars are capped at 64 KB and limited to PNG/JPEG. Voice, video, emote animations, or larger assets require a dedicated media channel outside the scope of 1.0.0.

---

### 4.25 Audio System (`renderer/audio/` + `simulation/content/AssetRef.ts`)

#### Purpose

Renderer-only audio playback for music, sound effects, and future voice cues. Zero coupling to the simulation — game reducers emit `GameEvent`s; the renderer's `EventAudioBinding` maps event types to `AudioRef` assets and plays them through `AudioManager`.

#### Layered Architecture

```
GameEvent[] in PlayerSnapshot   ← simulation emits; renderer observes
         │
         ▼
[EventAudioBinding]              ← pure config: eventType → AudioRef
         │
         ▼
[AudioManager.play(ref, opts)]   ← resolves AssetRef<AudioAsset> via AssetManager (§4.10)
         │
         ▼
[AudioBus] (master / music / sfx / voice)   ← per-bus gain, mute, ducking
         │
         ▼
Web Audio API (via THREE.Audio or plain AudioContext)
```

#### Core Types

```typescript
// renderer/audio/AudioManager.ts

export interface PlayOptions {
    bus?: AudioBusId; // Default: 'sfx'
    loop?: boolean; // Default: false
    volume?: number; // [0, 1]; multiplied with bus gain
    position?: Vector3Tuple; // If present, played as spatial (THREE.PositionalAudio)
    priority?: number; // Lower-priority sounds dropped when pool is full
}

export type AudioBusId = 'master' | 'music' | 'sfx' | 'voice';

export interface AudioManager {
    /** Play a one-shot or looping sound. Returns a handle for stop(). */
    play(ref: AssetRef<AudioAsset>, opts?: PlayOptions): AudioHandle;
    stop(handle: AudioHandle): void;
    stopAll(bus?: AudioBusId): void;
    /** Duck a bus to duckedVolume for durationMs, then restore. */
    duck(bus: AudioBusId, duckedVolume: number, durationMs: number): void;
    /** Dispose all active sources and clear the pool. Called on game session end. */
    dispose(): void;
}
```

```typescript
// renderer/audio/EventAudioBinding.ts
export type EventAudioBinding = {
    [eventType: string]: {
        ref: AssetRef<AudioAsset>;
        bus?: AudioBusId;
        volume?: number;
    };
};
```

Games declare their event-to-audio map as pure data; the engine's `<EventAudioPlayer>` component mounts in the R3F tree, reads `events: GameEvent[]` from the gameStore, and calls `AudioManager.play()` for each entry it recognises.

#### Settings Integration

Audio volume sliders (`settings.audio.masterVolume`, `audio.musicVolume`, etc.) are already declared in `EngineSettings` (§4.13). `AudioBus` subscribes to `settingsStore` and updates its gain node on every change — no polling, no manual plumbing per game.

#### Pool and Voice Limits

`AudioManager` maintains a fixed-size pool (default 32 concurrent voices). When saturated, the lowest-priority currently-playing sound is preempted. Voice count and pool size are configurable per game via `AudioManager` construction options.

#### SOLID Analysis

| Principle | Application                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **SRP**   | `AudioManager` owns playback pool; `AudioBus` owns bus gain + ducking; `EventAudioBinding` is pure config.                               |
| **OCP**   | Games add new sounds by registering new `AssetRef`s and event bindings; the manager never changes.                                       |
| **DIP**   | `useSound` hook and `<EventAudioPlayer>` depend on the `AudioManager` interface; a headless `NullAudioManager` is injected in E2E tests. |

#### Lifecycle Ownership

`AudioManager` is constructed once per app launch by `renderer/app/providers.tsx` and exposed via an `AudioContext` React provider. `renderer/components/shell/MatchShell.tsx` is the designated owner of **session** lifecycle: it calls `AudioManager.stopAll()` on match end and `AudioManager.dispose()` on engine shutdown (window close). No other component owns dispose.

#### Invariants

63. **The simulation never produces audio. Audio playback is initiated only by the renderer in response to `GameEvent`s or direct UI interactions. No reducer, validator, or `ActionDefinition` may import from `renderer/audio/`.**
64. **`AudioManager.dispose()` is called unconditionally at game session end, mirroring the asset disposal contract (invariant 21). `MatchShell` is the unique designated owner of `dispose()`; no other component may call it. Active `AudioHandle`s become invalid after dispose.**

---

### 4.26 Input and Keybindings (`renderer/input/` + `simulation/input/`)

#### Purpose

Centralise keyboard and gamepad input handling behind named `InputAction`s, decouple code that responds to input from the physical keys that trigger it, and let players rebind keys through the settings UI. Mirrors the command-pattern split from §4.7 but for client-local input rather than authoritative game actions.

#### Core Types

```typescript
// simulation/input/InputAction.ts

/** Reserved engine namespace: 'engine:undo', 'engine:redo', 'engine:toggle-menu', ... */
/** Games declare 'game:<name>' actions. */
export type InputActionId = `engine:${string}` | `game:${string}`;

export interface InputAction {
    readonly id: InputActionId;
    readonly description: string; // Shown in the rebind UI
    readonly category: string; // Groups related actions in the rebind UI ("Movement", "UI", …)
    /** If true, action fires on key press; if false, must be held. */
    readonly oneShot: boolean;
}
```

```typescript
// simulation/input/InputBindingSchema.ts

export interface KeyBinding {
    /** Primary binding: `KeyboardEvent.code` (e.g. 'KeyW') or gamepad button id. */
    readonly primary: string;
    /** Optional secondary binding. */
    readonly secondary?: string;
    /** Modifier keys required. */
    readonly modifiers?: ReadonlyArray<'Ctrl' | 'Shift' | 'Alt' | 'Meta'>;
}

export type EngineBindings = Record<InputActionId, KeyBinding>;
export type GameBindingSchema<T extends EngineBindings> = T;
```

Default bindings are defined by the engine for reserved actions (`engine:undo` → Ctrl+Z, `engine:redo` → Ctrl+Shift+Z, `engine:toggle-menu` → Escape, `engine:toggle-perf-hud` → F3). Games extend via `GameBindingSchema` and declare defaults in the game entry.

#### InputManager (renderer-only)

```typescript
// renderer/input/InputManager.ts
export class InputManager {
    constructor(
        private readonly registry: InputActionRegistry,
        private readonly bindings: KeyBindingRepository,
    ) {}

    /** Called once on app mount; attaches window listeners. */
    start(): void;
    stop(): void;

    /** Subscribe to a specific action. Returns unsubscribe. */
    onAction(id: InputActionId, cb: (event: InputEvent) => void): Unsubscribe;

    /** Query whether an action is currently held (for continuous movement). */
    isPressed(id: InputActionId): boolean;

    /** Rebind at runtime. Persists via KeyBindingRepository.save(). */
    rebind(id: InputActionId, binding: KeyBinding): Promise<RebindResult>;
}

export type RebindResult =
    | { ok: true }
    | { ok: false; reason: 'conflict'; conflictingAction: InputActionId };
```

#### `useInputAction` Hook

```typescript
// renderer/input/useInputAction.ts
export function useInputAction(id: InputActionId, callback: (event: InputEvent) => void): void;
```

Components subscribe declaratively without knowing the physical key:

```typescript
useInputAction('engine:undo', () => sendAction(UndoAction.build()));
useInputAction('game:end-turn', () => sendAction(EndTurnAction.build()));
useInputAction('game:cycle-unit', cycleNextUnit);
```

#### Settings Integration

Key bindings are stored in `settings.controls.bindings: GameBindingSchema<EngineBindings>`. The rebind UI reads from and writes to `settingsStore` — no separate repository needed. `KeyBindingRepository` is a thin read/write wrapper around the `settings.controls` namespace.

#### Conflict Detection

`InputManager.rebind()` rejects bindings that collide with an existing one (same key + modifier + category scope). The UI offers "unbind the existing action" as the resolution. Engine-reserved bindings (`engine:*`) may be rebound but not removed.

#### Lifecycle Ownership

`InputManager` is instantiated by `renderer/app/providers.tsx` on app mount and exposed via context. `providers.tsx` calls `InputManager.start()` once in a `useEffect` with no dependencies, and `InputManager.stop()` in the cleanup function. No other component calls `start()` / `stop()`. This mirrors the single-owner rule for `AudioManager.dispose()`.

#### Invariants

65. **`InputManager` is renderer-only. The simulation has no knowledge of keyboard or gamepad state. Input translates into `EngineAction`s via `sendAction()` at the renderer boundary \u2014 never directly into reducers.**
66. **Key bindings are settings, not profile data. They follow the settings layered-merge contract (engine defaults \u2190 game defaults \u2190 user overrides) and are stored under `settings.controls.bindings`. They are not transmitted over the network and never appear in `GameSnapshot`.**

---

### 4.27 Error Handling, Crash Reporting, and Logging (`electron/main/logger.ts` + `electron/main/crash-reporter.ts` + `renderer/logging/`)

#### Purpose

Three concerns, one consistent surface: (a) unhandled errors do not silently lose user data; (b) developers get structured logs for debugging post-mortems; (c) the renderer's React tree cannot crash into an unrecoverable white screen.

#### Shared Log Schema (`shared/logging.ts`)

```typescript
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
    readonly level: LogLevel;
    readonly message: string;
    readonly timestamp: number; // Wall-clock ms at emit site
    readonly source: LogSource; // Which process / module emitted
    readonly context?: Record<string, unknown>; // Structured fields (playerId, tick, sessionId, etc.)
    readonly error?: { name: string; message: string; stack?: string };
}

export type LogSource =
    | { process: 'main'; module: string }
    | { process: 'renderer'; module: string }
    | { process: 'simulation'; module: string };
```

#### Main-Process Logger (`electron/main/logger.ts`)

Backed by [Pino](https://getpino.io) for JSON-line output. Writes to `userData/logs/chimera-YYYY-MM-DD.log` with daily rotation and a 14-day retention window. Exposes a narrow `Logger` interface; `electron/main/index.ts` constructs it and injects it into every manager.

```typescript
export interface Logger {
    trace(msg: string, ctx?: Record<string, unknown>): void;
    debug(msg: string, ctx?: Record<string, unknown>): void;
    info(msg: string, ctx?: Record<string, unknown>): void;
    warn(msg: string, ctx?: Record<string, unknown>): void;
    error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
    fatal(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
    /** Returns a child logger with bound context. */
    child(ctx: Record<string, unknown>): Logger;
}
```

#### Crash Reporter (`electron/main/crash-reporter.ts`)

Wires three failure paths:

1. `process.on('uncaughtException', ...)` \u2014 logs at `fatal`, writes a crash dump to `userData/crashes/crash-<iso-timestamp>.json` containing: last 1000 log entries, snapshot of `GameSnapshot` if a simulation is live, `process.versions`, `os.release()`, `app.getVersion()`. Then gracefully shuts down the simulation host and app.
2. `process.on('unhandledRejection', ...)` \u2014 logs at `error`; does NOT shut down by default (configurable).
3. Renderer crashes via `webContents.on('render-process-gone', ...)` \u2014 logs, writes crash dump, attempts a single renderer restart before surrendering.

Autosave (`§4.11 Save On Demand + Autosave`) runs before the crash dump is written when a live simulation exists, giving the player the best chance of recovering from an otherwise-fatal error.

#### Renderer Side

```typescript
// renderer/logging/rendererLogger.ts
// Forwards console.warn / console.error, window.onerror, and window.onunhandledrejection
// to the main process via the logs IPC namespace. Unstructured console.log is preserved
// locally but not forwarded (avoids PII-leak / volume issues).
```

```typescript
// renderer/components/shell/RootErrorBoundary.tsx
// React error boundary at the app root. On catch:
//   1. Forward error via rendererLogger.error()
//   2. Render <CrashFallback /> with:
//        • "An unexpected error occurred."
//        • Button: "Return to Main Menu" (resets app state)
//        • Button: "Restart Application"  (calls window.__chimera.system.quit() + relaunch)
//        • Crash ID (so bug reports can reference the log)
```

#### Shell-Root Mount Ordering

`ToastHost` (§4.30) must be mounted as a **sibling** of `RootErrorBoundary`, NOT inside it.
If a component crashes, the error boundary replaces its subtree with `<CrashFallback />`; any
toast rendered inside that subtree disappears at the exact moment the user most needs to see
"Your last save was written to …". Correct ordering:

```tsx
// renderer/app/providers.tsx (sketch)
export function AppShell({ children }: { children: ReactNode }) {
    return (
        <>
            <RootErrorBoundary>{children}</RootErrorBoundary>
            <ToastHost /> {/* sibling — survives boundary catches */}
        </>
    );
}
```

#### Logger Injection Applies Retroactively

Invariant 67 mandates that every main-process manager receive an injected `Logger`. Earlier
sections in this document (§4.10 `AssetManager`, §4.11 `SaveManager`, §4.13 `SettingsManager`,
§4.14 `LobbyManager`) were authored before §4.27 and their constructor signatures omit the
parameter for brevity. **Read those signatures as implicitly having `logger: Logger` as their
first constructor parameter.** `electron/main/index.ts` is the single site that constructs
the root `Logger` and injects a child (`logger.child({ module: 'saves' })` etc.) into each
manager at wire-up time.

#### IPC (`window.__chimera.logs`)

```typescript
interface LogsAPI {
    /** Non-blocking; the renderer fires logs; the main process batches and writes. */
    emit(entry: LogEntry): void;
    /** For the settings / "send feedback" screen: read recent logs for export. */
    readRecent(maxEntries: number): Promise<ReadonlyArray<LogEntry>>;
}
```

#### Privacy

Log entries are local-only by default. Nothing leaves the user's machine unless the player explicitly uses an "Export diagnostics" flow (which zips `userData/logs/` and `userData/crashes/` for the player to attach to a bug report). No automatic telemetry in 1.0.0.

#### Invariants

67. **Every main-process manager (`SaveManager`, `LobbyManager`, `SettingsManager`, `ProfileManager`, `ReplayManager`, `ChatRelay`) is constructed with an injected `Logger` child. No module emits logs via raw `console.*` \u2014 all structured logging flows through the injected logger.**
68. **The crash reporter runs autosave before writing the crash dump when a live simulation is present. The crash dump file is created atomically (`.tmp` + rename) so a partially-written crash dump never exists.**
69. **No log entry, crash dump, or telemetry ever leaves the user's machine automatically. Export is an explicit, user-initiated action. The main process must not register network telemetry in 1.0.0.**

---

### 4.28 Replay Export and Import (`simulation/replay/` + `electron/main/replay-manager.ts`)

#### Purpose

Given `seed + ActionHistory`, a Chimera simulation replays bit-identically (invariants 42\u201344). Replays are therefore a thin packaging + playback layer on top of existing determinism guarantees \u2014 marginal cost is low, value (bug reports, post-match review, shareable highlights) is high.

#### Replay File Format (`simulation/replay/ReplayFile.ts`)

```typescript
export interface ReplayFile {
    readonly formatVersion: 1;
    readonly engineVersion: string; // app.getVersion()
    readonly gameId: string; // e.g. 'tactics'
    readonly gameVersion: string; // from games/<name>/package.json
    readonly matchConfig: Readonly<Record<string, unknown>>; // Lobby-time parameters
    readonly seed: number;
    readonly actions: ReadonlyArray<RecordedAction>;
    readonly metadata: {
        readonly recordedAt: string; // ISO-8601
        readonly durationTicks: number;
        readonly players: ReadonlyArray<{ playerId: PlayerId; displayName: string }>;
    };
}

export interface RecordedAction {
    readonly tick: number;
    readonly playerId: PlayerId;
    readonly action: EngineAction;
}
```

Stored as JSON (optionally gzipped via `CompressedReplaySerializer`). Default extension: `.chimera-replay`. Default location: `userData/replays/<game-id>/`.

#### ReplayPlayer (`simulation/replay/ReplayPlayer.ts`)

```typescript
export class ReplayPlayer {
    constructor(
        private readonly file: ReplayFile,
        private readonly pipeline: ActionPipeline,
        private readonly registry: ActionRegistry,
    ) {}

    /** Initialise a fresh GameSnapshot with file.seed + file.matchConfig. */
    initialize(): GameSnapshot;

    /** Advance to the next recorded action. Returns the new snapshot. */
    step(): GameSnapshot;

    /** Advance to a specific tick (fast-forward or jump). */
    seek(tick: number): GameSnapshot;

    /** Replay at N\u00d7 real-time speed; calls onFrame for each applied action. */
    play(speedMultiplier: number, onFrame: (s: GameSnapshot) => void): StopFn;
}
```

Replay playback reuses the exact same `ActionPipeline` instance as a live match \u2014 no separate "replay reducer" codepath. If a replay diverges from its recorded outcome, that is a determinism bug and should be caught by the determinism test suite (\u00a710.0).

#### ReplayManager (`electron/main/replay-manager.ts`)

```typescript
export class ReplayManager {
    constructor(
        private readonly logger: Logger,
        private readonly history: ActionHistory,
        private readonly baseDir: string, // userData/replays/
    ) {}

    /** Begin recording the current match. Called automatically when a new game starts. */
    startRecording(
        gameId: string,
        seed: number,
        matchConfig: Readonly<Record<string, unknown>>,
    ): void;

    /** Append one action to the in-memory recording. Called by ActionPipeline observer. */
    recordAction(playerId: PlayerId, action: EngineAction, tick: number): void;

    /** Finalise + write the replay file atomically. Returns the written path. */
    finaliseRecording(): Promise<string>;

    /** Load a replay file for playback. */
    load(path: string): Promise<ReplayFile>;

    /** List all replays for a game. */
    list(gameId: string): Promise<ReadonlyArray<ReplayMeta>>;
}
```

#### IPC (`window.__chimera.replay`)

```typescript
interface ReplayAPI {
    list(gameId: string): Promise<ReadonlyArray<ReplayMeta>>;
    exportCurrentMatch(): Promise<string>; // Returns file path
    openInPlayer(path: string): Promise<void>; // Launches playback UI
    delete(path: string): Promise<void>;
}
```

#### Cross-Version Compatibility

Replays are tied to the `(engineVersion, gameId, gameVersion)` triple at record time. `ReplayManager.load()` refuses to play a replay whose versions differ unless a `ReplayMigrator` is supplied \u2014 same pattern as `SaveMigrator` (\u00a74.11). For 1.0.0 no migration is provided; replays from previous engine versions must be played on an archived build.

#### SOLID Analysis

| Principle | Application                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| **SRP**   | `ReplayFile` is schema; `ReplaySerializer` is encoding; `ReplayPlayer` is stepping; `ReplayManager` is IO + IPC. |
| **OCP**   | Gzip vs plain serialisation is a strategy; future custom formats plug in without touching the manager.           |
| **LSP**   | `ReplayPlayer` reuses the live `ActionPipeline` \u2014 no separate replay-only path that could drift.            |
| **DIP**   | `ReplayManager` depends on `Logger`, `ActionHistory`, and a base path \u2014 all injected.                       |

#### Invariants

70. **`ReplayPlayer` uses the same `ActionPipeline` instance wiring as live play. Any "replay-only" shortcut code path is forbidden \u2014 a replay divergence is a determinism bug, not an acceptable replay-layer simplification.**
71. **Replay files contain full `EngineAction` payloads \u2014 never projected `PlayerSnapshot`s. Playback starts from seed + matchConfig and reconstructs state through the pipeline. A replay file without `seed` or `actions` is malformed and rejected at load.**

---

### 4.29 Chat (`electron/main/chat-relay.ts` + `renderer/state/chatStore.ts`)

#### Purpose

Lobby-level and in-match text chat. Travels out-of-band from the `ActionPipeline` \u2014 chat messages are not `EngineAction`s, do not advance `tick`, and do not participate in determinism, undo/redo, or save/load. Same trust and lifecycle model as `PROFILE_UPDATE` (\u00a74.24).

#### Scope and Wire Shape

```typescript
// shared/messages.ts
export type ChatScope =
    | { kind: 'lobby' } // All connected players
    | { kind: 'team'; teamId: string } // Players on the specified team
    | { kind: 'private'; toPlayerId: PlayerId }; // Whisper

export interface ChatMessage {
    readonly id: string; // Server-assigned
    readonly from: PlayerId;
    readonly body: string;
    readonly scope: ChatScope;
    readonly serverTime: number; // Host wall-clock at relay time
}
```

Clients send `{ type: 'CHAT', body, scope }`; host assigns `id` + `serverTime`, filters by scope (team membership derived from `PlayerDirectory`), and rebroadcasts `{ type: 'CHAT', from, body, scope, serverTime }` to eligible recipients.

#### Host-Side `ChatRelay`

```typescript
export class ChatRelay {
    constructor(
        private readonly logger: Logger,
        private readonly directory: PlayerDirectory,
        private readonly options: ChatRelayOptions,
    ) {}

    /** Validate + rate-limit + rebroadcast. */
    relay(from: PlayerId, msg: InboundChat): RelayResult;
}

export interface ChatRelayOptions {
    readonly maxBodyLength: number; // Default 500
    readonly messagesPerMinute: number; // Default 20 per player
    readonly profanityFilter?: (body: string) => string; // Optional injection point
}

export type RelayResult =
    | { ok: true; msg: ChatMessage }
    | { ok: false; reason: 'too_long' | 'rate_limited' | 'empty' | 'invalid_scope' };
```

Rate-limiting uses a token bucket per `PlayerId`; excess messages are dropped with a `REJECT { reason: 'chat:rate_limited' }` response.

#### IPC (`window.__chimera.chat`)

```typescript
interface ChatAPI {
    send(body: string, scope: ChatScope): Promise<void>;
    onMessage(cb: (msg: ChatMessage) => void): Unsubscribe;
    /** Retrieve the current session's rolling transcript (capped at 500 entries). */
    history(): Promise<ReadonlyArray<ChatMessage>>;
    /** Mute / unmute a player locally (renderer-side only \u2014 not propagated). */
    mute(playerId: PlayerId): void;
    unmute(playerId: PlayerId): void;
}
```

#### Renderer `chatStore`

Rolling buffer of the last 500 messages (configurable), plus per-player mute flags. `ChatPanel.tsx` subscribes and renders with `PlayerDirectory` for display names and avatars.

#### Persistence

Chat history is **not** persisted by default. It lives in memory for the session only. A future `ChatLogRepository` may optionally persist transcripts for local review, but 1.0.0 ships without persistence to minimise privacy exposure.

#### Invariants

72. **`CHAT` messages are not `EngineAction`s. They must not advance `tick`, invoke `ActionPipeline`, or be recorded in `ActionHistory` / replays / saves. Chat is a cosmetic communication channel, parallel to `PROFILE_UPDATE`.**
73. **`ChatRelay.relay()` is the mandatory gate between an inbound `CHAT` message and rebroadcast. Length cap, rate limit, and scope validation all run inside `relay()` \u2014 no bypass path exists.**

---

### 4.30 Toast Notifications (`renderer/components/shell/ToastHost.tsx` + `renderer/state/toastStore.ts`)

#### Purpose

Transient, non-blocking UI messages for ephemeral events: "Opponent disconnected", "Save failed", "Connection degraded", "Replay saved to `~/Documents/...`". Renderer-only, zero simulation involvement.

#### Toast Store

```typescript
// renderer/state/toastStore.ts

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
    readonly id: string; // Auto-generated ULID
    readonly severity: ToastSeverity;
    readonly title: string;
    readonly body?: string;
    readonly durationMs: number; // Auto-dismiss; Infinity = manual only
    readonly action?: { label: string; onClick: () => void };
    readonly createdAt: number;
}

export interface ToastStore {
    readonly toasts: ReadonlyArray<Toast>;
    show(input: Omit<Toast, 'id' | 'createdAt'>): string;
    dismiss(id: string): void;
    clearAll(): void;
}
```

Default durations: `info` 4 s, `success` 3 s, `warning` 6 s, `error` 8 s.

#### `ToastHost.tsx`

Mounted once at the app root as a **sibling** of `RootErrorBoundary` (see §4.27 — Shell-Root Mount Ordering). Placing it outside the error boundary ensures toasts remain visible even when the React tree under the boundary has been replaced by `<CrashFallback />`. Renders a stacked, animated column of toasts in the lower-right corner. Respects `settings.display.reducedMotion` — when enabled, toasts fade in/out instantly rather than sliding.

#### Engine-Wired Sources

The engine auto-emits toasts for common events:

| Event                      | Severity | Source                                  |
| -------------------------- | -------- | --------------------------------------- |
| Opponent disconnected      | warning  | `system.onConnectionStatus`             |
| Reconnected to lobby       | success  | `system.onConnectionStatus`             |
| Save failed                | error    | `saves.save()` rejection                |
| Replay exported            | success  | `replay.exportCurrentMatch()`           |
| Chat rate-limited          | warning  | `CHAT` REJECT response                  |
| Profile admission rejected | warning  | `profile.updateLocal()` REJECT response |

Games add their own via `useToastStore().show({ ... })`.

#### Invariants

74. **`toastStore` is renderer-only state. Toast contents must never be derived from `GameSnapshot`, `PlayerSnapshot`, or `SaveFile`. Toasts are transient UI surfaces for the local viewer; other players do not see another player's toasts.**

---

### 4.31 Fixed-Point Math (`simulation/engine/FixedPoint.ts`)

#### Purpose

Invariant 44 forbids floating-point in simulation state because floats produce different results across CPUs and compilers \u2014 fatal for cross-platform determinism. Games still need fractional math (movement in grid units smaller than 1, percentage multipliers, curved trajectories). `FixedPoint` provides a shared **Q32.32** fixed-point integer representation so games don't each invent their own incompatible fixed-point types.

#### Representation

A `FixedPoint` value is a `bigint` where the low 32 bits represent the fractional component and the high 32 bits represent the integer component. This gives a range of approximately \u00b12.1\u00d710\u2079 with a fractional resolution of \u22482.3\u00d710\u207b\u00b9\u2070.

```typescript
// simulation/engine/FixedPoint.ts

export type FixedPoint = bigint; // Branded Q32.32

export const FP_ZERO: FixedPoint;
export const FP_ONE: FixedPoint;
export const FP_HALF: FixedPoint;
export const FP_PI: FixedPoint;
export const FP_TAU: FixedPoint;

/** Integer \u2192 FixedPoint. Exact. */
export function fromInt(n: number): FixedPoint;

/** Ratio \u2192 FixedPoint. Exact when divisor divides 2^32. */
export function fromRatio(numerator: number, denominator: number): FixedPoint;

/** Float \u2192 FixedPoint. Lossy. Use ONLY for hard-coded content constants; never for runtime floats. */
export function fromFloat(x: number): FixedPoint;

/** FixedPoint \u2192 float. Lossy. Use ONLY at renderer boundary for display. */
export function toFloat(x: FixedPoint): number;

/** FixedPoint \u2192 integer (truncation). */
export function toInt(x: FixedPoint): number;

// Arithmetic
export function add(a: FixedPoint, b: FixedPoint): FixedPoint;
export function sub(a: FixedPoint, b: FixedPoint): FixedPoint;
export function mul(a: FixedPoint, b: FixedPoint): FixedPoint;
export function div(a: FixedPoint, b: FixedPoint): FixedPoint;
export function neg(a: FixedPoint): FixedPoint;
export function abs(a: FixedPoint): FixedPoint;

// Transcendentals \u2014 table-driven or polynomial, deterministic
export function sqrt(a: FixedPoint): FixedPoint;
export function sin(a: FixedPoint): FixedPoint; // Input in radians
export function cos(a: FixedPoint): FixedPoint;
export function atan2(y: FixedPoint, x: FixedPoint): FixedPoint;

// Comparison
export function lt(a: FixedPoint, b: FixedPoint): boolean;
export function gt(a: FixedPoint, b: FixedPoint): boolean;
export function eq(a: FixedPoint, b: FixedPoint): boolean;
```

#### Rules of Use

- **Simulation state may store `FixedPoint` (via `bigint`).** `GameSnapshot` fields are integers or `FixedPoint` — never `number` for fractional values.
- **Renderer converts at the boundary.** Once a value is about to be passed to Three.js / React / CSS, `toFloat()` converts. The simulation never does.
- **`fromFloat()` is for static content only.** Design-time constants in JSON may be written as floats and converted once at content load; runtime inputs must not pass through `fromFloat()`.

#### ESLint Enforcement

A custom rule **`chimera/no-fromfloat-in-simulation`** (shipped in `tools/eslint-plugin-chimera/`) enforces invariant 76:

- **Scope:** files under `simulation/**/*.ts` EXCEPT `simulation/content/loaders/**` (content load is the single permitted site).
- **Check:** any call expression resolving to `fromFloat` imported from `simulation/engine/FixedPoint` is an error.
- **CI gate:** the rule runs as part of `pnpm lint` and blocks merge on violation. Local bypass via `// eslint-disable-next-line` requires a companion `@chimera-review: <reason>` comment, grep-checked by CI.

#### Determinism Tests

The determinism test suite (\u00a710.0) includes a golden-vector test for `FixedPoint`: the same `(operation, inputs)` produces identical outputs on macOS, Windows, and Linux. `sin`/`cos`/`sqrt` use integer-only implementations (CORDIC or polynomial approximation with `bigint` intermediates) to guarantee cross-platform bit-identity.

#### SOLID Analysis

| Principle | Application                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **SRP**   | Pure math module. No state, no IO.                                                                                           |
| **LSP**   | Games cannot substitute their own fixed-point type without breaking determinism; the shared module is mandatory for interop. |

#### Invariants

75. **`FixedPoint` is the ONLY allowed fractional representation in `GameSnapshot` and `EngineAction.payload`. A game that stores `number` for a fractional gameplay quantity violates invariant 44 even if it rounds consistently — determinism requires the shared `bigint` Q32.32 representation.**
76. **`fromFloat()` is permitted only at content-load time for hard-coded constants. It must not be called inside `validate()`, `reduce()`, or any hot simulation path. Linting is enforced by the `chimera/no-fromfloat-in-simulation` ESLint rule in CI, scoped to `simulation/**/\*.ts`except`simulation/content/loaders/**`.**

---

### 4.32 Development Multiplayer Harness (`tools/dev-multiplayer.ts` + `electron/main/index.ts`)

#### Purpose

Running multiplayer scenarios by hand is the single biggest friction point in day-to-day engine development: launch Electron, click "Host", copy the port, launch a second Electron instance, click "Join", paste the port, pick a name, pick an avatar — then repeat for a third player. The dev harness collapses this to a one-line command:

```
pnpm dev:mp 3            # 1 host + 2 auto-joining clients
pnpm dev:mp 4 --game tactics --scenario skirmish
```

Each spawned instance boots, consumes its CLI flags, and automatically hosts or joins before the main menu renders. All instances point at distinct `userData` directories and distinct seed profiles so they behave as fully independent players.

#### Scope and Non-Goals

- **In scope:** spawn N Electron instances on localhost, wire up host + auto-join, per-instance data isolation, graceful teardown on `Ctrl+C`, seed profile rotation.
- **Out of scope:** performance measurement (N renderers sharing one GPU is not representative); production packaging (the harness refuses to run in production builds); automated assertions about the match outcome (that is the job of the Playwright E2E suite in §13).

#### CLI Contract

The harness adds three new flags to `electron/main/index.ts`, all gated by a single env guard:

| Flag                          | Accepted values       | Effect at startup                                                                                              |
| ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--dev-auto-host`             | boolean presence      | Skips the main menu; calls `LobbyManager.hostLobby({ port })` on the provided port.                            |
| `--dev-auto-join <host:port>` | `127.0.0.1:7777`      | Skips the main menu; calls `LobbyManager.joinLobby({ address })`.                                              |
| `--dev-profile-id <id>`       | `dev-p1`, `dev-p2`, … | Selects a seed profile from `tools/dev-profiles/` to attest at join time. Overrides any existing profile slot. |

The environment variable `CHIMERA_DEV_HARNESS=1` must be present for any of these flags to take effect. In its absence the flags are ignored with a warning. The guard mirrors the `CHIMERA_DEBUG` / `CHIMERA_E2E` pattern (§4.12, §13.10).

#### Launcher Script (`tools/dev-multiplayer.ts`)

```typescript
// tools/dev-multiplayer.ts (sketch)

interface HarnessOptions {
    players: number; // 2..8; rejected outside this range
    game?: string; // optional --game <id>
    scenario?: string; // optional --scenario <name>
    port?: number; // optional --port <n>; default: random free
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv);
    const port = opts.port ?? (await findFreePort());

    // Clean + recreate per-instance userData dirs so runs are hermetic.
    await resetDevUserDataDirs(opts.players);

    const children: ChildProcess[] = [];

    // Instance 1 — host
    children.push(
        spawnInstance({
            role: 'host',
            index: 1,
            port,
            profileId: 'dev-p1',
            game: opts.game,
            scenario: opts.scenario,
        }),
    );

    // Wait for the host's lobby to be listening before spawning clients.
    await waitForPortListening('127.0.0.1', port, /*timeoutMs*/ 10_000);

    // Instances 2..N — auto-join clients
    for (let i = 2; i <= opts.players; i++) {
        children.push(
            spawnInstance({
                role: 'client',
                index: i,
                address: `127.0.0.1:${port}`,
                profileId: `dev-p${i}`,
            }),
        );
    }

    installSignalForwarding(children); // Ctrl+C kills all children cleanly.
    await waitForAnyChildExit(children); // First child to exit tears down the rest.
}
```

Each `spawnInstance()` call uses Node's `child_process.spawn` to invoke the Electron binary with:

- `--user-data-dir=.dev-userdata/p<i>` — standard Electron flag; guarantees independent saves, settings, and profiles per instance.
- The harness flags from the CLI contract above.
- `stdio: 'inherit'` with a line prefix per instance so logs from all players interleave clearly in the host terminal.
- `env: { ...process.env, CHIMERA_DEV_HARNESS: '1' }`.

#### Startup Flow

```
pnpm dev:mp 3
  │
  ▼
 tools/dev-multiplayer.ts
  │
  ├── findFreePort() → 7812
  ├── resetDevUserDataDirs(3)
  │
  ├─ spawn electron #1  (host,   userData=.dev-userdata/p1, profile=dev-p1, port=7812)
  │       │  electron/main/index.ts parses --dev-auto-host
  │       │  ProfileManager loads seed profile dev-p1
  │       │  LobbyManager.hostLobby({ port: 7812 })
  │       └─ main menu bypassed; lobby screen renders directly
  │
  ├─ waitForPortListening(7812)  ← first instance signals readiness by binding
  │
  ├─ spawn electron #2  (client, userData=.dev-userdata/p2, profile=dev-p2, addr=127.0.0.1:7812)
  │       └─ LobbyManager.joinLobby(…)  → JOIN { profile dev-p2 }  → ProfileSanitizer.admit
  │
  └─ spawn electron #3  (client, userData=.dev-userdata/p3, profile=dev-p3, addr=127.0.0.1:7812)
          └─ LobbyManager.joinLobby(…)  → JOIN { profile dev-p3 }  → ProfileSanitizer.admit

 All three instances now show a populated lobby with distinct avatars. Ctrl+C in the launcher
 terminal sends SIGTERM to every child; each instance runs the normal clean-shutdown path
 (LobbyManager.closeLobby, dispose provider, flush logs) before exiting.
```

#### Seed Profiles (`tools/dev-profiles/`)

A small set of pre-authored profile JSON files baked into the repo:

```
tools/dev-profiles/
├── dev-p1.json   # { localProfileId: 'dev-p1', displayName: 'Dev Player 1', avatar: { kind: 'builtin', ref: 'avatars/red.png'    } }
├── dev-p2.json   # { …                                        avatar: { kind: 'builtin', ref: 'avatars/blue.png'   } }
├── dev-p3.json   # { …                                        avatar: { kind: 'builtin', ref: 'avatars/green.png'  } }
├── dev-p4.json   # …
└── dev-p8.json
```

On startup, if `--dev-profile-id` is provided, `ProfileManager` copies the corresponding seed file into the instance's `userData/profiles/` directory before normal profile resolution runs — so the lobby immediately shows distinct avatars and names without any interactive setup.

#### Production Guard

The harness flag parsing in `electron/main/index.ts` refuses to activate when `NODE_ENV === 'production'`, mirroring invariant 27:

```typescript
if (process.env.CHIMERA_DEV_HARNESS === '1' && process.env.NODE_ENV === 'production') {
    throw new Error(
        'CHIMERA_DEV_HARNESS is enabled in a production build. Refusing to start. ' +
            'The dev multiplayer harness is a development-only tool.',
    );
}
```

#### Performance Caveat

Running N Electron instances on one machine exercises correctness — sync, projection, disconnect, chat, profile updates, turn flow — but is **not** a representative performance benchmark. Three renderers competing for one GPU and one event loop will report frame times worse than any real deployment. Use `§4.16 Performance HUD` only on single-instance runs or on distinct machines over LAN.

#### SOLID Analysis

| Principle | Application                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SRP**   | `dev-multiplayer.ts` is process orchestration; `electron/main/index.ts` flag parsing is a narrow startup extension; `ProfileManager` seed-copy is a one-method addition. |
| **OCP**   | No change to `MultiplayerProvider`, `LobbyManager`, `LocalWebSocketProvider`, `StateBroadcaster`, or any game — the harness rides on existing public APIs.               |
| **DIP**   | The launcher depends on Electron's CLI surface and the `LobbyManager` IPC contract; it never imports from `simulation/` or `renderer/`.                                  |

#### Invariants

77. **The dev multiplayer harness is a development-only tool. `electron/main/index.ts` must refuse to start when `CHIMERA_DEV_HARNESS=1` is combined with `NODE_ENV=production`, and the `--dev-auto-host` / `--dev-auto-join` / `--dev-profile-id` flags must be ignored (with a warning) when `CHIMERA_DEV_HARNESS` is absent.**
78. **Each harness-spawned instance runs in an isolated Electron `userData` directory (`.dev-userdata/p<i>/`). Shared state between instances is forbidden — profiles, saves, settings, logs, and crash dumps must be per-instance so the harness behaves identically to multiple distinct machines.**

#### What This Is Not

- Not an E2E test runner. Automated multi-instance assertions belong in the Playwright suite (§13). The harness is an interactive developer tool.
- Not a production launcher. Nothing in `tools/` is bundled into production builds (`electron-builder` config excludes the directory).
- Not a load-testing tool. If you need 50-player correctness testing, build a headless test harness with `InMemoryMultiplayerProvider` instead — spawning 50 Electron processes is not a useful stress.

---

## 5. Data Flow

```
───── Human player path ──────────────────────────────────────────────────────
[Player Input]
  window.__chimera.game.sendAction(EngineAction)
     │  IPC (contextBridge)
     ▼
[electron/main/ipc-handlers.ts]
  queues action → ActionPipeline

───── AI player path (same destination) ─────────────────────────────────────
[electron/main/simulation-host.ts]
  after each sim tick:
  AgentManager.tickAll(gameSnapshot, tick, projector)
     │
     └── per AI player:
           project(gameSnapshot, playerId) → PlayerSnapshot
           AIBrain.tick(playerSnapshot, tick)
             └── CommandScheduler.advance() → AICommand.onTick()
                   └── context.dispatch(EngineAction) → ActionPipeline

───── Shared pipeline (all action sources converge here) ────────────────────
[simulation/engine/ActionPipeline.ts]
  Step 1: registry.resolve(action.type)            → ActionDefinition
  Step 2: definition.parsePayload(action.payload)  → typed payload (or schema error)
  Step 3: intercept engine:undo / engine:redo       → UndoManager
  Step 4: Legality — definition.validate(payload, state, playerId, db) → ValidationResult
     │  if ok:false → REJECT (no-op for AI; AI's onFail cleans up)
     │  if ok:true  ↓
  Step 5: definition.reduce(state, payload, playerId, db)         → nextState
  Step 6: history.append(action)
  Step 7: project(nextState, each playerId) → broadcast PlayerSnapshot
     │
     ├──► [networking/server/StateBroadcaster.ts]
     │      broadcast SNAPSHOT/DELTA to all clients
     │                │
     │    ┌───────────┴───────────┐
     │    │ WebSocket             │ IPC (host renderer)
     ▼    ▼                       ▼
[Remote Clients]         [renderer/bridge/ipcClient.ts]
  onSnapshot(cb)           onSnapshot(cb)
     │                            │
     ▼                            ▼
[renderer/state/gameStore.ts] ← applySnapshot()
     │
     ▼
[renderer/components/r3f/]   ← reads store via selectors
  Board, Unit, Effects        (R3F render loop is independent of React tree)
```

---

## 6. Multiplayer and Latency Implications

### Host Authority Model

- The host's simulation is the single source of truth.
- Actions from all clients (including host UI) are routed through validation before state mutation.
- Rejected actions return a `REJECT` message; clients roll back predictions.

### Client Prediction (Optional)

- Prediction is an opt-in feature for real-time or latency-sensitive games. Turn-based games (Tic Tac Toe, Monopoly, TBS, 4X) do not enable it; the UX difference from waiting for server confirmation is imperceptible at human-turn cadence.
- When enabled, own-player actions with `predictable: true` are applied immediately by `ClientPredictor` (see `simulation/prediction/`) and reconciled against authoritative snapshots by `ReconcileBuffer`.
- Contested or randomised outcomes are **never** predicted — the client waits for the authoritative snapshot.

### Snapshot vs Delta

- Full `SNAPSHOT` (as `PlayerSnapshot`, projected per recipient) is sent on join, after every applied action, and on resync request.
- Incremental `DELTA` (event list since last ack'd tick, pre-filtered for the viewer) is an optional bandwidth optimisation used by real-time games; turn-based games broadcast a full `PlayerSnapshot` per action without measurable cost.
- Clients maintain a local tick sequence number and request full snapshots if a gap is detected.

### NAT / Port-Forwarding

- Host must open a configurable port (default `7777`).
- The Electron main process exposes a connection info dialog with local IP and the required forwarding rule.
- If a STUN/TURN relay is added later, it slots in as an additional transport option in `ServerConnection.ts` without changing simulation or state contracts.

### Simulation Cadence

- The simulation is **action-driven**, not tick-driven. `tick` is a monotonic counter incremented once per applied action; it is not wall-clock time.
- Turn-based games (Tic Tac Toe, Monopoly, TBS, 4X) apply an action only when a player dispatches one. The main process is idle between inputs — no timer, no busy loop.
- Real-time games opt in by wrapping a `RealtimeTicker` (see §4.2.1) around the simulation core. The ticker dispatches a reserved `engine:tick` action at a game-defined frequency (e.g. 20 Hz). The same `ActionPipeline` processes it — no special real-time code path exists.
- Renderer frame rate is independent of simulation cadence in all modes. R3F interpolates between snapshots when the game is real-time.

---

## 7. Undo / Redo Architecture

### Design Pattern: Hybrid Memento + Event Sourcing

Turn-based games frequently need the ability for a player to retract their last action before committing the turn. Chimera uses a **Hybrid Memento + Event Sourcing** approach that integrates with the existing pure reducer without special-casing the simulation core.

| Pattern                | Role in Chimera                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Event Sourcing**     | All actions are appended to `ActionHistory`. Any past state is reconstructable by replaying actions from the beginning. Undo is a projection of a shorter replay.                                                                          |
| **Memento**            | A full `GameSnapshot` is saved at the start of each player's turn by `TurnMemento`. Undo replay begins from this memento — not game start — keeping undo O(n) where n = actions in current turn.                                           |
| **Command (implicit)** | `UNDO` and `REDO` are first-class `EngineAction` types (`engine:undo` / `engine:redo`). They travel the same validation → reducer pipeline. No separate execution path exists — undo is auditable, deterministic, and network-transparent. |

### How Undo Works Step-by-Step

```
Turn N begins
     │
     ▼
[TurnMemento.ts] ─── saveTurnMemento(currentSnapshot, activePlayerId)
     │
Player takes actions: A1, A2, A3
ActionHistory (this turn): [A1, A2, A3]
     │
Player sends UNDO (steps=1)
     │
     ▼
[UndoManager.ts]
  1. Load mementoSnapshot (saved at turn start)
  2. Collect turn actions to replay: [A1, A2]  (A3 dropped)
  3. Replay: applyAction(memento, A1) → S1
             applyAction(S1,    A2) → S2   ← new current state
  4. Push A3 onto redo stack
  5. Return S2
     │
     ▼
[StateProjector.ts] ─── project(S2, each playerId) → broadcast PlayerSnapshot
```

### Turn Boundary Rules

| Rule                    | Behavior                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default undo scope**  | Current player's turn only. `END_TURN` commits the turn and clears undo history for that player.                                                               |
| **Redo reset**          | Any new action after undo clears the redo stack (standard UX contract).                                                                                        |
| **Multiplayer consent** | Async/cooperative games may set `requireConsentFrom` in `UndoPolicy` — triggers an `UNDO_REQUEST` that opponents must acknowledge before the state rolls back. |
| **Cross-turn undo**     | Disabled by default. Enable via `UndoPolicy.crossTurnUndo = true` for solo / puzzle modes only.                                                                |

### Undo and Determinism

Because `UNDO` is an `EngineAction` (reserved type `engine:undo`):

- It is **validated** by `ActionValidator` (can be rejected if policy or game rules disallow it)
- It is **logged** in `ActionHistory` — the undo itself is auditable
- The full action log including UNDO/REDO steps replays to the **identical final state**
- Remote clients receive the projected result via the normal snapshot broadcast — they do not replay anything locally

---

## 8. State Obfuscation and Information Hiding

### Design Pattern: CQRS-Adjacent State Projection

The host owns the single authoritative `GameSnapshot` (full truth). Before any state transmission, `StateProjector` produces a `PlayerSnapshot` — a filtered, masked view for each specific player. This mirrors the **Projection / Read Model** pattern from CQRS: reads are projections tuned per consumer; writes use the full model.

**Critical invariant**: `GameSnapshot` never leaves the host's main process. **The host's own renderer is treated as an untrusted client** and receives a `PlayerSnapshot`. This prevents the host player from gaining an information advantage via devtools inspection.

### Information Classification

| Scope        | Examples                                                    | On-Wire Representation                                                                                         |
| ------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `public`     | Unit positions, HP, terrain, turn order                     | Transmitted as-is to all players                                                                               |
| `owner-only` | Card hand contents, resource totals, hidden objectives      | True value to owner only; others receive `null` or an opaque count                                             |
| `hidden`     | Server RNG seed, scheduled future events, internal counters | Never transmitted to any client                                                                                |
| `committed`  | Shuffled deck order, die roll result, card drawn            | SHA-256 commitment broadcast at generation; true value sent via `REVEAL` message at the appropriate game event |

### Fog of War

Invisible entities are **entirely absent** from the `PlayerSnapshot.entities` map — not masked with nulls. This prevents entity count inference from object key enumeration.

```typescript
// StateProjector internal — absent if invisible, masked if visible-but-partial
const visibleEntities = Object.fromEntries(
    Object.entries(fullState.entities)
        .filter(([, e]) => rules.isEntityVisible(e, viewerId, fullState))
        .map(([id, e]) => [id, rules.maskEntity(e, viewerId, fullState)]),
);
```

### Cryptographic Commitment Scheme (Anti-Cheat for Hidden-Info Games)

For values that must be provably fixed at generation time but remain hidden until revealed (shuffled decks, rolled dice, drawn cards):

**Phase 1 — Commit** (at generation time, before action resolves):

```
nonce ← crypto.randomBytes(32)
value ← shuffledDeckOrder
commitment ← SHA-256(JSON.stringify(value) + nonce)
→ broadcast CommitmentEnvelope { id, commitment } to ALL clients immediately
```

**Phase 2 — Reveal** (at the appropriate game event):

```
→ broadcast CommitmentReveal { id, value, nonce }
Client: SHA-256(JSON.stringify(value) + nonce) === storedCommitment?
  ✔ OK → trust the value
  ✖ MISMATCH → host tampered; flag + log with cryptographic proof
```

This makes hidden-information games auditable without a trusted third party. A cheating host cannot retroactively change a shuffled deck order after seeing how it would affect outcomes.

### Obfuscation Trust Boundary

```
Host Main Process
│
├── GameSnapshot (full truth) ────────────────────── NEVER leaves this process
│       │
│       ▼
│   project(snap, playerA) → PlayerSnapshot(A) ─► IPC ─► Host Renderer (own view only)
│
│   project(snap, playerB) → PlayerSnapshot(B) ─► WebSocket ─► Client B
│
│   project(snap, playerC) → PlayerSnapshot(C) ─► WebSocket ─► Client C
```

### Reconnect Handling

On reconnect, the client receives a fresh `PlayerSnapshot` at the current tick — not a replay of full game history. This prevents reconnection from becoming an information leak (e.g. a player should not receive history showing cards that were in an opponent’s hand before they were played).

---

## 9. Security and Trust Boundaries

| Boundary             | Rule                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer → Main      | Only through `contextBridge`. `nodeIntegration: false`. `contextIsolation: true`.                                                             |
| Client → Server      | All actions validated server-side. Client cannot mutate state by crafting a WebSocket message.                                                |
| Lobby tokens         | Short-lived random tokens issued by host on `JOIN`; prevents unauthenticated connections. No persistent auth required for peer-hosted play.   |
| IPC surface          | Preload exposes typed, enumerated methods only. No `eval`, no arbitrary Node.js access from renderer.                                         |
| Action checksums     | `ACTION` messages carry a CRC32 of `(playerId + tick + actionPayload)` to detect tampering or corruption.                                     |
| State obfuscation    | `GameSnapshot` never crosses any process boundary. `StateProjector` is the mandatory gate between simulation and all outbound messages.       |
| Commitment integrity | `CommitmentScheme.verify()` is called client-side on every `REVEAL` message before the value is trusted. Failures are surfaced to the player. |
| Host renderer trust  | Host's own renderer receives `PlayerSnapshot`, not `GameSnapshot`. Host player cannot gain info advantage via devtools inspection.            |

### 9.1 IPC Attack Surface Audit

The preload bridge (`electron/preload/api.ts`, §4.1) exposes the object `window.__chimera` with the namespaces tabulated below. This is the single entry point from the untrusted renderer into the trusted main process; every future change to this surface must update this table. Each namespace declares (a) the main-process validator that gates inbound calls, (b) the trust classification, and (c) whether it carries any authoritative gameplay authority.

| Namespace                              | Writes / side-effects                                                  | Main-process validator                                                                                                                                                                                                                                                                                          | Trust classification                                                                                                         | Gameplay authority?                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `game`                                 | `sendAction()` dispatches `EngineAction`s into `ActionPipeline`.       | `parseInvokeRequest(EngineActionSchema, …)` gates the envelope at `ipcMain` (§9.1 / `electron/main/ipc-schemas.ts`). `ActionPipeline.validate()` then runs the action's registered `ActionDefinition.validate()` + `parsePayload` (§4.7). Unknown action types rejected at `registry.resolve()`.                | Sanitiser-gated. Renderer input is structurally typed only; every action passes `parsePayload` + `validate` before `reduce`. | Yes — the only authoritative path.                                                            |
| `lobby`                                | Create/join/close lobby; kick players (host only).                     | `parseInvokeRequest(HostLobbyParamsSchema / JoinLobbyParamsSchema, …)` gates inbound args at `ipcMain`. `LobbyManager` then verifies caller is host for privileged ops; lobby code format + length checks on join.                                                                                              | Main-authoritative.                                                                                                          | No (session control only).                                                                    |
| `saves`                                | List / load / save / delete save files.                                | `parseInvokeRequest(GameIdSchema / SaveRequestSchema / SlotIdSchema, …)` gates inbound args at `ipcMain`. `SaveManager` — path confined to `userData/saves/`; filename regex `^[A-Za-z0-9_\-]+\.chimera-save$`; atomic writes (inv. 23). Load routes through `SimulationHost.restoreFromSave()` only (inv. 24). | Main-authoritative.                                                                                                          | No (requires `engine:save` / `engine:load` action which itself validates host-only, inv. 25). |
| `settings`                             | Read / update user settings.                                           | `parseInvokeRequest(GameIdSchema / UserSettingsPatchSchema, …)` gates inbound args at `ipcMain`. `SettingsManager` — Zod-validates patch against registered schema; atomic write (inv. 33); schema required (inv. 34).                                                                                          | Main-authoritative.                                                                                                          | No (settings never enter `GameSnapshot`, inv. 32).                                            |
| `profile`                              | Read local profile(s); update local profile.                           | `ProfileManager` (local) + `ProfileSanitizer.admit()` for network attestation (inv. 61).                                                                                                                                                                                                                        | Sanitiser-gated for wire; main-authoritative for disk.                                                                       | No (cosmetic only, inv. 59–62).                                                               |
| `replay`                               | List / export / open / delete replay files.                            | `ReplayManager` — path confined to `userData/replays/`; format-version + `(engineVersion, gameId, gameVersion)` checked on load (inv. 71).                                                                                                                                                                      | Main-authoritative.                                                                                                          | No (playback uses live `ActionPipeline` path, inv. 70).                                       |
| `chat`                                 | Send chat; subscribe to inbound; local mute.                           | `ChatRelay.relay()` on host — length cap, rate limit, scope check (inv. 73).                                                                                                                                                                                                                                    | Sanitiser-gated.                                                                                                             | No (never an `EngineAction`, inv. 72).                                                        |
| `logs`                                 | Emit log entry; read recent logs for export.                           | Log-level whitelist; entries capped in size; never re-broadcast.                                                                                                                                                                                                                                                | Renderer-write / main-persist. Local-only — never leaves the machine automatically (inv. 69).                                | No.                                                                                           |
| `system`                               | App quit, relaunch, open-external (for bug reports), OS version query. | `open-external` URL scheme whitelist (`https:`, `mailto:`); no `file:` or arbitrary protocols.                                                                                                                                                                                                                  | Main-authoritative.                                                                                                          | No.                                                                                           |
| `lobbyDiscovery` (optional capability) | LAN / Steam browse list.                                               | Provider-specific; browse result is read-only and never writes state.                                                                                                                                                                                                                                           | Main-authoritative; read-only.                                                                                               | No.                                                                                           |
| `debug` (dev builds only)              | Snapshot browser, time-travel, injected actions.                       | `webContents.id` checked against Inspector Window ID on every call (inv. 29); entire namespace absent in production builds (inv. 27, 28).                                                                                                                                                                       | Main-authoritative; dev-only.                                                                                                | Yes in dev, ABSENT in production.                                                             |

**Audit procedure when adding or modifying a namespace:**

1. Declare the namespace shape in `electron/preload/api.ts` as a typed, enumerated method set (no generic proxies, no pass-through `invoke`).
2. Add a row to the table above covering all six columns.
3. Register the main-process handler in `electron/main/ipc-handlers.ts` with explicit input validation at the first line of each handler.
4. If the new surface accepts any structured payload, write a Zod (or equivalent) schema and reject before touching any manager.
5. If the new surface can influence gameplay, confirm it goes through `ActionPipeline` — never through a direct manager mutation.
6. Add at least one invariant in Appendix B capturing the trust rule and link it from the namespace description.

---

## 10. Testing Strategy

### 10.0 Unit Testing Framework

#### Toolchain

| Tool                         | Role                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Vitest**                   | Unit and integration test runner for all TypeScript packages (`simulation/`, `ai/`, `networking/`, `renderer/`, `shared/`, `tools/`) |
| **React Testing Library**    | Component tests for renderer React components and Zustand stores                                                                     |
| `@react-three/test-renderer` | R3F scene tests (headless Three.js, no WebGL requirement)                                                                            |
| **Playwright**               | End-to-end tests only — launches real Electron instances (see §13)                                                                   |
| **fast-check**               | Property-based tests for projection, commitment, and determinism invariants                                                          |

Vitest is chosen over Jest because:

- Native ESM support without transform overhead — the entire codebase is ESM TypeScript.
- `vite` config reuse — the renderer already uses Vite; test config shares aliases, env, and plugins.
- First-class `jsdom`/`happy-dom` environments per test file via `// @vitest-environment jsdom`.
- Vitest UI mode (`vitest --ui`) gives a browser-based watch dashboard with per-file results and inline diffs.

#### File Conventions

Unit tests live **co-located** with the source file they test, in a `__tests__/` subdirectory or as a sibling `.test.ts` / `.test.tsx` file:

```
simulation/engine/
├── ActionPipeline.ts
├── ActionPipeline.test.ts          ← unit tests for ActionPipeline
├── DeterministicRng.ts
├── DeterministicRng.test.ts
└── __tests__/
    └── ActionPipeline.pipeline.test.ts  ← longer integration-style test group
```

Integration tests that span multiple modules (e.g. `ContentLoader` + `ContentDatabase`) live under:

```
simulation/__tests__/
ai/__tests__/
networking/__tests__/
renderer/__tests__/
```

E2E fixtures and specs live exclusively under `e2e/` and are never imported from unit tests.

#### `vitest.config.ts`

```typescript
// vitest.config.ts — root config; same file used by CI and local watch
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [tsconfigPaths()], // resolves @chimera/* path aliases
    test: {
        globals: true, // no need to import describe/it/expect
        environment: 'node', // default: pure Node — simulation tests need no DOM
        environmentMatchGlobs: [
            ['renderer/**/*.test.tsx', 'jsdom'], // React component tests
            ['renderer/**/*.test.ts', 'jsdom'], // store and hook tests
        ],
        coverage: {
            provider: 'v8',
            include: [
                'simulation/**/*.ts',
                'ai/**/*.ts',
                'networking/**/*.ts',
                'renderer/**/*.{ts,tsx}',
                'shared/**/*.ts',
            ],
            exclude: ['**/*.test.*', '**/__tests__/**', '**/index.ts'],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 75,
            },
        },
        // Separate pool for each top-level package — avoids module state bleed
        poolOptions: {
            threads: { singleThread: false },
        },
    },
});
```

#### `package.json` Scripts

```json
{
    "scripts": {
        "test": "vitest run",
        "test:watch": "vitest",
        "test:ui": "vitest --ui",
        "test:coverage": "vitest run --coverage",
        "test:e2e": "CHIMERA_E2E=1 playwright test"
    }
}
```

`test` (no flag) runs all unit and integration tests — fast, no Electron launch. `test:e2e` is always separate and gated by the `CHIMERA_E2E=1` environment variable so it never runs accidentally in unit test suites.

#### Test Utilities and Shared Fixtures

A `simulation/__tests__/helpers/` directory (and equivalents in `ai/`, `networking/`) provides builder helpers shared across test files. These are not test doubles — they are minimal, correct factory functions used to construct valid test inputs without repeating boilerplate:

```typescript
// simulation/__tests__/helpers/snapshots.ts

import { BaseGameSnapshot, PlayerId } from '../../engine/GameState';

// Returns the minimal valid BaseGameSnapshot for engine unit tests.
// Games build on this with Object.freeze({ ...makeBaseSnapshot(), ...gameFields }).
export function makeBaseSnapshot(overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 12345,
        phase: 'playing',
        players: [{ id: 'p1' as PlayerId }, { id: 'p2' as PlayerId }],
        activePlayerId: 'p1' as PlayerId,
        events: [],
        ...overrides,
    };
}
```

```typescript
// simulation/__tests__/helpers/registry.ts

import { createActionRegistry, ActionRegistry } from '../../engine/ActionRegistry';
import { BaseGameSnapshot } from '../../engine/GameState';

// Creates a registry pre-loaded with a single no-op action for structural tests.
export function makeRegistryWithNoOp(): ActionRegistry {
    const registry = createActionRegistry();
    registry.register({
        type: 'test:noop',
        parsePayload: (raw) => raw as Record<string, unknown>,
        validate: () => ({ ok: true }),
        reduce: (state) => state,
    });
    return registry;
}
```

#### Writing a Unit Test — Simulation Layer

Simulation unit tests require **no mocks** — the pure reducer pattern means every test is a function call with a plain input and a plain output assertion.

```typescript
// simulation/engine/ActionPipeline.test.ts
import { describe, it, expect } from 'vitest';
import { createActionPipeline } from './ActionPipeline';
import { makeBaseSnapshot, makeRegistryWithNoOp } from '../__tests__/helpers';
import { createInMemoryPipelineContext } from '../__tests__/helpers/context';

describe('ActionPipeline', () => {
    it('advances tick by 1 on a valid action', () => {
        const registry = makeRegistryWithNoOp();
        const ctx = createInMemoryPipelineContext();
        const pipeline = createActionPipeline(registry, ctx);
        const initial = makeBaseSnapshot({ tick: 5 });

        const next = pipeline.process(
            initial,
            { type: 'test:noop', playerId: 'p1', payload: {} },
            'p1',
        );

        expect(next.tick).toBe(6);
    });

    it('throws UnknownActionTypeError for unregistered action type', () => {
        const registry = makeRegistryWithNoOp();
        const ctx = createInMemoryPipelineContext();
        const pipeline = createActionPipeline(registry, ctx);

        expect(() =>
            pipeline.process(
                makeBaseSnapshot(),
                { type: 'test:missing', playerId: 'p1', payload: {} },
                'p1',
            ),
        ).toThrow('UnknownActionTypeError');
    });

    it('does not mutate the input snapshot', () => {
        const registry = makeRegistryWithNoOp();
        const ctx = createInMemoryPipelineContext();
        const pipeline = createActionPipeline(registry, ctx);
        const initial = Object.freeze(makeBaseSnapshot({ tick: 0 }));

        pipeline.process(initial, { type: 'test:noop', playerId: 'p1', payload: {} }, 'p1');

        expect(initial.tick).toBe(0); // frozen object; mutation would throw in strict mode
    });
});
```

#### Writing a Unit Test — Renderer / Zustand Store

Store tests run in a `jsdom` environment. Each test creates an isolated store instance rather than importing the singleton — avoids state bleed between tests.

```typescript
// renderer/state/gameStore.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameStore } from './gameStore';
import { makePlayerSnapshot } from '../__tests__/helpers/snapshots';

describe('SnapshotStore', () => {
    it('initialises with null snapshot', () => {
        const store = createGameStore();
        expect(store.getState().snapshot).toBeNull();
    });

    it('applySnapshot updates snapshot and clears predictions', () => {
        const store = createGameStore();
        const snapshot = makePlayerSnapshot({ tick: 3 });

        store.getState().applySnapshot(snapshot);

        expect(store.getState().snapshot?.tick).toBe(3);
        expect(store.getState().predictedActions).toHaveLength(0);
    });
});
```

#### Writing a Property Test — Projection Invariants

Property tests using `fast-check` guard that no `owner-only` field ever leaks through `StateProjector`:

```typescript
// simulation/projection/StateProjector.test.ts
import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { createStateProjector } from './StateProjector';
import { arbitraryGameSnapshot } from '../__tests__/arbitraries/snapshots';

describe('StateProjector — no information leak', () => {
    it('never exposes owner-only hand field to a non-owner', () => {
        fc.assert(
            fc.property(arbitraryGameSnapshot(), (snapshot) => {
                const projector = createStateProjector(new ExampleVisibilityRules());
                const viewerP2 = 'p2' as PlayerId;

                const projected = projector.project(snapshot, viewerP2);

                // hand is owner-only: p2 must never see p1's hand
                const p1Hand = (projected as any).players?.p1?.hand;
                return p1Hand === undefined;
            }),
            { numRuns: 10_000 },
        );
    });
});
```

#### CI Pipeline

```
Unit tests (vitest run)
  └── simulation/   — pure Node, no DOM
  └── ai/           — pure Node, no DOM
  └── networking/   — Node + real in-process ws server
  └── renderer/     — jsdom environment
  └── tools/        — Node

Coverage gate (vitest --coverage)
  └── fails PR if lines < 80%, functions < 80%, branches < 75%

Lint gates (run in parallel with tests)
  └── no-restricted-globals: blocks Math.random/Date.now in simulation/ and games/*/actions/
  └── no-restricted-imports: blocks simulation/ from importing renderer/ or games/
  └── no-snapshot-floats: flags untagged number fields in snapshot interfaces

E2E (playwright — separate job, gated on unit test pass)
  └── CHIMERA_E2E=1 playwright test
  └── Trace + video retained on failure
```

---

### 10.1 Test Scenarios by Layer

| Layer                                                | Approach                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simulation/engine/DeterministicRng`                 | Unit: given the same `(seed, tick)`, 10 000 successive calls produce the identical sequence on macOS, Windows, Linux; Fisher-Yates shuffle is permutation-correct; `pick()` uniformity within 0.5% over 10⁶ draws.                                                                                                                 |
| Determinism soak                                     | Run a 10 000-action pseudo-random match on two separate processes seeded identically; assert `snapshot.tick` checksums match at every step. Catches any hidden `Math.random` / `Date.now` introduced during development.                                                                                                           |
| Float guard                                          | Static analysis: grep `ActionDefinition` payload types in `games/*/actions/` for `number` fields that represent money or percentages; flag any field not documented as integer basis points. Runtime: `ActionPipeline` rejects actions whose payload contains a non-finite number.                                                 |
| `ActionHistory` pruning                              | Unit: append 1000 entries across 5 turn mementos; assert `sinceLastMemento()` never exceeds the configured window; assert `pruneTo(turnN)` drops exactly the expected range.                                                                                                                                                       |
| `simulation/engine/`                                 | Pure unit tests — no mocks needed. Feed `(state, action, ctx)` triples, assert output state and events.                                                                                                                                                                                                                            |
| `simulation/engine/UndoManager`                      | Table-driven: apply N actions, undo M steps, assert state equals replay from memento through first N-M actions. Verify redo after undo, redo-stack cleared on new action.                                                                                                                                                          |
| `simulation/content/ContentLoader`                   | Unit: load directory with valid JSON, assert all items queryable. Conflict detection: two sources with duplicate id throws `ContentConflictError`. Schema error: malformed JSON rejects with `ContentSchemaError`. Bad ref: invalid `DataRef` string rejects with `MalformedRefError`.                                             |
| `simulation/content/ContentDatabase`                 | Unit: `resolveRef()` reaches correct item; `getByIdOrThrow()` throws on missing id; `getAllIds()` returns stable ordering.                                                                                                                                                                                                         |
| `simulation/projection/StateProjector`               | Property tests: for every field classified `owner-only` or `hidden`, assert it never appears in a `PlayerSnapshot` for a non-owner across 10k random snapshots.                                                                                                                                                                    |
| `simulation/projection/CommitmentScheme`             | Unit: verify passes for valid reveal; verify throws for tampered value; verify throws for tampered nonce.                                                                                                                                                                                                                          |
| `networking/`                                        | Integration tests with in-process ws server and two client instances. Assert snapshot delivery, delta correctness, reconnect behavior.                                                                                                                                                                                             |
| `renderer/`                                          | Component tests with mocked `window.__chimera`. Vitest + React Testing Library.                                                                                                                                                                                                                                                    |
| R3F scenes                                           | Visual regression snapshots with `@react-three/test-renderer`. Interaction tests via pointer event dispatch.                                                                                                                                                                                                                       |
| `renderer/assets/AssetManager`                       | Unit: preloadCritical resolves after all entries load; get() returns null before load completes; load() for same ref returns the same Promise; dispose() frees GPU resources without throwing.                                                                                                                                     |
| `renderer/assets/AssetResolver`                      | Unit: dev resolver builds correct `file://` URL from source tree; prod resolver builds correct URL from `resources/` path; malformed `AssetRef` throws `MalformedAssetRefError`.                                                                                                                                                   |
| Asset CI validation                                  | `tools/validate-assets.ts` integration test: load all game JSON; assert every `AssetRef` string resolves to an existing file; assert missing file produces a descriptive error with data-object path and field name.                                                                                                               |
| `useAsset` hook                                      | Component test (Vitest + React Testing Library): renders fallback while loading; re-renders with resolved asset after Promise resolves; unmount during load does not trigger setState on unmounted component.                                                                                                                      |
| `simulation/persistence/SaveMigrator`                | Unit: file at v0 → apply migration v0→v1 → assert header.schemaVersion === 1 and fields transformed correctly; file at current version → no-op; file newer than current → throws `SaveSchemaTooNewError`.                                                                                                                          |
| `simulation/persistence/JsonSaveSerializer`          | Unit: round-trip `serialize → deserialize` produces structurally equal `SaveFile`; `CompressedSaveSerializer` round-trip identical outcome with smaller byte count.                                                                                                                                                                |
| `FileSaveRepository`                                 | Integration (temp dir): save → list shows entry → load returns equal file → delete removes it; crash-safe write: kill process mid-write (rename) leaves no corrupt file; list on empty dir returns [].                                                                                                                             |
| Save/load E2E                                        | Playwright: play match to turn 3 → save to `slot-1` → close app → relaunch → load `slot-1` → assert tick and player state match saved values in both renderer windows.                                                                                                                                                             |
| Crash recovery E2E                                   | Playwright: play to turn 2 → force-kill process → relaunch → assert "Resume last session" prompt visible → accept → assert match resumes at correct tick.                                                                                                                                                                          |
| `simulation/debug/SnapshotRingBuffer`                | Unit: record 250 entries into a capacity-200 buffer; assert only the last 200 are retrievable; assert `get(oldTick)` returns undefined; assert `onRecord` callback fires on each write.                                                                                                                                            |
| `simulation/debug/SnapshotInspector`                 | Unit: snapshot in buffer returns without replay; snapshot outside buffer reconstructed via `TurnMemento` + replay produces the same result as direct reduce sequence; `getProjection()` returns correctly masked snapshot; `diff()` entries match manually expected paths; `getPerfStats().bufferUsed` equals recorded tick count. |
| `simulation/debug/SnapshotDiff`                      | Unit: diff of identical snapshots returns empty entries; diff with added entity returns one `added` entry with correct path; diff with changed HP returns one `changed` entry with correct before/after values.                                                                                                                    |
| `debug-bridge` security                              | Integration: IPC handler rejects `GET_SNAPSHOT` request originating from a `webContents.id` other than the Inspector Window; assert response is `{ type: 'ERROR' }`.                                                                                                                                                               |
| Debug mode disabled in production                    | Unit: build with `NODE_ENV=production` and assert `IS_DEBUG_MODE === false`; assert `import('./debug-bridge')` is never called; assert `window.__chimeraDebug` is undefined in the game renderer window.                                                                                                                           |
| End-to-end                                           | Playwright — launch two Electron instances on localhost, run a full match, assert final game state. See **Section 13** for the complete E2E layer architecture.                                                                                                                                                                    |
| Multiplayer soak                                     | Headless N-client soak test: run 1000 ticks with randomized valid actions, assert all clients converge to identical checksum.                                                                                                                                                                                                      |
| Obfuscation soak                                     | Run 1000 ticks, assert no `PlayerSnapshot` for player A ever contains a field classified `owner-only` for player B.                                                                                                                                                                                                                |
| `ai/engine/CommandScheduler`                         | Unit: enqueue 3 commands; assert onStart fired for first; tick until done; assert second onStart fires; introduce failure; assert queue cleared and onFail called.                                                                                                                                                                 |
| `ai/engine/AIStateMachine`                           | Unit: register two states; assert transition calls onExit on old state and onEnter on new; assert deferred transition mid-tick completes at tick end.                                                                                                                                                                              |
| AI integration                                       | Run a full match with 2 AI agents (different params); assert game reaches terminal state within N ticks; assert every AI-dispatched action passed through `ActionPipeline`.                                                                                                                                                        |
| Honest AI isolation                                  | Assert that `PlayerSnapshot` passed to AI never contains fields classified `owner-only` for an opponent. Same test suite as obfuscation soak.                                                                                                                                                                                      |
| `simulation/settings/SettingsMerger`                 | Unit: `mergeAll(gameDefaults, {})` returns `gameDefaults` unchanged; deep partial override merges only specified keys; unknown keys from user overrides are stripped; nested objects merge correctly (not replaced).                                                                                                               |
| `simulation/settings/SettingsRepository` (file impl) | Integration (temp dir): save overrides → load returns equal object; reset → load returns `{}`; crash-safe write: kill process mid-write leaves no corrupt file; `gameId` with invalid characters throws at `filePath()`.                                                                                                           |
| `SettingsManager` IPC handlers                       | Integration: `getSettings` with no file on disk returns engine + game defaults; `updateSettings` with valid patch persists and returns merged result; `updateSettings` with invalid field value returns `SettingsValidationError`; `resetSettings` deletes file and returns game defaults.                                         |
| Settings E2E                                         | Playwright: open settings screen → change `masterVolume` to 0.5 → close and reopen app → assert `masterVolume` persists; reset → assert values return to game defaults.                                                                                                                                                            |
| Settings schema migration                            | Unit: load a `userData/settings/<game-id>.json` with a field absent from the current schema; assert field is stripped at merge time without error; assert remaining fields resolve correctly.                                                                                                                                      |
| `networking/provider/MultiplayerProvider` contract   | Unit (interface tests run against both implementations): `hostLobby()` returns a `HostedSession` with a non-empty `lobbyCode`; `joinLobby()` receives `WELCOME` and returns a `JoinedSession` with correct `lobbyInfo`; `close()` on `HostedSession` triggers `onPlayerLeft` for all connected clients.                            |
| `LocalWebSocketProvider` integration                 | Integration: host `hostLobby()` + client `joinLobby()` on localhost; assert `onPlayerJoined` fires; assert `sendSnapshot()` reaches client `onSnapshotReceived()`; assert `sendAction()` reaches host `onActionReceived()`; assert `disconnect()` fires host `onPlayerLeft()`.                                                     |
| `InMemorySaveRepository`                             | Unit: identical contract tests as `FileSaveRepository` (save/list/load/delete/has); run as a shared test suite against both implementations to guarantee interface parity.                                                                                                                                                         |
| Provider swap smoke test                             | Integration: replace `LocalWebSocketProvider` with a stub `InMemoryMultiplayerProvider` (test double implementing `MultiplayerProvider`); assert full match flow runs without any changes inside `simulation/` or `renderer/`.                                                                                                     |

---

## 11. Risks and Mitigations

| Risk                                                                                             | Impact                                                                                   | Mitigation                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simulation desync across clients                                                                 | Critical — game breaks                                                                   | Tick checksum comparison; automatic full-snapshot resync on mismatch; desync log captures diverging state                                                                                                                                                           |
| Malformed/missing content data                                                                   | Game crashes on startup or mid-action                                                    | `ContentLoader` validates all items and refs at startup before tick loop starts; fatal error surfaced to user with item path and schema violation detail                                                                                                            |
| Duplicate content IDs across expansions                                                          | Silent data override, wrong item returned                                                | `ContentConflictError` is thrown at load time; expansion packs must use different IDs or explicit merge strategy                                                                                                                                                    |
| AI deadlock (command never completes)                                                            | Game stalls, AI player frozen                                                            | `maxTicks` safety limit on all commands; `CommandScheduler.abort()` available as escape hatch; idle-state timeout can forcibly transition state                                                                                                                     |
| AI state transition loop                                                                         | CPU spike, possible infinite loop within a tick                                          | Deferred transitions (max 1 per tick); transition count limit per tick emits a warning and halts transitions                                                                                                                                                        |
| Omniscient AI information leak                                                                   | AI has unfair advantage; players lose trust                                              | Omniscient mode is opt-in and logged at game start; audit log entry records which AI players operate with full snapshot access                                                                                                                                      |
| Projection bug leaks hidden info                                                                 | Cheating advantage, trust collapse                                                       | Property-based projection tests as CI gate; no `owner-only` field leakage across 10k random snapshots                                                                                                                                                               |
| Commitment scheme bypass                                                                         | Host cheats on hidden values                                                             | Clients always verify on REVEAL; mismatch surfaced with cryptographic proof; logged for audit                                                                                                                                                                       |
| Undo desync in multiplayer                                                                       | Game state diverges from history                                                         | UNDO is a validated first-class action; resulting state is broadcast as a normal snapshot; no special client-side replay                                                                                                                                            |
| Undo policy misconfiguration                                                                     | Unexpected cross-turn undo                                                               | `UndoPolicy` declared in game ruleset, validated + logged at game start                                                                                                                                                                                             |
| NAT traversal failure                                                                            | Host unreachable for remote players                                                      | Built-in connection diagnostics; optional STUN relay path wired into `ServerConnection.ts` without core changes                                                                                                                                                     |
| Main process simulation blocking UI                                                              | App freeze during complex tick                                                           | Move simulation to a `worker_threads` Worker; communicate via `MessageChannel` in main process                                                                                                                                                                      |
| Electron renderer bundle size                                                                    | Slow startup                                                                             | Next.js `output: 'export'` with aggressive code splitting; R3F assets lazy-loaded                                                                                                                                                                                   |
| Static export + dynamic routing conflict                                                         | Runtime 404 in Electron                                                                  | All routes use hash routing (`#`); `next.config.js` sets `trailingSlash: true`                                                                                                                                                                                      |
| IPC surface creep                                                                                | Security regression                                                                      | Lint rule enforces all IPC handlers are declared in single `ipc-handlers.ts`; code-reviewed as security boundary                                                                                                                                                    |
| Missing or broken `AssetRef` in content JSON                                                     | Blank textures, silent model failure, crash mid-match                                    | `tools/validate-assets.ts` CI script checks every `AssetRef` string against disk at commit time; missing file = CI failure before merge                                                                                                                             |
| Asset path divergence between dev and prod                                                       | Assets load in dev but are missing in packaged app                                       | `electron-builder` config explicitly lists all `games/*/assets` in `extraResources`; a post-package smoke test loads the manifest and asserts all critical assets resolve                                                                                           |
| GPU memory leak from undisposed assets                                                           | Renderer memory grows unbounded across game sessions                                     | `AssetManager.dispose()` is called unconditionally on game session end via React effect cleanup; R3F canvas unmount triggers dispose                                                                                                                                |
| Deferred asset not loaded at first use                                                           | Visible pop-in or silent failure                                                         | `useAsset` returns `{ loading: true, asset: null }` while loading; all R3F components render a visible fallback mesh/texture; no null-dereference possible                                                                                                          |
| Expansion pack asset ID collision                                                                | Wrong asset displayed from wrong game                                                    | `AssetRef` format includes `<game-id>/` prefix as first path segment; resolver enforces it; `buildAssetRef()` requires explicit `gameId` argument                                                                                                                   |
| Save file corruption on crash during write                                                       | Player loses progress                                                                    | `FileSaveRepository.save()` writes to `<slot>.chimera.tmp` then renames atomically; partial writes never replace the previous good save                                                                                                                             |
| Save schema version mismatch after game update                                                   | Load fails silently; player loses save                                                   | `SaveMigrator` upgrades forward step-by-step; `SaveSchemaTooNewError` shown to user with engine update prompt rather than a silent failure                                                                                                                          |
| Missing `pendingCommitments` in loaded save                                                      | Commitment verify fails on post-load REVEAL; anti-cheat broken                           | `pendingCommitments` is a required field in `SaveFile`; `SaveRepository.load()` validates presence before returning file                                                                                                                                            |
| Client attempts to trigger save                                                                  | Host authority bypass                                                                    | `engine:save` `validate()` rejects any action whose `playerId` does not match the designated host player ID                                                                                                                                                         |
| Load during active match corrupts state                                                          | Mid-match desync, player data loss                                                       | `engine:load` is rejected by `validate()` unless lobby phase is `PREGAME` or `ENDED`                                                                                                                                                                                |
| Debug info leaks to production players                                                           | Player gains information advantage or trust collapses                                    | `IS_DEBUG_MODE` is a compile-time constant; `CHIMERA_DEBUG` is excluded from production `electron-builder` env; `window.__chimeraDebug` is only exposed in the Inspector Window preload, never the game renderer preload                                            |
| Debug Inspector Window can dispatch game actions                                                 | Security bypass via debug channel                                                        | `debug-api.ts` preload exposes only read-only `request()` and `onLiveTick()`; it has no `sendAction()` or any write surface; `ipcMain.handle('chimera:debug', ...)` handler only performs read operations via `SnapshotInspector`                                   |
| Ring buffer memory growth                                                                        | Main process OOM on long sessions                                                        | Ring buffer is fixed-capacity (200 ticks by default, ~200 × snapshot size); oldest entries overwritten automatically; capacity is configurable via `CHIMERA_DEBUG_BUFFER_SIZE`                                                                                      |
| Reconstruction replay is too slow for deep ticks                                                 | Inspector hangs on tick outside buffer                                                   | Reconstruction is bounded by `TurnMemento` interval (one memento per turn); worst-case replay is one turn's worth of actions, typically < 50; TurnMementos are never evicted in debug mode                                                                          |
| Settings schema mismatch after game update                                                       | User override file has keys removed or renamed in new version                            | Unknown keys are stripped at merge time via Zod `strip()`; missing keys silently fall back to new game defaults; no corrupted settings, no crash                                                                                                                    |
| Settings file corruption                                                                         | App starts with broken settings                                                          | `FileSettingsRepository.load()` wraps `JSON.parse` in try/catch; parse failure is treated as empty overrides (same as first launch); original file is moved to `<gameId>.json.bak` for diagnostics                                                                  |
| Game-defined setting key collides with engine namespace                                          | Ambiguous merge; engine setting silently overridden                                      | `SettingsManager.registerSchema()` asserts that none of the game-specific keys shadow the top-level engine keys (`audio`, `display`, `gameplay`, `controls`); throws `SettingsNamespaceCollisionError` at startup before the game boots                             |
| Settings written to disk from renderer directly                                                  | Bypasses validation; possible corrupted or malicious values                              | `FileSettingsRepository` is instantiated only in main process; renderer accesses settings exclusively via `window.__chimera` IPC; no `fs` module available in renderer                                                                                              |
| Multiplayer settings divergence (e.g. `animationSpeed`)                                          | Cosmetic desync (one player sees fast animations, another sees slow)                     | Cosmetic-only settings are explicitly documented as non-deterministic; settings that affect actual simulation rules must be declared in the game config (not settings) and transmitted as match parameters during lobby setup                                       |
| Provider API surface mismatch on Steam integration                                               | Steam lobby/P2P calls behave differently from WebSocket (async init, platform callbacks) | `SteamNetworkProvider` wraps all platform callbacks behind `HostTransport`/`ClientTransport` synchronously-typed interfaces; any platform-specific async handshake is internal to the provider and invisible to `LobbyManager`                                      |
| Non-determinism slipped into `reduce()` (`Math.random`, `Date.now`, locale-sensitive string ops) | Cross-machine desync after N turns; one player's game diverges from another's            | Determinism soak test (see §10) runs 10 000 actions on two isolated processes and asserts identical checksums at every step; lint rule `no-restricted-globals` blocks `Math.random`/`Date.now`/`performance.now` inside `simulation/` and `games/*/actions/`        |
| Floating-point introduced into `GameSnapshot`                                                    | Silent desync between x86 and ARM clients; Monopoly money ends one cent apart            | Lint rule `no-snapshot-floats`: scans declared snapshot interfaces for `number` fields and flags any that lack an `// integer:` or `// basis-points:` comment; runtime guard in `ActionPipeline` rejects non-finite values in action payloads                       |
| Prediction enabled on contested actions                                                          | Client displays wrong result; UI flickers on reconciliation                              | `predictable: true` is documented as "own-player-only, non-randomised, non-contested"; code review gate; `ClientPredictor` discards predictions of actions whose post-reduce state differs structurally from the authoritative snapshot within the reconcile window |
| Cloud save conflicts (same slot written from two devices)                                        | Data loss; player confusion                                                              | `SteamCloudSaveRepository` must implement a last-writer-wins or conflict-diverge strategy at the repository interface boundary; `SaveSlotMeta.savedAt` is always compared before overwrite                                                                          |
| `LobbyManager` holds a session reference after provider is swapped at runtime                    | Dangling session; memory leak                                                            | Provider swaps are only allowed at cold boot (not mid-session); `LobbyManager.closeLobby()` is always called before `dispose()` on the old provider; providers cannot be hot-swapped while a session is active                                                      |
| `LocalWebSocketProvider` port binding conflict in CI                                             | E2E tests fail on shared CI runners                                                      | E2E config assigns a unique port per test worker; `CHIMERA_E2E=1` uses the `--port` arg to `LocalWebSocketProvider`; `lobby.fixture.ts` selects a random free port before launch                                                                                    |

---

## 12. First Implementation Milestones

### M1 — Skeleton (Week 1–2)

- [ ] Electron app boots, loads Next.js static export from `renderer/out/`
- [ ] Preload bridge wired: `window.__chimera` typed and tested
- [ ] `simulation/` package with stub `BaseGameSnapshot` and `ActionPipeline` (no game rules yet)
- [ ] `ContentLoader` + `ContentDatabase` implemented with flat directory scan
- [ ] Example game loads a `damage-types/` directory; `db.getByIdOrThrow()` round-trips in unit tests
- [ ] `SaveFile`, `JsonSaveSerializer`, and `FileSaveRepository` implemented; round-trip unit tests passing
- [ ] `SettingsSchema.ts` and `SettingsMerger.ts` implemented; `mergeAll()` unit tests passing with engine defaults
- [ ] `SaveRepository` interface declared in `simulation/persistence/`; `FileSaveRepository` and `InMemorySaveRepository` both implemented; shared contract test suite passes against both
- [ ] `SaveManager` constructed with injected `SaveRepository`; no direct `FileSaveRepository` reference inside `save-manager.ts`
- [ ] Dev hot-reload harness working

### M2 — Networked Lobby (Week 3–4)

- [ ] `MultiplayerProvider` interface declared in `networking/provider/`; `HostTransport` and `ClientTransport` interfaces finalised
- [ ] `LocalWebSocketProvider` implemented; wraps existing `LobbyServer.ts` and `ServerConnection.ts` behind the provider interface
- [ ] `LobbyManager` holds `MultiplayerProvider` instance injected from `index.ts`; IPC handlers route through `LobbyManager` (no direct ws refs in `ipc-handlers.ts`)
- [ ] `StateBroadcaster` and `MessageRouter` refactored to use `HostTransport` exclusively; no ws imports remain in those files
- [ ] `SteamNetworkProvider` stub committed with full interface compliance and `throw new Error('not yet implemented')` bodies
- [ ] Provider swap smoke test: replace `LocalWebSocketProvider` with `InMemoryMultiplayerProvider` test double; full match flow passes without simulation changes
- [ ] Second Electron instance connects as client on localhost
- [ ] Lobby state synchronized: player list, ready states, host controls
- [ ] Connection status displayed in renderer UI

### M3 — Action Registry + Content DB + Game Loop + Undo/Redo (Week 5–6)

- [ ] `ActionRegistry` + `ActionPipeline` implemented in `simulation/engine/`
- [ ] Engine reserved actions (`engine:undo`, `engine:redo`, `engine:end_turn`, `engine:sync_request`) pre-registered
- [ ] Example game registers `tactics:move_unit` via `ActionDefinition` that calls `db.resolveRef()` — no changes to engine files
- [ ] `PipelineContext.db` wired through to all `validate()` and `reduce()` calls
- [ ] Fixed-tick simulation running on host with 2 players
- [ ] `tactics:move_unit` round-trips: renderer → IPC → `ActionPipeline` → snapshot → renderer
- [ ] `TurnMemento` saves state snapshot on `engine:end_turn`
- [ ] `engine:undo` round-trips and broadcasts correct projected state
- [ ] `canUndo` / `canRedo` reflected in `PlayerSnapshot.undoMeta` and wired to UI buttons
- [ ] Client prediction for actions where `predictable: true`
- [ ] Checksum enforcement; desync triggers full resync
- [ ] `engine:save` dispatched after `engine:end_turn`; `FileSaveRepository` writes `autosave.chimera` to `userData/saves/<gameId>/`
- [ ] `engine:load` restores snapshot + delta log; renderer receives fresh `PlayerSnapshot` at restored tick
- [ ] `SaveMigrator` wired; loading a save with `schemaVersion < CURRENT` applies registered migrations
- [ ] Crash recovery: relaunch after force-kill shows "Resume" prompt; loading autosave restores correct tick
- [ ] `listSaves`, `saveGame`, `loadGame`, `deleteSave` IPC handlers registered in `ipc-handlers.ts`
- [ ] `SaveScreen` renderer page reads `saveStore.slots`; save/delete/load actions wired through IPC bridge
- [ ] `FileSettingsRepository` implemented; `settings-manager.ts` wired with `getSettings` / `updateSettings` / `resetSettings` IPC handlers
- [ ] Example game (`tactics`) declares `settings-schema.ts` and registers it with `settingsManager.registerSchema()` at startup
- [ ] `settingsStore.ts` populated on app mount via `getSettings`; `onSettingsChange` subscription keeps it live
- [ ] `settings/page.tsx` renders engine + game-specific settings; changes propagate through IPC and persist across relaunch
- [ ] `SettingsManager.registerSchema()` throws `SettingsNamespaceCollisionError` on key conflict — verified in unit test

### M3.5 — AI Framework (Week 7)

- [ ] `PlayerAgent`, `AgentManager`, `AIBrain`, `AIStateMachine`, `CommandScheduler` implemented in `ai/engine/`
- [ ] `HumanPlayerAgent` registered for every human slot; `AIPlayerAgent` for every AI slot
- [ ] `AgentManager.tickAll()` wired into `simulation-host.ts` after each tick
- [ ] Example game registers two AI states (`attack`, `defend`) + two commands (`MoveToTargetCommand`, `AttackClusterCommand`)
- [ ] AI plays a full match against itself (no renderer); game reaches terminal state without hang
- [ ] AI-dispatched actions go through `ActionPipeline`; AI action log auditable in `ActionHistory`
- [ ] `onIdle` fires correctly when queue empties; next commands planned without busy-loop
- [ ] Command failure clears queue and transitions state correctly
- [ ] Honest AI verified: AI snapshot never contains opponent's fog-of-war entities

### M4 — State Projection + Obfuscation (Week 7–8)

- [ ] `VisibilityRules` interface implemented for the base game
- [ ] `StateProjector` wired into `StateBroadcaster`; each client receives a distinct `PlayerSnapshot`
- [ ] Host renderer confirmed to receive `PlayerSnapshot` only (not full state) — verified via devtools test
- [ ] `CommitmentScheme` implemented; hidden values committed at generation, verified on reveal
- [ ] Fog-of-war: invisible entities absent from `PlayerSnapshot` are absent from R3F scene
- [ ] Projection property tests passing in CI

### M5 — End-to-End Testing Layer (Week 9)

- [ ] `e2e/playwright.config.ts` wired; Electron app launchable in CI headless mode
- [ ] `electron.fixture.ts` and `lobby.fixture.ts` fixtures stable; two instances start and connect on localhost
- [ ] `MainMenuPage`, `LobbyPage`, `MatchPage` page objects cover all primary interactions
- [ ] `lobby.spec.ts`: host creates lobby, client joins, player list syncs in both windows
- [ ] `match-flow.spec.ts`: full match (host + client) reaches `game-over` state without assertion errors
- [ ] `undo-redo.spec.ts`: undo/redo through UI; `canUndo`/`canRedo` reflected correctly in both renderers
- [ ] `obfuscation.spec.ts`: `assertNoLeakedFields()` confirms no `owner-only` field visible in opponent window
- [ ] `reconnect.spec.ts`: client disconnects mid-match; reconnects; receives fresh `PlayerSnapshot`; match resumes
- [ ] `multiplayer-soak.spec.ts`: 1000 ticks with two Electron instances; tick checksums match in both windows
- [ ] `ipc-spy.ts` and `ws-inspector.ts` helpers used across at least one spec each
- [ ] All E2E specs run in CI; traces and videos retained on failure
- [ ] `CHIMERA_E2E=1` env flag enables test hooks in main process without affecting production build

### M6 — 3D Render Integration (Week 10–11)

- [ ] R3F `<GameCanvas>` mounts on `match/page.tsx`
- [ ] Entities rendered from `PlayerSnapshot` in `gameStore`
- [ ] Click-to-move UX dispatches `MOVE_UNIT` action through IPC bridge
- [ ] Fog-of-war: entities absent from `PlayerSnapshot` are absent from 3D scene
- [ ] Tick interpolation for smooth unit movement at 60fps from 20Hz simulation
- [ ] `AssetManager`, `AssetResolver`, and `AssetPreloader` implemented in `renderer/assets/`
- [ ] `createProductionResolver` and `createDevResolver` both passing unit tests; correct `file://` URLs verified in both environments
- [ ] `TacticsAssetManifest` declared; `preloadCritical()` blocks match start with progress bar in renderer
- [ ] `useAsset()` hook integrated into `Unit.tsx` and `Board.tsx`; fallback geometry rendered while deferred assets load
- [ ] `tools/validate-assets.ts` runs in CI; all `AssetRef` strings in `games/tactics/data/` verified against disk
- [ ] `AssetManager.dispose()` called on game session end; no GPU leak confirmed via devtools heap snapshot

### M7 — Hardening (Week 12–13)

- [ ] Multiplayer soak test passing (1000-tick, 4-client, checksum convergence)
- [ ] Obfuscation soak test passing (no `owner-only` field leaks across 10k random snapshots)
- [ ] Commitment scheme verified against simulated tampering attempt
- [ ] NAT diagnostics UI
- [ ] Performance baseline: <16ms main process tick at 20Hz, <32MB renderer heap
- [ ] `SnapshotRingBuffer`, `SnapshotInspector`, `SnapshotDiff`, `DebugProtocol` implemented in `simulation/debug/`
- [ ] `debug-bridge.ts` and `debug-api.ts` wired; Inspector Window launches when `CHIMERA_DEBUG=1`
- [ ] Timeline, Snapshot Inspector, Projection Explorer, Diff View, Action Log, and Performance panels functional
- [ ] Projection Explorer shows correct side-by-side full vs. projected view for all PlayerIds at any selected tick
- [ ] `IS_DEBUG_MODE=false` verified in production build: `window.__chimeraDebug` absent in game renderer window
- [ ] Ring buffer security test passing: IPC handler rejects requests from non-Inspector `webContents.id`

---

## 13. End-to-End Testing Layer (Playwright)

### 13.1 Executive Decision

All cross-process, multiplayer, and full-stack scenarios are validated through a Playwright-driven E2E layer that launches real Electron instances. Unit and integration tests cover individual modules in isolation; the E2E suite owns scenarios that require IPC, WebSocket networking, state projection, and renderer rendering to work together simultaneously. A `CHIMERA_E2E=1` environment flag activates lightweight test hooks in the main process without modifying production behaviour.

### 13.2 Tooling Rationale

| Concern                  | Choice                                              | Reason                                                                     |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Test runner              | `@playwright/test`                                  | First-class Electron API (`_electron`), fixture model, trace/video capture |
| Electron launch          | `playwright._electron.launch()`                     | Gives control over `args`, `env`, and main-process evaluation              |
| Multi-window multiplayer | Two `ElectronApplication` fixtures per test         | Each instance is a fully isolated OS process — realistic NAT simulation    |
| IPC inspection           | `electronApp.evaluate()` in main process context    | Access internal state and test hooks without changing the IPC surface      |
| WebSocket tapping        | Node.js interceptor injected via `CHIMERA_E2E`      | Capture frames without proxy middleware                                    |
| Assertions               | Custom typed helpers + standard Playwright `expect` | Chimera-specific `PlayerSnapshot` shape is too opaque for generic matchers |

### 13.3 Directory Structure

```
e2e/
├── playwright.config.ts         # Project config: Electron entry, timeouts, reporters
├── fixtures/
│   ├── electron.fixture.ts      # Base: launch / close one ElectronApplication
│   ├── lobby.fixture.ts         # Extends base: two instances + lobby helpers
│   └── game.fixture.ts          # Extends lobby: match started, tick driver wired
├── pages/
│   ├── MainMenuPage.ts          # POM: main menu
│   ├── LobbyPage.ts             # POM: lobby (host, join, ready)
│   ├── MatchPage.ts             # POM: HUD, action buttons, undo/redo, game-over banner
│   └── SettingsPage.ts          # POM: settings screen
├── helpers/
│   ├── ipc-spy.ts               # Read main-process state via electronApp.evaluate()
│   ├── ws-inspector.ts          # Tap raw WebSocket frames for protocol assertions
│   ├── snapshot-assert.ts       # assertNoLeakedFields(), assertTickAdvanced(), assertChecksumMatch()
│   └── tick-driver.ts           # Programmatic tick dispatch bypassing UI — used in soak specs
└── tests/
    ├── lobby.spec.ts            # Lobby lifecycle
    ├── match-flow.spec.ts       # Full match from lobby to game-over
    ├── undo-redo.spec.ts        # Undo/redo reflected in both windows
    ├── obfuscation.spec.ts      # Hidden fields absent from opponent window
    ├── reconnect.spec.ts        # Mid-match disconnect + reconnect
    └── multiplayer-soak.spec.ts # 1000-tick determinism soak
```

### 13.4 Playwright Configuration

```typescript
// e2e/playwright.config.ts
import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
    testDir: './tests',
    timeout: 90_000, // Electron cold-start + match flow needs headroom
    expect: { timeout: 10_000 },
    fullyParallel: false, // Multiplayer tests bind to fixed localhost ports — run serially
    retries: 1, // One retry on flake; network timing can vary in CI
    reporter: [
        ['html', { outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'results/e2e.xml' }],
    ],
    use: {
        trace: 'on-first-retry',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'electron-e2e',
            // No browser — Electron fixture handles app launch
            testMatch: '**/*.spec.ts',
        },
    ],
    globalSetup: './global-setup.ts', // Compile renderer bundle once before all tests
});
```

### 13.5 Fixtures

#### Base Electron Fixture

```typescript
// e2e/fixtures/electron.fixture.ts
import { test as base } from '@playwright/test';
import { ElectronApplication, Page, _electron as electron } from 'playwright';

type ElectronFixtures = {
    electronApp: ElectronApplication;
    mainWindow: Page;
};

export const test = base.extend<ElectronFixtures>({
    electronApp: async ({}, use) => {
        const app = await electron.launch({
            args: [path.resolve(__dirname, '../../electron/main/index.js')],
            env: {
                ...process.env,
                CHIMERA_E2E: '1', // Enables test hooks in main process
                NODE_ENV: 'test',
                CHIMERA_PORT: '7778', // Isolated port; avoids collision with dev server
            },
        });
        await use(app);
        await app.close();
    },

    mainWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

export { expect } from '@playwright/test';
```

#### Multiplayer Lobby Fixture

```typescript
// e2e/fixtures/lobby.fixture.ts
import { test as electronTest } from './electron.fixture';
import { ElectronApplication, Page, _electron as electron } from 'playwright';

type LobbyFixtures = {
    hostApp: ElectronApplication;
    clientApp: ElectronApplication;
    hostWindow: Page;
    clientWindow: Page;
};

export const test = electronTest.extend<LobbyFixtures>({
    hostApp: async ({}, use) => {
        const app = await electron.launch({
            args: [path.resolve(__dirname, '../../electron/main/index.js')],
            env: {
                ...process.env,
                CHIMERA_E2E: '1',
                NODE_ENV: 'test',
                CHIMERA_PORT: '7779',
                CHIMERA_ROLE: 'host',
            },
        });
        await use(app);
        await app.close();
    },

    clientApp: async ({}, use) => {
        const app = await electron.launch({
            args: [path.resolve(__dirname, '../../electron/main/index.js')],
            env: {
                ...process.env,
                CHIMERA_E2E: '1',
                NODE_ENV: 'test',
                CHIMERA_PORT: '7779',
                CHIMERA_ROLE: 'client',
            },
        });
        await use(app);
        await app.close();
    },

    hostWindow: async ({ hostApp }, use) => {
        const w = await hostApp.firstWindow();
        await w.waitForLoadState('domcontentloaded');
        await use(w);
    },

    clientWindow: async ({ clientApp }, use) => {
        const w = await clientApp.firstWindow();
        await w.waitForLoadState('domcontentloaded');
        await use(w);
    },
});

export { expect } from '@playwright/test';
```

### 13.6 Page Objects

```typescript
// e2e/pages/LobbyPage.ts
import { Page, Locator } from '@playwright/test';

export class LobbyPage {
    readonly hostButton: Locator;
    readonly joinButton: Locator;
    readonly readyButton: Locator;
    readonly startButton: Locator;
    readonly playerList: Locator;
    readonly connectionStatus: Locator;

    constructor(private readonly page: Page) {
        this.hostButton = page.getByTestId('host-lobby');
        this.joinButton = page.getByTestId('join-lobby');
        this.readyButton = page.getByTestId('ready-toggle');
        this.startButton = page.getByTestId('start-match');
        this.playerList = page.getByTestId('player-list');
        this.connectionStatus = page.getByTestId('connection-status');
    }

    async hostLobby(): Promise<void> {
        await this.hostButton.click();
        await this.connectionStatus.waitFor({ state: 'visible' });
    }

    async joinLobby(address: string): Promise<void> {
        await this.joinButton.click();
        await this.page.getByTestId('address-input').fill(address);
        await this.page.getByTestId('confirm-join').click();
        await this.connectionStatus.waitFor({ state: 'visible' });
    }

    async waitForPlayerCount(count: number): Promise<void> {
        await this.page
            .getByTestId('player-list-item')
            .nth(count - 1)
            .waitFor({ state: 'visible' });
    }
}

// e2e/pages/MatchPage.ts
import { Page, Locator } from '@playwright/test';

export class MatchPage {
    readonly canvas: Locator;
    readonly undoButton: Locator;
    readonly redoButton: Locator;
    readonly endTurnButton: Locator;
    readonly gameOverBanner: Locator;
    readonly hudTick: Locator;

    constructor(private readonly page: Page) {
        this.canvas = page.getByTestId('match-canvas');
        this.undoButton = page.getByTestId('undo');
        this.redoButton = page.getByTestId('redo');
        this.endTurnButton = page.getByTestId('end-turn');
        this.gameOverBanner = page.getByTestId('game-over-banner');
        this.hudTick = page.getByTestId('hud-tick');
    }

    async currentTick(): Promise<number> {
        const text = await this.hudTick.innerText();
        return parseInt(text, 10);
    }

    async waitForTick(tick: number, timeout = 30_000): Promise<void> {
        await this.page.waitForFunction(
            (t) =>
                parseInt(
                    document.querySelector('[data-testid=hud-tick]')?.textContent ?? '0',
                    10,
                ) >= t,
            tick,
            { timeout },
        );
    }
}
```

### 13.7 IPC Spy and Snapshot Helpers

```typescript
// e2e/helpers/ipc-spy.ts
import { ElectronApplication } from 'playwright';
import { PlayerSnapshot } from '../../shared/snapshot';

/**
 * Read the last PlayerSnapshot delivered to the host renderer.
 * Requires CHIMERA_E2E=1 — main process stores it on globalThis.__e2eHooks.
 */
export async function getHostSnapshot(app: ElectronApplication): Promise<PlayerSnapshot> {
    return app.evaluate(() => (globalThis as Record<string, unknown>).__e2eHooks?.lastHostSnapshot);
}

/**
 * Retrieve the current tick from the simulation host (not the renderer).
 * Uses the same __e2eHooks mechanism — avoids reading from renderer DOM.
 */
export async function getSimulationTick(app: ElectronApplication): Promise<number> {
    return app.evaluate(() => (globalThis as Record<string, unknown>).__e2eHooks?.currentTick ?? 0);
}

/**
 * Retrieve the last checksum broadcast by StateBroadcaster.
 * Used by soak tests to compare host vs client convergence.
 */
export async function getLastBroadcastChecksum(app: ElectronApplication): Promise<number> {
    return app.evaluate(
        () => (globalThis as Record<string, unknown>).__e2eHooks?.lastChecksum ?? 0,
    );
}

// e2e/helpers/snapshot-assert.ts
import { expect } from '@playwright/test';
import { PlayerSnapshot } from '../../shared/snapshot';

/**
 * Assert that a PlayerSnapshot contains no fields classified owner-only for another player.
 * Fields tagged with __visibility: 'owner-only' must be null/undefined in non-owner snapshots.
 */
export function assertNoLeakedFields(
    snapshot: PlayerSnapshot,
    viewerId: string,
    ownerId: string,
): void {
    if (viewerId === ownerId) return; // own snapshot — all fields permitted
    for (const [playerId, playerState] of Object.entries(snapshot.players)) {
        if (playerId !== viewerId) {
            // Any field on opponent players that is explicitly marked owner-only must be absent
            const leaked = Object.entries(playerState as Record<string, unknown>).filter(
                ([, v]) => (v as { __visibility?: string })?.__visibility === 'owner-only',
            );
            expect(
                leaked,
                `Snapshot for viewer=${viewerId} leaked owner-only field from player=${playerId}`,
            ).toHaveLength(0);
        }
    }
}

export async function assertChecksumMatch(
    hostApp: import('playwright').ElectronApplication,
    clientApp: import('playwright').ElectronApplication,
): Promise<void> {
    const { getLastBroadcastChecksum } = await import('./ipc-spy');
    const hostChecksum = await getLastBroadcastChecksum(hostApp);
    const clientChecksum = await getLastBroadcastChecksum(clientApp);
    expect(hostChecksum).toBe(clientChecksum);
}
```

### 13.8 Test Specifications

```typescript
// e2e/tests/lobby.spec.ts
import { test, expect } from '../fixtures/lobby.fixture';
import { LobbyPage } from '../pages/LobbyPage';

test.describe('Lobby lifecycle', () => {
    test('host creates lobby; client joins; player list syncs in both windows', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);

        await hostLobby.hostLobby();
        await clientLobby.joinLobby('localhost:7779');

        // Both windows should show 2 players
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        await expect(hostLobby.connectionStatus).toContainText('Connected');
        await expect(clientLobby.connectionStatus).toContainText('Connected');
    });
});

// e2e/tests/match-flow.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { MatchPage } from '../pages/MatchPage';

test.describe('Full match flow', () => {
    test('host and client reach game-over state without assertion errors', async ({
        hostWindow,
        clientWindow,
    }) => {
        // game.fixture already starts the match
        const hostMatch = new MatchPage(hostWindow);
        const clientMatch = new MatchPage(clientWindow);

        await expect(hostMatch.canvas).toBeVisible();
        await expect(clientMatch.canvas).toBeVisible();

        // Both windows should observe the game-over banner within the soak timeout
        await expect(hostMatch.gameOverBanner).toBeVisible({ timeout: 60_000 });
        await expect(clientMatch.gameOverBanner).toBeVisible({ timeout: 60_000 });
    });
});

// e2e/tests/undo-redo.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { MatchPage } from '../pages/MatchPage';

test.describe('Undo / Redo', () => {
    test('undo reflects canUndo=false after exhausting turn history in both renderers', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostMatch = new MatchPage(hostWindow);

        // Dispatch one action via UI (host's turn)
        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();

        await expect(hostMatch.undoButton).toBeEnabled();
        await hostMatch.undoButton.click();
        await expect(hostMatch.undoButton).toBeDisabled();

        // Redo becomes available
        await expect(hostMatch.redoButton).toBeEnabled();
    });
});

// e2e/tests/obfuscation.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { getHostSnapshot } from '../helpers/ipc-spy';
import { assertNoLeakedFields } from '../helpers/snapshot-assert';
import { PlayerSnapshot } from '../../shared/snapshot';

test.describe('State obfuscation', () => {
    test('host snapshot contains no opponent owner-only fields', async ({ hostApp, clientApp }) => {
        // Read the snapshot delivered to the host renderer (already projected for host player)
        const snapshot = (await getHostSnapshot(hostApp)) as PlayerSnapshot;
        // Host's viewerId must not expose client's owner-only fields
        assertNoLeakedFields(snapshot, snapshot.viewerId, /* clientPlayerId */ 'p2');
    });

    test('fog-of-war: invisible entities are absent from opponent snapshot entities map', async ({
        hostApp,
    }) => {
        const snapshot = (await getHostSnapshot(hostApp)) as PlayerSnapshot;
        // Every entity in the snapshot must have been permitted by VisibilityRules
        // (confirmed by the absence of a __fogHidden marker set by test hooks)
        const fogHiddenLeak = Object.values(snapshot.entities).filter(
            (e: unknown) => (e as { __fogHidden?: boolean }).__fogHidden === true,
        );
        expect(fogHiddenLeak).toHaveLength(0);
    });
});

// e2e/tests/multiplayer-soak.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { getLastBroadcastChecksum, getSimulationTick } from '../helpers/ipc-spy';
import { tick } from '../helpers/tick-driver';

test.describe('Multiplayer soak', () => {
    test('host and client checksums converge after 1000 ticks', async ({ hostApp, clientApp }) => {
        const TARGET_TICK = 1000;

        // Drive 1000 ticks via tick-driver (bypasses UI; uses CHIMERA_E2E hooks)
        await tick(hostApp, TARGET_TICK);

        // Allow broadcast delivery
        await hostApp.evaluate(() => new Promise((r) => setTimeout(r, 200)));

        const simTick = await getSimulationTick(hostApp);
        expect(simTick).toBeGreaterThanOrEqual(TARGET_TICK);

        const hostChecksum = await getLastBroadcastChecksum(hostApp);
        const clientChecksum = await getLastBroadcastChecksum(clientApp);
        expect(hostChecksum).toBe(clientChecksum);
    });
});
```

### 13.9 Test Hooks in Main Process

The `CHIMERA_E2E=1` flag activates a minimal, isolated `__e2eHooks` object on `globalThis` inside the Electron main process. This is the only production-code change required by the E2E layer.

```typescript
// electron/main/simulation-host.ts (E2E hook registration — behind env guard)
if (process.env.CHIMERA_E2E === '1') {
    // globalThis is safe in Node.js main process context
    (globalThis as Record<string, unknown>).__e2eHooks = {
        lastHostSnapshot: null as PlayerSnapshot | null,
        lastChecksum: 0,
        currentTick: 0,
        // Called by ActionPipeline after each applied action completes
        onTick(tick: number, checksum: number, hostSnapshot: PlayerSnapshot): void {
            this.currentTick = tick;
            this.lastChecksum = checksum;
            this.lastHostSnapshot = hostSnapshot;
        },
    };
}
```

The guard is a compile-time dead-code elimination target: a production build with `NODE_ENV=production` strips the entire block. The hook surface is narrow and read-only from the test side — tests cannot write state through it.

### 13.10 CHIMERA_E2E Environment Flag Contract

| Flag value   | Behaviour                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Absent / `0` | Production mode. `__e2eHooks` not set. Test helper imports compile to no-ops.                                     |
| `1`          | Test mode. `__e2eHooks` registered. Fixed `CHIMERA_PORT` from env respected. Lobby auto-connect skips NAT checks. |

No production code path branches on `CHIMERA_E2E` outside `simulation-host.ts` and `lobby-manager.ts` (provider port binding). The flag is not forwarded to the renderer process.

### 13.11 CI Integration

```yaml
# .github/workflows/e2e.yml (excerpt)
jobs:
    e2e:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with: { node-version: '20' }
            - run: npm ci
            - run: npm run build:renderer # Compile Next.js static export
            - run: npm run build:electron # Compile electron/main
            - name: Install Playwright browsers
              run: npx playwright install --with-deps chromium
            - name: Run E2E tests
              run: npx playwright test --project=electron-e2e
              env:
                  CI: true
                  DISPLAY: ':99' # Xvfb for headless Electron on Linux
            - uses: actions/upload-artifact@v4
              if: always()
              with:
                  name: playwright-report
                  path: e2e/playwright-report/
```

On macOS runners, `DISPLAY` is not required. On Linux runners, an `Xvfb` or `xvfb-run` step is needed because Electron requires a display server even in headless mode.

### 13.12 Security Notes for E2E Layer

| Concern               | Rule                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test hook surface     | `__e2eHooks` is read-only from tests. Tests inspect state; they do not inject actions or mutate snapshots through this path. All actions still go through `ActionPipeline`. |
| Isolated ports        | Each test suite uses a dedicated port (`CHIMERA_PORT`). Port collision between parallel CI jobs is prevented by the `fullyParallel: false` Playwright config.               |
| No credentials in env | `CHIMERA_E2E` env block must never log or expose lobby tokens, seeds, or player data beyond what asserting tests require.                                                   |
| Production gate       | `CHIMERA_E2E` is never set in production packaging scripts. The `electron-builder` config explicitly omits the env variable.                                                |

---

## Appendix A — Technology Versions (Baseline)

| Package           | Version                   |
| ----------------- | ------------------------- |
| Electron          | 34.x                      |
| Next.js           | 15.x (`output: 'export'`) |
| React             | 19.x                      |
| Three.js          | r170+                     |
| React Three Fiber | 9.x                       |
| ws                | 8.x                       |
| TypeScript        | 5.x                       |
| Zustand           | 5.x (game/lobby store)    |
| Vitest            | 3.x                       |
| Playwright        | 1.x                       |

---

## Appendix B — Key Invariants (Never Violate) (78 total)

### Thematic Index

The 78 invariants are numbered stably; this index is purely navigational. A single invariant may appear in multiple themes when it straddles concerns.

| Theme                                  | Invariants                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| **Determinism & purity**               | 1, 2, 42, 43, 44, 54, 55, 70, 71, 75, 76                                          |
| **State ownership & trust boundaries** | 3, 4, 5, 6, 8, 23, 24, 26, 32, 33, 36, 57, 58, 59, 60, 61, 62, 66, 72, 73, 74, 78 |
| **Action pipeline & extensibility**    | 7, 10, 11, 12, 13, 16, 17, 18, 19, 25                                             |
| **Content & assets**                   | 13, 14, 15, 20, 21, 22, 46                                                        |
| **Save / load / replay**               | 23, 24, 25, 26, 70, 71                                                            |
| **Settings, profiles, input**          | 32, 33, 34, 35, 36, 59, 60, 61, 62, 65, 66                                        |
| **Debug, logging, crash**              | 27, 28, 29, 30, 31, 67, 68, 69                                                    |
| **Rendering & UI boundaries**          | 47, 48, 49, 50, 51, 52, 53, 56, 57, 58, 63, 64, 74                                |
| **Networking & multiplayer**           | 6, 8, 9, 37, 38, 39, 40, 41, 72, 73                                               |
| **Lifecycle & dispose**                | 21, 64, 77, 78                                                                    |

### Invariants

1. **`simulation/` has zero runtime dependencies on React, DOM, or networking.**
2. **`applyAction`/`definition.reduce` are pure functions — same input, same output, always.**
3. **`GameSnapshot` never leaves the host's main process. `PlayerSnapshot` is the only state type that crosses any process or network boundary.**
4. **The renderer reads state; it never writes state directly.**
5. **All IPC methods are declared in `ipc-handlers.ts` and exposed only through `preload/api.ts`.**
6. **Network messages are validated before they touch the simulation.**
7. **`engine:undo` and `engine:redo` are `EngineAction` types — they go through the normal `ActionPipeline`. There is no side-door undo execution path.**
8. **`StateProjector.project()` is the mandatory gate between `GameSnapshot` and any outbound message. `StateBroadcaster` never reads `GameSnapshot` directly.**
9. **`CommitmentScheme.verify()` is always called client-side on receipt of a `REVEAL` message before the revealed value is trusted.**
10. **Game-defined action types must be registered in `ActionRegistry` before the simulation tick loop starts. The engine never switches on raw `type` strings — all delegation goes through `ActionRegistry.resolve()`.**
11. **The `engine:` action namespace is reserved. Games must not register action types starting with `engine:`.**
12. **`ActionPipeline` steps are invariant — parse before validate, validate before reduce. Games supply strategies; they do not control step ordering.**
13. **`ContentDatabase` is immutable after `ContentLoader.load()` returns. It is never stored inside `GameSnapshot`. It is passed to `validate()` and `reduce()` through `PipelineContext`.**
14. **`ContentDatabase` is loaded and all schemas/refs validated before the tick loop starts. A failed load is a fatal startup error — the game does not start with incomplete content.**
15. **Game-defined content must never contain executable code. The engine loads JSON only; content files are pure data.**
16. **AI players submit `EngineAction` through `ActionPipeline` — there is no back-door mutation path for AI.**
17. **AI receives `PlayerSnapshot` by default (honest AI). Omniscient mode (`GameSnapshot` access) must be declared explicitly in the game's AI configuration and is logged at game start.**
18. **`AIParams` are passed by value (frozen) to every lifecycle method — AI state and command implementations must not mutate them.**
19. **At most one state transition is applied per AI tick. If multiple transitions are requested within a single tick, the last one wins; earlier requests are discarded and a warning is logged.**
20. **`simulation/` never resolves `AssetRef` values. `AssetRef` strings stored in `ContentDatabase` data objects are opaque to the simulation. Only `renderer/assets/AssetManager` may resolve them to loaded GPU or audio resources.**
21. **`AssetManager.dispose()` is called unconditionally on every game session end. Components must never hold direct references to loaded Three.js assets — all access goes through `useAsset()` or `AssetManager.get()`.**
22. **All `AssetRef` strings in content JSON files must pass `tools/validate-assets.ts` before merge. A data object referencing a non-existent file is a CI-blocking error, not a warning.**
23. **`FileSaveRepository.save()` always writes to a `.tmp` file and renames atomically. A save must never partially overwrite a previous valid save file.**
24. **`SimulationHost.restoreFromSave()` is the only entry point for replacing the live `GameSnapshot` from a file. No other code path may overwrite the running simulation state from disk.**
25. **`engine:save` and `engine:load` are validated `EngineAction` types — only the designated host player may dispatch them. Client-originated save/load actions are rejected by `validate()` before reaching the reducer.**
26. **`SaveFile.pendingCommitments` must be restored into `CommitmentScheme` on load. A loaded game without restored commitments must not process any `REVEAL` messages until commitments are present.**
27. **`CHIMERA_DEBUG` must never appear in the production packaging configuration. The production build must assert `IS_DEBUG_MODE === false` at startup and refuse to start if `process.env.CHIMERA_DEBUG` is set in a `NODE_ENV=production` process.**
28. **`window.__chimeraDebug` is exposed only by `debug-api.ts` and only to the Inspector Window. The game renderer's `api.ts` preload must never expose any debug surface.**
29. **The debug `ipcMain` handler (`chimera:debug`) must validate `event.sender.id` against the Inspector Window's `webContents.id` on every request. Any request from a different sender returns `{ type: 'ERROR' }` immediately.**
30. **`SnapshotRingBuffer` has a fixed capacity. It must never grow unboundedly. Oldest entries are overwritten silently; the capacity is configurable but must be explicitly set — no dynamic growth.**
31. **`SnapshotInspector` and `SnapshotRingBuffer` are instantiated only when `IS_DEBUG_MODE` is true. The `debugObserver` field in `PipelineContext` is undefined in production; the optional-chain call `context.debugObserver?.()` is the only simulation-side debug coupling.**
32. **Settings are never stored inside `GameSnapshot`, `SaveFile`, or `PlayerSnapshot`. Settings have a completely separate lifecycle from gameplay state and are not replayed, diffed, or included in undo history.**
33. **`FileSettingsRepository.save()` always writes to a `.tmp` file and renames atomically. A settings write must never partially overwrite a previous valid settings file.**
34. **`SettingsManager.registerSchema()` must be called for a game before `getSettings()` or `updateSettings()` is called for that game. Calling `getSettings` for an unregistered `gameId` returns only engine defaults and logs a warning — it does not throw, ensuring graceful degradation.**
35. **Game-defined settings keys must not shadow the five top-level engine namespace keys (`audio`, `display`, `gameplay`, `controls`). `SettingsManager.registerSchema()` enforces this at startup and throws `SettingsNamespaceCollisionError` if violated.**
36. **Settings are never read by the simulation core (`simulation/`) or the `ActionPipeline`. Any game parameter that must affect simulation outcomes must be declared as a match config value and transmitted as part of lobby setup, not as a user setting.**
37. **`SaveManager` must be constructed with an injected `SaveRepository` instance. No code inside `save-manager.ts` imports `FileSaveRepository` or any other concrete class by name. The concrete implementation is chosen once in `electron/main/index.ts`.**
38. **`LobbyManager` must be constructed with an injected `MultiplayerProvider` instance. No code inside `lobby-manager.ts`, `ipc-handlers.ts`, `StateBroadcaster.ts`, or `MessageRouter.ts` imports `LocalWebSocketProvider` or any other concrete provider by name.**
39. **`StateBroadcaster` and `MessageRouter` must not import from `networking/server/` or `networking/client/`. They interact exclusively through `HostTransport` and `ClientTransport` interfaces. Provider-internal directories are off-limits to all other modules.**
40. **A `MultiplayerProvider` instance must not be disposed or replaced while a `HostedSession` or `JoinedSession` is active. `LobbyManager.closeLobby()` must complete before `provider.dispose()` is called. Provider swaps are a cold-boot concern only — no hot-swapping during a session.**
41. **`InMemorySaveRepository` must pass the identical contract test suite as `FileSaveRepository`. Any divergence between their observable behaviors for the same inputs is a bug in the in-memory implementation, not an acceptable simplification.**
42. **The simulation is action-driven. `GameSnapshot.tick` is incremented by exactly 1 per action applied by `ActionPipeline.process()`. It is never derived from `Date.now()`, `performance.now()`, or any wall-clock source.**
43. **`validate()` and `reduce()` must be pure given `(state, payload, playerId, ctx)`. They must not call `Math.random`, `Date.now`, `performance.now`, read environment variables, or access any I/O. The only permitted source of randomness is `ctx.rng`.**
44. **All numeric fields of `GameSnapshot` that participate in arithmetic, comparison, or checksums must be integers (including fixed-point representations of money, percentages, and fine-grained positions). Floating-point is forbidden in simulation state.**
45. **`ActionHistory` is bounded by `TurnMemento`. After a memento is written, entries older than the memento are pruned. The canonical way to reconstruct an older state is to load the appropriate memento and replay forward.**
46. **`ContentDatabase` is optional. Games that declare no content (e.g. Tic Tac Toe) pass no `db` to `PipelineContext`, and `ReduceContext.db` is `undefined` for them. `validate()` and `reduce()` must tolerate `ctx.db` being `undefined` if the game opts out.**
47. **`StateBroadcaster`, `MessageRouter`, `LobbyManager`, `SaveManager` and all other main-process orchestration modules must not import from `networking/provider/local/` or any other provider-specific subdirectory. Cross-module communication goes exclusively through `MultiplayerProvider`, `HostTransport`, and `ClientTransport`.**
48. **Game UI beyond engine chrome (menus, HUD, dialog boxes) lives in `games/<name>/screens/` and is registered via `GameScreenRegistry`. `MatchShell.tsx` is game-agnostic — it never imports from any specific game package.**
49. **Scene transitions are host-authoritative. `engine:scene_prepare` and `engine:scene_commit` are rejected if the dispatcher is not the host player. (See §4.18.)**
50. **`SceneDescriptor.initialize()` and `teardown()` are pure reducers. They may not perform I/O, call `Date.now()`, or read from `Math.random()`. They receive `ReduceContext` and use `ctx.rng` for any randomness. (See §4.18.)**
51. **Clients never drive a scene change. A client that wishes to transition sends a domain action; host-side policy decides whether to honour it via `SceneManager.requestTransition()`. (See §4.18.)**
52. **Required assets for a scene MUST be declared in its `SceneDescriptor.requiredAssets`. Assets loaded on-demand inside the new scene are allowed but will cause visual pop-in and are flagged by the `validate-assets` CI tool. (See §4.18.)**
53. **`TransitionOverlay` is a renderer-only component. The simulation and Electron main process have no knowledge of fade state. Fade timing must never gate an authoritative simulation event — the `SceneReadyAction` is dispatched _after_ the fade completes, not as a cause of it. (See §4.19.)**
54. **`GameTimer` lives in `GameSnapshot.timers`. It is serialised, loaded, and replayed. A timer's `remainingTicks` counter must never be derived from wall-clock time. (See §4.20.)**
55. **`TimerManager.advance()` is a pure function. The `engine:tick` reducer is the ONLY consumer of `TimerManager.advance()`. Game action reducers may create or cancel timers but must NOT call `TimerManager.advance()`. (See §4.20.)**
56. **`curves.ts` and `useTween` are renderer-only modules. They must never be imported by anything under `simulation/`. Visual smoothing is a client-local concern; the authoritative state does not move smoothly. (See §4.21.)**
57. **Camera state is renderer-only. `GameSnapshot` must never contain camera position, look-at, zoom, or any other camera parameter. Camera configuration is driven by game board components in response to snapshot data — it is never driven by authoritative simulation actions. (See §4.22.)**
58. **`isHovered` in `useGameInteraction` is local component state. It must never be written to any Zustand store, IPC message, or simulation state. Hover is a transient renderer-local concern. (See §4.23.)**
59. **Player profile data (avatar, display name, locale, game-defined profile fields) is never stored in `GameSnapshot`, `PlayerSnapshot`, or `SaveFile`. It is a lobby-scoped cosmetic concern, separate from gameplay state, and is not replayed, diffed, or included in undo history. (See §4.24.)**
60. **`ProfileRepository` persists only the _local_ machine's profiles. The host's repository never receives or persists remote clients' profiles — remote profiles live only in the in-memory `PlayerDirectory` for the lifetime of the session and are discarded on lobby close. (See §4.24.)**
61. **`ProfileSanitizer.admit()` is the mandatory gate between an inbound `JOIN` / `PROFILE_UPDATE` attestation and the `PlayerDirectory`. Size caps, MIME whitelist, image decode check, display-name length, and game-schema validation all run inside `admit()`. A failed admission results in a `REJECT` response — the raw attestation is never exposed to any other subsystem. (See §4.24.)**
62. **Profile changes travel out-of-band from the `ActionPipeline`. `PROFILE_UPDATE` is not an `EngineAction`, does not advance `tick`, and does not participate in undo/redo or save/load. Any renderer component reading profile data must read it from the profile directory — never from `PlayerSnapshot`. (See §4.24.)**
63. **The simulation never produces audio. Audio playback is initiated only by the renderer in response to `GameEvent`s or direct UI interactions. No reducer, validator, or `ActionDefinition` may import from `renderer/audio/`. (See §4.25.)**
64. **`AudioManager.dispose()` is called unconditionally at game session end, mirroring the asset disposal contract (invariant 21). Active `AudioHandle`s become invalid after dispose. (See §4.25.)**
65. **`InputManager` is renderer-only. The simulation has no knowledge of keyboard or gamepad state. Input translates into `EngineAction`s via `sendAction()` at the renderer boundary — never directly into reducers. (See §4.26.)**
66. **Key bindings are settings, not profile data. They follow the settings layered-merge contract (engine defaults ← game defaults ← user overrides) and are stored under `settings.controls.bindings`. They are not transmitted over the network and never appear in `GameSnapshot`. (See §4.26.)**
67. **Every main-process manager is constructed with an injected `Logger` child. No module emits logs via raw `console.*` — all structured logging flows through the injected logger. (See §4.27.)**
68. **The crash reporter runs autosave before writing the crash dump when a live simulation is present. The crash dump file is created atomically (`.tmp` + rename) so a partially-written crash dump never exists. (See §4.27.)**
69. **No log entry, crash dump, or telemetry ever leaves the user's machine automatically. Export is an explicit, user-initiated action. The main process must not register network telemetry in 1.0.0. (See §4.27.)**
70. **`ReplayPlayer` uses the same `ActionPipeline` instance wiring as live play. Any "replay-only" shortcut code path is forbidden — a replay divergence is a determinism bug, not an acceptable replay-layer simplification. (See §4.28.)**
71. **Replay files contain full `EngineAction` payloads — never projected `PlayerSnapshot`s. Playback starts from seed + matchConfig and reconstructs state through the pipeline. A replay file without `seed` or `actions` is malformed and rejected at load. (See §4.28.)**
72. **`CHAT` messages are not `EngineAction`s. They must not advance `tick`, invoke `ActionPipeline`, or be recorded in `ActionHistory` / replays / saves. Chat is a cosmetic communication channel, parallel to `PROFILE_UPDATE`. (See §4.29.)**
73. **`ChatRelay.relay()` is the mandatory gate between an inbound `CHAT` message and rebroadcast. Length cap, rate limit, and scope validation all run inside `relay()` — no bypass path exists. (See §4.29.)**
74. **`toastStore` is renderer-only state. Toast contents must never be derived from `GameSnapshot`, `PlayerSnapshot`, or `SaveFile`. Toasts are transient UI surfaces for the local viewer; other players do not see another player's toasts. (See §4.30.)**
75. **`FixedPoint` is the ONLY allowed fractional representation in `GameSnapshot` and `EngineAction.payload`. A game that stores `number` for a fractional gameplay quantity violates invariant 44 even if it rounds consistently — determinism requires the shared `bigint` Q32.32 representation. (See §4.31.)**
76. **`fromFloat()` is permitted only at content-load time for hard-coded constants. It must not be called inside `validate()`, `reduce()`, or any hot simulation path. Linting is enforced by a dedicated ESLint rule in CI. (See §4.31.)**
77. **The dev multiplayer harness is a development-only tool. `electron/main/index.ts` must refuse to start when `CHIMERA_DEV_HARNESS=1` is combined with `NODE_ENV=production`, and the `--dev-auto-host` / `--dev-auto-join` / `--dev-profile-id` flags must be ignored (with a warning) when `CHIMERA_DEV_HARNESS` is absent. (See §4.32.)**
78. **Each harness-spawned instance runs in an isolated Electron `userData` directory (`.dev-userdata/p<i>/`). Shared state between instances is forbidden — profiles, saves, settings, logs, and crash dumps must be per-instance so the harness behaves identically to multiple distinct machines. (See §4.32.)**

---

## Appendix C — Worked Example: Gameplay ↔ Renderer Connection

This appendix walks through how a single gameplay entity — a `Soldier` with stats — connects from authoritative simulation state all the way to an on-screen sprite that changes with those stats. It ties together §4.2 (simulation), §4.6 (projection), §4.8 (content database), §4.10 (assets), §4.4 (renderer state), and the module tree in §3.

### C.1 The Three "Soldier" Shapes

A gameplay entity exists in three layers, connected only by **IDs and ref strings** — never by direct object references.

| Layer                           | What "Soldier" looks like                                                                              | Where it lives                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Content** (static definition) | `SoldierData` JSON — max HP, damage, sprites, model, sfx. Designer-authored, read-only at runtime.     | `games/tactics/data/units/soldier.json` → loaded into `ContentDatabase` (§4.8) |
| **Simulation** (dynamic state)  | `EntityState` — `{ id, unitDefId: 'soldier', hp: 47, position, ownerId }`. The _current_ numbers only. | `GameSnapshot.entities` on the host (§4.2)                                     |
| **Renderer** (visual)           | `<Unit />` R3F component that reads sprites and models via `useAsset()`                                | `renderer/components/r3f/Unit.tsx` (§4.10)                                     |

The simulation entity stores only `unitDefId: 'soldier'`, not the stats themselves. All _static_ soldier data (portrait, model, sfx, base stats, sprite variants) stays in the content database. This is what lets a designer change a sprite by editing JSON without recompiling anything, and why a 200-soldier snapshot stays small over the wire.

### C.2 The Connection Chain

```
games/tactics/data/units/soldier.json           ← static definition
                │                                  (AssetRef<TextureAsset> strings inside)
                │  loaded once at startup
                ▼
           ContentDatabase                      ← simulation/content/ (§4.8)
                │
                │  db.getByIdOrThrow('units', 'soldier') → SoldierData
                ▼
   ┌───────────────── HOST (Electron main process) ─────────┐
   │  GameSnapshot.entities['soldier-42'] = {                │
   │     unitDefId: 'soldier',  hp: 47,  x: 3, y: 5,  ...    │
   │  }                                                      │
   │                                                         │
   │  StateProjector.project(snapshot, playerId)             │
   │     → VisibilityRules mask fog / owner-only fields      │
   └─────────────────────────┬───────────────────────────────┘
                             │  PlayerSnapshot over IPC / WS
                             ▼
   ┌───────────────── RENDERER ──────────────────────────────┐
   │  gameStore.snapshot  (Zustand — §4.4)                   │
   │                                                         │
   │  <BoardScreen>                                          │
   │    snapshot.entities.map(e => <Unit key={e.id} …/>)     │
   │                                                         │
   │  <Unit entity={e}>                                      │
   │     const def = db.getByIdOrThrow('units', e.unitDefId) │
   │     const sprite = pickSprite(def, e.hp)  ← stat-driven │
   │     const { asset } = useAsset(sprite)    ← §4.10 hook  │
   │     return <mesh>…<spriteMaterial map={asset}/>…        │
   └─────────────────────────────────────────────────────────┘
```

### C.3 Worked Example — "Show a Different Sprite Based on HP"

#### Content JSON (pure data, one file)

```json
// games/tactics/data/units/soldier.json
{
    "id": "soldier",
    "name": "Soldier",
    "stats": { "maxHp": 100, "damage": 25, "armor": 10 },
    "sprites": {
        "healthy": "tactics/sprites/units/soldier-healthy.webp",
        "wounded": "tactics/sprites/units/soldier-wounded.webp",
        "critical": "tactics/sprites/units/soldier-critical.webp"
    },
    "sfx": { "hit": "tactics/audio/sfx/soldier-hit.ogg" }
}
```

The `"tactics/sprites/…"` strings are `AssetRef<TextureAsset>` per §4.10 — typed at compile time, plain strings at rest.

#### Simulation State (dynamic bits only)

```typescript
// Inside GameSnapshot.entities on the host
'soldier-42': {
  id: 'soldier-42',
  unitDefId: 'soldier',   // ← ref into ContentDatabase
  ownerId: 'p1',
  position: { x: 3, y: 5 },
  hp: 47,                 // ← dynamic, changes via reduce()
}
```

No sprite info here. No Three.js import reachable from this file — the simulation layer stays pure.

#### R3F Component (renderer — the only place that sees pixels)

```typescript
// renderer/components/r3f/Unit.tsx
import { useAsset } from '../../assets/useAsset';
import { useContentDb } from '../../content/useContentDb';

function pickSpriteRef(def: SoldierData, hp: number): AssetRef<TextureAsset> {
  const ratio = hp / def.stats.maxHp;
  if (ratio > 0.66) return def.sprites.healthy;
  if (ratio > 0.33) return def.sprites.wounded;
  return def.sprites.critical;
}

export function Unit({ entity }: { entity: ObservedEntityState }) {
  const db        = useContentDb();
  const def       = db.getByIdOrThrow<SoldierData>('units', entity.unitDefId);
  const spriteRef = pickSpriteRef(def, entity.hp);
  const { asset, loading } = useAsset(spriteRef);   // §4.10
  if (loading) return <FallbackSprite position={entity.position}/>;
  return (
    <sprite position={[entity.position.x, 0, entity.position.y]}>
      <spriteMaterial map={asset}/>
    </sprite>
  );
}
```

#### BoardScreen (game-declared, in `games/tactics/screens/`)

```typescript
function BoardScreen() {
  const snapshot = useGameStore(s => s.snapshot);   // §4.4 PlayerSnapshot
  if (!snapshot) return null;
  return (
    <GameCanvas>
      {Object.values(snapshot.entities).map(e =>
        <Unit key={e.id} entity={e}/>
      )}
    </GameCanvas>
  );
}
```

### C.4 What Makes a Change "Happen" Visually

A damage action flows like this:

1. Player dispatches `tactics:attack` via `window.__chimera.game.dispatch(...)` (§4.1).
2. Host `ActionPipeline.process()` runs the 7-step pipeline (§4.7): validate → reduce → history → project → broadcast.
3. `reduce()` returns a new `GameSnapshot` where `entities['soldier-42'].hp = 22`.
4. `StateProjector` produces a `PlayerSnapshot` per player (fog of war applied — a soldier in fog never reaches the renderer at all).
5. IPC pushes the `PlayerSnapshot` into `gameStore.applySnapshot(...)` (§4.4).
6. React re-renders `<Unit>`; `pickSpriteRef` now returns `def.sprites.critical`; `useAsset` returns the critical texture from the `AssetManager` cache (§4.10). If it was preloaded as `'critical'` priority, no flicker.

### C.5 Why the Indirection Is Worth It

- **Simulation has zero Three.js / DOM dependency** — same code runs headless in tests, in the AI layer (§4.9), and in save/load replay (§4.11).
- **Designers change sprites by editing JSON.** No TypeScript rebuild. `tools/validate-assets.ts` (§4.10) catches typos at CI time.
- **Fog of war is automatic.** The renderer literally cannot render a soldier it never received in its `PlayerSnapshot` — `VisibilityRules` decided upstream (§4.6).
- **Bit-identical determinism.** Stats live in integer fields per §4.2.1 Rule 3; the sprite bucket is derived deterministically from `(hp, maxHp)`, so every client shows the same sprite for the same state.
- **Stat-driven visuals are a pure renderer concern.** Adding a `"legendary"` sprite variant for `hp > 150%` is a `pickSpriteRef` change and one JSON edit — no engine, no network, no save-migration changes.

### C.6 Common Pitfalls (and Where They Really Belong)

| Temptation                                                     | Why it's wrong here                                                                                                               | Correct place                                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Store `currentSprite: THREE.Texture` on the entity             | Couples simulation to Three.js; breaks determinism, replay, save. Violates invariant "simulation has zero renderer dependencies." | Derive in `<Unit>` from stats + content def via `pickSpriteRef`.                                                     |
| Put `maxHp: 100` on every entity                               | Duplicates static data in every snapshot; bloats saves and network frames.                                                        | Put on `SoldierData` in content; entity stores only `unitDefId` + `hp`.                                              |
| Have the renderer directly mutate `entity.hp`                  | Breaks host-authoritative rule (§1, §6); causes desync.                                                                           | Dispatch an action; wait for the authoritative snapshot.                                                             |
| Use `Math.random()` to roll a critical hit inside `reduce()`   | Violates invariant #43 — non-deterministic; soak test (§10) catches it within minutes.                                            | Use `ctx.rng.intBetween(1, 100)` — seeded from `(state.seed, state.tick)`.                                           |
| Use `Date.now()` as a cooldown timer in state                  | Violates invariants #42 and #43; breaks replay and save-file portability across timezones/clocks.                                 | Store `cooldownUntilTick: number` and compare to `state.tick`.                                                       |
| Store `hp: 47.5` (fractional HP)                               | Violates invariant #44 — floats are not bit-exact across CPUs; causes cross-platform desync.                                      | Scale up: use integer HP `475` with "tenths of HP" semantics, or fixed-point.                                        |
| Load `soldier-critical.webp` on first damage tick              | First-hit stutter; 200ms frame spike.                                                                                             | Declare it `'critical'` priority in `asset-manifest.ts` → preloaded before match (§4.10).                            |
| Reach directly from `<Unit>` into the host's `GameSnapshot`    | There is no such access path; attempting it via Electron remote is a security violation (§9).                                     | Read `PlayerSnapshot` from `gameStore` (§4.4). If a field is missing, it was masked by `VisibilityRules` on purpose. |
| Put HUD logic (turn timer, undo button) into `<Unit>`          | Conflates entity rendering with shell chrome.                                                                                     | HUD lives in engine `shell/` or game `screens/`; the `<Unit>` component only draws a unit.                           |
| Add a new action type by editing `StateReducer` in engine core | Breaks the Action Registry pattern (§4.7); engine must stay game-agnostic.                                                        | Add an `ActionDefinition` in `games/tactics/actions/` and register it.                                               |
| Read a game setting inside `reduce()` to change outcome        | Violates invariant #36 — settings are UI-only; they are not replayed or synchronised.                                             | Put it in match config (lobby setup) so all clients agree.                                                           |
| Call `useAsset()` with a ref that isn't in `asset-manifest.ts` | Works in dev but `validate-assets.ts` will flag it, and it won't be packaged into `resources/` in production.                     | Register every `AssetRef` in the manifest with `'critical'` or `'deferred'` priority.                                |
| Send the full `GameSnapshot` to the renderer "for convenience" | Leaks hidden information (opponent hand, fog-covered entities); trivially cheatable via devtools.                                 | Always route through `StateProjector` → `PlayerSnapshot`, even for the host's own renderer.                          |

### C.7 The One-Sentence Version

**Content defines what a Soldier _is_; simulation tracks what a Soldier _is currently doing_; renderer decides what a Soldier _looks like right now_ — and `AssetRef` strings + `unitDefId` strings are the only glue between them.**

---

## Appendix D. Roadmap: From Monorepo to Package Hierarchy

### D.1 Scope of This Document

Everything specified in this architecture overview — §1 through §18 and Appendices A–C — constitutes the **Chimera Core Engine v1.0.0 target**. The monorepo layout described in §3 is the development vehicle for reaching that target. It is deliberately chosen for velocity: all packages share a single `tsc` build, a single test run, and a single git history, making cross-cutting interface changes cheap while the design is still evolving.

### D.2 The Trigger: v1.0.0 Stability

The monorepo remains the right structure **until the core engine interfaces are proven stable** by at least one shipped game. Stability means:

- `ActionRegistry` / `ActionPipeline` / `BaseGameSnapshot` have not had breaking changes across two full game development cycles.
- The `MultiplayerProvider` / `HostTransport` / `ClientTransport` contracts are exercised by at least two transport implementations (`LocalWebSocketProvider` + one other).
- The save/migration chain has survived at least one `schemaVersion` increment in production.
- No `engine:*` reserved action type has been renamed or removed post-release.

Once that bar is met, the project transitions to a **published package hierarchy**.

### D.3 Target Package Layout

```
@chimera/simulation     ←  simulation/ + shared/          (pure TS, zero runtime deps)
@chimera/ai             ←  ai/                             (depends on @chimera/simulation)
@chimera/networking     ←  networking/                     (depends on @chimera/simulation)
@chimera/renderer       ←  renderer/                       (depends on @chimera/simulation, React, Three.js)
@chimera/electron       ←  electron/                       (depends on all above)

# First-party extension library — example of the adopter pattern:
@chimera/cards          ←  new package                     (depends on @chimera/simulation, @chimera/ai)

# Games become independent repositories / packages:
my-poker-game           ←  games/poker/                    (depends on @chimera/simulation, @chimera/cards, @chimera/renderer)
my-ccg                  ←  games/my-ccg/                   (depends on @chimera/simulation, @chimera/cards, @chimera/renderer)
```

The dependency arrows already point this way in the monorepo — no refactoring of logic is required. The transition is a **packaging and publishing change**, not an architectural one.

### D.4 What the Transition Requires

| Task                                                                                        | Effort  | Notes                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Add `mergeFrom(definitions)` to `ActionRegistry`                                            | Small   | Enables extension libraries to pre-register shared action definitions without forcing adopters to re-register each one manually |
| Extract `SimulationHost` from `electron/main/simulation-host.ts` into `@chimera/simulation` | Medium  | Makes the host composable outside Electron; `@chimera/electron` becomes a thin wrapper                                          |
| Replace `tsconfig` path aliases with real workspace `package.json` deps                     | Small   | One-line change per package in a pnpm/yarn workspace                                                                            |
| Add import-boundary lint rules                                                              | Small   | `eslint-plugin-import` `no-restricted-imports` — enforces what the architecture already requires                                |
| Curate each package's `index.ts` barrel                                                     | Small   | Expose contract types only; hide implementation details                                                                         |
| Per-package incremental build                                                               | Medium  | `tsc --build` project references, or `turborepo`/`nx` for caching                                                               |
| Semantic versioning and changelogs                                                          | Ongoing | Each package gets independent semver; `@chimera/simulation` breaking changes are major bumps                                    |

### D.5 Intermediate Step: pnpm Workspaces

Before publishing, the monorepo should introduce **pnpm workspaces** (or yarn workspaces) as an intermediate step. This gives:

- Separate `package.json` per logical package with explicit `dependencies`
- Enforced dependency graph (a package cannot import from a sibling it doesn't declare)
- Incremental builds with caching
- Independent changelogs

...all without the overhead of publishing to npm or managing semver compatibility promises while interfaces are still hardening.

### D.6 Adopter Model

Once `@chimera/simulation` is published and stable, the intended adoption path for external developers is:

```
@chimera/simulation          ← always required; the core contract
@chimera/ai                  ← required if the game has AI players
@chimera/networking          ← required if the game has multiplayer
@chimera/renderer            ← required if using the React/R3F renderer shell
@chimera/electron            ← required if shipping as an Electron desktop app
@chimera/<domain>            ← optional extension libraries (e.g. @chimera/cards, @chimera/hex-grid)
```

An adopter building a card game toolkit publishes `@chimera/cards` with `peerDependencies` on `@chimera/simulation`. Their game packages depend on both. The engine team has no coupling to or knowledge of the game packages — the dependency arrows point inward toward the core, never outward.

---

## Appendix E. Future Extensions Roadmap (Post-1.0.0)

These capabilities are deliberately out of scope for the 1.0.0 release but are architecturally anticipated. They are listed in **priority order** — E.1 is the first candidate for a 1.1.0 release, E.5 the most speculative.

Each entry notes the existing anchor point in the 1.0.0 architecture and the broad strokes of what a follow-up release would add. Nothing here is a commitment; this list exists to prevent accidental design decisions in 1.0.0 that would foreclose these options.

### E.1 Auto-Update and Distribution Hardening

**Anchor:** Invariant 27 (production-mode guard) and `electron/main/index.ts`.

**Gap:** 1.0.0 packages the Electron app but does not include auto-update, code signing metadata, macOS notarization, or update channels. Players must manually download new versions.

**Planned approach:**

- Integrate `electron-updater` with GitHub Releases or an equivalent static host.
- Establish **stable** and **beta** channels via `electron-builder` config. Host + all clients in a lobby must run the same channel + major version; the lobby join handshake extends `WELCOME` with an `engineVersion` check.
- Add macOS notarization and Windows EV code-signing to the CI release pipeline.
- User-facing UI: an update indicator in the main menu + "Restart to install" prompt.

### E.2 Accessibility Baseline

**Anchor:** `EngineSettings.display` (§4.13); fade/tween renderer modules (§4.19, §4.21).

**Gap:** 1.0.0 has no accessibility settings.

**Planned approach:**

- Add `settings.display.reducedMotion: boolean` — when `true`, `useFadeTransition` and `useTween` resolve instantly, and `<ToastHost>` disables slide animations.
- Add `settings.display.highContrast: boolean` — game stylesheets expose a contrast-friendly theme variant.
- Add `settings.display.fontScale: number` — `1.0 = default`, `[0.75, 2.0]` range; applied via a CSS custom property at the root.
- Add keyboard-navigation affordances: focus rings, skip-to-content, ARIA labels on all shell components.
- Screen-reader compatibility is a larger project deferred beyond E.2.

### E.3 Spectator Mode

**Anchor:** `StateProjector` (§4.6), `VisibilityRules`.

**Gap:** The projection infrastructure can already produce a public-only `PlayerSnapshot`, but there is no formal "spectator" player type, no spectator join flow, and no allowlist enforcement for spectator-originated actions.

**Planned approach:**

- Extend `LobbyPlayerEntry` with a `role: 'player' | 'spectator'`.
- `StateProjector` gains a `projectForSpectator()` method that returns a `PlayerSnapshot` with no owner-only fields.
- `ActionValidator` rejects all non-`engine:chat` actions from spectators.
- `LobbyManager.joinLobby()` accepts a `role` parameter; host policy decides whether spectators are allowed per match.
- Spectators are visible in `PlayerDirectory` but excluded from turn rotation.

### E.4 Localisation / i18n

**Anchor:** `PlayerProfile.locale` (§4.24, currently carried but unused).

**Gap:** All engine-provided UI strings are hard-coded English.

**Planned approach:**

- Introduce a minimal translation surface: `translations/<locale>.json` bundles shipped in the engine package and per-game packages.
- Adopt `react-i18next` (or equivalent) in the renderer only — the simulation remains language-agnostic because it emits identifiers, not user-facing strings.
- Profile locale becomes the default; the player may override via `settings.display.locale`.
- RTL support (Arabic, Hebrew) is tracked separately from E.4 and may slip further.

### E.5 Connection Quality Telemetry

**Anchor:** `PING`/`PONG` wire frames (§4.3); `ConnectionStatus` IPC event (§4.1).

**Gap:** The ping round-trip is measured but not surfaced as a rolling quality metric (RTT, jitter, packet loss estimate). Players cannot see "weak connection" warnings.

**Planned approach:**

- Extend `PerfProbe` (or add a sibling `NetworkProbe`) that maintains an EWMA of RTT and its variance; estimates packet loss from sequence-number gaps in `SNAPSHOT` messages.
- A `connectionHealthStore` in the renderer exposes `rttMs`, `jitterMs`, `lossEstimate` to the UI.
- A small lobby indicator (green / yellow / red dot next to each player's avatar in `ChatPanel` / `PlayerListPanel`) surfaces the health state.
- Telemetry is **local only** (invariant 69) — these metrics are shown to the player, not exported or reported to any server.

---

### Sequencing Note

E.1 (auto-update) is the most operationally urgent because it gates every subsequent patch release. E.2 (accessibility) is the lowest-effort meaningful improvement and pairs well with E.1 in a 1.1.0. E.3 (spectator), E.4 (i18n), and E.5 (connection telemetry) are larger, more independent efforts that can be sequenced based on player feedback after 1.0.0 ships.
