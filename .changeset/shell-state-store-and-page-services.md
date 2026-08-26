---
'@chimera-engine/renderer': minor
---

Ship the shell reactivity spine as ONE store, and publish the page services a game's own shell
surfaces need on `@chimera-engine/renderer/game` (§4.37.18).

`renderer/shell/shellStateStore.ts` is a module singleton carrying
`{ surface, pathname, gameId, transition, draft }`. The state is plain data, which is what makes
`getShellState()` a read a `useFrame` callback can make every frame without subscribing —
`useShellState(selector)` is the React half, and a per-frame read through it would re-render the
subscriber on every write it observes.

One classifier. A new `ShellStateBridge`, mounted beside `ShellBackgroundHost` inside `AppShell`'s
Suspense boundary, is the only module in `renderer/` that turns a pathname into a `ShellSurface`.
Before it there were three independent derivations — the background host, the snapshot navigation
gate, and the hook that resolved a game's declared shell routes — each with its own pathname source,
its own `?gameId=` read and its own route-set membership test; they agreed by review, and nothing
held them together. `useGameShellRoutes` is gone, and both surviving consumers read the published
surface. A census parses every production module under `renderer/` and asserts exactly one imports a
pathname-consuming helper from the route vocabulary.

`replay-player` is a surface of its own rather than a member of `replays`, because the reverse
navigation gate acts on the player route — a post-game replay opened over a still-live session — and
not on the browser; one member for both would widen a gate that was scoped on purpose. `boot` is the
catch-all: the initial state, `/`, `/logo-screen`, the engine developer routes, and any non-engine
route the active game has not declared.

The transition is armed the moment a match entry BEGINS — not when it lands — carrying the
screen-fade duration this hop runs on, so a background timing a dolly-in has the whole fade to move.
It clears on arrival, and on IPC REJECTION: a quick start the main process refuses must not leave a
background dollied into a match that never came, nor make the next unrelated route change read as a
match entry. The two match-entry verbs behind `start-game` / `continue` moved into
`renderer/shell/matchEntryVerbs.ts`, which owns that protocol for the menu and the facade alike.

`@chimera-engine/renderer/game` becomes a curated barrel (`renderer/game/index.ts`) instead of the
registry module itself. The registration seam's exports are unchanged; `_resetRendererGameRegistryForTest`
is no longer reachable, which is what the `_` prefix always meant. Added: `useShellState`,
`getShellState`, `setShellDraft`, `useShellNavigate()`, and
`useQuickStart()` — `{ start(config?), close(options?), continueFromAutosave(), hasAutosave }`.

`setShellDraft` is the only shell-state writer a game can reach; the barrel publishes no setter for
`surface`, `pathname`, `gameId` or `transition`, so a game reacts to a route change and never
authors one. The draft is a `QuickStartConfig`, so what a character-select page accumulates is
exactly what `start()` hands to `chimera:lobby:quick-start`: calling `start()` with nothing starts
the draft, and an explicit config merges over it per key. The draft is read at call time and never
subscribed to, so a component that only starts a match does not re-render on every keystroke a
sibling page makes; `hasAutosave` is the opposite by design and follows the live slot list.

Every `useQuickStart()` member rejects rather than throwing, including for a missing game context
and a missing preload bridge — a `Promise`-returning method that sometimes throws synchronously
breaks `void start().catch(report)`. The engine's own menu verbs keep an absent bridge a synchronous
throw, so an engine defect still reaches the crash fallback instead of a console line.
