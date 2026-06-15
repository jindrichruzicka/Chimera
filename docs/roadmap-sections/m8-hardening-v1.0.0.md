---
title: 'M8 — Hardening (v1.0.0)'
description: 'F43–F49, F51–F52: Crash Reporter/Error Boundaries, Replay System, Chat System, Toast Notification System, Debug Inspector, Multiplayer/Obfuscation Soak Tests, Performance Baseline/NAT Diagnostics, Game-Customizable Main Menu, and Game-Customizable Settings Page (Tabbed Redesign). Production-grade quality: soak tests pass, Debug Inspector ships, performance baseline met, commitment anti-tamper verified.'
tags:
    [
        milestone,
        m8,
        hardening,
        crash-reporter,
        replay,
        chat,
        toast,
        debug-inspector,
        soak-tests,
        performance,
        nat,
        main-menu,
        settings,
        ui-redesign,
    ]
---

# M8 — Hardening (v1.0.0)

> **Goal**: Production-grade quality: soak tests pass, Debug Inspector ships, performance baseline met, commitment anti-tamper verified. Shell pages are fully customizable per game.
> Architecture sections: §4.4, §4.12, §4.13, §4.14, §4.27, §4.28, §4.29, §4.30, §4.33, §4.37, §10, §11

---

## F43 — Crash Reporter and Error Boundaries `§4.27`

**Note**: Pino backing and `createPinoSink()` are already implemented in `logging/logger.ts`. This issue focuses on crash-dump configuration and error boundaries.

Implement `crash-reporter.ts` (`uncaughtException`, `unhandledRejection`, `render-process-gone` handlers), autosave-before-crash-dump, atomic crash dump write, and `ToastHost` / `RootErrorBoundary` sibling mount ordering. Wire `rendererLogger` forwards to main via `window.__chimera.logs`. Configure Pino daily log rotation (userData/logs/) with retention policy.

---

## F44 — Replay System `§4.28`

Implement `ReplayFile`, `ReplaySerializer` (JSON + compressed), `ReplayPlayer` (reuses live `ActionPipeline`), and `ReplayManager` (record, finalise, load, list). Wire `window.__chimera.replay` IPC surface. Add cross-version compatibility guard.

**GitHub**: [F44 — #654](https://github.com/jindrichruzicka/Chimera/issues/654)

---

## F45 — Chat System `§4.29`

Implement `ChatRelay` (token bucket rate limiting, length cap, scope filter), `chatStore` (500-entry rolling buffer), `ChatPanel.tsx`, `window.__chimera.chat` IPC surface, and mute/unmute. Wire `CHAT` messages as `SideChannelMessage`, not `EngineAction`.

---

## F46 — Toast Notification System `§4.30`

Implement `toastStore`, `ToastHost.tsx` (stacked, animated, `reducedMotion`-aware), auto-dismiss durations, and engine-wired sources (disconnect, save failure, replay export, chat rate-limit, profile rejection).

---

## F47 — Debug Inspector `§4.12`

Implement `SnapshotRingBuffer`, `SnapshotInspector`, `SnapshotDiff`, `DebugProtocol`, `debug-bridge.ts`, and `debug-api.ts`. `CHIMERA_DEBUG=1` starts only the debug bridge (the ring buffer is instantiated per attached session); the Inspector `BrowserWindow` is closed by default and lazily created/closed via **F9** (`engine:toggle-debug-inspector`, rebindable) over the data-free `chimera:debug:toggle-inspector` IPC. Build the four Inspector panels (Action Log, Snapshot, Diff View, Performance). Enforce `IS_DEBUG_MODE` production guard.

**GitHub**: [F47 — #689](https://github.com/jindrichruzicka/Chimera/issues/689)

---

## F48 — Multiplayer Soak and Obfuscation Soak Tests `§10`

Run 1 000-tick, 4-client soak with checksum convergence at every step. Run 10 000-snapshot obfuscation soak asserting zero `owner-only` field leaks. Verify commitment anti-tamper (tampered `REVEAL` value and nonce detected by `verify()`).

**Delivered by**: the 1 000-tick × 4-client soak and the time-series obfuscation soak live in `electron/main/__tests__/multiplayer-soak.integration.test.ts` (per-step convergence proven by two same-seed runs producing byte-identical per-viewer checksum sequences). The 10 000-snapshot obfuscation soak is `simulation/projection/__tests__/StateProjector.property.test.ts`; commitment anti-tamper (tampered value and nonce) is `simulation/projection/CommitmentScheme.test.ts`.

---

## F49 — Performance Baseline and NAT Diagnostics `§11, §6`

Establish and gate: main process tick ≤ 16 ms at 20 Hz, renderer heap ≤ 32 MB. Implement connection diagnostics UI (local IP, port-forward guide). Add STUN relay extension point in `ServerConnection.ts` without core changes.

---

## F51 — Game-Customizable Main Menu `§4.37`

Implement a declarative `GameMainMenuDefinition` contract in `shared/game-shell-contract.ts` covering layout (`orientation`, `align`, `anchor`, `offsetX`, `offsetY`, `gap`), button array (`GameMainMenuButton`), and a discriminated `GameMainMenuAction` union (`navigate | quit | open-lobby | command`). Introduce a `GameMenuCommand` registry contributed through `LoadedRendererGame.shell.menuCommands`. Create `renderer/shell/renderMainMenuDefinition.tsx` which maps any definition (or `undefined`) to engine-rendered `<Button>` components with token-based layout. Refactor `renderer/app/main-menu/page.tsx` to load the active game's definition via `rendererGameRegistry` and fall back to the engine default (also expressed as a `GameMainMenuDefinition`). Add a sample definition in `games/<game>/shell/main-menu.ts`. Invariants #80, #85, #91–#94 apply.

**GitHub**: [F51 — #615](https://github.com/jindrichruzicka/Chimera/issues/615)

---

## F52 — Game-Customizable Settings Page + Tabbed UI Redesign `§4.13, §4.37`

Two improvements delivered together:

1. **Tabbed Settings Redesign** — Rebuild `renderer/app/settings/page.tsx` with a `<Tabs>` layout (Audio, Display, Gameplay, Controls) so settings sections are independently navigable without scrolling a single long page.

2. **Declarative Settings Definition** — Introduce `GameSettingsPageDefinition` (with `SettingsTabDefinition`, `SettingsSectionDefinition`, `SettingsItemDefinition`, `SettingsControlDefinition`, `EngineSettingsFieldId`) in `shared/game-shell-contract.ts`. Games declare which engine fields and game-specific fields to show per tab; the engine renders all controls from design system primitives. Unknown `EngineSettingsFieldId` values are rejected at load time (fail-fast). The current generic `JSON.stringify` game-specific section is fully replaced. Add a sample in `games/<game>/shell/settings-page.ts` exercising all 4 control types and 5 tabs including a dedicated AI tab. Invariants #34–#36, #91–#94 apply.

**GitHub**: [F52 — #624](https://github.com/jindrichruzicka/Chimera/issues/624)

---

## F53 — Customizable Lobby `§4.37, §4.4`

Make the multiplayer lobby game-customizable while keeping its chrome engine-owned. Add the declarative `GameLobbySetup` descriptor, the synced `GameSetupConfig` (chosen match settings + per-player attributes), and `GameLobbyScreenProps` in `shared/game-lobby-contract.ts`. Sync config on `LobbyState` (`matchSettings`) and `LobbyPlayerEntry` (`attributes`), written through IPC (`chimera:lobby:set-match-setting`, `chimera:lobby:set-player-attribute`) to `LobbyManager.setMatchSetting()` / `setPlayerAttribute()`: match settings are host-authored (reject non-hosted sessions), per-player attributes are owner-authored (each player writes only its own seat; a joined client forwards its own-seat intent to the host), and every accepted change broadcasts to every peer. Add a registry-loaded `GameScreenRegistry.LobbyScreen` slot rendered by `renderer/app/lobby/page.tsx`, and the main-side `lobbySetupRegistry` (`resolveLobbySetup`, `buildSetupFromLobbyState`). Carry the agreed config into the match via `engine:start_game` → `snapshot.setup`, projected to every viewer verbatim by `StateProjector`. Tactics is the first adopter (host picks a shared board colour and each player picks their own unit colour), proven by a 4-player colour-sync E2E. Invariants #36, #80, #99–#101 apply.

**GitHub**: [F53 — #702](https://github.com/jindrichruzicka/Chimera/issues/702)

---

## Cross-References

- [Logging & Crash Reporting](../core-components/logging-crash-reporting.md)
- [Replay System](../core-components/replay-system.md)
- [Chat System](../core-components/chat-system.md)
- [Toast Notification System](../core-components/toast-notification-system.md)
- [Runtime Debug Layer](../core-components/runtime-debug-layer.md)
- [Renderer Shell Pages UI Contract](../core-components/renderer-shell-pages-ui-contract.md)
- [Customizable Lobby Contract](../core-components/customizable-lobby-contract.md) — F53 host-authored match config, `snapshot.setup` projection
- [Testing Strategy](../testing/property-tests-soak.md) — soak test scenarios
- [E2E Testing (Playwright)](../testing/e2e-testing-playwright.md) — multiplayer-soak.spec.ts, obfuscation.spec.ts
