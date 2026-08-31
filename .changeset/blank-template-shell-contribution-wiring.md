---
'create-chimera-game': minor
---

Wire the blank template's four inert shell contributions, and move the feature catalogue out of
`renderer/loaders.ts` into a doc that ships with the game.

Four of the optional shell features the template's own comments invited an adopter to use could
not work as the template shipped them, and each failure was silent — nothing threw, nothing
linted, nothing reddened.

**The token stylesheet was dead.** `styles/tokens-override.css` was imported by nothing: the only
mentions in the template tree were comments, the scaffolder injected no import, and the engine
root layout the app re-exports loads only its own three stylesheets. An adopter who edited the
accent family saw no change and had no signal pointing anywhere. The template now ships
`styles/register-token-overrides.ts` — a side-effect module whose only job is that import — and
the shell loader `await`s it as its FIRST statement. Awaited and first, because the shell renders
as soon as that loader resolves and tokens installed after first paint are a visible flash of the
engine defaults. The README claimed the shipped override was "working"; it now says what makes it
work.

**A game's settings pane could not be reached.** The engine settings page resolves a game's
definition through `loadRendererGame(gameId).shell?.settings` and never calls the shell loader, so
a `settings` definition declared on the shell payload — where the type declares it — was
unreachable however complete it was. The match loader now forwards `shell`.

**Input actions did not register at app boot.** The engine's boot-time registrar reads
`shell.inputActions`; the template put the table on the match payload only, so a scaffolded game's
actions were absent from Settings › Controls until the player had entered a match at least once.
The table moves out of `screens/index.tsx` into a plain-data `renderer/input-actions.ts` (reading
it off the screen registry would pull that module's whole `React.lazy` graph into the menu
bundle), rides the SHELL payload, and is read BACK onto the match payload through the
`exactOptionalPropertyTypes` spread — so both payloads hand the engine one array rather than two
that can disagree, which is what keeps the second registration a no-op instead of a throw.

**No shell asset manifest shipped.** `chimera-validate-assets` matches manifests on the WHOLE
basename against a closed set of `asset-manifest.ts` and `shell-asset-manifest.ts`; the template
shipped the first only, so turning on menu audio or an asset-backed background meant creating a
file at an exact name the adopter had to learn. `shell-asset-manifest.ts` now ships empty and
already forwarded as both `shellAudioAssets` and `shellBackgroundAssets`, the way
`asset-manifest.ts` already ships empty-but-wired.

**`loaders.ts` is now values rather than function bodies.** The dials an adopter edits —
`SHELL_ROUTES`, `SHELL_BACKGROUND_INTERACTIVE`, `SHELL_MUSIC_BED`, `PRELOAD_IMAGES`,
`MENU_COMMANDS`, `TRANSLATIONS` — are named constants at the top of the file, so switching one
on is changing a value rather than discovering a field. `SHELL_ROUTES` stays a same-file `const` array literal deliberately:
`tools/shell-page-routes.ts` resolves that identifier inside the parsed source file and follows no
import, so an extracted constant reads as `unreadable-declaration` — which turns the missing-page
check OFF for the game rather than failing it. The suite now runs that reader against the
template's own `loaders.ts` and pins `unreadable` empty, with a positive control proving the
reader bites on the extracted shape.

The slots a game fills with its own interface — `icons`, `mainMenu`, `settings`,
`shellBackground`, `LobbyScreen` — move to one dynamically imported `shell/contributions.tsx`.
`icons` ships empty-but-wired; the other four ship commented out, because each REPLACES an engine
default rather than adding to it and an empty `mainMenu` is a menu with no buttons. Everything
`loaders.ts` imports statically is loaded on every screen the shell mounts, so its static imports
are pinned to an exact four-module plain-data set.

**The feature catalogue moves to `renderer/shell-contributions.md`**, which ships into the
scaffolded game beside `loaders.ts`. Prose inside a file the adopter edits goes stale the moment
they edit around it — which is how the catalogue came to invite four features that could not work.
The suite reads the optional field list off `LoadedRendererGameShell` itself, so a shell field the
engine adds without a doc line reds here. §16.5 gains the matching carve-out: a markdown file the
TEMPLATE ships lands in the adopter's project, so pointing at it names a file they have — unlike a
reference back into this repo's `docs/`, which stays banned.

`asset-manifest.test.ts` now loops over BOTH inventories rather than the match one alone, so a
menu clip declared with the wrong kind fails the same byte-level check a match texture does — the
two resolve their refs under the same asset directory, and only the basename the validator
discovers them by differs.

The "no model game named" sweep stops depending on a hand-written file list and reads the whole
template tree instead, since the file such a list stops covering is always the newest one. The
tree walk those whole-tree checks run on now subtracts the copier's own `SKIP_DIRS`, cross-checked
against it: the walk reads file CONTENTS, so a stale local `node_modules` or `dist` left inside
the template by a previous run was being graded as template source.
