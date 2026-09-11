---
'@chimera-engine/simulation': minor
---

Guard the timer payload against values a save cannot hold.

`GameTimer.payload` and `FiredTimerAction.payload` narrow from `Record<string, unknown>` to
`TimerPayload`: JSON-persistable values with integer numbers — strings, integers, booleans, `null`,
arrays and plain objects, nested as the fired action needs. `TimerManager.create` refuses a
non-integer number, a `bigint`, an `undefined`, a function, a symbol, a `Date`, a `Map` or a class
instance with a `RangeError` naming the field, at any depth: a `FixedPoint` (a `bigint`) used to be
accepted and then made the match unsavable at the first autosave, a float is forbidden in simulation
state, and a function, a `NaN`, a `Date` or a `Map` came back from a save as something else. A timer
authored with a string entity id or a nested target is unaffected.
