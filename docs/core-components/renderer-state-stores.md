---
title: 'Renderer State Stores'
description: 'All Zustand stores in the renderer: SnapshotStore, PredictionStore, GameStore composition, and the full store catalogue with ownership rules, writers, and clear-on semantics.'
tags: [renderer, zustand, state, stores, ipc-mirror]
---

# Renderer State Stores

> §4.4 of the Chimera architecture.
> Related: [Electron Shell](electron-shell-ipc-bridge.md) · [Simulation Core](simulation-core-action-pipeline.md) · [Undo/Redo Policy](undo-redo-policy.md)

---

## Core Rule

The renderer **reads** state; it never writes simulation state directly. All game-state writes go through `sendAction()` → IPC → `ActionPipeline` on the main process. The renderer store receives `PlayerSnapshot` (never `GameSnapshot`) from the main process via IPC.

---

## GameStore — Split into Two Focused Interfaces (ISP)

```typescript
// SnapshotStore — authoritative view projected from the host
// Read-only from components; only ipcClient may call applySnapshot()
interface SnapshotStore {
    readonly snapshot: PlayerSnapshot | null;
    /** Called by ipcClient only. Never call from components. */
    applySnapshot(snapshot: PlayerSnapshot): void;
}

// PredictionStore — client-side optimistic prediction queue
interface PredictionStore {
    readonly predictedActions: readonly EngineAction[];
    readonly latencyMs: number;
    readonly canUndo: boolean; // Mirrored from snapshot.undoMeta
    readonly canRedo: boolean;
    /** ipcClient only — do NOT call from components. */
    addPrediction(action: EngineAction): void;
    /** ipcClient only — do NOT call from components. */
    confirmPrediction(tick: number): void;
}

// Convenience composition exposed to components
type GameStore = SnapshotStore & PredictionStore;
```

---

## Store Catalogue

The renderer composes several small Zustand stores rather than one god-store (ISP).

**Rule of thumb:** If state is owned by the main process (saves, settings, profiles, lobby membership), the renderer store is an IPC-mirror and writes only via an `apply*` method called by `renderer/bridge/ipcClient.ts`. If state is purely visual/local (predictions, toasts, perf samples, chat buffer), the store owns its source of truth and components may write directly.

| Store           | Scope   | Source of truth                                                                                              | Writers                                                                                                                                                                                          | Clears on      |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `gameStore`     | match   | main (snapshot) / renderer (prediction)                                                                      | `ipcClient` only — `applySnapshot`, `addPrediction`, `confirmPrediction`                                                                                                                         | match end      |
| `lobbyStore`    | session | main (`LobbyManager`)                                                                                        | `ipcClient.applyLobbyState`                                                                                                                                                                      | disconnect     |
| `saveStore`     | app     | main (`SaveManager`) — slot list; main (`SessionRestoreCoordinator`) — restore-status slim projection (#828) | `ipcClient.applySaveSlots` / `applyRestoreStatus` (bootstrap only); components (selection; `dismissRestore` — sanctioned optimistic reset of the local restore mirror, main stays authoritative) | —              |
| `settingsStore` | app     | main (`SettingsManager`)                                                                                     | `ipcClient.applySettings`; settings UI via `settings.update()` IPC                                                                                                                               | —              |
| `profileStore`  | session | main (`ProfileManager` + `PlayerDirectory`)                                                                  | `ipcClient.applyProfileDirectory`; `profile.updateLocal()` IPC                                                                                                                                   | lobby close    |
| `chatStore`     | session | renderer (rolling 500-entry buffer)                                                                          | `ipcClient.onChatMessage` push; components (mute flags)                                                                                                                                          | lobby close    |
| `toastStore`    | app     | renderer                                                                                                     | any component via `push()` / `dismiss()` / `dismissAll()`                                                                                                                                        | app close      |
| `perfStore`     | app     | renderer                                                                                                     | `PerfProbe` (GL metrics); `bootstrapPerfStore` (tick/ping/heap); action system (RTT)                                                                                                             | app close      |
| `uiStore`       | app     | renderer                                                                                                     | components (menu state, modal stack, `activeScreenKey`)                                                                                                                                          | app close      |
| `cameraStore`   | screen  | renderer                                                                                                     | game board components                                                                                                                                                                            | screen unmount |

Adding a new store requires an entry in this table. Do not extend an existing store to carry unrelated state — prefer a new, focused store.

---

## Selector Rule

Components must subscribe to Zustand via **narrow typed selectors** — never the whole store:

```typescript
// ✅ Correct — narrow selector
const snapshot = useGameStore((s) => s.snapshot);

// ❌ Wrong — subscribes to entire store, causes spurious re-renders
const store = useGameStore();
```

---

## `useSendAction()` Hook

Actions are dispatched through a typed hook, never via `window.__chimera.game.sendAction()` directly:

```typescript
// renderer/hooks/useSendAction.ts
export function useSendAction(): (action: EngineAction) => void {
    return useCallback((action: EngineAction) => {
        window.__chimera.game.sendAction(action);
    }, []);
}
```

---

## Route-Global Lobby Bootstrap (`renderer/app/LobbyStoreBootstrap.tsx`)

`renderer/app/LobbyStoreBootstrap.tsx` mounts from the root layout so every route,
including `/game`, receives lobby-state updates. It wires `bootstrapLobbyStore(...)`
to `window.__chimera.lobby.onUpdate` and `window.__chimera.system.onConnectionStatus`, then
calls `lobby.getCurrentState()` once to replay an already-active main-process lobby session.

This replay lets deep-linked or E2E direct-game `/game` boots distinguish "no session exists"
from "a hidden lobby session exists but the first `PlayerSnapshot` has not arrived yet". The
match route redirects to `/lobby` only after that initial lobby replay has completed and no lobby
state is active.

## Lobby Page Integration (`renderer/app/lobby/page.tsx`)

The lobby screen uses two small renderer-local helpers to keep component code typed and boundary-safe:

### `lobbyConfig` (query-string normalization)

`renderer/app/lobby/lobbyConfig.ts` provides:

- `getDefaultLobbyConfig()` for SSR-safe initial render values.
- `parseLobbyConfig(searchParams)` for client-side query parsing.

Rules enforced by `parseLobbyConfig`:

- `gameId` defaults to the configured default game's id when absent.
- `maxPlayers` accepts only integer strings.
- Invalid values fall back to `4`.
- Final `maxPlayers` is clamped to `[2, 16]`.

The page initializes state with defaults, then updates config in `useEffect` after mount. This avoids server/client hydration divergence while still supporting URL overrides.

### `useLobbyApi` (typed lobby bridge access)

`renderer/app/lobby/useLobbyApi.ts` centralizes bridge access for lobby actions and the root
bootstrap bridge lookup:

- `useLobbyApi()` exposes typed `host`, `join`, and `leave` methods.
- `getLobbyBridge()` resolves `{ lobby, system }` for route-global bootstrap wiring.

Component code does not call `window.__chimera.lobby.*` directly. The lobby page delegates writes through `useLobbyApi`; route-global bootstrap owns `bootstrapLobbyStore(...)` wiring.

This keeps lobby writes consistent with the typed-hook pattern and makes bridge-availability handling testable in one place.

---

## Key Invariants

- **Invariant #3** — `GameSnapshot` never leaves main process; `PlayerSnapshot` is what the renderer receives.
- **Invariant #4** — The renderer reads state; it never writes state directly.

---

## Cross-References

- [Chat System](chat-system.md) — `chatStore` detail (§4.29)
- [Toast Notification System](toast-notification-system.md) — `toastStore` detail (§4.30)
- [Performance HUD](performance-hud-device-info.md) — `perfStore` detail (§4.16)
- [Player Profiles](player-profiles-directory.md) — `profileStore` detail (§4.24)
- [Save/Load Persistence](save-load-persistence.md) — `saveStore` detail (§4.11)
- [Settings System](settings-system.md) — `settingsStore` detail (§4.13)
