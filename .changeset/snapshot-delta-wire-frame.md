---
'@chimera-engine/simulation': minor
'@chimera-engine/networking': minor
'@chimera-engine/electron': minor
---

Send the changed paths instead of the whole projection, with periodic keyframes.

`SNAPSHOT_DELTA` is a new `ServerMessage`. It carries a `SnapshotDelta`, a `version` (a client built for
another version REFUSES the frame at `ServerMessageSchema.safeParse` rather than applying it as if it
were this shape), and a CRC32 over the `delta` — the bytes the frame actually carries.
`ServerConnection` validates that checksum against the pre-Zod bytes exactly as it does a `SNAPSHOT`,
because a corrupt delta is the worse of the two: a snapshot REPLACES the client's state, so the next
one repairs it, while a delta is APPLIED to state the client keeps.

`StateBroadcaster` now keeps the last projection it sent each recipient and sends a delta against it.
Where it sends a whole snapshot instead is `StateBroadcaster.sendProjection`'s to say; the
size-fallback case also leaves a `trace` line and bumps a counter on `deltaMetrics()`.

`BroadcastContext.broadcast` gains a third argument, `{ forceFull }`, which Stage 7 sets for
`engine:sync_request`. The callback cannot infer it: a re-sync arriving after a run of clock-only beats
has a projection that genuinely DID change, so an empty diff is not the signal — and the viewer that
asked to be re-synced is precisely the one whose baseline the host cannot vouch for. Without it
`multiplayer-soak.spec.ts` fails: its `requestFullSnapshotSync` produced a delta rather than the
keyframe its name promises. Point-sends stay whole
snapshots: every caller of one is asking for the whole thing by definition. The baseline is keyed by RECIPIENT rather than by seat, so a spectator is diffed against
what that spectator received, and the broadcaster subscribes to `onPlayerLeft` itself to drop a
departed recipient's entry — the composition root's own handler returns early down several branches,
and a baseline left behind on any of them is the unbounded map this work exists to remove.

`HostTransport` gains `sendSnapshotDelta`. `ClientTransport` is unchanged: `WsClientTransport` and the
in-memory provider both rebuild the whole projection from the delta and publish THAT, so
`onSnapshotReceived` still hands subscribers a whole snapshot and nothing above the transport learns a
delta was on the wire. A delta the client cannot apply is dropped — never partially applied — and the
next whole snapshot re-establishes the chain. `WsClientTransport` also asks for one, sending
`engine:sync_request` once per broken chain, since that request makes the host broadcast to every viewer
rather than only to the asker.

The checksum `onSnapshotReceived` carries is now documented as the one the host stamped on the frame,
over that frame's own body, and the delta path passes it through rather than measuring the rebuild.
Measuring cannot give the host's number: `ServerMessageSchema` rebuilds a parsed snapshot in the
SCHEMA's key order rather than the host projector's, and `crc32Json` is order-sensitive, so two deeply
equal objects check differently. Comparing a host checksum with a client one is therefore meaningful
only across a whole-snapshot frame.

Breaking for anyone implementing `HostTransport` outside this repo: `sendSnapshotDelta` is required.
