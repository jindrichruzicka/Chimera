---
'@chimera-engine/electron': patch
---

Keep an applied `engine:sync_request` out of the Inspector's action log.

The request changes nothing and leaves the tick where it was, so the debug bridge used to log it
as a state-changing action: the next action, applied at the same tick, then read as a tick
regression, was compacted with a warning, and the bridge's redo stash was wiped while the engine's
own redo buffer was not. The bridge now treats a sync request like undo and redo and does not append
it or touch the redo stash.
