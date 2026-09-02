---
'@chimera-engine/electron': minor
---

Give the perspective replay frame buffer an explicit ceiling with oldest-frame eviction.

`PerspectiveReplayManager.recordSnapshot` appended a whole projected `PlayerSnapshot` to
`recording.frames` with viewerId and tick-order checks but no capacity check — a sweep of
`electron/main/replay` for `maxFrames|cap|truncat|prune|evict` returned nothing. The buffer is
released per **match** — `abort()` on return-to-lobby, on session close and on joined teardown — not
per session, so what it holds is set by how long one uninterrupted match runs.

For a turn-based game that is bounded by the players. For a realtime host it was not: a frame is
retained per CHANGED beat, so growth tracked time-in-motion, and each frame is a whole projected
snapshot whose size scales with the game's entity count.

`PerspectiveReplayManager` now takes a `maxFrames` option defaulting to
`DEFAULT_MAX_PERSPECTIVE_REPLAY_FRAMES`. A non-positive or non-integer value throws at construction
rather than degrading to unbounded. The default matches `MAX_ACTION_HISTORY_ENTRIES` — the engine's
existing order of magnitude for a per-match retained buffer — and nothing more is claimed for it:
the two fill at different rates, since the action history appends on every depth-0 dispatch while a
frame is retained only when the beat changed something.

On overflow the oldest frame is dropped and a `perspective-replay:overflow` warn carrying
`maxFrames` is raised **once per recording** — past the ceiling every frame evicts, so a
per-eviction warn would be a log line per beat for the rest of the match. The latch lives on the
recording state rather than on the manager, so a second match that overflows reports again.

Eviction moves the FRONT of the buffer while `recordSnapshot`'s strictly-increasing-tick check reads
the back, so a dropped frame cannot make a later one look out of order — pinned by a test that
records past the ceiling and then offers both an evicted tick and a retained one, expecting both to
be skipped. Every existing validation, `durationTicks`, and the file format are untouched, and
playback reads an overflowed file without special-casing: it binary-searches frames by tick and
already holds the first frame for any tick before it. What an overflowed file costs the viewer is
its prefix — `durationTicks` still spans the whole match, so the scrubber's early range renders the
earliest retained frame held.

Overflowing a long match costs the OLDEST frames of its perspective replay. That is a retention
decision, not a correctness one, and it is independent of any per-game switch that turns recording
off.
