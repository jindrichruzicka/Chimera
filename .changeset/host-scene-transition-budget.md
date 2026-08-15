---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': minor
---

A scene transition waiting on a seat that cannot acknowledge is now released by a host-side
budget, instead of holding forever.

The barrier requires an `engine:scene_ready` from every key of `state.players`, and that action
has exactly one producer — `useFadeTransition`, inside a mounted `SceneRouter`. A seat with no
renderer never sends one: an AI seat has no renderer at all, and a disconnect mid-transition
leaves the seat in `state.players` with its renderer gone (no engine action removes a seat).
`SceneTransitionState.timeoutTicks` could not cover for it either, because a tick advances only
when an action is applied and a turn-based match applies none while a transition is pending.

`SessionRuntime` now measures a pending transition against a wall clock —
`DEFAULT_SCENE_TRANSITION_BUDGET_MS`, 30 s, above every client-side budget it has to outlast so
a slow-but-live client is never mistaken for a seat that cannot ack — and dispatches a new
host-only engine action, `engine:scene_expire`. That action carries no payload and decides
nothing: it sets `SceneTransitionState.expired`, which `isTransitionTimedOut` reads beside the
tick budget, so the descriptor's own `onClientTimeout` still chooses between committing and
dropping exactly as it does when the tick budget elapses.

The wall clock stays in the host runtime; the reduce remains pure and clock-free, and
`engine:scene_ready` still carries `{ playerId }` and nothing else — no client's load timing
enters authoritative state.

Worth knowing before a game adds a transition: in a match with an AI seat the acks can never
complete the barrier, so this budget is not a rescue there but the release path, and every scene
hop costs it in full. A game that adds a transition should pick `sceneTransitionBudgetMs` with
that case in mind.
