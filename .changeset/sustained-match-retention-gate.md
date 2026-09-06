---
'@chimera-engine/simulation': patch
'@chimera-engine/electron': patch
---

Add a sustained-match retention gate that fails when a retained structure grows without bound.

Every growth defect this arc found shares one shape: a structure that grows with elapsed beats and
nothing that notices. The new `electron/main/__tests__/sustained-match-retention.integration.test.ts`
drives a REAL hosted session with the action history, the deterministic recorder and the perspective
recorder armed, through a harness under `electron/main/__test-support__/`. The §13.4 heap gate
builds a bare `ActionPipeline`, so none of those three is wired there.

It probes the defect class rather than an instance: retained sizes are sampled at N beats and again
at 2N and compared, so the assertion is about growth rate and not about a byte number that drifts.
Two scales, because the capped buffers must be sampled past a 10,000 cap while the per-beat working
state must be sampled small — `TimerManager.advance` walks the timer registry once per beat, so a
fired timer that survives its beat makes the run quadratic, and a synchronous beat loop cannot be
cut short by a test timeout.

Two small observability seams make it possible. `InMemoryActionHistory.size()` reports the live
entry count — what `maxEntries` bounds, whole rather than the undoable tail `sizeSinceLastMemento()`
reports once a turn memento has re-based it. `HostSessionPipelineResult.retainedActionCount()`
surfaces it for a session whose history is constructed inside `buildHostSessionPipeline`.
