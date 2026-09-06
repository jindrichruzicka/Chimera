---
'@chimera-engine/simulation': patch
'@chimera-engine/renderer': patch
'@chimera-engine/electron': patch
'@chimera-engine/tactics': patch
---

Remove the client-prediction surface, which was implemented and tested but reachable from nothing.

There was no client prediction: every action waited a full host round trip. What existed was a chain
where each link's only consumer was the next one, and the last led nowhere — `ActionDefinition.predictable`,
the `chimera:game:predictable-action-types` channel and its `GameAPI.getPredictableActionTypes()`
method, the `isPredictable` predicate the IPC client was built with, `gameStore.addPrediction` /
`confirmPrediction`, and the `predictedActions` array, which no component, hook or reducer anywhere
in the repo read. Beside it sat `ClientPredictor` and `ReconcileBuffer`, exported from the engine
barrel and unit-tested, constructed only in their own tests, and typed on `BaseGameSnapshot` — the
state Invariant #3 keeps inside the main process — so a client could not have used them as written.

All of it is gone, together with the comment in `ipcClient.ts` that forbade importing the two
classes: a prohibition outlives its subject as a puzzle, not a rule. `PredictionStore` is now
`MatchStatusStore`, carrying the three fields that survive — `latencyMs`, `canUndo`, `canRedo`. What `latencyMs` is written by, and
what reads it, is §6.3's.

§6 says what it costs to add prediction properly instead of describing what was there: the renderer
holds a `PlayerSnapshot`, so the reducers it would replay have to be renderer-safe and registered as
such, and the optimistic state may never become an authoritative write.

Breaking for adopters who set `predictable: true` on an action definition, or who call
`getPredictableActionTypes()`: both are removed. Neither did anything.
