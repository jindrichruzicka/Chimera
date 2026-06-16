---
title: 'M8 — Hardening (v1.0.0)'
description: 'F43–F49, F51–F54: Crash Reporter/Error Boundaries, Replay System, Chat System, Toast Notification System, Debug Inspector, Multiplayer/Obfuscation Soak Tests, Performance Baseline/NAT Diagnostics, Game-Customizable Main Menu, Game-Customizable Settings Page (Tabbed Redesign), Customizable Lobby, and Tactics-Stub Hardening (turn-gating, stamina, AI players, commitment-scheme battle mode). Production-grade quality: soak tests pass, Debug Inspector ships, performance baseline met, commitment anti-tamper verified.'
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
        tactics,
        stamina,
        ai-players,
        commitment,
        turn-mode,
    ]
---

# M8 — Hardening (v1.0.0)

> **Goal**: Production-grade quality: soak tests pass, Debug Inspector ships, performance baseline met, commitment anti-tamper verified. Shell pages and the lobby are fully customizable per game, and the tactics stub exercises turn-gating, stamina, AI players, and an opt-in commitment-scheme battle mode.
> Architecture sections: §4.4, §4.6, §4.9, §4.12, §4.13, §4.14, §4.27, §4.28, §4.29, §4.30, §4.33, §4.37, §8, §10, §11

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

## F54 — Tactics Stub: Turn-Gating, Stamina, AI Players & Commitment-Scheme Battle Mode `§4.4, §4.6/§8, §4.9`

Harden the **tactics** demo/test game so it exercises four engine capabilities end-to-end, with E2E coverage as the deliverable. Tactics is explicitly a testing stub — the goal is to wire and prove existing engine primitives, not to ship a polished game (it is slated to move to its own package out of the engine).

1. **Turn-gated selection** — units are not selectable when it is not your turn; ending your turn deselects the active unit.
2. **Stamina** — a per-player action budget (max & default **3**) that refreshes to max at the start of each of your turns; `move`/`attack` cost 1; rejected at 0. Shown in the HUD while it is your turn — deterministic `GameSnapshot` state, projection-only (Invariant #105).
3. **AI players** — expose the existing AI-agent infrastructure in the lobby: a host **Add AI player** control (disabled when full), AI shown as a separate sub-list, AI auto-removed when a human join would exceed `maxPlayers`; plus a tactics AI brain (random move, attack a visible enemy). See [Lobby Agent-Slot Controls](../core-components/ai-framework-agent-system.md#lobby-agent-slot-controls).
4. **Commitment-scheme battle mode** — the first gameplay consumer of the commit/reveal primitive. A host-authored **Battle Setup** toggle (off by default) switches tactics from sequential turns to a **simultaneous commit-then-sync** turn: each player acts locally, commits, and a reveal-only `End Turn` (enabled only once every seat has committed) reveals and applies every player's actions in a deterministic, attack-first order; undo-before-commit refunds stamina. Invariants #103–#105 apply (reaffirms #2/#9/#71). See [Commit-then-sync Battle Mode](../security-trust/tactics-commitment-battle-mode.md) and [Commit-then-Sync Turns](../security-trust/fog-of-war-cryptographic-commitment.md#commit-then-sync-turns-commitment-as-a-turn-mechanism).

**GitHub**: [F54 — #720](https://github.com/jindrichruzicka/Chimera/issues/720)

---

## Cross-References

- [Logging & Crash Reporting](../core-components/logging-crash-reporting.md)
- [Replay System](../core-components/replay-system.md)
- [Chat System](../core-components/chat-system.md)
- [Toast Notification System](../core-components/toast-notification-system.md)
- [Runtime Debug Layer](../core-components/runtime-debug-layer.md)
- [Renderer Shell Pages UI Contract](../core-components/renderer-shell-pages-ui-contract.md)
- [Customizable Lobby Contract](../core-components/customizable-lobby-contract.md) — F53 host-authored match config, `snapshot.setup` projection
- [Commit-then-sync Battle Mode](../security-trust/tactics-commitment-battle-mode.md) — F54 commitment-scheme turn design + contract
- [State Obfuscation & Fog of War](../security-trust/fog-of-war-cryptographic-commitment.md) — F54 commit-then-sync turns (engine mechanism)
- [AI Framework and Agent System](../core-components/ai-framework-agent-system.md) — F54 lobby agent-slot controls
- [Testing Strategy](../testing/property-tests-soak.md) — soak test scenarios
- [E2E Testing (Playwright)](../testing/e2e-testing-playwright.md) — multiplayer-soak.spec.ts, obfuscation.spec.ts
