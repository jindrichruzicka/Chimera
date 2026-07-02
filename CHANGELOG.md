# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- Crash recovery — removed the `CrashRecoveryBanner` "Resume last session" prompt and the entire unclean-shutdown detection mechanism: the `lastCleanExit.flag` sentinel, `SaveManager.checkCrashRecovery` / `markCleanExit` / `clearCleanExitFlag`, the `chimera:saves:check-crash-recovery` and `chimera:system:was-clean-exit` IPC channels, `CrashRecoveryStatus`, and the `triggerCrashSave` E2E hook. Autosave (including the crash reporter's autosave-before-crash-dump) and manual save/load are unaffected.

## [0.8.0] — 2026-06-19

### Added

- Crash Reporter and Error Boundaries — `crash-reporter.ts` (`uncaughtException`, `unhandledRejection`, `render-process-gone` handlers); autosave-before-crash-dump with atomic dump write; `ToastHost` / `RootErrorBoundary` sibling mount ordering; `rendererLogger` → main forwarding via `window.__chimera.logs`; Pino daily log rotation with retention in `userData/logs/` (F43)
- Replay System — `ReplayFile`, `ReplaySerializer` (JSON + compressed), `ReplayPlayer` (reuses the live `ActionPipeline`), `ReplayManager` (record, finalise, load, list); `window.__chimera.replay` IPC surface; cross-version compatibility guard (F44)
- Chat System — `ChatRelay` (token-bucket rate limiting, length cap, scope filter), `chatStore` (500-entry rolling buffer), `ChatPanel.tsx`, `window.__chimera.chat` IPC surface, and mute/unmute; `CHAT` carried as a `SideChannelMessage`, not an `EngineAction` (F45)
- Toast Notification System — `toastStore`, `ToastHost.tsx` (stacked, animated, `reducedMotion`-aware), auto-dismiss durations, and engine-wired sources (disconnect, save failure, replay export, chat rate-limit, profile rejection) (F46)
- Debug Inspector — `SnapshotRingBuffer`, `SnapshotInspector`, `SnapshotDiff`, `DebugProtocol`, `debug-bridge.ts`, `debug-api.ts`, and the four Inspector panels (Action Log, Snapshot, Diff View, Performance); `CHIMERA_DEBUG=1` starts only the debug bridge, the Inspector window is lazily toggled via `engine:toggle-debug-inspector` over data-free `chimera:debug:toggle-inspector` IPC; `IS_DEBUG_MODE` production guard (F47)
- Multiplayer and Obfuscation Soak Tests — 1 000-tick × 4-client soak with per-step checksum convergence (`multiplayer-soak.integration.test.ts`); 10 000-snapshot obfuscation soak asserting zero `owner-only` field leaks (`StateProjector.property.test.ts`); commitment anti-tamper coverage for tampered value and nonce (`CommitmentScheme.test.ts`) (F48)
- Performance Baseline and NAT Diagnostics — gated main-process tick ≤ 16 ms at 20 Hz and renderer heap ≤ 32 MB; connection diagnostics UI (local IP, port-forward guide); STUN relay extension point in `ServerConnection.ts` without core changes (F49)
- Game-Customizable Main Menu — declarative `GameMainMenuDefinition` (layout + `GameMainMenuButton` array + discriminated `GameMainMenuAction` union: `navigate | quit | open-lobby | command`); `GameMenuCommand` registry via `LoadedRendererGame.shell.menuCommands`; `renderMainMenuDefinition.tsx`; engine default expressed as a definition (F51)
- Customizable Lobby — declarative `GameLobbySetup`, synced `GameSetupConfig`, and `GameLobbyScreenProps`; host-authored match settings and owner-authored per-player attributes synced over `chimera:lobby:set-match-setting` / `chimera:lobby:set-player-attribute`; registry-loaded `GameScreenRegistry.LobbyScreen` slot; agreed config carried into the match via `engine:start_game` → `snapshot.setup` and projected verbatim to every viewer (F53)
- Tactics Stub Hardening — turn-gated unit selection; per-player stamina (max/default 3, refreshes at turn start, `move`/`attack` cost 1, rejected at 0); lobby AI players (host Add-AI control, AI sub-list, auto-removal when a human join would overflow, random tactics brain); opt-in commit-then-sync battle mode (host-authored Battle Setup toggle, reveal-only End Turn enabled once all seats commit, deterministic attack-first resolution, undo-before-commit stamina refund) (F54)
- In-Game Menu and Role-Aware Leave Game — Escape-toggled in-game menu via `GameScreenRegistry` (component override / `'none'` / engine default Resume-Leave); host-only `engine:return_to_lobby` action + `chimera:lobby:return-to-lobby` IPC resetting the live session to `phase: 'lobby'` without closing it; clients leave to the main menu via `chimera:lobby:leave`; layered renderer Escape/overlay stack (F55)
- Lobby Password — optional host-set join secret threaded through the `JOIN` handshake (`ClientMessage` + Zod schema, `HostLobbyParams` / `JoinLobbyParams`, `LobbyServer` config), validated timing-safe with `REJECT 'invalid_password'` before WELCOME; server-side only — never written to `LobbyState`, `LobbyInfo`, broadcasts, or logs; blank host password preserves open-lobby behaviour (F56)

### Changed

- Settings Page redesign — rebuilt `renderer/app/settings/page.tsx` with a tabbed layout (Audio, Display, Gameplay, Controls) replacing the single scrolling page, and replaced the generic `JSON.stringify` game-specific section with a declarative `GameSettingsPageDefinition` (`SettingsTabDefinition` / `SettingsSectionDefinition` / `SettingsItemDefinition` / `SettingsControlDefinition`, `EngineSettingsFieldId` validated fail-fast at load) (F52)

## [0.7.0] — 2026-05-30

### Added

- R3F GameCanvas and Camera System — `GameCanvas` with `cameraMode`/`cameraPreset` props; built-in camera presets (isometric, top-down, side-scrolling, free); `useCamera` hook (`setPosition`, `lookAt`, `zoom`, `animateTo`); `CameraAnimationCancelled` error; optional `cameraStore` (F35)
- Asset Manager and Resolver — `AssetResolver` (dev + production variants); open `AssetKindRegistry` typing; `AssetLoaderRegistry` (built-in + game-contributed loaders keyed by manifest `kind`); `AssetManager` (`registerManifest`, `preloadCritical`, `get`, `load`, `dispose`); `AssetPreloader` (progress callback); `useAsset<T>` hook; `AssetManagerContext`; `tools/validate-assets.ts` CI script (F36)
- Curves, Tweening, and Interaction — `curves.ts` (`lerp`, `linear`, `easeIn`, `easeOut`, `easeInOut`); `useTween` hook (R3F `useFrame`-driven); `useTweenCallback` variant; `useGameInteraction` hook; `InteractionBlocker` context provider (F37)
- UI Design System — `renderer/components/ui/` primitive library (Button, Modal, Panel, Slider, ProgressBar, Spinner, Tooltip, Badge, Divider, ScrollArea, and more); `renderer/styles/tokens.css` with full `--ch-*` token set (colours, spacing, radius, typography, shadows, motion); `prefers-reduced-motion` wired into `--ch-motion-*`; game override pattern via `games/<name>/styles/tokens-override.css`; Invariants #85/#86 enforced (F50)
- Scene Transition System + GameShell — `SceneDescriptor`, `SceneRegistry`, `SceneManager` (two-phase prepare/commit); reserved actions (`engine:scene_prepare`, `engine:scene_ready`, `engine:scene_commit`); `SceneRouter`; `TransitionOverlay`; `useFadeTransition`; `GameScreenRegistry`; `GameShell.tsx` (game-agnostic match chrome, full context provider tree, `React.Suspense`-wrapped slots, `useActiveScreen`/`useNavigateToScreen`); `ContentDatabaseContext`; `FadeContext`; Invariants #80–#88 (F38)
- Audio System — `AudioManager`; `AudioBus` (gain + ducking); `EventAudioBinding`; `useSound` hook; `<EventAudioPlayer>` component; 32-voice pool with priority-based preemption; volume buses wired to `SettingsStore.audio.*`; lifecycle owner `GameShell` (F39)
- Input and Keybindings — `InputManager` (keyboard + gamepad); `InputAction` registry; `KeyBindingRepository`; `useInputAction` hook; conflict detection; rebind UI in `settings/page.tsx`; engine default bindings (undo, redo, end-turn, toggle-menu, toggle-perf-hud) (F40)
- Performance HUD — `PerfHud`; `PerfProbe` (R3F `useFrame` GL stats); `perfStore`; FPS, frame time, sim tick, actions/sec, action round-trip, ping, heap, draw calls, and triangles; toggle with F3 or `settings.gameplay.showPerfHud` (F41)
- Device Info — `DeviceInfo`; `device-probe.ts` (main process); `DeviceInfoProvider`; `useDeviceInfo`; `usePrimaryInput`; `useWindowSizeClass` hooks; `inputTracker`; `getDeviceInfo()` and `onDeviceInfoChange()` added to `SystemAPI` (F42)

## [0.6.0] — 2026-05-12

### Removed

- Manual pass-and-play seat-switching UI and `chimera:game:switch-seat` IPC; local turn handoff now follows host-projected `PlayerSnapshot.isMyTurn`.

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
- Save Manager IPC and SaveScreen UI — `chimera:saves:*` IPC handlers (`listSaves`, `saveGame`, `loadGame`, `deleteSave`, `onSlotUpdate`); `saveStore` Zustand slice; `saves/page.tsx` SaveScreen; autosave wired to `engine:end_turn`; `SaveRepository` contract test suite (F18)
- Settings UI — `settings/page.tsx` with engine-wide and game-specific settings fields; wired to `window.__chimera.settings.update()` / `reset()`; `settingsStore` keeps UI live via `onChange` subscription (F19)
- Fixed-Point Math — `FixedPoint` (Q32.32 `bigint`); full arithmetic suite (`add`, `sub`, `mul`, `div`), comparisons, `sqrt`, `sin`, `cos`, `atan2`; conversion helpers (`fromInt`, `fromRatio`, `fromFloat`, `toFloat`, `toInt`); constants `FP_ZERO`, `FP_ONE`, `FP_HALF`, `FP_PI`, `FP_HALF_PI`, `FP_TWO_PI`; `chimera/no-fromfloat-in-simulation` ESLint rule; golden-vector determinism test suite (F20)
- Game Timers — `GameTimer`, `TimerRegistry`, `TimerManager` (`create`, `cancel`, `advance`); `TimerManager.advance()` wired into `engine:tick` reducer via bounded re-entrant `ctx.dispatch()` (`MAX_NESTED_DISPATCH = 16`); `snapshot.timers` serialised in saves; `GameReduceContext` ISP split enforcing dispatch visibility (F21)

## [0.2.0] — 2026-04-28

### Added

- Multiplayer Provider Abstraction — `MultiplayerProvider`, `HostTransport`, `ClientTransport`, `HostedSession`, `JoinedSession`, `BrowsableProvider` interfaces; `isBrowsable()` type-narrowing helper; `InMemoryMultiplayerProvider`; `SteamNetworkProvider` stub (F09)
- LocalWebSocketProvider — `LobbyServer`, `WsHostTransport`, `MessageRouter`, `ServerConnection` (with reconnect and `PlayerId` persistence), `WsClientTransport`; Zod message validation; `maxPayload` guard; `timingSafeEqual` token check; backpressure and REJECT flush (F10)
- LobbyManager and IPC Wiring — `LobbyManager` with injected `MultiplayerProvider`; `StateBroadcaster` decoupled from ws; `chimera:lobby:*` IPC handlers (`host`, `join`, `leave`, `ready`, `start`); provider-swap smoke test (F11)
- Lobby UI and State Sync — `lobbyStore` (Zustand); `lobbyStoreBootstrap` IPC subscription; `lobby/page.tsx` with host / join / leave flows; `PlayerList` with per-player ready states; `ConnectionStatusIndicator`; manual pass-and-play controls (F12)
- WebSocket Message Protocol — full typed wire protocol (`ClientMessage`, `ServerMessage`) in `shared/messages.ts`; CRC32 utility (`shared/crc32.ts`); action checksums; `PING`/`PONG` round-trip latency measurement; `SNAPSHOT` broadcast via `StateBroadcaster` → `HostTransport.sendSnapshot()` (F13)
- Player Profiles and Directory — `ProfileSchema`; `ProfileRepository` interface; `FileProfileRepository` (atomic writes); `InMemoryProfileRepository`; `ProfileManager`; `PlayerDirectory`; `ProfileSanitizer.admit()` (7 rejection types); JOIN attestation; `PROFILE_UPDATE` side-channel with rate limiting; `chimera:profile:*` IPC bridge; `profileStore` Zustand store; pass-and-play multi-seat support (F14)

## [0.1.0] — 2026-04-23

### Added

- Electron Application Shell — BrowserWindow lifecycle, environment-specific config (F01)
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
- `FileSaveRepository` wired in production (not `InMemorySaveRepository`)
- `did-fail-load` diagnostic handler; `isDestroyed()` guard before all `webContents.send` calls
- Renderer logger: `addEventListener` over `window.onerror`; idempotent install with teardown; `LogEntry.source.process` not renderer-forgeable
- Pino sink uses async writes with `flushSync` on crash/quit paths; SonicBoom destination closed before day-rollover
- Crash dump write guarded against circular refs and oversized payloads; `process.exit(1)` after fatal crash dump

[0.8.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.8.0
[0.7.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.7.0
[0.6.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.6.0
[0.5.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.5.0
[0.4.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.4.0
[0.3.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.3.0
[0.2.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.2.0
[0.1.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.1.0
[Unreleased]: https://github.com/jindrichruzicka/Chimera/compare/v0.8.0...HEAD
