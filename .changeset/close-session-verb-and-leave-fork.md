---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': minor
'@chimera-engine/renderer': minor
---

Add the `chimera:lobby:close-session` verb and fork the in-game Leave on the session-mode stamp — the
exit a lobby-less, quick-started session needs, since it has no lobby to go back to.

`closeSession({ autosave })` is atomic by contract: one call captures the game's autosave (when
asked) and then tears the session down. A game-side "save, then leave" pair would race — a leave that
landed first leaves the capture with no session to read — so the pair is not offered. The composition
root's port composes exactly the two steps the crash path already composes,
`SessionRuntime.captureSaveFile` → `SaveManager.autoSave`, and then the public `closeLobby()`; there
is no second save reader or writer and no `engine:save` dispatch, so the capture stays an out-of-band
host call and the `chimera:saves:slot-update` push still fires from the single `SaveManager`
`onSlotsChanged` seam. A "Continue" offered right after the exit therefore finds the fresh autosave.
`activeSession !== null` is the host gate: the reference is set only inside `onSessionHosted`, so a
joined client is refused and leaves through `chimera:lobby:leave` as before.

`useLeaveGame`'s host path now picks its exit by reading `engine.sessionMode` off the live snapshot's
`setup`: `'quick'` closes the session and raises the leaving-to-main-menu intent (routing owns the
fade, the snapshot reset and the navigation); anything else — including every save written before the
stamp existed — keeps today's `returnToLobby()` → `/lobby` path byte for byte. Reading the stamp off
the snapshot rather than off renderer-held state is what makes the answer survive a window reload and
a save restore.

`InGameMenuProps.leaveGame` widens to `(options?: LeaveGameOptions) => void`, and the renderer's
`LeaveGame` type with it. `autosave` defaults to `true`, so an Escape-exit keeps the match and a menu
that offers "abandon" must ask to discard. It is deliberately NOT the `gameplay.autoSave` user
setting: that toggle governs turn-interval autosaves during play, so reading it here would silently
lose the match for a player who turned it off. The option is ignored wherever the session survives
the leave.

New on the bridge contract: `CloseSessionParams` and `LobbyAPI.closeSession(params): Promise<void>`,
reached from the renderer as `window.__chimera.lobby.closeSession`. `RegisterLobbyHandlersOptions`
gains a required `closeSession` port, mirroring `quickStart` — a composition root that forgot to wire
it cannot register a lobby namespace with the verb silently missing.

No shipped game calls `quickStart`, so no session carries the stamp yet and the fork itself changes
nothing reachable today. Two things outside it do change. The renderer's lobby-bridge resolver now
also requires `closeSession`, so a bridge double in a game's own tests needs the third verb. And the
replay player now answers the leave-to-main-menu intent itself, which fixes a client's Leave from a
post-game replay: it raised that intent, and on that route nothing consumed it, so the leave
disconnected and then went nowhere. It now lands on the main menu.
