---
'@chimera-engine/simulation': minor
---

Resolve `FixedPoint`'s persistence gap: it is arithmetic, not storage.

A `FixedPoint` is a `bigint`, and every persistence boundary in the engine is bare
`JSON.stringify`, which throws on a `bigint` rather than degrading; no reviver on the way back
produces one. Invariant #75 no longer names `FixedPoint` as the stored form of a fractional gameplay
quantity: that form is a scaled integer `number` in a declared unit (milli-cells, basis points),
which Invariant #44 already blesses, JSON-native and allocation-free on a realtime beat path.
`FixedPoint` stays the arithmetic that produces such a value, converted with `toInt()` before it
reaches a `GameSnapshot` field or an `EngineAction.payload`, and its doc comment now says so.

`AnimationWindowPayload` narrows from `number | FixedPoint` to `number`, and
`AnimationWindowManager.open` refuses any payload value that
is not an integer `number` (a float, a `bigint`, or a non-number that arrived through a cast) with
the same `RangeError` it already raised for a float. A window opened with a `FixedPoint` value used
to be accepted and then made the match unsavable at the first autosave.

The alternative — a paired `bigint` replacer/reviver at every boundary, a save `schemaVersion`
bump with a migrator step, and a checksum that still verifies a save written before it — was
weighed and not taken: it keeps a per-operation `bigint` allocation on every hot path and touches
four boundaries to preserve a representation with no production call site.
