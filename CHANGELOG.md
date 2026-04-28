# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[0.2.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.2.0
[0.1.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.1.0
[Unreleased]: https://github.com/jindrichruzicka/Chimera/compare/v0.2.0...HEAD
