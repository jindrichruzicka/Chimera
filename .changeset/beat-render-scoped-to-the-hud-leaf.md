---
'@chimera-engine/renderer': patch
---

Stop an authoritative beat cascading a render through the whole match tree.

`GameShellBaseProps.tick` is now OPTIONAL, and omitting it is the instruction: the HUD leaf
subscribes to the match store's clock itself, so a clock-only beat re-renders that one leaf instead
of the route, the frame, the router and the game screen hanging off it. Passing it keeps the old
behaviour and is what a clock that is not the live store's must do — the replay player drives its
own. Absence is distinguished from tick 0, which is a legal tick: the leaf reads `null` when the
store holds no match and falls back to the snapshot's own tick, so a shell mounted over a snapshot
the live store never saw still prints the right number.

The match route no longer selects `currentTick`. Its `sendAction` reads the clock from the store at
DISPATCH instead, which is strictly fresher than a value closed over at render time, and holds the
snapshot in a ref for the same reason. `SceneRouter` is memoised on its props, and each registry
screen is wrapped in `React.memo` through a module-level `WeakMap` keyed on the component — the
wrapper is the element's type, so a wrapper whose identity changed between renders would unmount
and remount the screen.

What the bail-outs actually rest on is the caller's callback identities, measured in
`SceneRouter.memo.test.tsx`, `GameShell.beat.test.tsx` and `page.beat.test.tsx` rather than
asserted. One consequence is written down where it bites: the fade transition's ready-dispatch
interval is pinned to the caller's `sendAction`, so a caller that re-creates that callback every
beat clears and re-arms the interval faster than its own period and it never fires.
