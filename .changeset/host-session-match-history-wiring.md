---
'@chimera-engine/electron': minor
'@chimera-engine/simulation': patch
---

Thread a game's declared match-history capability into the hosted session's undo policy, action-history
bound and start-of-match memento.

`buildHostSessionPipeline` hard-wired both collaborators: `new InMemoryActionHistory({ logger })` and
`new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replay)`. `HostSessionPipelineOptions` gains
`undoPolicy` and `retainActions`; both are optional and both default to what was hard-wired, so a
caller that passes neither builds exactly the pipeline it built before.

`undoPolicyForMatchHistory` maps a resolved `GameMatchHistorySupport` onto an `UndoPolicy`, reading
only `undo`. A game that keeps undo gets `DEFAULT_UNDO_POLICY` itself; one that declares none gets the
same policy with `allowUndo` false. The manager stays in `PipelineContext` either way, so `engine:undo`
still enters through the Stage 3 intercept and is refused there with `policy_disallows` (Invariant #7).

The composition root resolves the capability once from the hosted game's manifest, so no consumer of
it can disagree with another. The turn handover keeps seeding the next player's memento from inside `ActionPipeline`'s
`engine:end_turn` branch, which this change does not touch; what a declining game loses is the
start-of-match baseline, which is refreshed only by that same handover.

`apps/tactics` declares no `matchHistory`, so it resolves to undo on, replay on and the
`MAX_ACTION_HISTORY_ENTRIES` bound — the values the host already used, unchanged.

`apps/action` is `realtime: true`, so it resolves to undo off, replay on and a 1,000-entry history
where the host previously gave it `DEFAULT_UNDO_POLICY`, a start-of-match memento and 10,000 entries. Its Ctrl+Z binding is the engine default spread into the app's settings
schema; it survives, and the seat's projected `undoMeta.canUndo` is now `false`, which is what the
renderer's own key handler returns on.

Prose the change falsified is repaired rather than left standing: `InMemoryActionHistory`'s
`maxEntries` option is documented as a host knob rather than a test-only override, and Invariant #45,
the `ActionHistory` listing in the action-pipeline doc and three pending changesets no longer name
`MAX_ACTION_HISTORY_ENTRIES` as the bound every hosted session runs against.
