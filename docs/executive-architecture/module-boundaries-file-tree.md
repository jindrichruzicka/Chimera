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

| Package                      | May import from                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Must NOT import from                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simulation/`                | Nothing outside its own package — the zero-dependency foundation leaf (Invariant #1); the cross-layer contracts live in `simulation/foundation/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `renderer/`, `electron/`, `apps/*`, any DOM API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ai/`                        | `simulation/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `renderer/`, `electron/`, `apps/*`, any DOM API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `renderer/`                  | `simulation/content` (types only in production code), the `simulation/foundation` contracts, the `simulation/bridge` preload API contract, `renderer/` internals; test files may also import from `simulation/settings` for cross-boundary compatibility guards                                                                                                                                                                                                                                                                                                                                                                                       | `electron/main/`, `ai/engine/` (except IPC types), `apps/*/data`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/<game>/`               | `simulation/`, `ai/`, own files; renderer surfaces in `screens/*.tsx` and `components/*.tsx`, React shell contributions in `shell/*.tsx`, and the renderer composition root `renderer/*.{ts,tsx}` may also import the public renderer barrels enumerated by Invariant #96 (`components/{ui,chat,r3f}` + the top-level `game`, `i18n`, `audio`, `assets`, `input`) — the invariant states the surfaces and the `shell/*` carve-out (its own Next host tree only, for any `shell/*` module — route re-export or composed); `*.test.ts` at the app root may additionally import `@chimera-engine/electron/test-support`, the dev-time asset-fact readers | Other `apps/` game directories; every `@chimera-engine/renderer/*` specifier outside those barrels and the `shell/*` carve-out — `styles/*.css` included; `@chimera-engine/electron/*` from any file that is not a test, with two carve-outs. **`apps/<game>/electron/`** — the Electron composition root and its `build:app` driver run in the main process and consume the host by design (`main.ts` imports `@chimera-engine/electron/main`, `build-main.ts` the bundle plan). **Type-only `preload/api-types` imports**, anywhere — that subpath is a types-only module that erases before it can reach a bundle, and it is the renderer-facing contract (`apps/tactics/components/useCommitmentBuffer.ts` takes it). The ban exists because a production import elsewhere ships the main-process package into the renderer BUNDLE; neither carve-out does. Lint reaches only part of this row, so measure before relying on it: the `apps/*/*.{ts,tsx}` zone is one level deep and matches no file under `apps/<game>/electron/`. Verify any given path with `eslint --print-config` |
| `electron/main/`             | All engine packages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | DOM APIs; `apps/*` game code (game wiring enters only at a consumer app's composition root)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `networking/provider/local/` | Only within `local/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Engine or renderer internals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

## Annotated File Tree

A **selection**, not an inventory: it draws the files worth annotating for a reader
working out which module owns what, and a file arriving without a row here is not a
defect. `ls` is the census for any directory below.

What it draws must be where it says, though — in a boundary document a row naming the
wrong module is worse than a missing row, because it answers the question incorrectly.
`tools/module-boundaries-file-tree.test.ts` resolves every row against the repo.

Two kinds of row describe a shape rather than a path and are exempt from that check:
a **placeholder** segment in angle brackets — `apps/<game>/`, `<subsystem>` — stands in
for a value the reader supplies, and `…` marks rows deliberately elided.

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
│   │   ├── runtime/                 # Live-game runtime infrastructure: tick driving, session lifecycle, broadcast
│   │   │   ├── RealtimeTicker.ts    # Wall-clock beat driver for manifest.realtime games; host starts/stops per match (§4.2.1)
│   │   │   ├── SessionRuntime.ts    # Manages session lifecycle: setup, teardown, player assignment
│   │   │   ├── HostSessionPipeline.ts # Orchestrates pings, broadcasts, heartbeat loop during active session
│   │   │   └── StateBroadcaster.ts  # Per-player snapshot projection via commitment scheme; network dispatch + spectator perspective fan-out (broadcastWave/broadcastSpectator, Invariant #114)
│   │   ├── saves/                   # Game save persistence via repository pattern
│   │   │   ├── SaveManager.ts       # IPC handler; uses SaveRepository to handle save/load/list/delete
│   │   │   ├── FileSaveRepository.ts      # Default: userData/saves/<game-id>/; atomic .tmp rename
│   │   │   ├── CompressedSaveSerializer.ts # zlib gzip wrapper around JsonSaveSerializer
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
│   ├── build-main/                  # The Electron bundle PLAN, published at the `@chimera-engine/electron/build-main` SUBPATH (§4.12): the packaging `define` Invariant #27 rests on, the esbuild alias/nodePaths derivation, the output layout, the bundle list. Every consumer app runs it through a thin driver (`apps/<game>/electron/build-main.ts`), which owns the paths, the module resolution and esbuild — the plan names no esbuild specifier, so the package gains no dependency
│   ├── packaged-bundle/             # The Invariant #27 packaged-bundle GUARD, published at the `@chimera-engine/electron/packaged-bundle` SUBPATH (§4.12): the debug-graph marker set and the self-validating `verifyPackagedBundle`, driven by each consumer's own `verify:packaged-bundle` script (`tools/verify-packaged-bundle.ts`; the scaffold template's `electron/verify-packaged-bundle.ts`)
│   ├── dev-tools/                   # Development-time tooling published from @chimera-engine/electron — as bins, as subpath exports, or both — so standalone games run what the monorepo runs
│   │   ├── dev-harness/             # `chimera-dev-mp` bin + harness library (spawn planning, announce handshake); see §4.32
│   │   ├── eslint/                  # The ten `chimera/*` lint rules, published at the `@chimera-engine/electron/eslint` SUBPATH (never a bin — a flat config imports it, nothing spawns it): `chimeraPlugin` for the monorepo's own root config, and `standaloneLintConfig()`, the curated six-rule overlay a scaffolded game composes (§4.32)
│   │   ├── fetch-google-fonts/      # `chimera-fetch-fonts` bin — dev-time Google Fonts downloader; writes committed self-hosted .woff2 files (satisfies Invariant #97; `validate-assets` enforces it)
│   │   ├── generate-icons/          # `chimera-generate-icons` bin — derives the .icns/.ico + loose PNG set, and the `chimera.png` window-icon fallback, from one square master; sharp is an OPTIONAL peer loaded on demand (§4.32)
│   │   ├── test-support/            # Asset-fact readers for a GAME's own unit tests, published at the `@chimera-engine/electron/test-support` SUBPATH (never a bin): `assetPathForRef`, `readWavFacts`, `readGlbDocument`. Framework-free — no `vitest` import, so it stays publishable; a malformed container raises `MalformedAssetFileError`
│   │   └── validate-assets/         # CI: the AssetRef/GameFontFace/cue-sheet build gate — enforces Invariants #22/#52/#97/#125; see §4.10
│   ├── preload/
│   │   ├── api.ts                   # The composition root for window.__chimera
│   │   ├── api-types.ts             # Type-only module: ChimeraAPI, ChimeraExtensions, all namespace interfaces
│   │   ├── debug-api.ts             # debug-only: window.__chimeraDebug surface (Inspector Window only)
│   │   └── apis/                    # One module per namespace; a selection is drawn
│   │       ├── extensions-api.ts    # registerExtension() + buildExtensionsApi() — extension registration infrastructure
│   │       ├── game-api.ts          # window.__chimera.game — action dispatch + snapshot stream
│   │       ├── lobby-api.ts         # window.__chimera.lobby — host/join/leave/discover
│   │       ├── saves-api.ts         # window.__chimera.saves — slot list/save/load/delete
│   │       ├── settings-api.ts      # window.__chimera.settings — get/update/reset/onChange
│   │       ├── profile-api.ts       # window.__chimera.profile — local profile + lobby directory
│   │       ├── replay-api.ts        # window.__chimera.replay — export/load/playback
│   │       ├── chat-api.ts          # window.__chimera.chat — send / onMessage
│   │       ├── logs-api.ts          # window.__chimera.logs — renderer forwards structured logs to main
│   │       └── system-api.ts        # window.__chimera.system — connection status, platform, quit
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
│   ├── host/                        # Session-scoped agent wiring, free of Electron / AI / networking deps
│   │   ├── SimulationHost.ts        # Drives an AgentCoordinator lifecycle: registerAgent, afterTick, onGameStart/End
│   │   └── AgentCoordinator.ts      # The port SimulationHost drives; ai/'s AgentManager implements it, so the
│   │                                #   dependency edge points inward and simulation/ stays the leaf (Invariant #1)
│   ├── engine/
│   │   ├── types.ts                 # BaseGameSnapshot — base state shape all games extend
│   │   ├── ActionRegistry.ts        # Registry: type string → ActionDefinition plus GameDefinition startup hooks
│   │   ├── ActionPipeline.ts        # Template Method: parsePayload → validate → reduce (invariant)
│   │   ├── EngineActions.ts         # Reserved engine ActionDefinitions: undo, redo, end_turn, sync, tick
│   │   ├── StateReducer.ts          # Delegates to ActionRegistry — no game-specific switch statements
│   │   ├── UndoManager.ts           # Undo/redo stack via memento + event log replay. Declares TurnMemento
│   │   │                            #   (full snapshot at each player's turn-start) and ActionHistory
│   │   │                            #   (append-only log, pruned to the most recent TurnMemento window)
│   │   ├── SimulationClock.ts       # Advances `tick` per applied action
│   │   ├── DeterministicRng.ts      # Seeded PRNG derived from (snapshot.seed, tick); passed via ReduceContext
│   │   ├── GameTimer.ts             # Tick-based deterministic timer registry; TimerManager helper; see §4.20
│   │   ├── FixedPoint.ts            # Q32.32 fixed-point integer math (mul, div, sqrt, sin, cos); see §4.31
│   │   ├── prediction/              # Optional client-side replay of own actions; see §6
│   │   │   ├── ClientPredictor.ts   # Optimistic local application of own actions (predictable: true)
│   │   │   └── ReconcileBuffer.ts   # Replays unconfirmed actions on top of authoritative snapshots
│   ├── projection/                  # StateProjector + commitment scheme — fog-of-war, cryptographic commitment (§8)
│   │   ├── index.ts                 # Public API: exports types for state projection
│   │   ├── types.ts                 # ObservedEntityState, ObservedPlayerState, VisibilityRules, VisibilityScope
│   │   └── types.test.ts            # Test coverage for projection types
│   ├── content/                      # OPTIONAL — games with no static content omit this
│   │   ├── DataRef.ts               # DataRef<T> branded type; buildRef() / parseRef() helpers
│   │   ├── AssetRef.ts              # AssetRef<T> branded type — phantom-typed path string; zero renderer deps
│   │   ├── AssetManifest.ts         # AssetManifestEntry (kind, priority, opaque `metadata: unknown`)
│   │   ├── audioManifest.ts         # audioClipEntry() cue-sheet authoring builder — write-only (§4.25, #124)
│   │   ├── ContentDatabase.ts       # Immutable query interface; createContentDatabase() factory
│   │   └── ContentLoader.ts         # Loads JSON sources, validates, merges, builds ContentDatabase
│   ├── foundation/                  # Contract leaf — types + pure helpers; no cross-package imports (Check 13)
│   │   ├── audio-cue-sheet.ts       # AudioCueName / AudioClipMetadata — DEFINED sim-side, read only by renderer/audio (#124)
│   │   ├── dev-fixture-contract.ts  # Dev-harness fixture schemas (DevScenario, DevAnnounce) + pure helpers; see §4.32
│   │   ├── game-manifest-contract.ts # GameManifest + resolvers; see §4.2.1
│   │   ├── game-screen-contract.ts  # GameScreenRegistry, GameHudProps, GameEventAudioBinding
│   │   ├── engine-contract.ts       # EngineAction envelope + TypedAction<T,P>; the reduce-time contract
│   │   └── …                        # The remaining shared contracts (messages, chat, lobby, logging, snapshot, …)
│   ├── persistence/                 # Save/load — pure serialisation logic, zero FS/IPC deps
│   │   ├── SaveFile.ts              # SaveFile schema: checkpoint snapshot + delta action log + metadata
│   │   ├── SaveSerializer.ts        # Strategy interface: serialize(SaveFile) / deserialize(string)
│   │   ├── JsonSaveSerializer.ts    # Default: pretty JSON (human-readable, debuggable)
│   │   ├── InMemorySaveRepository.ts # In-memory double; used by E2E fixtures for clean state
│   │   └── SaveMigrator.ts          # Applies versioned migrations when loading an older save schema
│   ├── settings/                    # Settings schema and merge logic — zero DOM, zero IPC deps
│   │   ├── SettingsSchema.ts        # EngineSettings base interface; GameSettingsSchema<T> generic
│   │   ├── SettingsMerger.ts        # Layered merge: engine defaults ← game defaults ← user overrides
│   │   └── SettingsRepository.ts   # Repository interface: load / save / reset per game-id
│   ├── profile/                     # Client-local player identity (§4.24) — pure schema + sanitisation, zero IO
│   │   ├── ProfileSchema.ts         # EngineProfile base (displayName, avatar, locale); GameProfileSchema<T> generic; declares ProfileRepository (load / save / listLocalSlots)
│   │   └── ProfileSanitizer.ts      # Host-side admission: size caps, schema, image content check
│   ├── replay/                      # Deterministic replay format (§4.28) — pure serialisation, zero IO
│   │   ├── ReplayFile.ts            # ReplayFile schema: seed + ActionHistory + metadata
│   │   ├── ReplaySerializer.ts      # Strategy: serialize / deserialize; JSON + gzip variants
│   │   └── ReplayPlayer.ts          # Feeds actions back through ActionPipeline at configurable speed
│   ├── debug/                       # Debug-mode only — gate folds to false in packaged builds; graph pruned, not shipped
│   │   ├── SnapshotRingBuffer.ts    # Observer: records last N full GameSnapshots after each ActionPipeline step
│   │   ├── SnapshotInspector.ts     # Facade: query API — get/reconstruct/diff snapshots; project to a PlayerId
│   │   ├── SnapshotDiff.ts          # Structural diff of two GameSnapshots (added/changed/removed fields)
│   │   └── DebugProtocol.ts         # Typed request/response message shapes for debug IPC channel
│   └── index.ts                     # Public API of simulation engine
│
├── apps/                            # One application per game built on Chimera (layer-3 consumers;
│   └── <game>/                      #   `create-chimera-game` scaffolds every DIRECTORY below from
│                                    #   templates/blank except lobby/, which a game adds with its first
│                                    #   lobby contribution; ai/, data/ and components/ arrive empty, held by
│                                    #   a .gitkeep)
│       ├── simulation/              # Deterministic gameplay — pure, no DOM/IPC/renderer imports; covered by the
│       │   │                        #   apps/*/simulation ESLint purity + boundary zones (Invariants #1, #43)
│       │   ├── actions.ts           # ActionDefinitions (validators + reducers) registered on the ActionRegistry
│       │   ├── constants.ts         # Game tokens: gameId, '<gameId>:*' action namespace, playfield extents, setting keys
│       │   ├── entities.ts          # Deterministic initial entity/playfield setup (optional for stateless games)
│       │   ├── visibility-rules.ts  # Implements the VisibilityRules interface for host-side state projection
│       │   └── <subsystem>/         # Gameplay subsystems as the game grows (turn gating, resource ledgers, ...)
│       ├── ai/                      # Game-specific AI policy (imports @chimera-engine/ai + own simulation/ only)
│       ├── content/                 # Typed content-collection definitions consumed by the Content DB
│       ├── data/                    # Pure JSON content; loaded by the host at startup, shipped by electron-builder
│       │   ├── <collection-type>/   # One directory per collection (preferred for large sets)
│       │   └── <collection-type>.json # Flat array format (valid for small collections)
│       ├── assets/                  # Binary assets (audio, fonts, icons, textures) — referenced by AssetRef strings
│       ├── screens/                 # The screens the registry names (playfield + HUD); exported via screens/index.tsx
│       ├── components/              # Everything reusable those screens compose — shared React, shared hooks/stores,
│       │                            #   and the R3F contributions (playfield meshes, selection markers, camera model)
│       ├── shell/                   # Declarative shell contributions (main menu, settings page, fonts, backgrounds)
│       ├── styles/                  # Design-token overrides (tokens-override.css + registration)
│       ├── lobby/                   # Lobby-setup contribution (agent slots, match settings)
│       ├── renderer/                # Per-app Next.js app (output: export) + register.ts game-registration seam
│       ├── electron/                # Electron main composition root (main.ts) + build-main.ts, the thin driver over the engine `@chimera-engine/electron/build-main` bundle plan (paths, module resolution, esbuild)
│       ├── dev/                     # Dev-harness fixtures — profiles/ and scenarios/ (starter set scaffolded)
│       ├── e2e/                     # Playwright E2E suite (fixtures, page objects, specs)
│       ├── asset-manifest.ts        # Declares every AssetRef this game owns + priority (critical|deferred)
│       ├── manifest.ts              # GameManifest: displayName/window title, realtime + tickRateMs, optional icon + cursor + logoScreen + languages + spectators
│       ├── settings-schema.ts       # Zod schema extending EngineSettings with game-specific fields
│       └── package.json             # App identity + scripts; engine packages as devDependencies (#817),
│                                    #   plus tsconfig.json / tsconfig.build.json / electron-builder.yml
│
├── networking/                      # Adapter between simulation and transport
│   └── provider/
│       ├── MultiplayerProvider.ts   # Interface: hostLobby() → HostedSession; joinLobby() → JoinedSession.
│       │                            #   Also declares HostTransport (sendSnapshot, broadcastLobbyState,
│       │                            #   onActionReceived, onPlayerJoined/Left, onSpectateTargetUpdate) and
│       │                            #   ClientTransport (sendAction, onSnapshotReceived, onLobbyStateChanged,
│       │                            #   onDisconnected, sendSpectateTarget) — Invariant #115
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
│   │   ├── game/page.tsx            # Thin shell: mounts GameShell
│   │   ├── lobby/page.tsx
│   │   ├── settings/page.tsx
│   │   └── debug/page.tsx           # debug-only: server gate — notFound() in packaged builds; UI in DebugInspectorClient.tsx
│   ├── components/
│   │   ├── shell/                   # Engine-provided navigation chrome
│   │   │   ├── GameShell.tsx       # Hosts the active game's screen registry; game-agnostic
│   │   │   ├── SpectatorHud.tsx     # Read-only spectator overlay: followed-seat name + Tab switch hotkey (Invariants #114/#115)
│   │   │   ├── RootErrorBoundary.tsx  # Top-level React error boundary; see §4.27
│   │   │   ├── ToastHost.tsx        # Renders transient notifications; see §4.30
│   │   │   ├── perf/                # Performance HUD — toggled with F3; see §4.16
│   │   │   │   ├── PerfHud.tsx
│   │   │   │   ├── PerfProbe.tsx
│   │   │   │   └── perfStore.ts
│   │   │   └── debug/               # Debug Inspector F9 toggle — headless; see §4.12
│   │   │       └── DebugInspectorToggle.tsx
│   │   ├── scene/                   # Scene routing + the waits around it; see §4.18–§4.19, §4.36
│   │   │   ├── SceneRouter.tsx      # Watches sceneId / sceneTransition; owns the screen Suspense boundary; see §4.18
│   │   │   ├── TransitionOverlay.tsx  # Fixed full-screen fade overlay; see §4.19
│   │   │   ├── SceneLoadingFallback.tsx  # Registry-resolved loading cover; falls back to an empty div; see §4.36
│   │   │   ├── EngineLoadingPreset.tsx   # The engine's own cover forms (spinner / progress / message / image); see §4.36
│   │   │   ├── RouteEntryLoadingCover.tsx  # The route-entry cover site: a sibling layer over the mounted shell while the preload gate waits; see §4.36
│   │   │   ├── resolveLoadingScreen.ts   # loadingScreens[key] ?? loadingScreen cascade; see §4.36
│   │   │   ├── loadingCoverHold.ts  # Resolves loadingScreenMinVisibleMs into the hold consumers arm; e2e-collapsed at call time; see §4.36
│   │   │   ├── useMinimumVisibleHold.ts  # Delayed-release latch: a shown cover stays up at least holdMs; see §4.36
│   │   │   ├── useFadeTransition.ts # Drives the fade around a scene transition and acks scene_ready; see §4.18
│   │   │   ├── scenePreload.ts      # Budgeted, fail-open warm-up of a scene's requiredAssets; see §4.10
│   │   │   └── FadeContext.ts       # Re-export of the shell fade context for scene-local consumers
│   │   ├── audio/                   # Event-driven audio playback components (e.g. EventAudioPlayer)
│   │   ├── chat/                    # PUBLIC chat component (Tier 2); barrel: @chimera-engine/renderer/components/chat; mounted by game HUDs only; see §4.35.1
│   │   │   ├── index.ts             # Public barrel
│   │   │   └── ChatPanel.tsx        # In-match chat UI; see §4.29
│   │   ├── ui/                      # PUBLIC UI primitive library (Tier 1); barrel: @chimera-engine/renderer/components/ui (includes <LanguageSelector>, §4.39)
│   │   └── r3f/                     # Reusable R3F building blocks; PUBLIC barrel: @chimera-engine/renderer/components/r3f (curated: the GameCanvas root — the only canvas root a game mounts, Invariant #127 — plus useModelAnimation, useClipPlayer, useSpriteClipPlayer, AnimatedSprite, useAnimationTimeScale, the tween/camera/curve surface re-exported from hooks/ and utils/, the pointer-interaction pair plus InteractionBlocker, and the curated types)
│   │       ├── index.ts             # Public barrel (exports GameCanvas + useModelAnimation + useClipPlayer + useSpriteClipPlayer + AnimatedSprite + useAnimationTimeScale + useTween/useTweenCallback/useCamera/CameraAnimationCancelled + lerp/linear/easeIn/easeOut/easeInOut + useGameInteraction/useInteractionContext/InteractionBlocker + the curated types; PerfProbe/FrameRateLimiter/useEngineFrameloop/useOwnedMixer/useClipPlayback/mainCanvasRegistry/mixerBindingRegistry are engine wiring and stay unexported)
│   │       ├── GameCanvas.tsx       # <Canvas> root; declarative `camera` prop (preset | explicit config); role="main"|"overlay" — mounts FrameRateLimiter and InteractionBlocker always, PerfProbe on the main canvas only — and owns the frameloop prop from useEngineFrameloop(); see §4.22
│   │       ├── FrameRateLimiter.tsx # Loop DRIVER for display.targetFps: one rAF chain calling advance(); registers no useFrame and never presents; see §4.22
│   │       ├── useEngineFrameloop.ts # Canvas-FREE hook returning the frameloop prop that canvas needs ('never' capped, 'always' uncapped); see §4.22
│   │       └── InteractionBlocker.tsx  # Context provider; see §4.23
│   ├── state/
│   │   ├── gameStore.ts             # Zustand: receives PlayerSnapshot from IPC
│   │   ├── lobbyStore.ts
│   │   ├── uiStore.ts
│   │   ├── saveStore.ts
│   │   ├── settingsStore.ts
│   │   ├── profileStore.ts          # see §4.24
│   │   ├── chatStore.ts             # see §4.29
│   │   └── toastStore.ts            # see §4.30
│   ├── assets/                      # Asset loading layer; PUBLIC barrel: @chimera-engine/renderer/assets (curated: hooks + provider + asset/error types; files behind it stay internal)
│   │   ├── index.ts                 # Public barrel; the exported set lives in index.ts itself, pinned by __tests__/assets-barrel-side-effects.test.ts. Everything not re-exported there stays internal
│   │   ├── AssetManager.ts
│   │   ├── AssetManagerProvider.tsx
│   │   ├── AssetResolver.ts
│   │   ├── AssetPreloader.ts
│   │   ├── criticalAssetPreload.ts  # The §4.10 critical preload — commit-phase, non-blocking, non-fatal; plus the route-entry gate that reports when it settles
│   │   ├── animationSheet.ts        # parseModel/SpriteAnimationMetadata — fail-soft readers of the animation sheet in AssetManifestEntry.metadata
│   │   ├── spriteAtlas.ts           # parseSpriteAtlas — public via the barrel; measures atlas cells to raw flipY UVs
│   │   ├── useAnimationSheet.ts     # Model sheet, memoised on metadata IDENTITY
│   │   └── useAsset.ts
│   ├── game/
│   │   ├── rendererGameRegistry.ts  # Game shell/screen/asset registration bridge; budgeted, fail-open shell warm-up
│   │   ├── gameShellAssetSource.ts  # Local game-asset-ref resolver for shell fonts/images/cursors
│   │   ├── GameFontLoader.ts        # Loads GameFontFace self-hosted fonts through the renderer protocol
│   │   ├── GameImageWarmup.ts       # Fetch+decode warm-up for shell.preloadImages (§4.37.13)
│   │   └── gameCursorStyles.ts      # shell.cursor → --ch-cursor-* hardware-cursor overrides (§4.37.14)
│   ├── audio/                       # Audio playback layer (§4.25); public barrel: @chimera-engine/renderer/audio
│   │   ├── index.ts                 # Public barrel — its header names the surface and what it drags in
│   │   ├── AudioManager.ts          # play/stop/fadeOut/fadeTo/crossfade, 32-voice pool, MUSIC_PRIORITY
│   │   ├── AudioBus.ts
│   │   ├── Cue.ts                   # Cue, LoopRegion, Fade{In,Out,To}Spec, CrossfadeOptions
│   │   ├── audioCueSheet.ts         # parseAudioCueSheet + resolvers — the SOLE reader of a sheet (#124)
│   │   ├── AudioManagerContext.ts   # Context + useAudioManager() (throws outside the provider, #83)
│   │   ├── AudioManagerProvider.tsx # Publishes the app-level manager; mounted once by app/providers.tsx
│   │   ├── EventAudioBinding.ts
│   │   ├── useSound.ts
│   │   └── useMusicTrack.ts         # Live-handle verbs (fadeOut/fadeTo/crossfade) bound to the manager
│   ├── input/                       # Keyboard / gamepad input layer (§4.26); public barrel: @chimera-engine/renderer/input
│   │   ├── InputAction.ts           # InputAction ID namespaces (engine:*, game:*); registry contract
│   │   ├── InputBindingSchema.ts    # EngineBindings base; GameBindingSchema<T> generic; default bindings
│   │   ├── index.ts                 # Public barrel — its header names the surface and what stays internal
│   │   ├── InputManagerProvider.tsx # Publishes a manager to the tree below it; app/providers.tsx mounts the live one
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
│   ├── animation/                    # Clip-sheet compile half, marker scheduling, the clip backends, blended transitions and the dilation store (F82, F89); renderer-internal — no `exports` subpath (useAnimationTimeScale ships through the components/r3f barrel)
│   │   ├── ClipPosition.ts          # resolveClipPosition — fail-soft authored position → phase in [0, 1]
│   │   ├── ClipTimeline.ts          # compileClipTimeline — sorted phase-denominated marks; warnings returned, not logged
│   │   ├── ClipBackend.ts           # ClipBackend / ClipPlayback / PlayheadSample seam; two terminal verbs (stop releases, hold leaves the pose), supportsBlending narrows, and the seam owns the argument refusals rather than each backend
│   │   ├── clipMarkerScheduler.ts   # Pure playhead → notify/passage/clip-end batches; sole producer of clip-end
│   │   ├── ClipPlayer.ts            # Speed stack, per-playback step bound, handler fan-out, transitionTo/stopAll and the poses a clip end or a blend left; getTimeScale and report injected
│   │   ├── MeshClipBackend.ts       # ClipBackend + SupportsClipBlending over an INJECTED AnimationMixer; ended derived from state, weight ramps owned here rather than three's, released-but-posing actions owned under Rule POSING-RELEASE
│   │   ├── SpriteClipBackend.ts     # ClipBackend over an atlas run; writes uv into an injected geometry, never touches the shared Texture
│   │   ├── timeScaleStore.ts        # One float: the authoritative dilation multiplier, derived only via timeScaleMultiplier (Invariant #130)
│   │   └── useAnimationTimeScale.ts # Read seam onto that float; the one module here re-exported from the components/r3f barrel
│   ├── shell/
│   │   └── SettingsLanguageSelector.tsx  # Store-connected wrapper for the settings Language field (§4.39)
│   ├── logging/
│   │   └── rendererLogger.ts        # see §4.27
│   ├── utils/                       # INTERNAL directory; curves.ts is re-exported by the components/r3f barrel
│   │   └── curves.ts                # Pure math: lerp, linear, easeIn, easeOut, easeInOut, EasingFn; see §4.21
│   ├── hooks/                       # INTERNAL directory; the first four are re-exported by the components/r3f barrel
│   │   ├── useTween.ts              # see §4.21
│   │   ├── useTweenCallback.ts      # see §4.21
│   │   ├── useCamera.ts             # see §4.22
│   │   ├── useGameInteraction.ts    # see §4.23
│   │   ├── useReplayApi.ts          # Shell-only, NOT re-exported; see §4.28
│   │   └── useSavesApi.ts           # Shell-only, NOT re-exported; see §4.11
│   └── bridge/
│       └── ipcClient.ts             # Wraps window.__chimera, typed
│
├── tools/
│   └── dev-server.ts                # Hot-reload dev harness
│
└── apps/tactics/e2e/                # Playwright end-to-end test suite (owned by the tactics consumer app).
                                     #   Deliberately NOT expanded here — the suite's tree is
                                     #   §13.3 of ../testing/e2e-testing-playwright.md, and one
                                     #   directory described in two places is one description
                                     #   nobody opens when the directory changes.
```

---

## Key Invariants Referenced Here

- **Invariant #1** — `simulation/` has zero runtime dependencies on React, DOM, or networking.
- **Module boundary (§3)** — the renderer never imports game packages; `AssetManager` included.
- **Invariant #48** — `GameShell.tsx` must never import from any `apps/*` game path.

---

## Cross-References

- [System Overview](system-overview-and-context.md) — process boundaries and context diagram
- [Architecture Invariants](architecture-invariants.md) — complete invariant list
- [Electron Shell and IPC Bridge](../core-components/electron-shell-ipc-bridge.md) — `electron/` in detail
- [Simulation Core](../core-components/simulation-core-action-pipeline.md) — `simulation/engine/` in detail
- [Renderer State Stores](../core-components/renderer-state-stores.md) — `renderer/state/` in detail
- [Playwright E2E](../testing/e2e-testing-playwright.md) — §13.3 carries the `apps/tactics/e2e/` tree
- [Spectator Mode Contract](../core-components/spectator-mode-contract.md) — read-only spectators, the join classifier, and perspective projection (F72)
