---
'@chimera-engine/action': patch
---

Build the action app's per-beat entities copy only once a primitive moves.

`advanceActionPrimitives` copied `state.entities` before walking it and returned the input reference
only after discovering that nothing had moved. The early-out was already load-bearing — with every
field handed back by reference the pipeline keeps an idle beat on its clock-only broadcast, and the
perspective recorder's growth stays proportional to time in motion — but the copy was paid on every
beat regardless. The copy is now materialised on the first primitive that actually changes cell; an
idle beat, or a beat whose only moving primitive is clamped against the arena wall, walks the record
without building a copy. The contract is unchanged: the input reference comes back when nothing
moved, a moved beat returns a new record with only the moved entities replaced, and the input is
never mutated.
