---
'@chimera-engine/renderer': patch
---

Held input actions are now released when the window loses focus. `InputManager` cleared a
held action from its `keyup` handler alone, and a key let go while the app is in the
background sends the window no key-up at all — so the action stayed in `pressedActions`
forever and no subscriber was ever told it came up.

In a turn-based game that is invisible: a held key contributes nothing between presses. In
a realtime one a held key is a standing order, so it is a control that cannot be stopped —
in the action reference app an arrow writes a velocity the per-beat pass re-applies every
heartbeat, and alt-tabbing while holding one ran the primitive into the arena wall.

`start()` now also listens for the window's `blur` and the document's `visibilitychange`.
On a blur, or on a change whose new `visibilityState` is `hidden`, every held action is
dispatched with `pressed: false` in press order, and the pressed set is emptied before the
first callback runs — so a subscriber reading `isPressed` from inside its own release
callback cannot find that action still down. The reset is idempotent: the real key-up, if
one ever arrives, dispatches nothing a second time. `stop()` detaches both listeners.

A game needs no change to benefit — a screen already handling `pressed: false` receives the
synthesised release the way it receives a key-up, though the synthesised one carries no
modifiers and the code that pressed the action rather than the one that released it. A
screen that treated a release as proof the player pressed a key will now see one it did
not cause.

The release reaches a held gamepad action; it does not outlast one. `getGamepads()` goes on
reporting a button that is physically down, so the next `pollGamepad()` re-arms a
non-`oneShot` action; `InputManager.test.ts` pins that behaviour rather than leaving it to
be discovered.
