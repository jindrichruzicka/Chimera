---
'@chimera-engine/electron': patch
---

Fire the match-start lifecycle for AI-completed rosters, and hold the wall-clock heartbeat until
the session leaves the lobby.

`seatLobbyAgentsForGameStart` seated the lobby's AI into the active roster but never re-entered
the start gate, so a roster that only reached its seat count inside `onGameStartRequested` —
host plus lobby-added AI, the ordinary single-player shape — never fired
`SimulationHost.onGameStart` and never started `RealtimeTicker`. Tactics survived because its AI
is pumped from `afterTick`; a `manifest.realtime` game would have started frozen.
`onGameStartRequested` now re-enters the gate itself, after `engine:start_game` is applied and
after the first player's turn memento is seeded — `onGameStart` reaches an AI brain's state
machine synchronously, so a memento seeded behind it would take a human's undo baseline from a
snapshot already carrying an AI's move.

The gate's two halves ask different questions and are now gated separately. `onGameStart` fires
once the roster is SETTLED, which normally means full — the missing seats are ones the session is
waiting for — but `LobbyManager.startGame` gates on readiness and not on a full lobby, so the
start request additionally declares the roster final and an under-cap start no longer waits for a
seat that is never coming.

The heartbeat now arms on the session having LEFT THE LOBBY, not on roster completion. The two
are not the same moment: a roster can be full while the host still holds the lobby open (host-time
`agentSlots`, or every human already joined), and a lobby-phase `engine:tick` is not inert — the
reducer admits it in every phase and advances the clock. An early arm therefore shifted the tick
`engine:start_game` is stamped with and wrote pre-start beats into the deterministic recording,
which is armed back at host time. Measured before the fix: ten lobby heartbeat periods produced
ten `engine:tick` envelopes in the recording ahead of `engine:start_game`; after it, the first
recorded action is `engine:start_game`. The arm EXCLUDES `lobby` rather than allow-listing
`playing`, because a game names its own in-match phases and a restored save carries whichever one
it was in.

Recording arming stays in `onSessionHosted` and `engine:start_game` semantics are unchanged
(Invariants #71, #101).
