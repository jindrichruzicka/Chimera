---
'@chimera-engine/renderer': patch
'@chimera-engine/electron': patch
---

Pace a realtime game's authoritative snapshots to the frame clock, and fix a save race the change
surfaced.

`ipcClient` now holds the newest arriving `PlayerSnapshot` and applies it on the next animation
frame. Newest-wins, never a queue: a snapshot superseded inside one frame is dropped where it
stands, because draining it later would put the renderer a frame behind the host for nothing, and a
backlog the host can outpace has no bound. `onTick` is deliberately NOT paced and still writes the store on every beat.

The pacing is the game's choice, not a global default. Measured: with it on for everyone, a
turn-based canvas-interaction spec failed its first attempt on 3 of 3 runs, while the same tree with
pacing off was 3 of 3 clean — a turn-based game pushes on a player's action, where a frame of
presentation lag buys nothing and costs interaction fidelity. So `manifest.realtime` is forwarded on
`LoadedRendererGame` the way `matchHistory` already is, the match route publishes it, and the
client's scheduler asks whenever it requests a frame rather than once, because the client is built at app start
and no game is known then. A game that declares nothing keeps application on arrival.

The one addition a consumer can reach is `LoadedRendererGame.realtime`, on the `./game` subpath — the
scheduler types the pacing is built from are renderer internals (Invariant #96), reachable through no
export. `createIpcClient` still applies on arrival when given no scheduler, so an existing call site
is unchanged.

`FileSaveRepository.save()` now names its temp file per WRITE rather than per slot. The autosave slot
has two writers nothing serialises — the fire-and-forget autosave after `engine:end_turn`, and an
explicit `saves.save()` naming no `slotId`, which defaults onto that slot — and with one shared temp
path the first rename moved the file out from under the second, whose rename failed with `ENOENT` and
whose caller saw its save rejected while a file the other writer produced sat on disk.
