---
'@chimera-engine/electron': patch
---

Apply a player action on a heartbeat-driven host at the beat it arrives on.

`ActionPipeline.process()` refuses an envelope whose `tick` is not the snapshot's (`StaleActionError`).
A realtime host's `RealtimeTicker` advances that tick on its own, so the tick a sender stamps — the last
one the host pushed to it — is behind by the time the envelope arrives whenever that round trip spans a
beat. The action app's held-key e2e specs (`movement`, `two-player`, `autosave-continue`) passed on a
developer machine and failed on every completed run of the e2e workflow on main since the suite landed,
the primitive never moving; the diagnosis, on a runner an order slower, is that the round trip spans the
100 ms beat and each `action:set-velocity` is refused as stale. Reproduced on a developer machine by
forcing a 5 ms and a 1 ms beat through the e2e seam (`CHIMERA_E2E_REALTIME_TICK_MS`): the same specs
fail with the same signature, and pass again at both beats with this change.

The host's per-action fan-out (`runHostAction`) now re-stamps a received action with the current
snapshot tick before `applyAction` when a `RealtimeTicker` is driving the clock — every envelope
entering it, from the host's own renderer, a remote client or an AI seat — through
`restampForHeartbeatHost`, a pure helper with its own tests. A host with no ticker applies the envelope
as stamped, so `StaleActionError` still refuses a stale stamp where the clock moves only when someone
acts; the composition-root test pins both arms. Invariant #42 is unaffected: the tick applied is the
snapshot's own, and the recorded envelope carries it.
