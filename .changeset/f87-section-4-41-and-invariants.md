---
'create-chimera-game': patch
---

Close F87 in the documentation: author §4.41 — Quick Start, Session Mode & the Shell Flow Layer —
mint the four invariant rows the feature earned, and tell a scaffolded game about the two shell
capabilities it gained.

§4.41 is the session half of the flow layer, and it points at §4.37 for the presentation half rather
than restating it: what belongs here is how a match is BORN without the lobby UI. The
`QuickStartConfig` seat contract and its merge rules (maps per key, seat lists wholesale, because a
list's length is its seat count); `QuickStartCoordinator` as sugar over the public `LobbyManager`
verbs, with the driven sequence written out; the engine-owned `engine.sessionMode` stamp, the three
places that refuse it, and why a snapshot-carried stamp is the launch origin that survives both
a window reload and a restore; the atomic `chimera:lobby:close-session { autosave }` exit and the
`useLeaveGame` fork; the `autosaveSlotId` contract and the `saves:slot-update` push that make
Continue reactive rather than resolve-once; and the shell-state discipline a game page reads under.

Four invariants are minted, each with its roll-call classification row in the same commit:
**#137** quick start is sugar — the coordinator composes only public manager verbs, held by a
structural port slice, an ordered call log, and a source scan for a door that declares no port;
**#138** `engine.sessionMode` is engine-owned, so its absence means the session was born in the
lobby; **#139** shell state is read-mostly and inert — enumerated writers, one game-reachable one,
and nothing on the published state to dispatch WITH; **#140** one confirm surface, one visible
question. The roll-call's coverage table, total, numbering line and automatic-coverage percentage
were recomputed by parsing the ledger rows rather than edited by eye.

Two new census tests hold what the new rows claim. `renderer/shell/__tests__/shell-state-no-dispatch.test.ts`
takes two reads of the shell-state surface — what a reader is HANDED (an exact key set, plain data
throughout, walking into the objects the state nests) and what the surface DECLARES (a source scan
over the store, the bridge and the navigation hook) — because a dispatcher smuggled in as a value
passes the first and a parameter added to a hook erases before the second.
`QuickStartCoordinator.test.ts` gains the arm the compile-time port pin cannot reach: a reach that
bypasses the ports entirely declares no port at all, so the module's own comment-stripped source is
read for a session constructor and a start-game action.

The blank scaffold's shell loader now names `shellRoutes` in its growth comment and explains both of
the capabilities a new game can reach for: a `start-game` or `continue` menu button (neither
navigates — the engine's snapshot gate carries the player into the match, fade included, and a
button may declare `confirm` to ask first), and promoting the app's own Next routes to first-class
shell pages, where the game background persists behind them and a declared route needs a real
page in the app's own tree.
