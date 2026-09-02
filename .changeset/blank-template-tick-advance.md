---
'create-chimera-game': patch
---

Advance the tick in the blank template's example reducer, and ship a reducer smoke beside it.

The example action every scaffolded game starts from had `reduce(state) { return state; }`. That
teaches the wrong thing: `GameSnapshot.tick` is the engine's clock and its action count, and
replaying a recorded match feeds the same actions back through the game's reducers expecting each
to land the tick one higher. A game built from the old template records actions
`ReplayPlayer.step()` refuses with a `DeterminismError`. It now returns
`{ ...state, tick: state.tick + 1 }`, with the rule explained in plain language beside it —
including that an action which would change nothing belongs in `validate`, not in a reducer that
declines to move the clock.

The template also ships `simulation/actions.test.ts`: a reducer unit smoke that registers the
example action through a real `ActionRegistry`, asserts the tick advance and asserts the input
snapshot is not mutated. `verify:scaffold` collects it as part of the generated app's own
`pnpm test`.
