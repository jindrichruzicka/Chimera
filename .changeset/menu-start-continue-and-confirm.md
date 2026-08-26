---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': minor
---

Extend the declarative main-menu contract with the two engine-implemented verbs and a confirmation
primitive, so a game can express Continue and a lobby-skipping Start as pure menu data.

`GameMainMenuAction` gains `{ type: 'start-game'; config?: QuickStartConfig }` and
`{ type: 'continue' }`. Neither navigates: `start-game` invokes `chimera:lobby:quick-start` and
`continue` loads `autosaveSlotId(gameId)` through the ordinary `saves.load` restore funnel — the
same call the saves browser issues, so no restore machinery is added. Both verbs address one
concrete game, so rendering either with no `gameId` in context throws at render time, the way an
unregistered `command.commandId` already does.

Routing is not part of that change: neither verb navigates, each issues its IPC call and returns.
The hop into the match belongs to the renderer's snapshot→`/game` effect.

Availability is engine-computed and **reactive**, an honest change to §4.37.5's resolve-once model:
`RenderMainMenuDefinition` subscribes to `saveStore` and `lobbyStore`. A `continue` button enables
the moment a `chimera:saves:slot-update` push carries an autosave in and disables again when one is
deleted; both verbs stay disabled while a lobby session is live — host or joined alike — because
the menu is not the surface for acting on a session already in progress. The engine gates are resolved before a
game's own `disabled` and win over it, so a declaration cannot offer a Continue with nothing to
continue.

`GameMainMenuButton` gains `id?` (a testid slug the renderer renders as `main-menu-<id>`, for
entries the built-in derivation cannot name) and `confirm?: GameMenuConfirm`
(`when: 'always' | 'autosave-exists'`, plus title, body and control labels that resolve through
`t()` on the same terms as `label`). The existing hardcoded target map is retained, so an existing
game's page objects keep resolving; the two verbs add `main-menu-start` and `main-menu-continue`.

Confirmation is one primitive with two disclosure levels. `ConfirmDialogHost` is mounted once by
`AppShell` beside `ToastHost`, backed by a promise-resolving queue store, and `useConfirmDialog()`
— new on the `components/ui` barrel — returns `(options) => Promise<boolean>` that resolves `false`
on Cancel or Escape. The declarative `confirm` field resolves through that same store, and the host
shows only the head of its queue, so a question asked while one is open waits its turn rather than
stealing the surface. `when: 'autosave-exists'` holds its button disabled until the save slot list
has hydrated: until then "is there a save to overwrite?" has no answer, and a first-run player must
never be told they are about to overwrite a save that does not exist.

`ConfirmDialog` is also exported as a primitive for a surface that owns its own dialog state. Note
that the `components/ui` barrel now reaches one `renderer/state/` module — the confirm store — where
it previously reached none, so Invariant #96 and the §4.35 tier list drop the "stateless" qualifier
from the barrel's description. The store is created lazily, so importing
the barrel still constructs nothing, and the barrel guard now asserts that exact single-module set
rather than a blanket absence.

New engine tokens `engine.menu.continue` and `engine.menu.start` are the engine-supplied labels for
the two verbs, for a game menu definition to name as raw token strings. The confirm dialog's default
control labels reuse the existing `engine.common.confirm` / `engine.common.cancel` tokens, which had
no consumer until now.
