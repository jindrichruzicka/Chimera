---
'@chimera-engine/renderer': patch
'@chimera-engine/tactics': patch
---

Give the tactics menu **Continue** and **Quick Match**, and prove both flows end to end — the F87
seams now have a shipped consumer instead of only a contract.

`apps/tactics/shell/main-menu.ts` gains two entries above the lobby flow: `{ type: 'continue' }`,
and `{ type: 'start-game', config: { aiSeats: [{}] } }` — host versus one AI, nothing else declared,
so the AI seat's colour comes from `resolveDefaultPlayerAttributes` exactly as a lobby-added AI's
does and the match settings are the ones `buildTacticsLobbySetup` already declares. New Game →
lobby is untouched, which is the point: the two exits of the in-game Leave now both have a live
caller on the same menu. Neither entry declares `disabled` — the engine's own gates answer for both,
so Continue is dark on a fresh profile and enables the moment the close's autosave lands. Quick
Match declares `id: 'quick-match'` because the engine derives only `main-menu-start` from the action
and could not distinguish a second start; Continue declares none, since `main-menu-continue` is
already the engine's own derivation.

**A user-facing correction rides with it.** The host leave prompt said the leave "returns all
players to the lobby". A host's exit depends on how the session was born — back to the lobby it came
from, or out of a lobby-less quick session to the main menu — and `InGameMenuProps` carries no way
to tell those apart, so the destination clause is now deleted rather than narrowed, in the engine
default menu and in both tactics bundles. The client copy is unchanged: a client always disconnects
to the main menu. Naming the destination again would need the engine to hand the menu the session's
exit, which is a contract widening this change deliberately does not make.

New e2e: `quick-match-continue.spec.ts` drives the shipped UI — the real `chimera:lobby:quick-start`
verb, never the `CHIMERA_E2E` direct-game latch, since a spec that booted into a match would leave
the verb untested. It proves the fresh-profile gate, a quick start that reaches `/game` without ever
visiting `/lobby`, a leave that lands on `/main-menu`, a Continue that returns the board as it stood
before the leave, a second leave that still lands on the menu (the session-mode stamp survived the
save file), and — beside them, on the same menu — New Game still opening the lobby and a lobby-born
session still returning to it.

New helper: `apps/tactics/e2e/helpers/route-trace.ts` records the routes a window VISITS by wrapping
`history.pushState` / `replaceState` and listening for `popstate`. `expect(page).toHaveURL()` samples
the URL that is current when it runs, so a route entered and left inside one commit is invisible to
it — and "the lobby was never passed through" is exactly a claim about routes that were not passed
through.

`GameStoreBootstrap`'s match-entry gate gains a matrix over the six flows the issue names.
Two of its rows stand on the same surface and are separated by the snapshot that lands there, which
is what a matrix keyed on the surface alone could not do: a gate conditioned on the session-mode
stamp, or on a fresh match's tick, passes `quick-from-menu` and fails `continue-from-menu`.
