---
'@chimera-engine/simulation': patch
'@chimera-engine/renderer': patch
---

The scene actions that FINISH a transition now pass the terminal-match gate, so a transition
still in flight when a match resolves is no longer stranded by the guard itself.

Both terminal guards rejected everything once `gameResult` was recorded: the pipeline's own
gate, and the game route's `sendAction` wrapper. Nothing ties `gameResult` to `sceneTransition`
— and the game resolver runs on the output of every reduce, including the prepare's own — so
the state is reachable. There the rejection stranded the transition: the acks are what the host
waits for, the host's own commit or drop is what clears it, and the barrier's timeout is counted
in ticks that only an applied action advances.

`engine:scene_prepare` still does not pass: a resolved match may FINISH the transition it is in,
and may not BEGIN another. The set is one exported predicate,
`isSceneTransitionCompletionAction` in `simulation/foundation/scene-lifecycle.ts`, which both
guards consult — the renderer may not import the pipeline, and two copies of the list would
drift.

Admitting them is necessary and not sufficient: the release still needs every seat in
`state.players` to acknowledge, or the host's own budget to expire the transition. What a seat
that cannot acknowledge at all does to it is measured in
`simulation/scene/__tests__/unackable-seat-barrier.test.ts`.

Also fixed, in the same path: a scene commit landing after a result now carries the recorded
`gameResult` through unchanged. `initialize`/`teardown` may return any state and the commit
spreads it, so the newly-admitted commit would otherwise have been a door through which game
code could blank a recorded result and resume a finished match. Only `gameResult` is re-pinned,
so an entered scene still writes its own `phase`.

The spectator gate is unchanged: a seatless viewer has nothing to acknowledge for.
