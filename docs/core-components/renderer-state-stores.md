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
    addPrediction(action: EngineAction): void;
    confirmPrediction(tick: number): void;
}

// Convenience composition exposed to components
type GameStore = SnapshotStore & PredictionStore;
```

---

## Store Catalogue

The renderer composes several small Zustand stores rather than one god-store (ISP).

**Rule of thumb:** If state is owned by the main process (saves, settings, profiles, lobby membership), the renderer store is an IPC-mirror and writes only via an `apply*` method called by `renderer/bridge/ipcClient.ts`. If state is purely visual/local (predictions, toasts, perf samples, chat buffer), the store owns its source of truth and components may write directly.

| Store           | Scope   | Source of truth                             | Writers                                                            | Clears on      |
| --------------- | ------- | ------------------------------------------- | ------------------------------------------------------------------ | -------------- |
| `gameStore`     | match   | main (snapshot) / renderer (prediction)     | `ipcClient.applySnapshot`; components via `addPrediction`          | match end      |
| `lobbyStore`    | session | main (`LobbyManager`)                       | `ipcClient.applyLobbyState`                                        | disconnect     |
| `saveStore`     | app     | main (`SaveManager`) — slot list UI only    | `ipcClient.applySaveSlots`; components (selection)                 | —              |
| `settingsStore` | app     | main (`SettingsManager`)                    | `ipcClient.applySettings`; settings UI via `settings.update()` IPC | —              |
| `profileStore`  | session | main (`ProfileManager` + `PlayerDirectory`) | `ipcClient.applyProfileDirectory`; `profile.updateLocal()` IPC     | lobby close    |
| `chatStore`     | session | renderer (rolling 500-entry buffer)         | `ipcClient.onChatMessage` push; components (mute flags)            | lobby close    |
| `toastStore`    | app     | renderer                                    | any component via `show()` / `dismiss()`                           | app close      |
| `perfStore`     | app     | renderer (`PerfProbe`)                      | `PerfProbe` only                                                   | app close      |
| `uiStore`       | app     | renderer                                    | components (menu state, modal stack, `activeScreenKey`)            | app close      |
| `cameraStore`   | screen  | renderer                                    | game board components                                              | screen unmount |

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
