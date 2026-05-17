<p align="center">
  <img src="docs/assets/chimera-logo-compact.png" alt="Chimera" width="120" />
</p>

# Chimera

Host-authoritative, multiplatform multiplayer game engine built on Electron, Next.js, React, and Three.js / React Three Fiber.

Architecture reference: [`docs/architecture-overview.md`](docs/architecture-overview.md).

## Status

**v0.6.0** — M1 (Skeleton), M2 (Networked Lobby), M3 (Action Registry + Game Loop + Undo/Redo), M4 (AI Framework), M5 (State Projection + Obfuscation), and M6 (End-to-End Testing Layer) are complete. The full Playwright E2E suite is green in CI, covering lobby, game-flow, undo/redo, obfuscation, reconnect, and 1 000-tick multiplayer soak; page objects, IPC spy helpers, WebSocket frame tap, and snapshot assertions are all in place. M7 (3D Render Integration) is next.

## Getting started

Prerequisites:

- Node.js **≥ 20** (tested on 25.x)
- [pnpm](https://pnpm.io) **≥ 10**

Install dependencies and run the test suite:

```sh
pnpm install
pnpm test            # vitest run
pnpm typecheck       # tsc --noEmit (root + renderer)
pnpm build:renderer  # next build renderer → renderer/out/index.html
```

Project layout (landed so far):

```
electron/
├── main/
│   ├── index.ts              # App entry: BrowserWindow creation + lifecycle (§3)
│   ├── ipc-handlers.ts       # chimera:system|game|lobby|saves|settings|profile:* IPC handlers
│   ├── lobby-manager.ts      # LobbyManager — host/join/leave with injected MultiplayerProvider
│   ├── state-broadcaster.ts  # StateBroadcaster — snapshot fanout over HostTransport
│   └── *.test.ts
└── preload/
    ├── api.ts                # contextBridge.exposeInMainWorld('__chimera', …)
    ├── {system,game,lobby,saves,settings,profile}-api.ts
    └── *.test.ts
networking/
└── provider/
    └── local/                # LocalWebSocketProvider (LobbyServer, WsHostTransport,
                              #   MessageRouter, ServerConnection, WsClientTransport)
renderer/
├── app/
│   ├── layout.tsx            # Root layout with ConnectionStatusIndicator
│   ├── page.tsx              # Main-menu shell
│   ├── lobby/
│   │   └── page.tsx          # Lobby UI — host/join/leave, PlayerList
│   ├── saves/
│   │   └── page.tsx          # Save/Load screen — slot list, save, load, delete, crash-recovery banner
│   └── settings/
│       └── page.tsx          # Settings UI — engine-wide + game-specific fields
├── state/
│   ├── gameStore.ts          # Zustand game store (snapshot, optimistic patch)
│   ├── lobbyStore.ts         # Zustand lobby store (players, ready states, connection)
│   ├── profileStore.ts       # Zustand profile store (local and remote profiles)
│   ├── saveStore.ts          # Zustand save store (slot list, active slot)
│   └── settingsStore.ts      # Zustand settings store (engine + game settings)
├── next.config.ts            # Static export (renderer/out)
└── tsconfig.json             # Extends root; jsx: preserve + DOM lib
shared/
├── messages.ts               # Typed wire protocol: ClientMessage / ServerMessage
├── crc32.ts                  # CRC32 checksum for action envelopes
└── messages-schemas.ts       # Zod schemas for all wire messages
ai/
└── engine/
    ├── AgentManager.ts           # AgentManager — tick fan-out, lifecycle, honest/omniscient projection
    ├── AIBrain.ts                # AIBrain<TParams> facade; drives AIStateMachine per tick
    ├── AIStateMachine.ts         # AIStateMachineImpl — state registration, deferred transitions
    ├── AIState.ts                # AIState<TParams> interface (onEnter, onTick, onIdle, onExit)
    ├── AITypes.ts                # Shared types: AIParams, PlayerSnapshot, GameResult
    ├── CommandScheduler.ts       # CommandSchedulerImpl — queue, advance, abort, isIdle
    ├── CommandContext.ts         # CommandContextImpl — dispatch bridge + deferred transitionState
    ├── AICommand.ts              # AICommand<TParams,TPayload>, CommandProgress, AnyAICommand
    └── PlayerAgent.ts            # PlayerAgent interface, HumanPlayerAgent, AIPlayerAgent
e2e/
├── playwright.config.ts          # Playwright config; CHIMERA_E2E=1 flag
├── global-setup.ts               # Global setup (app build verification)
├── fixtures/
│   ├── electron.fixture.ts       # Boot-smoke fixture: window opens, window.__chimera defined
│   └── lobby.fixture.ts          # Multiplayer fixture: two-window host+client setup
├── helpers/
│   ├── ipc-spy.ts                # getHostSnapshot, getSimulationTick, getLastBroadcastChecksum
│   ├── ws-inspector.ts           # WebSocket frame tap
│   ├── snapshot-assert.ts        # assertNoLeakedFields, assertChecksumMatch, assertTickAdvanced
│   └── tick-driver.ts            # Programmatic tick dispatch
├── pages/                        # Page Object Model (MainMenuPage, LobbyPage, GamePage, SettingsPage)
└── tests/
    ├── lobby.spec.ts
    ├── game-flow.spec.ts
    ├── undo-redo.spec.ts
    ├── obfuscation.spec.ts
    ├── reconnect.spec.ts
    ├── multiplayer-soak.spec.ts   # 1 000-tick checksum convergence
    ├── save-load.spec.ts
    └── settings.spec.ts
simulation/
├── engine/
│   ├── ActionPipeline.ts         # 7-stage pipeline (validate → auth → intercept → reduce → history → project → broadcast)
│   ├── ActionRegistry.ts         # Game-action + engine-action registration; namespace collision guard
│   ├── EngineActions.ts          # engine:undo, redo, end_turn, sync_request, save, load, tick
│   ├── UndoManager.ts            # UndoManager, TurnMemento, ActionHistory, InMemoryUndoManager
│   ├── UndoPolicy.ts             # UndoPolicy interface + DEFAULT_UNDO_POLICY
│   ├── FixedPoint.ts             # Q32.32 bigint — full arithmetic + sqrt/sin/cos/atan2 + constants
│   ├── GameTimer.ts              # GameTimer, TimerRegistry, TimerManager (bounded re-entrant dispatch)
│   └── prediction/
│       ├── ClientPredictor.ts    # Optimistic local state for predictable:true actions
│       └── ReconcileBuffer.ts    # Reconciliation on authoritative snapshot receipt
├── projection/
│   ├── StateProjector.ts         # StateProjector interface + DefaultStateProjector (fog-of-war by construction)
│   ├── CommitmentScheme.ts       # CommitmentScheme, CommitmentEnvelope, CommitmentReveal (SHA-256)
│   ├── assertNoLeakedFields.ts   # assertNoLeakedFields — obfuscation leak assertion for tests + E2E
│   └── types.ts                  # VisibilityRules, VisibilityScope, projection types
├── persistence/                  # JsonSaveSerializer, CompressedSaveSerializer, FileSaveRepository,
│                                 #   InMemorySaveRepository, SaveMigrator, SaveManager
├── profile/                      # ProfileSchema, ProfileRepository, FileProfileRepository,
│                                 #   InMemoryProfileRepository, ProfileManager, PlayerDirectory,
│                                 #   ProfileSanitizer
└── settings/                     # SettingsManager, FileSettingsRepository, SettingsSchema
```

## Features

**Core simulation**

- Pure, deterministic reducers with seeded RNG and integer / Q32.32 fixed-point math — bit-identical across macOS / Windows / Linux.
- Tick-based simulation for both turn-based and real-time games.
- Extensible `ActionRegistry` — games register their own actions without modifying engine code.
- Content system (`ContentDatabase`) loading game data from pure JSON; CI-validated `AssetRef` typing.
- Deterministic tick-based game timers (DoT, durations, countdowns) that save / load / replay.

**Multiplayer**

- Host-authoritative architecture; local Node.js WebSocket server in Electron main.
- Pluggable `MultiplayerProvider` (LAN default; Steam / others plug in unchanged).
- Per-player state projection (`StateProjector` + `VisibilityRules`) with fog-of-war by construction.
- Commitment scheme for hidden-info anti-cheat (shuffles, dice, hidden cards).
- CRC32-checksummed actions; sanitised profile / chat side-channels parallel to the action pipeline.
- Client-side prediction with server reconciliation; reconnect + resync flow.

**Identity & lobby**

- Client-attested player profiles (avatar, display name, locale) with host-side sanitiser.
- `PlayerDirectory` aggregates all lobby participants; pass-and-play handoff follows projected turn ownership.
- Lobby browse/discovery capability (optional, provider-specific).

**Input & UI**

- Renderer built on Next.js (static export) + React 19 + Three.js / React Three Fiber.
- Named `InputAction`s with rebindable keyboard + gamepad bindings stored under user settings.
- R3F-native pointer/click interactions, hover state, and interaction-blocker for transitions.
- Camera system: perspective/orthographic, presets (isometric, top-down, side-scroll, free), smooth `animateTo` with cancellation contract.
- Scene router with two-phase transitions + full-screen fade overlay.
- Curves + `useTween` hook for pure-renderer animations.
- Toast notifications, chat panel, performance HUD (F3), settings UI.

**Assets & audio**

- `AssetManager` with lifecycle-owned Three.js asset cache; `useAsset` hook.
- Audio system: master/music/sfx/voice buses, ducking, spatial audio, `EventAudioBinding` map from game events to sounds.

**Persistence**

- Save / load with atomic writes, migrations, and commitment-state restoration.
- Settings: layered merge (engine defaults ← game defaults ← user overrides), Zod-validated, atomic writes.
- Replay export/import — re-uses live `ActionPipeline` for bit-identical playback.
- Per-user profiles on disk; pass-and-play multi-slot support.

**AI**

- Pluggable AI brains submitting `EngineAction`s through the same pipeline as humans.
- Default "honest" AI receives `PlayerSnapshot`; omniscient mode is opt-in and logged.
- `CommandScheduler` with bounded per-tick transitions.

**Undo / redo**

- Hybrid memento + event-sourcing undo with configurable policy (intra-turn, cross-turn, consent-based).
- `engine:undo` / `engine:redo` travel the standard action pipeline — no side doors.

**Security & robustness**

- `contextIsolation: true`, `nodeIntegration: false`; typed, enumerated preload API surface.
- Dedicated IPC attack-surface audit (`window.__chimera` namespace table).
- React `RootErrorBoundary` with crash fallback; crash reporter with autosave-before-dump.
- Structured Pino logging (main + renderer), log rotation, local-only by default, user-initiated diagnostics export.

**Developer tooling**

- In-engine debug Inspector Window (dev builds only): snapshot browser, time-travel, injected actions, multi-window devtools.
- Dev multiplayer harness: `pnpm dev:mp N` spawns a host + N-1 auto-joining clients with isolated user-data dirs and distinct seed profiles.
- Vitest + fast-check + React Testing Library unit/integration tests; Playwright E2E.
- Custom ESLint rules (`chimera/no-fromfloat-in-simulation`, `no-context-null-bang`).
- Debug mode (`CHIMERA_DEBUG=1`) guarded against production builds.
  s
