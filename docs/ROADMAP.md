# Chimera Engine — Product Roadmap

> Based on `docs/architecture-overview.md` (v1.0.0, 2026-04-20)
> Every milestone, feature, and version maps directly to architecture sections.

---

## Version Overview

| Version | Milestone | Focus |
|---------|-----------|-------|
| **0.1.0** | M1 — Skeleton | Electron shell, IPC bridge, simulation stub, persistence foundations |
| **0.2.0** | M2 — Networked Lobby | Multiplayer provider abstraction, WebSocket lobby, player sync |
| **0.3.0** | M3 — Action Registry + Game Loop + Undo/Redo | Full action pipeline, undo/redo, save/load, settings |
| **0.4.0** | M3.5 — AI Framework | AI agent system, state machine, command scheduler |
| **0.5.0** | M4 — State Projection + Obfuscation | Per-player snapshots, fog of war, cryptographic commitment |
| **0.6.0** | M5 — End-to-End Testing Layer | Playwright E2E suite, all mandatory specs green in CI |
| **0.7.0** | M6 — 3D Render Integration | R3F canvas, asset pipeline, scene transitions |
| **1.0.0** | M7 — Hardening | Soak tests, Debug Inspector, performance baseline, anti-tamper |
| **post-1.0** | Future Extensions | Auto-update, accessibility, spectator, i18n, telemetry |

---

## 0.1.0 — Skeleton

> **Goal:** Working Electron application that boots, bridges the renderer, runs a simulation stub, and can persist state.

### F01 — Electron Application Shell `§3 electron/main/index.ts`
Bootstrap the Electron entry point: create and manage the `BrowserWindow`, inject environment-specific configuration, load the Next.js static export from `renderer/out/`, and implement the clean-shutdown `lastCleanExit.flag` mechanism.

### F02 — Preload / IPC Bridge `§4.1`
Wire the full `window.__chimera` contextBridge surface. Declare all five type-safe namespace files (`game-api.ts`, `lobby-api.ts`, `saves-api.ts`, `settings-api.ts`, `system-api.ts`) and compose them in `preload/api.ts`. Enforce `nodeIntegration: false` and `contextIsolation: true`. **Carried over from F01:** verify the Electron app boots and loads the Next.js static export from `renderer/out/` — this §12 M1 checklist item could not be exercised in F01 because `preload/api.js` and a first Next.js page did not yet exist.

### F03 — Simulation Engine Stub `§4.2, §4.7`
Implement `BaseGameSnapshot`, `ActionEnvelope`, `ActionRegistry`, `ActionPipeline` (7-stage, fixed order), `StateReducer`, and `EngineActions` (reserved action set). No game-specific rules — just the invariant pipeline contract operating on a pass-through no-op game.

### F04 — Deterministic RNG and Clock `§4.2.1`
Implement `DeterministicRng` (splitmix64 → xoshiro256\*\*) and `SimulationClock`. Enforce Rule 1 (action-driven tick), Rule 2 (seeded RNG only), and the integer-state contract (Rule 3). Add `chimera/no-restricted-globals` ESLint rule blocking `Math.random` / `Date.now` inside `simulation/`.

### F05 — Content Database `§4.8`
Implement `DataRef<T>`, `AssetRef<T>`, `ContentDatabase`, `ContentLoader` (directory scan + flat-array format), ref-integrity checking, Zod schema validation, and `ContentConflictError` / `ContentSchemaError` error types.

### F06 — Save / Load Persistence `§4.11`
Implement `SaveFile`, `JsonSaveSerializer`, `CompressedSaveSerializer`, `SaveMigrator`, `SaveRepository` interface, `FileSaveRepository` (atomic `.tmp` rename), `InMemorySaveRepository`, and `SaveManager`. Wire `engine:save` and `engine:load` as reserved actions. Implement crash-recovery check (`lastCleanExit.flag`).

### F07 — Settings System `§4.13`
Implement `SettingsSchema`, `SettingsMerger` (three-layer merge), `SettingsRepository` interface, `FileSettingsRepository` (atomic write), `SettingsManager` with IPC handlers (`get`, `update`, `reset`, `onChange`). Add namespace-collision guard and `settingsStore` in the renderer.

### F08 — Development Tooling `§4.32, §4.27`
Set up `tools/dev-server.ts` hot-reload harness, `tools/dev-multiplayer.ts` launcher (with `CHIMERA_DEV_HARNESS` guard), seed dev profiles in `tools/dev-profiles/`, and the `Logger` interface backed by Pino with daily rotation. Wire `RootErrorBoundary` and `rendererLogger`.

---

## 0.2.0 — Networked Lobby

> **Goal:** Two independent Electron instances discover each other, connect, and synchronise lobby state.

### F09 — Multiplayer Provider Abstraction `§4.14`
Declare `MultiplayerProvider`, `HostTransport`, `ClientTransport`, `HostedSession`, `JoinedSession`, and `BrowsableProvider` interfaces. Implement the `isBrowsable()` type-narrowing helper. Commit `SteamNetworkProvider` stub with full interface compliance.

### F10 — LocalWebSocketProvider `§4.14 networking/provider/local/`
Implement `LocalWebSocketProvider` wrapping `LobbyServer`, `MessageRouter`, `WsHostTransport`, `ServerConnection`, and `WsClientTransport`. Encapsulate all ws internals; no imports from `networking/provider/local/` outside the provider.

### F11 — LobbyManager and IPC Wiring `§4.14 electron/main/lobby-manager.ts`
Implement `LobbyManager` with injected `MultiplayerProvider`. Wire `chimera:host-lobby` and `chimera:join-lobby` IPC handlers. Decouple `StateBroadcaster` and `MessageRouter` from ws — they talk exclusively through `HostTransport` / `ClientTransport`. Add provider-swap smoke test.

### F12 — Lobby UI and State Sync `§4.4 renderer/state/lobbyStore.ts`
Implement `lobbyStore` (Zustand). Build `lobby/page.tsx` with host / join / leave flows, player list with ready states, connection status indicator, and `SeatSwitcher` for pass-and-play.

### F13 — WebSocket Message Protocol `§4.3`
Implement the full typed wire protocol (`ClientMessage`, `ServerMessage`) in `shared/messages.ts`. Add action checksums (CRC32) and `PING`/`PONG` round-trip latency measurement. Wire `SNAPSHOT` broadcast through `StateBroadcaster` → `HostTransport.sendSnapshot()`.

### F14 — Player Profiles and Directory `§4.24`
Implement `ProfileSchema`, `ProfileRepository` interface, `FileProfileRepository`, `InMemoryProfileRepository`, `ProfileManager`, `PlayerDirectory`, and `ProfileSanitizer.admit()`. Wire `JOIN` attestation, `PROFILE_UPDATE` side-channel, `profileStore`, and pass-and-play multi-seat support.

---

## 0.3.0 — Action Registry + Game Loop + Undo/Redo

> **Goal:** The full action pipeline is live, undo/redo works end-to-end, game state persists and migrates, and settings survive app restart.

### F15 — Full ActionPipeline Integration `§4.7`
Complete the 7-stage `ActionPipeline` with validated game actions, `UnknownActionTypeError`, `ActionSchemaError`, and `ValidationResult`. Implement `EngineActions` (undo, redo, end_turn, sync_request, save, load). Enforce namespace collision guard (`engine:` prefix).

### F16 — UndoManager and Turn Memento `§4.5, §7`
Implement `UndoManager`, `TurnMemento`, `ActionHistory` (with `TurnMemento`-bounded pruning), and `UndoPolicy`. Wire `engine:undo` / `engine:redo` as interceptable actions in `ActionPipeline` Stage 3. Reflect `canUndo` / `canRedo` in `PlayerSnapshot.undoMeta`.

### F17 — Client Prediction `§6 simulation/prediction/`
Implement `ClientPredictor` and `ReconcileBuffer` for actions where `predictable: true`. Wire into `ipcClient.sendAction()`. Limit prediction to non-randomised, own-player-only actions. Reconcile on authoritative snapshot receipt.

### F18 — Save Manager IPC and SaveScreen UI `§4.11`
Complete `SaveManager` IPC handlers (`listSaves`, `saveGame`, `loadGame`, `deleteSave`, `onSlotUpdate`). Implement `SaveScreen` renderer page reading `saveStore.slots`. Wire autosave after `engine:end_turn`. Implement crash-recovery "Resume last session" prompt.

### F19 — Settings UI `§4.13`
Build `settings/page.tsx` rendering engine-wide and game-specific settings fields. Wire `window.__chimera.settings.update()` and `reset()`. Validate that settings propagate across app relaunch and that the `onChange` subscription keeps the UI live.

### F20 — Fixed-Point Math `§4.31`
Implement `FixedPoint` (Q32.32 `bigint`), full arithmetic suite (`add`, `sub`, `mul`, `div`, `sqrt`, `sin`, `cos`, `atan2`), and conversion helpers (`fromInt`, `fromRatio`, `fromFloat`, `toFloat`, `toInt`). Add `chimera/no-fromfloat-in-simulation` ESLint rule. Add `FP_ZERO`, `FP_ONE`, `FP_HALF`, `FP_PI` constants.

### F21 — Game Timers `§4.20`
Implement `GameTimer`, `TimerRegistry`, and `TimerManager` (`create`, `cancel`, `advance`). Wire `TimerManager.advance()` into the `engine:tick` reducer via `ctx.dispatch()` (re-entrant, bounded by `MAX_NESTED_DISPATCH = 16`). Serialise `snapshot.timers` in saves.

---

## 0.4.0 — AI Framework

> **Goal:** AI plays a full headless match; honest-AI fog-of-war projection verified by tests.

### F22 — Player Abstraction and AgentManager `§4.9`
Implement `PlayerAgent` interface, `HumanPlayerAgent` (no-op stub), `AgentManager` (tick fan-out), and `AIPlayerAgent`. Register agents for every player slot before tick loop starts. Wire `AgentManager.tickAll()` into `simulation-host.ts` after each tick.

### F23 — AIBrain and State Machine `§4.9 ai/engine/`
Implement `AIStateMachine` (state registration, deferred transitions, `setInitialState`), `AIBrain` facade, `AIState<TParams>` interface (`onEnter`, `onTick`, `onIdle`, `onExit`), and `AIParams` base type.

### F24 — CommandScheduler and Commands `§4.9 ai/engine/`
Implement `CommandScheduler` (queue, `advance`, `abort`, `isIdle`), `AICommand<TParams, TPayload>` interface (`onStart`, `onTick`, `onEnd`, `onFail`), `CommandProgress` discriminated union, `AnyAICommand` existential wrapper, and `CommandContext` (dispatch bridge + deferred `transitionState`).

### F25 — Honest vs Omniscient AI Policy `§4.9`
Enforce that `AgentManager` projects `GameSnapshot` per AI player (via `StateProjector`) before calling `AIBrain.tick()`. Implement opt-in omniscient mode per `AIPlayerAgent` instance with startup log entry. Add honest-AI isolation test: AI snapshot never exposes opponent's fog-hidden entities.

---

## 0.5.0 — State Projection + Obfuscation

> **Goal:** Every client — including the host renderer — receives only its authoritative `PlayerSnapshot`; fog of war and commitment scheme are verified.

### F26 — StateProjector and VisibilityRules `§4.6, §8`
Implement `StateProjector`, `VisibilityRules` interface (`isEntityVisible`, `maskEntity`, `maskPlayerState`, `filterEvents`), and `VisibilityScope` classification. Ensure fog-hidden entities are entirely absent from `PlayerSnapshot.entities` (not masked with `null`).

### F27 — Cryptographic Commitment Scheme `§4.6, §8`
Implement `CommitmentScheme`, `CommitmentEnvelope`, `CommitmentReveal`, and the SHA-256 commit / verify flow. Wire `REVEAL` server message. Restore `pendingCommitments` from `SaveFile` on load. Add client-side `verify()` call before trusting any revealed value.

### F28 — Host Renderer Obfuscation Enforcement `§8, §9`
Confirm that the host's own renderer receives `PlayerSnapshot` via the same IPC path as remote clients. Disable any devtools shortcut that would expose `GameSnapshot`. Add an E2E assertion (`assertNoLeakedFields`) that the host window never contains an opponent's `owner-only` fields.

### F29 — Projection Property Tests `§10.1`
Write `fast-check` property tests asserting: (a) no `owner-only` or `hidden` field ever appears in a non-owner `PlayerSnapshot` across 10 000 random snapshots; (b) fog-of-war entities are absent (not null) in views of players who cannot see them.

---

## 0.6.0 — End-to-End Testing Layer

> **Goal:** Full Playwright suite green in CI, covering lobby, match, undo/redo, obfuscation, reconnect, and soak.

### F30 — Playwright Infrastructure `§13`
Set up `e2e/playwright.config.ts`, `global-setup.ts`, `CHIMERA_E2E=1` flag, and `__e2eHooks` on `globalThis` in `simulation-host.ts`. Implement base `electron.fixture.ts` and multiplayer `lobby.fixture.ts`. Add CI workflow `e2e.yml` with Xvfb on Linux.

### F31 — Page Object Model `§13.6`
Implement `MainMenuPage`, `LobbyPage`, `MatchPage`, and `SettingsPage` page objects covering all primary interactions. Add `data-testid` attributes to all engine shell components.

### F32 — IPC and WebSocket Test Helpers `§13.7`
Implement `ipc-spy.ts` (`getHostSnapshot`, `getSimulationTick`, `getLastBroadcastChecksum`), `ws-inspector.ts` (frame tap), `snapshot-assert.ts` (`assertNoLeakedFields`, `assertChecksumMatch`, `assertTickAdvanced`), and `tick-driver.ts` (programmatic tick dispatch).

### F33 — Core E2E Specs `§13.8`
Write and green all mandatory specs: `lobby.spec.ts`, `match-flow.spec.ts`, `undo-redo.spec.ts`, `obfuscation.spec.ts`, `reconnect.spec.ts`, and `multiplayer-soak.spec.ts` (1 000-tick checksum convergence).

### F34 — Save and Settings E2E Specs `§10.1`
Write: (a) save/load E2E — play to turn 3, save, relaunch, load, assert tick matches; (b) crash recovery E2E — force-kill, relaunch, accept "Resume", assert correct tick; (c) settings E2E — change `masterVolume`, relaunch, assert persists, reset returns defaults.

---

## 0.7.0 — 3D Render Integration

> **Goal:** R3F canvas renders game entities; asset pipeline is production-ready; scene transitions work end-to-end.

### F35 — R3F GameCanvas and Camera System `§4.22`
Implement `GameCanvas` with `cameraMode` and `cameraPreset` props, built-in camera presets (isometric, top-down, side-scrolling, free), `useCamera` hook (`setPosition`, `lookAt`, `zoom`, `animateTo`), `CameraAnimationCancelled` error, and optional `cameraStore`.

### F36 — Asset Manager and Resolver `§4.10`
Implement `AssetResolver` (dev + production variants), `AssetManager` (`preloadCritical`, `get`, `load`, `dispose`), `AssetPreloader` (progress callback), and `useAsset<T>` hook. Wire `AssetManagerContext`. Implement `tools/validate-assets.ts` CI script.

### F37 — Curves, Tweening, and Interaction `§4.21, §4.23`
Implement `curves.ts` (`lerp`, `linear`, `easeIn`, `easeOut`, `easeInOut`), `useTween` hook (R3F `useFrame`-driven), `useTweenCallback` variant, `useGameInteraction` hook, and `InteractionBlocker` context provider.

### F38 — Scene Transition System `§4.18, §4.19`
Implement `SceneDescriptor`, `SceneRegistry`, `SceneManager` (two-phase prepare / commit protocol), reserved actions (`engine:scene_prepare`, `engine:scene_ready`, `engine:scene_commit`), `SceneRouter`, `TransitionOverlay`, and `useFadeTransition`. Add scene invariants 49–52 to validator.

### F39 — Audio System `§4.25`
Implement `AudioManager`, `AudioBus` (gain + ducking), `EventAudioBinding`, `useSound` hook, and `<EventAudioPlayer>` component. Wire volume buses to `SettingsStore.audio.*`. Implement pool (32-voice default) with priority-based preemption. Define lifecycle owner (`MatchShell`).

### F40 — Input and Keybindings `§4.26`
Implement `InputManager` (keyboard + gamepad), `InputAction` registry, `KeyBindingRepository`, `useInputAction` hook, conflict detection, and rebind UI in `settings/page.tsx`. Wire engine default bindings (undo, redo, end-turn, toggle-menu, toggle-perf-hud).

### F41 — Performance HUD `§4.16`
Implement `PerfHud`, `PerfProbe` (R3F `useFrame` GL stats), and `perfStore`. Wire FPS, frame time, sim tick, actions/sec, action round-trip, ping, heap, draw calls, and triangles. Toggle with F3 or `settings.gameplay.showPerfHud`.

### F42 — Device Info `§4.17`
Implement `DeviceInfo`, `device-probe.ts` (main process), `DeviceInfoProvider`, `useDeviceInfo`, `usePrimaryInput`, `useWindowSizeClass` hooks, and `inputTracker`. Add `getDeviceInfo()` and `onDeviceInfoChange()` to `SystemAPI`.

---

## 1.0.0 — Hardening

> **Goal:** Production-grade quality: soak tests pass, Debug Inspector ships, performance baseline met, commitment anti-tamper verified.

### F43 — Crash Reporter and Error Boundaries `§4.27`
Implement `crash-reporter.ts` (`uncaughtException`, `unhandledRejection`, `render-process-gone` handlers), autosave-before-crash-dump, atomic crash dump write, and `ToastHost` / `RootErrorBoundary` sibling mount ordering. Wire `rendererLogger` forwards to main via `window.__chimera.logs`.

### F44 — Replay System `§4.28`
Implement `ReplayFile`, `ReplaySerializer` (JSON + compressed), `ReplayPlayer` (reuses live `ActionPipeline`), and `ReplayManager` (record, finalise, load, list). Wire `window.__chimera.replay` IPC surface. Add cross-version compatibility guard.

### F45 — Chat System `§4.29`
Implement `ChatRelay` (token bucket rate limiting, length cap, scope filter), `chatStore` (500-entry rolling buffer), `ChatPanel.tsx`, `window.__chimera.chat` IPC surface, and mute/unmute. Wire `CHAT` messages as `SideChannelMessage`, not `EngineAction`.

### F46 — Toast Notification System `§4.30`
Implement `toastStore`, `ToastHost.tsx` (stacked, animated, `reducedMotion`-aware), auto-dismiss durations, and engine-wired sources (disconnect, save failure, replay export, chat rate-limit, profile rejection).

### F47 — Debug Inspector `§4.12`
Implement `SnapshotRingBuffer`, `SnapshotInspector`, `SnapshotDiff`, `DebugProtocol`, `debug-bridge.ts`, and `debug-api.ts`. Launch Inspector `BrowserWindow` when `CHIMERA_DEBUG=1`. Build all six Inspector panels (Timeline, Snapshot Inspector, Projection Explorer, Diff View, Action Log, Performance). Enforce `IS_DEBUG_MODE` production guard.

### F48 — Multiplayer Soak and Obfuscation Soak Tests `§10`
Run 1 000-tick, 4-client soak with checksum convergence at every step. Run 10 000-snapshot obfuscation soak asserting zero `owner-only` field leaks. Verify commitment anti-tamper (tampered `REVEAL` value and nonce detected by `verify()`).

### F49 — Performance Baseline and NAT Diagnostics `§11, §6`
Establish and gate: main process tick ≤ 16 ms at 20 Hz, renderer heap ≤ 32 MB. Implement connection diagnostics UI (local IP, port-forward guide). Add STUN relay extension point in `ServerConnection.ts` without core changes.

---

## Post-1.0.0 — Future Extensions

> Tracked under the `Post-1.0 — Future Extensions` milestone. Not committed to any release date.

### E1 — Auto-Update and Distribution Hardening `§Appendix E.1`
`electron-updater` integration, stable / beta channels, macOS notarization, Windows EV code signing, engine version check in `WELCOME` handshake.

### E2 — Accessibility Baseline `§Appendix E.2`
`settings.display.reducedMotion`, `highContrast`, `fontScale`. Focus rings, skip-to-content, ARIA labels on all shell components.

### E3 — Spectator Mode `§Appendix E.3`
`role: 'player' | 'spectator'` in `LobbyPlayerEntry`, `projectForSpectator()` on `StateProjector`, spectator action allowlist (chat only).

### E4 — Localisation / i18n `§Appendix E.4`
`translations/<locale>.json` bundles, `react-i18next` in renderer, `settings.display.locale` override, `PlayerProfile.locale` as default.

### E5 — Connection Quality Telemetry `§Appendix E.5`
EWMA RTT + jitter + loss estimate in `NetworkProbe`, `connectionHealthStore`, per-player quality indicator in lobby UI. Local-only, no automatic export.

---

## Architecture Traceability

Every feature above maps to at least one architecture section. No feature exists without a specification anchor. If a feature lacks an `§` reference, it must not be planned.

| Architecture document section | Features |
|-------------------------------|---------|
| §3 Module structure | F01, F08 |
| §4.1 IPC Bridge | F02 |
| §4.2 Simulation core | F03, F15, F16, F17 |
| §4.2.1 Determinism | F04, F20 |
| §4.3 WebSocket protocol | F13 |
| §4.4 Renderer state | F12, F28 |
| §4.5 Undo policy | F16 |
| §4.6 Projection | F26, F27, F28, F29 |
| §4.7 Action registry | F03, F15 |
| §4.8 Content database | F05 |
| §4.9 AI framework | F22, F23, F24, F25 |
| §4.10 Asset system | F36 |
| §4.11 Save / load | F06, F18, F34 |
| §4.12 Debug layer | F47 |
| §4.13 Settings | F07, F19, F34 |
| §4.14 Multiplayer provider | F09, F10, F11 |
| §4.16 Performance HUD | F41 |
| §4.17 Device info | F42 |
| §4.18 Scene transitions | F38 |
| §4.19 Fade transitions | F38 |
| §4.20 Game timers | F21 |
| §4.21 Curves / tweening | F37 |
| §4.22 Camera | F35 |
| §4.23 Interactions | F37 |
| §4.24 Profiles | F14 |
| §4.25 Audio | F39 |
| §4.26 Input | F40 |
| §4.27 Logging / crash | F43 |
| §4.28 Replay | F44 |
| §4.29 Chat | F45 |
| §4.30 Toast | F46 |
| §4.31 Fixed-point | F20 |
| §4.32 Dev harness | F08 |
| §8 Obfuscation | F26, F27, F28, F29 |
| §10 Testing strategy | F29, F30, F31, F32, F33, F34, F48 |
| §12 Implementation milestones | All F-series |
| §13 E2E layer | F30, F31, F32, F33, F34 |
| §Appendix E | E1–E5 |
