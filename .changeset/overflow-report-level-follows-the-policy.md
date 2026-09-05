---
'@chimera-engine/simulation': patch
---

Report `action-history:overflow` at `info` rather than `warn` when no undo replays the history.

The warn was written for a retention failure — a capability the player has, quietly reduced. A game
that declares no undo has no such capability: the entries the cap drops are read back through the undo
manager alone, since `HistoryContext.history` narrows the type to `append` and `pruneTo` for every
other consumer. The action app is the case that made this matter: it declares no undo, dispatches no
`engine:end_turn` and so never reaches `pruneTo`, and `ActionPipeline` appends every depth-0 dispatch
including `engine:tick`. At its resolved bound of 1_000 entries and a 100 ms beat that history
saturates about 100 seconds in and stays saturated, so a `warn` there names steady-state behaviour as
a fault and an operator who reads one learns nothing.

`InMemoryActionHistory` takes an `undoable` option, defaulting to `true` so an existing caller is
unchanged, and `buildHostSessionPipeline` supplies the resolved `UndoPolicy.allowUndo`. Only the level
moves: the message, the `capacity` context and the saturation latch are the same. `info` rather than
`debug` is where `resolveFileLogLevel` defaults the durable file sink's threshold (§4.27). Invariant
#45 and §4.5 state which level follows which resolved capability.
