---
title: 'M2 — Networked Lobby (v0.2.0)'
description: 'F09–F14: MultiplayerProvider abstraction, LocalWebSocketProvider, LobbyManager IPC wiring, Lobby UI/State Sync, WebSocket Message Protocol, and Player Profiles. Two independent Electron instances discover each other, connect, and synchronise lobby state.'
tags: [milestone, m2, networking, lobby, multiplayer, websocket, profiles]
---

# M2 — Networked Lobby (v0.2.0)

> **Goal**: Two independent Electron instances discover each other, connect, and synchronise lobby state.
> Architecture sections: §4.3, §4.4, §4.14, §4.24

---

## F09 — Multiplayer Provider Abstraction `§4.14`

Declare `MultiplayerProvider`, `HostTransport`, `ClientTransport`, `HostedSession`, `JoinedSession`, and `BrowsableProvider` interfaces. Implement the `isBrowsable()` type-narrowing helper. Commit `SteamNetworkProvider` stub with full interface compliance.

---

## F10 — LocalWebSocketProvider `§4.14 networking/provider/local/`

Implement `LocalWebSocketProvider` wrapping `LobbyServer`, `MessageRouter`, `WsHostTransport`, `ServerConnection`, and `WsClientTransport`. Encapsulate all ws internals; no imports from `networking/provider/local/` outside the provider.

---

## F11 — LobbyManager and IPC Wiring `§4.14 electron/main/lobby-manager.ts`

Implement `LobbyManager` with injected `MultiplayerProvider`. Wire `chimera:host-lobby` and `chimera:join-lobby` IPC handlers. Decouple `StateBroadcaster` and `MessageRouter` from ws — they talk exclusively through `HostTransport` / `ClientTransport`. Add provider-swap smoke test.

---

## F12 — Lobby UI and State Sync `§4.4 renderer/state/lobbyStore.ts`

Implement `lobbyStore` (Zustand). Build `lobby/page.tsx` with host / join / leave flows, player list with ready states, connection status indicator, and snapshot-driven pass-and-play handoff.

---

## F13 — WebSocket Message Protocol `§4.3`

Implement the full typed wire protocol (`ClientMessage`, `ServerMessage`) in `shared/messages.ts`. Add action checksums (CRC32) and `PING`/`PONG` round-trip latency measurement. Wire `SNAPSHOT` broadcast through `StateBroadcaster` → `HostTransport.sendSnapshot()`.

---

## F14 — Player Profiles and Directory `§4.24`

Implement `ProfileSchema`, `ProfileRepository` interface, `FileProfileRepository`, `InMemoryProfileRepository`, `ProfileManager`, `PlayerDirectory`, and `ProfileSanitizer.admit()`. Wire `JOIN` attestation, `PROFILE_UPDATE` side-channel, `profileStore`, and pass-and-play multi-seat support.

---

## Cross-References

- [Multiplayer Provider & WebSocket](../core-components/multiplayer-provider-websocket.md)
- [WebSocket Message Protocol](../core-components/websocket-message-protocol.md)
- [Renderer State Stores](../core-components/renderer-state-stores.md)
- [Player Profiles & Directory](../core-components/player-profiles-directory.md)
- [IPC Security Model](../security-trust/ipc-security-model.md)
