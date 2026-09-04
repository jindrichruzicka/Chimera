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
}

// Default: free unrestricted undo within your turn, cleared on END_TURN
const DEFAULT_UNDO_POLICY: UndoPolicy = {
    allowUndo: true,
    maxUndoSteps: 0,
    crossTurnUndo: false,
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

| Scenario                                                 | Behaviour                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Undo within own turn (default policy)                    | Allowed                                                                                                  |
| `END_TURN` already dispatched                            | Undo blocked unless `crossTurnUndo: true`                                                                |
| Undo past `TURN_MEMENTO_RETENTION=4`                     | Blocked; memento no longer exists                                                                        |
| The game declares no undo                                | Refused by the policy (`policy_disallows`); no start-of-match memento exists either                      |
| Eviction cut into the history recorded since the memento | Blocked; a player whose own undo already moved them onto the manager's copy of the segment is unaffected |

---

## Declared match history

A game states what history it needs the host to keep, on its manifest:

```typescript
interface GameMatchHistorySupport {
    undo: boolean;
    replay: boolean;
    retainActions?: number; // positive integer ≤ MAX_ACTION_HISTORY_ENTRIES
}

interface GameManifest {
    // …
    matchHistory?: GameMatchHistorySupport;
}
```

`resolveMatchHistorySupport(manifest)` answers all three fields, so no caller
re-implements a default. Absent fields key off `realtime`:

| `realtime` | `undo`  | `replay` | `retainActions`                   |
| ---------- | ------- | -------- | --------------------------------- |
| `false`    | `true`  | `true`   | `MAX_ACTION_HISTORY_ENTRIES`      |
| `true`     | `false` | `true`   | `DEFAULT_REALTIME_RETAIN_ACTIONS` |

The turn-based row is what the engine did before the field existed, so a
turn-based game that declares nothing is unaffected by the field. `realtime` is
read for truthiness, the same reading `resolveTickerHz` uses, so the two forks
cannot disagree about which games are real-time. The resolver never throws:
malformed input is dropped per field, following `resolveGameLanguages` rather
than `resolveTickerHz`, so a bad manifest degrades instead of bricking a boot.

### What the host does with it

The composition root resolves the capability once. What `undo` drives from that
one value:

- **The policy.** `undoPolicyForMatchHistory` maps `undo` onto an
  `UndoPolicy`: `true` gives `DEFAULT_UNDO_POLICY` itself, `false` gives the same
  policy with `allowUndo: false`. The manager stays in `PipelineContext` either
  way — the refusal has to reach the Stage 3 intercept (Invariant #7), and
  removing the manager would instead let `engine:undo` through as an ordinary
  engine action and append it to history.
- **The history bound.** `retainActions` becomes `InMemoryActionHistory`'s
  `maxEntries` (Invariant #45).
- **The start-of-match memento.** A game declaring no undo mints none. The turn
  handover is untouched: `ActionPipeline`'s `engine:end_turn` branch still seeds
  the next player's memento, and the policy is what refuses undo against it.

### What the renderer does with it

Manifest data reaches the renderer only as registration payload — the renderer
package is import-banned from `apps/*` (§3). A game forwards its **resolved**
capability on
`LoadedRendererGame.matchHistory` from its own `renderer/loaders.ts`, and the
`/game` route reads `undo` for two surfaces: it passes `enabled: false` to the
`engine:undo` / `engine:redo` `useInputAction` registrations, so no key
subscription exists at all, and it withholds `onUndo`/`onRedo` from `GameShell`
rather than passing disabled handlers. The engine shell draws no undo control of
its own, so a game's HUD receives `undoDisabled: true`.

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
