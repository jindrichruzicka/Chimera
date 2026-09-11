---
'@chimera-engine/electron': patch
'@chimera-engine/simulation': patch
---

Honour a client's `engine:sync_request` on a host with no ticker, and keep the request out of the undo
history and the replay recording.

A client whose snapshot delta will not apply asks for a keyframe with `engine:sync_request`, stamped with
the tick of the last snapshot it holds. On a turn-based host the envelope reached `ActionPipeline` as
stamped, so a request behind the host's tick was refused with `StaleActionError` before Stage 7 could
force the full snapshot, and the client waited for the next keyframe.

The host's per-action fan-out now applies `engine:sync_request` at its current tick on every host. The
helper that re-stamps envelopes is renamed from `restampForHeartbeatHost` to `envelopeToApply`; every other
action on a host with no ticker is still applied as stamped, so a stale action there is still refused.

`ActionPipeline` Stage 6 no longer appends `engine:sync_request` to `ActionHistory`. Undo replays the
history since the memento minus its last `steps` entries, so an entry for the request was the step a
player's undo removed.

`buildHostSessionPipeline` no longer passes `engine:sync_request` to the replay recording.
`ReplayPlayer.step()` refuses a recorded action that does not advance the tick by exactly one, so a
recording across a re-sync could not be played past it.
