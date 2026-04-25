---
title: 'Undo/Redo Policy'
description: 'UndoPolicy interface, DEFAULT_UNDO_POLICY constant, Turn Boundary Rules, and the Hybrid Memento + Event Sourcing undo architecture.'
tags: [undo-redo, policy, memento, event-sourcing, simulation]
---

# Undo/Redo Policy

> §4.5 and §7 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Renderer State Stores](renderer-state-stores.md)

---

## UndoPolicy Interface

```typescript
interface UndoPolicy {
    allowUndo: boolean;
    maxUndoSteps: number; // 0 = unlimited within current turn
    crossTurnUndo: boolean; // Allow undoing past END_TURN? Default: false
    requireConsentFrom: PlayerId[]; // Empty = no consent; use for cooperative games
}

// Default: free unrestricted undo within your turn, cleared on END_TURN
const DEFAULT_UNDO_POLICY: UndoPolicy = {
    allowUndo: true,
    maxUndoSteps: 0,
    crossTurnUndo: false,
    requireConsentFrom: [],
};
```

---

## 7-Step Architecture — Hybrid Memento + Event Sourcing

Chimera's undo system combines two classical patterns:

| Pattern            | What it stores                                | Role in undo                                  |
| ------------------ | --------------------------------------------- | --------------------------------------------- |
| **Memento**        | Full `GameSnapshot` at each turn start        | Defines "baseline" for reconstruction         |
| **Event Sourcing** | Append-only `ActionHistory` since the memento | Replayed on top of the memento to reconstruct |

### Step-by-Step (Undo 1 Action)

```
1. UndoManager checks canUndo(playerId) against current UndoPolicy
2. Retrieves the most recent TurnMemento for this player
3. Replays all ActionHistoryEntries since the memento EXCEPT the last `steps` entries
4. Returns the reconstructed GameSnapshot
5. ActionPipeline broadcasts the reconstructed snapshot to all viewers
6. ActionHistoryEntry for the undo itself is appended (engine:undo is an EngineAction)
7. canUndo / canRedo are updated in PredictionStore → rendered in UI
```

### Turn Boundary Rules

| Scenario                                    | Behaviour                                         |
| ------------------------------------------- | ------------------------------------------------- |
| Undo within own turn (default policy)       | Always allowed; no consent needed                 |
| `END_TURN` already dispatched               | Undo blocked unless `crossTurnUndo: true`         |
| Multi-player consent (`requireConsentFrom`) | UNDO action dispatched; others confirm or decline |
| Undo past `TURN_MEMENTO_RETENTION=4`        | Blocked; memento no longer exists                 |

---

## Undo is an EngineAction

`engine:undo` and `engine:redo` are **EngineAction** types — they go through the normal `ActionPipeline` (stage 3: intercept). There is no side-door undo execution path.

Consequences:

- Undo requests can be rejected (e.g. other player's turn, policy disallows).
- Undo requests are recorded in `ActionHistory`.
- Undo results are broadcast via `StateBroadcaster` — all players see the reconstructed state.
- Undos appear in replays.

---

## Key Invariant

> **Invariant #7** — `engine:undo` and `engine:redo` are `EngineAction` types — they go through the normal `ActionPipeline`. There is no side-door undo execution path.

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `TurnMemento`, `ActionHistory`, `UndoManager`
- [Renderer State Stores](renderer-state-stores.md) — `PredictionStore.canUndo` / `canRedo` mirrors
