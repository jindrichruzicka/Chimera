---
title: 'M3 — Action Registry, Game Loop & Undo/Redo (v0.3.0)'
description: 'F15–F21: Full ActionPipeline integration, UndoManager/TurnMemento, Client Prediction, SaveManager IPC/UI, Settings UI, Fixed-Point Math (Q32.32), and Game Timers. The full action pipeline is live, undo/redo works end-to-end, game state persists and migrates, and settings survive app restart.'
tags:
    [
        milestone,
        m3,
        action-pipeline,
        undo-redo,
        client-prediction,
        save-load,
        settings,
        fixed-point,
        timers,
    ]
---

# M3 — Action Registry, Game Loop & Undo/Redo (v0.3.0)

> **Goal**: The full action pipeline is live, undo/redo works end-to-end, game state persists and migrates, and settings survive app restart.
> Architecture sections: §4.2, §4.4, §4.5, §4.7, §4.11, §4.13, §4.20, §4.31, §6, §7

---

## F15 — Full ActionPipeline Integration `§4.7`

Complete the 7-stage `ActionPipeline` with validated game actions, `UnknownActionTypeError`, `ActionSchemaError`, and `ValidationResult`. Implement `EngineActions` (undo, redo, end_turn, sync_request, save, load). Enforce namespace collision guard (`engine:` prefix).

---

## F16 — UndoManager and Turn Memento `§4.5, §7`

Implement `UndoManager`, `TurnMemento`, `ActionHistory` (with `TurnMemento`-bounded pruning), and `UndoPolicy`. Wire `engine:undo` / `engine:redo` as interceptable actions in `ActionPipeline` Stage 3. Reflect `canUndo` / `canRedo` in `PlayerSnapshot.undoMeta`.

---

## F17 — Client Prediction `§6 simulation/prediction/`

Implement `ClientPredictor` and `ReconcileBuffer` for actions where `predictable: true`. Wire into `ipcClient.sendAction()`. Limit prediction to non-randomised, own-player-only actions. Reconcile on authoritative snapshot receipt.

---

## F18 — Save Manager IPC and SaveScreen UI `§4.11`

Complete `SaveManager` IPC handlers (`listSaves`, `saveGame`, `loadGame`, `deleteSave`, `onSlotUpdate`). Implement `SaveScreen` renderer page reading `saveStore.slots`. Wire autosave after `engine:end_turn`.

---

## F19 — Settings UI `§4.13`

Build `settings/page.tsx` rendering engine-wide and game-specific settings fields. Wire `window.__chimera.settings.update()` and `reset()`. Validate that settings propagate across app relaunch and that the `onChange` subscription keeps the UI live.

---

## F20 — Fixed-Point Math `§4.31`

Implement `FixedPoint` (Q32.32 `bigint`), full arithmetic suite (`add`, `sub`, `mul`, `div`, `sqrt`, `sin`, `cos`, `atan2`), and conversion helpers (`fromInt`, `fromRatio`, `fromFloat`, `toFloat`, `toInt`). Add `chimera/no-fromfloat-in-simulation` ESLint rule. Add `FP_ZERO`, `FP_ONE`, `FP_HALF`, `FP_PI` constants.

---

## F21 — Game Timers `§4.20`

Implement `GameTimer`, `TimerRegistry`, and `TimerManager` (`create`, `cancel`, `advance`). Wire `TimerManager.advance()` into the `engine:tick` reducer via `ctx.dispatch()` (re-entrant, bounded by `MAX_NESTED_DISPATCH = 16`). Serialise `snapshot.timers` in saves.

---

## Cross-References

- [Simulation Core & Action Pipeline](../core-components/simulation-core-action-pipeline.md)
- [Undo/Redo Policy](../core-components/undo-redo-policy.md)
- [Save / Load Persistence](../core-components/save-load-persistence.md)
- [Settings System](../core-components/settings-system.md)
- [Fixed-Point Math](../core-components/fixed-point-math.md)
- [Game Timers](../core-components/game-timers.md)
