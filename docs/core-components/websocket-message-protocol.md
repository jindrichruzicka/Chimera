---
title: 'WebSocket Message Protocol'
description: 'LocalWebSocketProvider wire protocol — all ClientMessage and ServerMessage union types, CRC32 checksums, PING/PONG, and the scope of this protocol vs. other providers.'
tags: [websocket, protocol, multiplayer, networking, messages]
---

# WebSocket Message Protocol

> §4.3 of the Chimera architecture.
> Related: [Multiplayer Provider](multiplayer-provider-websocket.md) · [Simulation Core](simulation-core-action-pipeline.md) · [State Projection](state-projection-interfaces.md)

---

## Scope

This wire protocol is the **internal contract of `LocalWebSocketProvider`**. It is not part of the `MultiplayerProvider` interface — other providers (e.g. `SteamNetworkProvider`) use their own frames. Consumers of the simulation and IPC bridge interact only with typed `HostTransport` / `ClientTransport` calls and never see wire frames directly.

---

## Message Types

```typescript
// shared/messages.ts

// Client → Server
type ClientMessage =
    | {
          type: 'JOIN';
          token: string;
          profile: PlayerProfile; // Client attestation; admitted via ProfileSanitizer.admit()
      }
    | {
          type: 'ACTION';
          tick: number;
          action: EngineAction; // payload is raw Record<string,unknown>; ActionPipeline runs parsePayload() first
          checksum: number; // CRC32 of JSON(action) — integrity check, not security
      }
    | {
          type: 'PROFILE_UPDATE';
          profile: PlayerProfile; // Mid-lobby cosmetic update; see §4.24
      }
    | {
          type: 'CHAT';
          body: string; // Capped at 500 characters before sending
          scope: ChatScope; // 'lobby' | 'team' | 'private'
      }
    | {
          type: 'PING';
          sentAt: number; // performance.now() on sender (renderer-local; not simulation time)
      };

// Server → Client
// SNAPSHOT and DELTA carry PlayerSnapshot — GameSnapshot NEVER leaves the host
type ServerMessage =
    | {
          type: 'WELCOME';
          playerId: PlayerId;
          lobbyState: LobbyState; // lobbyState.profiles populated from PlayerDirectory
      }
    | {
          type: 'SNAPSHOT';
          snapshot: PlayerSnapshot;
          checksum: number; // CRC32 of JSON(snapshot) — integrity check
      }
    | {
          type: 'DELTA';
          fromTick: number;
          events: GameEvent[]; // Incremental update for low-bandwidth reconnects
      }
    | {
          type: 'REJECT';
          reason: string; // e.g. 'crc_mismatch' for an action-level rejection, 'host_closed' for terminal close
          tick: number; // Tick at which the action was rejected
      }
    | {
          type: 'REVEAL';
          reveal: CommitmentReveal; // Discloses a committed hidden value; client must verify()
      }
    | {
          type: 'CHAT';
          from: PlayerId;
          body: string;
          scope: ChatScope;
          serverTime: number; // Host wall-clock (for ordering only, not simulation time)
      }
    | {
          type: 'PONG';
          sentAt: number; // Echoed from PING; client subtracts to compute RTT
          serverTime: number;
      };
```

---

## CRC32 Checksums

The `checksum` field in `ACTION` (client→server) and `SNAPSHOT` (server→client) is CRC32 of the JSON-serialised payload. This provides a fast integrity guard against transport corruption. It is **not** a cryptographic security control — the `CommitmentScheme` (§4.6) handles anti-cheat.

An `ACTION` checksum mismatch produces `REJECT { reason: 'crc_mismatch' }` for that action only. The joined session remains connected; terminal session shutdown uses explicit reasons such as `host_closed`.

---

## PING / PONG Round-Trip Latency

Clients send a `PING` with `sentAt = performance.now()`. The server echoes it in a `PONG` immediately. The client computes `RTT = performance.now() - sentAt` and stores it in `PredictionStore.latencyMs`. This RTT is displayed in the `PerfHud` (§4.16).

---

## Profile Attestation on JOIN

When a client sends `JOIN`, the `profile` field is the client's **attestation**. The host runs `ProfileSanitizer.admit()` before admitting the player — size caps, MIME whitelist, image decode check, display-name length, and game-schema validation. A failed admission results in a `REJECT` response; the attestation never reaches any other subsystem.

---

## REVEAL Flow

1. Host generates a hidden value (dice roll, card draw).
2. Host calls `CommitmentScheme.commit(value)` → `CommitmentEnvelope` (SHA-256 of value+nonce).
3. Host broadcasts `CommitmentEnvelope` to all clients via the next `SNAPSHOT`.
4. At reveal time, host sends a `REVEAL` message with the original `value` and `nonce`.
5. Every client calls `CommitmentScheme.verify(reveal, envelope)` before trusting the revealed value.

> **Invariant #9** — `CommitmentScheme.verify()` is always called client-side on receipt of a `REVEAL` message before the revealed value is trusted.

---

## Cross-References

- [Multiplayer Provider](multiplayer-provider-websocket.md) — `LocalWebSocketProvider`, `HostTransport`, `ClientTransport`
- [State Projection](state-projection-interfaces.md) — `StateProjector` that produces the `PlayerSnapshot` in `SNAPSHOT`
- [Fog of War](../security-trust/fog-of-war-cryptographic-commitment.md) — `CommitmentScheme` details
- [Player Profiles](player-profiles-directory.md) — `ProfileSanitizer.admit()` used on `JOIN`
