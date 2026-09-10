---
'@chimera-engine/networking': minor
'@chimera-engine/electron': minor
---

`StateBroadcaster` no longer diffs or serialises for a recipient nothing will receive.

`HostTransport` gains `isReachable(playerId)`: whether a snapshot sent to that player now would
reach a client, which is the check `sendSnapshot` makes before dropping a frame. The WebSocket
transport answers with its open-socket check and the in-memory transport with its client lookup.
Breaking for anyone implementing `HostTransport` themselves.

Before sending, `StateBroadcaster` asks the transport and its own renderer recipients. A recipient
neither will deliver to — the transport cannot reach it and no renderer is bound to it — is sent
nothing, costs no diff, no size test and no keyframe serialisation, and keeps no baseline, so the
first frame it gets once it is reachable again is a keyframe. The host's own seat keeps its renderer
leg on deltas: it is never reachable over the transport, and its renderer consumes the delta.

`electron/main/__tests__/BroadcasterPerBeatPerf.bench.test.ts` measures the broadcaster per wave
for reachable seats, for seats nothing receives, and for projection alone; §7.5 records the numbers.
