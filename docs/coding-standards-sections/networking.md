---
title: 'Chimera Coding Standards — §9 Networking'
description: 'Networking provider abstraction, message validation with Zod, CRC32 checksum enforcement, and per-player snapshot distribution rules.'
tags: [networking, MultiplayerProvider, WebSocket, Zod, CRC32, StateBroadcaster, coding-standards]
---

# §9 Networking

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 9.1 Provider abstraction

- All multiplayer code interacts through `MultiplayerProvider`, `HostTransport`, and `ClientTransport` interfaces.
- `ws` (or any transport library) is never imported outside `networking/provider/local/`. All other modules use the provider interfaces.

## 9.1.1 Extension seams within `local/`

- Provider-internal transports (e.g. `ServerConnection`) expose alternative wire backends through **optional constructor options that default to today's behaviour** — never by adding cross-module imports. Example: `ServerConnection`'s `resolveEndpoint` (default identity) and `socketFactory` (default `(u) => new WebSocket(u)`) let a future STUN/TURN/relay or WebRTC transport be injected without editing the connect path.
- Such seams type their dependency against a **minimal structural type** (e.g. `WebSocketLike`) that the default implementation satisfies, keeping `ws` the default-only dependency confined to `networking/provider/local/` (§9.1). The seam must stay additive: no new imports, and existing default behaviour proven unchanged by tests.

## 9.2 Message validation

- Every incoming `ClientMessage` and `ServerMessage` is validated against its Zod schema before processing. Malformed messages from the wire are untrusted input.
- The checksum in `ActionEnvelope` (CRC32) is verified on receipt. Failed checksum triggers a full state resync, not a crash.

## 9.3 Snapshot distribution

- `StateBroadcaster` calls `StateProjector.project()` per player before sending. Each client receives only its own `PlayerSnapshot`.
