---
'@chimera-engine/electron': patch
---

Pin `ReplayPlaybackManager.#projectedAt`'s `step()`/`seek()` fork.

`#projectedAt` forks on `absoluteTick === active.lastTick + 1`: a `step()` fast path for the
sequential case, falling back to `active.player.seek(absoluteTick)` on `step()`'s `null` (end of
recording) or when the request isn't sequential. Two independent mutants on that fork survived: the
whole fork replaced by an unconditional `seek(absoluteTick)`, and `next ?? active.player.seek(...)`
replaced by `next as BaseGameSnapshot`. Both left `electron/main/replay` green.

Both arms answer a sequential request with the same snapshot, so no tick assertion can separate
them — the pre-existing test named `advances one tick via step on sequential requests` asserted only
ticks, so its title was a claim its body did not make. What differs is which call the fork makes:
that test now spies `ReplayPlayer.prototype.step`/`seek` and asserts the sequential walk takes one
`seek` (the initial non-sequential request) and two `step`s, never a further `seek`. Under the
unconditional-seek mutant, `seek` is called 3 times instead of 1.

The end-of-replay arm needed a fixture that runs `step()` out from a fast-path position: a new test
requests one tick past the final recorded action, so `step()` returns `null` and `?? seek(...)`
answers with the refusal — a `ReplaySeekError` naming the requested tick, not a snapshot. Drop that
arm and the `null` reaches `state.tick`, turning the refusal into a `TypeError`.

The manager is unchanged; this is test coverage only. `PerspectiveReplayPlaybackManager` binary-
searches stored frames and holds no equivalent fork, so it is untouched.
