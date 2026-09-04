---
'@chimera-engine/renderer': minor
---

Withhold the undo and redo affordances from a game that declares no undo — both the `/game` route's
key registrations and the handlers it hands the shell.

Manifest data reaches the renderer only when a game re-forwards a named field from its own
`renderer/loaders.ts` — the renderer package is import-banned from `apps/*`. So this is a second
declaration, not a read of the main-side one. `LoadedRendererGame` gains an optional `matchHistory` carrying the
game's RESOLVED capability, forwarded the same way `translations.languages` already is. Absent ⇒ undo
is offered, which is what every game got before the field existed.

`useInputAction` gains an `enabled` option (its `UseInputActionOptions` type stays off the
`@chimera-engine/renderer/input` barrel's closed export set — a call site passes an object literal). `false` registers NOTHING rather than registering a
callback that ignores the press, so the hook call itself stays unconditional at the top level and it
is the effect that is gated — React's rules of hooks are untouched. The subscription is established
and torn down as the flag flips.

The `/game` route reads `matchHistory.undo` for both surfaces: it passes `enabled` to the
`engine:undo` and `engine:redo` registrations, and withholds `onUndo`/`onRedo` from `GameShell`
entirely rather than passing disabled handlers — the same shape `onSaveGame` already uses. The engine
shell draws no undo control of its own, so what a game's own HUD receives is `undoDisabled: true`.
The capability is read only once the game payload has loaded: until then it is unknown rather than
absent, so no key is registered on the way in and torn down after.

`apps/tactics` is turn-based and declares nothing, so it resolves to undo on: it keeps both key
registrations and both handlers.
`apps/action` is real-time, so it resolves to undo off: its Ctrl+Z now reaches no listener at all. It reached one before, but that listener returns on `!snapshot.undoMeta.canUndo`,
which the host has projected `false` for this game since the host-side sibling landed — so what this
removes is the registration, not a live dispatch.
