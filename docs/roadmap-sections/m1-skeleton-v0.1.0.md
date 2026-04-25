---
title: 'M1 — Skeleton (v0.1.0)'
description: 'F01–F08: Electron shell, Preload/IPC Bridge, Simulation Engine Stub, Deterministic RNG, Content Database, Save/Load Persistence, Settings System, and Development Tooling. Working Electron application that boots, bridges the renderer, runs a simulation stub, and can persist state.'
tags: [milestone, m1, electron, ipc, simulation, persistence, settings, dev-tooling]
---

# M1 — Skeleton (v0.1.0)

> **Goal**: Working Electron application that boots, bridges the renderer, runs a simulation stub, and can persist state.
> Architecture sections: §3, §4.1, §4.2, §4.2.1, §4.7, §4.8, §4.11, §4.13, §4.27, §4.32

---

## F01 — Electron Application Shell `§3 electron/main/index.ts`

Bootstrap the Electron entry point: create and manage the `BrowserWindow`, inject environment-specific configuration, load the Next.js static export from `renderer/out/`, and implement the clean-shutdown `lastCleanExit.flag` mechanism.

---

## F02 — Preload / IPC Bridge `§4.1`

Wire the full `window.__chimera` contextBridge surface. Declare all type-safe namespace files (`game-api.ts`, `lobby-api.ts`, `saves-api.ts`, `settings-api.ts`, `system-api.ts`) and compose them in `preload/api.ts`. Enforce `nodeIntegration: false` and `contextIsolation: true`.

**Carried over from F01:** verify the Electron app boots and loads the Next.js static export from `renderer/out/` — this §12 M1 checklist item could not be exercised in F01 because `preload/api.js` and a first Next.js page did not yet exist.

---

## F03 — Simulation Engine Stub `§4.2, §4.7`

Implement `BaseGameSnapshot`, `ActionEnvelope`, `ActionRegistry`, `ActionPipeline` (7-stage, fixed order), `StateReducer`, and `EngineActions` (reserved action set). No game-specific rules — just the invariant pipeline contract operating on a pass-through no-op game.

---

## F04 — Deterministic RNG and Clock `§4.2.1`

Implement `DeterministicRng` (splitmix64 → xoshiro256\*\*) and `SimulationClock`. Enforce Rule 1 (action-driven tick), Rule 2 (seeded RNG only), and the integer-state contract (Rule 3). Add `chimera/no-restricted-globals` ESLint rule blocking `Math.random` / `Date.now` inside `simulation/`.

---

## F05 — Content Database `§4.8`

Implement `DataRef<T>`, `AssetRef<T>`, `ContentDatabase`, `ContentLoader` (directory scan + flat-array format), ref-integrity checking, Zod schema validation, and `ContentConflictError` / `ContentSchemaError` error types.

---

## F06 — Save / Load Persistence `§4.11`

Implement `SaveFile`, `JsonSaveSerializer`, `CompressedSaveSerializer`, `SaveMigrator`, `SaveRepository` interface, `FileSaveRepository` (atomic `.tmp` rename), `InMemorySaveRepository`, and `SaveManager`. Wire `engine:save` and `engine:load` as reserved actions. Implement crash-recovery check (`lastCleanExit.flag`).

---

## F07 — Settings System `§4.13`

Implement `SettingsSchema`, `SettingsMerger` (three-layer merge), `SettingsRepository` interface, `FileSettingsRepository` (atomic write), `SettingsManager` with IPC handlers (`get`, `update`, `reset`, `onChange`). Add namespace-collision guard and `settingsStore` in the renderer.

---

## F08 — Development Tooling `§4.32, §4.27`

Set up `tools/dev-server.ts` hot-reload harness, `tools/dev-multiplayer.ts` launcher (with `CHIMERA_DEV_HARNESS` guard), seed dev profiles in `tools/dev-profiles/`, and the `Logger` interface backed by Pino with daily rotation. Wire `RootErrorBoundary` and `rendererLogger`.

---

## Cross-References

- [Electron Shell & IPC Bridge](../core-components/electron-shell-ipc-bridge.md)
- [Simulation Core & Action Pipeline](../core-components/simulation-core-action-pipeline.md)
- [Content Database & DataRefs](../core-components/content-database-data-refs.md)
- [Save / Load Persistence](../core-components/save-load-persistence.md)
- [Settings System](../core-components/settings-system.md)
- [Dev Tooling & Harness](../core-components/dev-tooling.md)
- [Logging & Crash Reporting](../core-components/logging-crash-reporting.md)
