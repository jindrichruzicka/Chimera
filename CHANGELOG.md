# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] — 2026-05-05

### Added

- StateProjector and VisibilityRules — `StateProjector`, `VisibilityRules` interface (`isEntityVisible`, `maskEntity`, `maskPlayerState`, `filterEvents`), `VisibilityScope` classification, and `DefaultStateProjector`; fog-hidden entities are entirely absent (not `null`) from `PlayerSnapshot.entities`; `StateProjector` wired into `StateBroadcaster` so the host renderer receives only its own `PlayerSnapshot` via the same IPC path as remote clients (F26)
- Cryptographic Commitment Scheme — `CommitmentScheme`, `CommitmentEnvelope`, `CommitmentReveal`, and SHA-256 commit / verify flow; `REVEAL` server message forwarded through `WsClientTransport`; `pendingCommitments` delivered in `PlayerSnapshot` and restored from `SaveFile` on load; client-side `verify()` rejects tampered reveals before trusting any hidden value (F27)
- Host Renderer Obfuscation Enforcement — `assertNoLeakedFields` integration assertion confirms the host window never exposes an opponent's `owner-only` fields; `CHIMERA_DEBUG` production startup guard (Invariant #27) prevents debug overrides in release builds (F28)
- Projection Property Tests — `fast-check` property tests over 10 000 random `GameSnapshot` inputs: (a) no `owner-only` or `hidden` field ever appears in a non-owner `PlayerSnapshot`; (b) fog-of-war entities are absent (not `null`) in views of players who cannot see them; `fast-check` arbitraries for `GameSnapshot` and projection inputs extracted as reusable helpers (F29)

## [0.4.0] — 2026-05-03

### Added

- Player Abstraction and AgentManager — `PlayerAgent` interface, `HumanPlayerAgent` (no-op stub), `AIPlayerAgent`; `AgentManager` with tick fan-out, lifecycle management, and `tickAll()` wired into `simulation-host.ts` after each engine tick; agent-ordering contract driven from `onPlayerJoined` after all players join (F22)
- AIBrain and State Machine — `AIStateMachineImpl<TParams>` with state registration and deferred-transition buffer; `AIBrain<TParams>` facade driving the state machine; `AIState<TParams>` interface (`onEnter`, `onTick`, `onIdle`, `onExit`); `AIParams` base type; `AIBrain` wired to `AIPlayerAgent.brain` (F23)
- CommandScheduler and Commands — `AICommand<TParams, TPayload>` interface (`onStart`, `onTick`, `onEnd`, `onFail`); `CommandProgress` discriminated union; `AnyAICommand` existential wrapper; `CommandContextImpl` with dispatch bridge and deferred `transitionState`; `CommandSchedulerImpl` with queue, `advance`, `abort`, `isIdle` (F24)
- Honest vs Omniscient AI Policy — `AgentManager` projects `GameSnapshot` per AI player via `StateProjector` before `AIBrain.tick()`; opt-in `omniscient` flag on `AIPlayerAgent` bypasses projection with startup log entry; honest-AI isolation test verifies AI snapshot never exposes fog-hidden opponent entities (F25)

## [0.3.0] — 2026-05-01

### Added

- Full ActionPipeline Integration — 7-stage pipeline complete (`validate → auth → intercept → reduce → history → project → broadcast`); `UnknownActionTypeError`, `ActionSchemaError`, `ValidationResult`; `PipelineContext` constructor; `engine:` namespace collision guard; Stage 7 skip on undo/redo (F15)
- UndoManager and Turn Memento — `UndoManager`, `InMemoryUndoManager`, `TurnMemento`, `ActionHistory` (with `TurnMemento`-bounded pruning), `UndoPolicy` + `DEFAULT_UNDO_POLICY`; `engine:undo` / `engine:redo` intercepted at Stage 3; `canUndo` / `canRedo` reflected in `PlayerSnapshot.undoMeta` (F16)
- Client Prediction — `ClientPredictor` and `ReconcileBuffer`; wired into `ipcClient.sendAction()`; limited to `predictable: true`, own-player-only actions; reconciles on authoritative snapshot receipt (F17)
- Save Manager IPC and SaveScreen UI — `chimera:saves:*` IPC handlers (`listSaves`, `saveGame`, `loadGame`, `deleteSave`, `onSlotUpdate`); `saveStore` Zustand slice; `saves/page.tsx` SaveScreen; `CrashRecoveryBanner` with "Resume last session" prompt; autosave wired to `engine:end_turn`; `SaveRepository` contract test suite (F18)
- Settings UI — `settings/page.tsx` with engine-wide and game-specific settings fields; wired to `window.__chimera.settings.update()` / `reset()`; `settingsStore` keeps UI live via `onChange` subscription (F19)
- Fixed-Point Math — `FixedPoint` (Q32.32 `bigint`); full arithmetic suite (`add`, `sub`, `mul`, `div`), comparisons, `sqrt`, `sin`, `cos`, `atan2`; conversion helpers (`fromInt`, `fromRatio`, `fromFloat`, `toFloat`, `toInt`); constants `FP_ZERO`, `FP_ONE`, `FP_HALF`, `FP_PI`, `FP_HALF_PI`, `FP_TWO_PI`; `chimera/no-fromfloat-in-simulation` ESLint rule; golden-vector determinism test suite (F20)
- Game Timers — `GameTimer`, `TimerRegistry`, `TimerManager` (`create`, `cancel`, `advance`); `TimerManager.advance()` wired into `engine:tick` reducer via bounded re-entrant `ctx.dispatch()` (`MAX_NESTED_DISPATCH = 16`); `snapshot.timers` serialised in saves; `GameReduceContext` ISP split enforcing dispatch visibility (F21)

## [0.2.0] — 2026-04-28

### Added

- Multiplayer Provider Abstraction — `MultiplayerProvider`, `HostTransport`, `ClientTransport`, `HostedSession`, `JoinedSession`, `BrowsableProvider` interfaces; `isBrowsable()` type-narrowing helper; `InMemoryMultiplayerProvider`; `SteamNetworkProvider` stub (F09)
- LocalWebSocketProvider — `LobbyServer`, `WsHostTransport`, `MessageRouter`, `ServerConnection` (with reconnect and `PlayerId` persistence), `WsClientTransport`; Zod message validation; `maxPayload` guard; `timingSafeEqual` token check; backpressure and REJECT flush (F10)
- LobbyManager and IPC Wiring — `LobbyManager` with injected `MultiplayerProvider`; `StateBroadcaster` decoupled from ws; `chimera:lobby:*` IPC handlers (`host`, `join`, `leave`, `ready`, `start`); provider-swap smoke test (F11)
- Lobby UI and State Sync — `lobbyStore` (Zustand); `lobbyStoreBootstrap` IPC subscription; `lobby/page.tsx` with host / join / leave flows; `PlayerList` with per-player ready states; `ConnectionStatusIndicator`; `SeatSwitcher` for pass-and-play (F12)
- WebSocket Message Protocol — full typed wire protocol (`ClientMessage`, `ServerMessage`) in `shared/messages.ts`; CRC32 utility (`shared/crc32.ts`); action checksums; `PING`/`PONG` round-trip latency measurement; `SNAPSHOT` broadcast via `StateBroadcaster` → `HostTransport.sendSnapshot()` (F13)
- Player Profiles and Directory — `ProfileSchema`; `ProfileRepository` interface; `FileProfileRepository` (atomic writes); `InMemoryProfileRepository`; `ProfileManager`; `PlayerDirectory`; `ProfileSanitizer.admit()` (7 rejection types); JOIN attestation; `PROFILE_UPDATE` side-channel with rate limiting; `chimera:profile:*` IPC bridge; `profileStore` Zustand store; pass-and-play multi-seat support (F14)

## [0.1.0] — 2026-04-23

### Added

- Electron Application Shell — BrowserWindow lifecycle, environment-specific config, clean-shutdown `lastCleanExit.flag` (F01)
- Preload / IPC Bridge — full `window.__chimera` contextBridge surface, five typed namespaces (`game-api`, `lobby-api`, `saves-api`, `settings-api`, `system-api`) (F02)
- Simulation Engine Stub — `BaseGameSnapshot`, `ActionEnvelope`, `ActionRegistry`, `ActionPipeline` (7-stage), `StateReducer`, `EngineActions` (F03)
- Deterministic RNG and Clock — splitmix64 → xoshiro256\*\*, `SimulationClock`, `chimera/no-restricted-globals` ESLint rule (F04)
- Content Database — `DataRef<T>`, `AssetRef<T>`, `ContentDatabase`, `ContentLoader`, ref-integrity checking, Zod validation (F05)
- Save / Load Persistence — `JsonSaveSerializer`, `CompressedSaveSerializer`, `FileSaveRepository` (atomic `.tmp` rename), `SaveMigrator`, `InMemorySaveRepository`, `SaveManager` (F06)
- Settings System — `SettingsManager`, `FileSettingsRepository` (atomic write), three-layer merge, `settingsStore`, IPC handlers (`get`, `update`, `reset`, `onChange`) (F07)
- Development Tooling — `dev-server.ts` hot-reload harness, `dev-multiplayer.ts` launcher, Pino logger with daily rotation, `RootErrorBoundary`, `rendererLogger` (F08)

### Security

- Content-Security-Policy meta tag: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'`
- BrowserWindow hardened: `sandbox: true`, `webSecurity: true`, `nodeIntegration: false`, `contextIsolation: true`
- `setWindowOpenHandler` deny-all; `will-navigate` blocks non-`file://` navigation
- `session.defaultSession.setPermissionRequestHandler` deny-all registered before `app.whenReady()`
- All `ipcMain.handle` inputs validated with Zod at IPC boundary; `SETTINGS_UPDATE` additionally validates via `validatePatchForGame`
- `FileSaveRepository` wired in production (not `InMemorySaveRepository`); crash-recovery `knownGameIds` populated
- `did-fail-load` diagnostic handler; `isDestroyed()` guard before all `webContents.send` calls
- Renderer logger: `addEventListener` over `window.onerror`; idempotent install with teardown; `LogEntry.source.process` not renderer-forgeable
- Pino sink uses async writes with `flushSync` on crash/quit paths; SonicBoom destination closed before day-rollover
- Crash dump write guarded against circular refs and oversized payloads; `process.exit(1)` after fatal crash dump

[0.5.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.5.0
[0.4.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.4.0
[0.3.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.3.0
[0.2.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.2.0
[0.1.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.1.0
[Unreleased]: https://github.com/jindrichruzicka/Chimera/compare/v0.5.0...HEAD
