# Shell contributions — what `loaders.ts` can turn on

The engine renders a complete main menu, settings pane, lobby and background without this
game contributing anything. Every field below is an OPTIONAL customisation, wired from
`renderer/loaders.ts` — the one module that hands the engine this game's renderer
contribution.

This file is the catalogue. `loaders.ts` carries one-line pointers and the values you edit;
the explanations live here because that file is one you edit, and prose next to an edited
line goes stale before a doc does.

## The two payloads, and which one a field belongs on

A game answers two payloads, and a field's HOME is the payload its CONSUMER loads — not the
one that declares it in the types.

- The **shell** payload (`load__GamePascal__RendererGameShell`) is what a menu route loads.
  The engine loads it without touching the game's screens, so a field here reaches the menu
  without dragging `screens/` and its lazy graph along.
- The **match** payload (`load__GamePascal__RendererGame`) is what a running game needs: the
  screen registry, the asset inventory, and `shell` itself.

`shell` is on the match payload deliberately. The engine's settings page resolves a game's
`settings` definition through the MATCH payload and never calls the shell loader, so a
`settings` definition declared on the shell payload alone is unreachable however complete it
is. Forwarding `shell` from the match loader is what closes that.

`inputActions` runs the other way. The engine's boot-time registrar reads it off the SHELL
payload, so a table carried on the match payload alone registers nothing until a match
starts — and Settings › Controls shows its empty caption for a game that declared a full key
map. The template carries it on the shell payload and reads it BACK onto the match one, so
both payloads hand the engine the same array. That matters: registering one id twice with a
different description, category or `oneShot` throws rather than last-write-winning.

## What a static import here costs

Everything `loaders.ts` imports STATICALLY is loaded on every screen the shell mounts, main
menu included. Keep those imports to plain data — no React, no `three`. The slots a game
fills with its own interface go through `shell/contributions.tsx`, which `loaders.ts` imports
dynamically, so they arrive as one chunk when the shell loads rather than sitting in front of
the menu.

## The catalogue

### Menu and navigation

- **`mainMenu`** — replaces the engine's button list with this game's own. A button may
  declare `{ type: 'start-game' }` to open a match without the lobby UI (optionally with a
  quick-start config naming match settings and per-seat attributes), or
  `{ type: 'continue' }` to reload the game's autosave. Neither navigates: the engine's
  snapshot gate carries the player into the match, fade included. A button may also declare
  `confirm` to ask first, through the engine's one confirm dialog. An EMPTY definition is a
  menu with no buttons, not the engine's — which is why it ships commented out rather than
  as an empty stub.
- **`menuCommands`** — handlers for this game's OWN menu commands, by id. A button declaring
  `{ type: 'command', commandId }` needs an entry here: rendering the menu THROWS on a command
  id no handler is registered for, rather than ignoring the button. The engine's own buttons
  declare no command, so an empty map is right until this game's menu declares one.
- **`shellRoutes`** — promotes this app's OWN Next routes to first-class shell pages: declare
  `['/credits']`, add `renderer/app/credits/page.tsx`, and the game background persists behind
  it, a menu navigation reaches it with the game context preserved, and a match started from
  it lands in the game screen. A declared route needs a real page in this app's tree — the
  static export emits nothing for a route it cannot find, so the navigation is a 404 the
  renderer never observes.

    Keep the declaration a `const` array literal inside `loaders.ts` if this game lives inside
    the Chimera monorepo. The check that pairs each declared route with a real page reads the
    initializer out of that source file and follows no import, so a constant moved to a module
    of its own reads as unreadable — which turns the missing-page check OFF for this game
    rather than failing it. A standalone project ships no such check.

### The background

- **`shellBackground`** — replaces the engine's flat menu surface with a component of this
  game's own.
- **`shellBackgroundAssets`** — the inventory the engine opens an asset session around for
  that component, so a background that renders declared files resolves its own refs rather
  than whatever the app-level manager happens to reach. Declared without a `shellBackground`
  it is inert: there is no subtree to publish the session to.
- **`shellBackgroundInteractive`** — lets that background take pointer input. The engine's own
  layers stand aside for it — the frame around every route's content stops eating clicks, and
  so does the main menu's container — but a surface inside that frame keeps working only
  because it declares `pointer-events: auto` for itself, and that includes any page this game
  ships. Copy the engine main menu's construction on a game page: `pointer-events: none` on
  the full-viewport container, `auto` restored on `> *`, so whatever the page grows next is
  clickable the day it is added. Absent or `false`, the background stays inert decor and is
  hidden from assistive tech, which is what a painted backdrop should be.

### Sound

- **`shellAudioAssets`** — gives the menu a voice. The audio hooks resolve their clips through
  the app-level audio manager, which reaches a game's clips only while something binds an
  inventory to it — a match does, and outside one this declaration is what does. With it,
  `useSound` and `useMusicTrack` work on the menu screens.
- **`shellMusicBed`** — a loop the engine plays across those screens for you; it fades out on
  its own when a match starts. Inert without `shellAudioAssets`, because that is what resolves
  the ref.

Both read from `shell-asset-manifest.ts` at the app root. That exact basename matters: the
asset validator tells a shell inventory from a match one by the file's NAME, and a manifest
under any other name is not one that fails to validate — it is one the gate never reads.

### The rest of the UI

- **`settings`** — this game's own settings pane definition, REPLACING the engine's rather
  than adding to it: the engine default is a fallback for an ABSENT field, so a declared
  definition that omits the engine's tabs loses them. Read off the MATCH payload, so `shell`
  has to be forwarded there (see above).
- **`LobbyScreen`** — a game-provided lobby screen, rendered in place of the engine default.
- **`icons`** — game-contributed UI glyphs, keyed `game.<gameId>.<name>`. Author them on the
  engine `IconGlyph` contract — a `viewBox` plus fill-based `content` carrying no `fill` — and
  `<Icon name="game.…">` renders them with currentColor and token sizing, exactly like a
  built-in, including inside an `<IconButton>`.
- **`translations`** — this game's UI bundles, layered over the engine's English. The declared
  language list comes from the manifest, so the two cannot disagree about which locales this
  game offers; a bundle for a locale the manifest does not declare is one the provider will
  never select.
- **`fonts`** — self-hosted font faces, declared in `shell/fonts.ts` and populated by this
  app's `fetch:fonts` script.
- **`cursor`** — the manifest's cursor declaration, forwarded verbatim; the renderer turns it
  into `--ch-cursor-*` token overrides.
- **`preloadImages`** — shell images to fetch and decode while the game loads, as game asset
  refs, so a menu hero paints in one frame instead of streaming in. Best-effort: a broken ref
  warns and never blocks the shell.
- **`inputActions`** — this game's rebindable actions, authored in `renderer/input-actions.ts`.
  See the payload note above for why they ride the shell payload.

## Theming is not on this list

`styles/tokens-override.css` re-themes the whole UI by redefining tokens the engine already
declares. It reaches the app through `styles/register-token-overrides.ts`, a side-effect
module the shell loader awaits as the very first thing it does — a stylesheet no module
imports is loaded by nothing, and tokens installed after first paint are a visible flash of
the engine defaults.
