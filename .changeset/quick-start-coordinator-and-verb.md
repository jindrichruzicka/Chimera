---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': minor
---

Add the `chimera:lobby:quick-start` verb and the `QuickStartCoordinator` behind it — the one-click
path from a shell screen into a playable match, skipping the lobby UI.

It is orchestration sugar, never a second session constructor. `QuickStartCoordinator`
(`electron/main/runtime/QuickStartCoordinator.ts`, beside `SessionRestoreCoordinator`) is
ports-injected and holds no session objects; the lobby half of its ports is a structural slice of the
public `LobbyManager`, pinned assignable at compile time by its own test, so a port cannot grow into
a bespoke session door. The sequence: guards (active session, active restore, quick start already in
flight) → merge the game's `GameLobbySetup.quickStart` defaults UNDER the request →
`maxPlayers = 1 + localSeats.length + aiSeats.length`, a roster exactly full by design →
`hostLobby({ gameId, maxPlayers, agentSlots })` with the AI roster pre-seeded atomically through the
existing `agentSlots` seam (never an `addAi()` loop against a roster still being filled) → stamp
`engine.sessionMode` → apply the merged match settings, the host's attributes and each pass-and-play
seat's → ready → start.
Any throw after the lobby exists tears it down with `closeLobby()`, so a failed start never leaves a
session behind; a failure of the teardown itself is logged and the caller still sees the failure that
broke the start.

New reserved match-setting key `SESSION_MODE_SETTING` (`'engine.sessionMode'`) and its one value
`SESSION_MODE_QUICK` (`'quick'`) in `foundation/game-lobby-contract`, joining
`ALLOW_SPECTATORS_SETTING` under the engine's `engine.` namespace. Unlike that one it is not
host-settable: `SetMatchSettingPayloadSchema` refuses the key and `QuickStartParamsSchema` refuses it
inside a requested `matchSettings` map, so neither a custom lobby screen nor a game's own quick-start
defaults can flip it. It rides `matchSettings` into `snapshot.setup`, so it survives a window reload
and a restore; its absence means the session was born in the lobby.

New on the bridge contract: `QuickStartParams` (a `QuickStartConfig` addressed at one `gameId`) and
`LobbyAPI.quickStart(params): Promise<LobbyInfo>`, reached from the renderer as
`window.__chimera.lobby.quickStart`.

`AddLocalSeatOptions` gains `attributes`, merged per key OVER whatever the seat already carries — the
descriptor's seat defaults for a fresh seat, the seat's own picks on a re-add. This is how a
pass-and-play seat's picks are authored: such a seat has no connection, so the own-seat
`setPlayerAttribute` channel cannot reach it, and on a shared machine the host connection owns it.
Host-time seeding only; there is still no runtime attribute channel for a local seat.

Behaviour-neutral for every existing flow: `buildSetupFromLobbyState` and `matchId` minting are
untouched, no shipped flow ever authored `engine.sessionMode` on the newly-refusing
`chimera:lobby:set-match-setting` boundary, and a game that declares no `quickStart` block simply
has no quick-start defaults to merge.
