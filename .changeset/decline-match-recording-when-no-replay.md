---
'@chimera-engine/electron': minor
---

Record nothing for a game whose manifest declares `matchHistory.replay: false` — neither the
deterministic replay nor the host's or a joined client's perspective recording.

`createDeterministicReplayPort` already modelled declining: it answers `undefined` in a packaged
build, and the pipeline skips `recordAction` when the port is absent. The game's declaration joins
`app.isPackaged` as a second gate on the same factory, whose two parameters move into one
`DeterministicReplayGates` object (`isPackaged`, `replayDeclared`). The composition root is its only
caller in this repo, and the helper is not on `@chimera-engine/electron`'s exports map.

The perspective side declines in `startSessionRecordings`, which is also what return-to-lobby calls to
re-arm for a fresh match — so a declining game does not start a recording on the way back into a match
either. `hostPerspectiveActive` therefore stays `false` and the per-broadcast `recordSnapshot` is never
reached. A joined client's `clientPerspective` stays `null` for the same declaration.

Nothing new guards the save or preview paths. With no recording started, `exportCurrent` and the
current-match playback sentinel refuse exactly as they already do for a match that was never recorded:
the IPC invoke rejects and no file is written. A game whose post-game screen opens the current match
(as `apps/tactics` does) reaches that refusal rather than a crash or a frameless playback.

A game that resolves to `replay: true` records exactly as before.
