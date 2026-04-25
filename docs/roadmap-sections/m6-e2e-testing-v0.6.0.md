---
title: 'M6 — End-to-End Testing Layer (v0.6.0)'
description: 'F30–F34: Playwright Infrastructure, Page Object Model, IPC/WebSocket Test Helpers, Core E2E Specs (lobby/match-flow/undo-redo/obfuscation/reconnect/multiplayer-soak), and Save/Settings E2E Specs. Full Playwright suite green in CI.'
tags: [milestone, m6, e2e, playwright, testing, lobby, multiplayer, save-load, settings]
---

# M6 — End-to-End Testing Layer (v0.6.0)

> **Goal**: Full Playwright suite green in CI, covering lobby, match, undo/redo, obfuscation, reconnect, and soak.
> Architecture sections: §13

---

## F30 — Playwright Infrastructure `§13`

**Earliest start: after F02 lands.** The boot-smoke fixture (`electron.fixture.ts`) requires a real preload bridge and at least one renderer page to load. The full multiplayer fixture (`lobby.fixture.ts`) additionally requires M2 (F09–F11).

Set up `e2e/playwright.config.ts`, `global-setup.ts`, `CHIMERA_E2E=1` flag, and `__e2eHooks` on `globalThis` in `simulation-host.ts`. Implement base `electron.fixture.ts` (boot smoke: window opens, `window.__chimera` is defined) immediately after F02. Implement multiplayer `lobby.fixture.ts` after M2. Add CI workflow `e2e.yml` with Xvfb on Linux.

---

## F31 — Page Object Model `§13.6`

Implement `MainMenuPage`, `LobbyPage`, `MatchPage`, and `SettingsPage` page objects covering all primary interactions. Add `data-testid` attributes to all engine shell components.

---

## F32 — IPC and WebSocket Test Helpers `§13.7`

Implement `ipc-spy.ts` (`getHostSnapshot`, `getSimulationTick`, `getLastBroadcastChecksum`), `ws-inspector.ts` (frame tap), `snapshot-assert.ts` (`assertNoLeakedFields`, `assertChecksumMatch`, `assertTickAdvanced`), and `tick-driver.ts` (programmatic tick dispatch).

---

## F33 — Core E2E Specs `§13.8`

Write and green all mandatory specs: `lobby.spec.ts`, `match-flow.spec.ts`, `undo-redo.spec.ts`, `obfuscation.spec.ts`, `reconnect.spec.ts`, and `multiplayer-soak.spec.ts` (1 000-tick checksum convergence).

---

## F34 — Save and Settings E2E Specs `§10.1`

Write: (a) save/load E2E — play to turn 3, save, relaunch, load, assert tick matches; (b) crash recovery E2E — force-kill, relaunch, accept "Resume", assert correct tick; (c) settings E2E — change `masterVolume`, relaunch, assert persists, reset returns defaults.

---

## Cross-References

- [E2E Testing (Playwright)](../testing/e2e-testing-playwright.md) — full spec & fixture documentation
- [Testing Strategy](../testing/property-tests-soak.md) — unit + property test layer
- [Dev Tooling & Harness](../core-components/dev-tooling.md) — interactive counterpart
