---
'@chimera-engine/ai': minor
---

Skip the per-beat projection for agents that do not observe ticks.

`AgentManager.tickAll` projected a `PlayerSnapshot` for every registered agent and handed it to
`onTick`. `HumanPlayerAgent.onTick` is an empty body, so for every human seat that projection was
computed and thrown away on every beat — O(entities) per human seat, growing with the tick rate the
realtime arc is built to raise. `PlayerAgent` now carries `observesTicks`; `HumanPlayerAgent`
declares `false`, `AIPlayerAgent` declares `true`, and `tickAll` skips a `false` agent before either
the projection or the `onTick` call. The coordinator reads the flag, never `kind`. `onGameStart` and
`onGameEnd` still project for every agent.

An honest tick-observing agent receives the projector's own return, by identity, as before. The
skipped agent receives nothing, so the skip opens no path to unprojected state (Invariant #17).
