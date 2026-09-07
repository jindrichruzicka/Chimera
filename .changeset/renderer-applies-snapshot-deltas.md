---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': minor
'@chimera-engine/renderer': minor
---

Apply snapshot deltas in the renderer bridge, and measure what the delta path saves.

`GameAPI` gains `onSnapshotDelta` and the `chimera:game:snapshot-delta` channel. On a beat the
broadcaster decided is a delta, main sends the changed paths instead of the whole projection — that
IPC leg cost a structured clone of a whole projection per beat, and the changed paths are what it
costs instead. Main still keeps the projection for what needs it in-process: `getCurrentSnapshot`
answers with it and the perspective recorder appends it, both pinned.

`ipcClient` holds the last snapshot it RECEIVED, separate from the store's, which is the last one
PAINTED — the host measures the next delta against the former. Deltas are applied on arrival and only
the store WRITE is paced: newest-wins is right for a whole snapshot, which is measured against
nothing, and wrong for a delta, which is measured against what the one before it produced. So a frame
carries one write with everything that accumulated in it and no delta is dropped. An inapplicable
delta is refused rather than partly applied, and `engine:sync_request` is sent once per broken chain.

`RendererSnapshotRecipient.sendSnapshot` now takes the delta alongside the projection — `null` on a
keyframe. Breaking for anyone who registered a recipient directly.

The measurement F101 asked for is now in `OutboundPerBeatPerf.bench.test.ts` and recorded in §7.5, at
both ends of the axis the delta path lives on. At a realtime beat's motion — 25 of 500 entities, 100 of
2000 — the payload is about a twentieth of the projection at both grids. With nearly the whole arena
moving the delta is LARGER than the snapshot it would replace, about 105% of its bytes, which is the
case `StateBroadcaster`'s size fallback exists for. Each run reports the count `measureDeltaWave` counted, and
neither delta row is gated: a ratio asserted there would gate the runner
rather than the code.
