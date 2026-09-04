---
'@chimera-engine/action': patch
---

Declare the action app's match-history capability on its manifest, and prove end to end that undo is
withheld.

`matchHistory: { undo: false, replay: true }` states what a real-time game's default already resolves
to. The point is that the intent is readable off the manifest rather than inferred from the loop mode:
this arena offers no undo, and keeps replay recording. `retainActions` is left to the real-time
default, because there is no intent there to record. A manifest test asserts the declaration resolves identically to the same manifest without it,
so this is documentation rather than a behaviour change.

The new `no-undo.spec.ts` measures the resolved capability in the shipped build. Three withholdings
have to hold at once there — the host arms a refusing policy, mints no start-of-match memento, and
the renderer registers no key subscription — and each is unit tested in isolation against a double.
The spec drives the shipped path into a match, moves the seat's primitive so there is something an
undo could take back, presses the engine's default undo binding, and asserts the primitive stayed
where the move left it while the HUD clock kept advancing. It is NOT sensitive to whether the capability was declared
or inherited: the two resolve identically, which is the manifest test's job to say.

The companion case asserts the match route renders no `undo` or `redo` control. Neither the engine
shell nor this app's HUD draws one today, so it is a regression guard rather than a measurement of
this change.
