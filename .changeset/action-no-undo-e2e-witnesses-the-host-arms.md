---
'@chimera-engine/action': patch
---

Assert the action seat's own undo refusal in `no-undo.spec.ts`, off a projection fresh enough to mean
it.

A seat's `undoMeta` is derived per projection, and a real-time host broadcasts only a beat that changed
something — so an idle match leaves a seat holding the start-of-match projection, which reports
`canUndo: false` on a build with undo ARMED too, because at `engine:start_game` that seat has nothing to
undo yet. Read stale, that looked like an ineligibility upstream of the declaration; it is staleness.
The spec now pairs its refusal with a projection-tick comparison, so the assertion fails when the two
host arms are reverted rather than passing on the start-of-match answer. `electron/main/index.test.ts`
pins the start-of-match refusal, and pins that the start-of-match projection goes out before the seat's
memento is seeded — so the reading a seat holds is taken while it has no baseline to undo to at all.
