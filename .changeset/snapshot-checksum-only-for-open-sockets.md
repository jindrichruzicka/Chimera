---
'@chimera-engine/networking': patch
---

Compute the outbound SNAPSHOT checksum only for a viewer with an open socket, and serialise the
snapshot once per frame.

`WsHostTransport.sendSnapshot` built `{ type: 'SNAPSHOT', snapshot, checksum: crc32Json(snapshot) }`
— a full `JSON.stringify` plus a per-byte CRC walk — and only then handed it to
`LobbyServer.sendToPlayer`, which looks the connection up and silently drops the frame when there is
no open socket. The local host seat is served in-process and never appears in either connection map,
so in a solo match every byte of that work was discarded. A connected seat then paid a second
`JSON.stringify` inside `sendToPlayer`, re-serialising the body it had just been given.

`LobbyServer` gains `hasOpenSocket(playerId)` — the same lookup `sendToPlayer` performs, over both
the seated-player and the spectator map — and `sendRawToPlayer(playerId, frame)` for a frame the
caller has already serialised. `sendSnapshot` returns before any work when the viewer has no open
socket; otherwise it stringifies the snapshot once, runs `crc32` over that exact string, and
assembles the frame around it. The wire bytes and the checksum are unchanged: the frame is
byte-identical to `JSON.stringify` of the previous message object, so the client's
`crc32Json(snapshot)` verification still matches.
