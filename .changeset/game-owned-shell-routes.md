---
'@chimera-engine/renderer': minor
---

Make a game's own Next routes first-class shell pages. `LoadedRendererGameShell` gains
`shellRoutes?: readonly \`/${string}\`[]` — each entry naming a PHYSICAL page in the game's own host
tree (`apps/<game>/renderer/app/<route>/page.tsx`), the logo-screen and model-showcase precedent
promoted to a supported pattern (§4.37.17).

One declaration, three effects. `ShellBackgroundHost` mounts on the engine's background routes UNION
the declared ones, so one background instance survives `/main-menu → /<page> → /settings`. The
renderer's snapshot→`/game` gate admits the declared routes, so a match started from a game page
carries the player into the scene. A `navigate` menu action reaches a declared page as an ordinary
instant hop with `?gameId=` preserved — the treatment `/settings` and `/saves` already get.

The gate is an enumerated allow-set — `/lobby` on any phase, plus `/saves`, `/main-menu` and the
declared pages on a non-`'lobby'` phase — never a deny-list inversion, which would drag `/debug`,
`/component-gallery` and every undeclared route into a hop none of them asked for. The phase
condition is what keeps a return-to-lobby broadcast from bouncing those routes through `/game` into
the reverse effect's `reset()`. `shellRoutes` resolves asynchronously, so the gate re-evaluates when
the payload lands: a reload straight onto a game page can deliver a live match snapshot before the
declaration is known, and reading it once would strand the player on the page with a match running.
A game that declares nothing keeps the engine's route sets exactly as they were.

Every route comparison normalizes both sides (`renderer/shell/shellRoutes.ts`). The renderer is a
static export with `trailingSlash: true`, so the router reports `/credits/` for a route declared as
`'/credits'`, and the packaged app can serve it as `/credits/index.html`; a raw `===` comparison
would silently never match. The same module names `ENGINE_OWNED_ROUTES`, the engine's own page tree
— a declared route is by definition one the engine does not ship, which is what lets the background
host and the gate decide whether a route could be a game page before the payload has resolved, and
keeps `/game` from paying for a second shell load.

New `@chimera-engine/renderer/shell/shellPageChrome` exports `ShellPageChrome`, the settings-style
permanently-open modal a game page composes so it looks like one of the engine's own without
importing a renderer internal — the same `shell/*` allowance `gameAssetSession` uses, importable
only from the app's Next host tree. The page owns its body; geometry, the action row and the exit
are declarations, and the default exit returns to `/main-menu` with `?gameId=` carried along.

A declared route with no physical page cannot be caught at runtime — under a static export the
route is simply not emitted, so the navigation is a 404 the renderer never observes.
`tools/shell-page-routes.ts` checks the two halves against each other statically, and
`tools/shell-page-routes.test.ts` runs it under `pnpm test`. It reads `shellRoutes` off the
TypeScript AST per game and asks that game's own Next tree which routes it serves — asking rather
than probing for a guessed file path, so a page served from inside a route group counts. Three
things are findings: a declared route the tree does not serve, a declared route the engine owns (a
consumer app re-exports every engine route, so the page exists and the declaration is still inert),
and an initializer the scan cannot read statically, since a computed declaration would switch the
check off for that game.
