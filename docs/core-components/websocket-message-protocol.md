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
// simulation/foundation/messages.ts

// Client → Server
type ClientMessage =
    | {
          type: 'JOIN';
          token: string;
          profile: PlayerProfile; // Client attestation; admitted via ProfileSanitizer.admit()
          reconnectPlayerId?: PlayerId; // Reclaim a dropped identity that connected this session (#687)
          password?: string; // Lobby password, compared timing-safe by the host (F56)
          claims?: JoinSeatClaim[]; // Saved-seat claims: ≤16 opaque {matchId, playerId} entries, ids ≤64 chars (F68/#821)
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
          type: 'READY_STATE_UPDATE';
          ready: boolean; // Owner-authored: client toggles its OWN ready; host stays authoritative
      }
    | {
          type: 'PLAYER_ATTRIBUTE_UPDATE';
          key: string; // Owner-authored: client sets an attribute on its OWN seat (e.g. 'color')
          value: string; // Host infers the seat from the connection and rebroadcasts LOBBY_STATE (F53)
      }
    | {
          type: 'CHAT';
          body: string; // Capped at 500 characters before sending
          scope: ChatScope; // 'lobby' | 'team' | 'private'
      }
    | {
          type: 'PING';
          sentAt: number; // performance.now() on sender (renderer-local; not simulation time)
      }
    | {
          type: 'LEAVE'; // Deliberate departure sent before socket close; suppresses presence toasts (#687)
      };

// Server → Client
// GameSnapshot NEVER leaves the host
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
          type: 'SNAPSHOT_DELTA';
          version: 1; // Frame shape; a client built for another version REFUSES the frame
          delta: SnapshotDelta; // Changed paths since the receiver's last projection
          checksum: number; // CRC32 of JSON(delta) — over what is actually sent
      }
    | {
          type: 'DELTA';
          fromTick: number;
          events: GameEvent[]; // Incremental update for low-bandwidth reconnects
      }
    | {
          type: 'REJECT';
          reason: string; // e.g. 'crc_mismatch' for an action-level rejection
          tick: number; // Tick at which the action was rejected
      }
    | {
          type: 'CLOSE';
          reason: 'host_closed'; // Dedicated session shutdown signal
      }
    | {
          type: 'REVEAL';
          reveal: CommitmentReveal; // Discloses a committed hidden value; client must verify()
      }
    | {
          type: 'CHAT';
          id: string; // Stable identifier assigned by the host relay (§4.29)
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

The `checksum` field in `ACTION` (client→server) and `SNAPSHOT` / `SNAPSHOT_DELTA` (server→client) is CRC32 of the JSON-serialised payload — the `snapshot` for one, the `delta` for the other, in both cases over what the frame actually carries. This provides a fast integrity guard against transport corruption. It is **not** a cryptographic security control — the `CommitmentScheme` (§4.6) handles anti-cheat.

A corrupt `SNAPSHOT_DELTA` is the more damaging of the two, which is why `ServerConnection` validates it against the pre-Zod bytes exactly as it does a `SNAPSHOT`: a snapshot REPLACES the client's state, so the next one repairs it, while a delta is APPLIED to state the client keeps.

## Snapshot Deltas

`StateBroadcaster` keeps the last projection it sent each recipient and sends the changed paths instead of the whole projection. Where it sends a whole `SNAPSHOT` — a **keyframe** — instead is `StateBroadcaster.sendProjection`'s to say, and `StateBroadcaster.test.ts`'s outbound-delta block to measure.

`engine:sync_request` is the forced wave, and `BroadcastContext.broadcast` carries `{ forceFull }` from Stage 7 to say so. Nothing observable identifies it: a re-sync arriving after a run of clock-only beats has a projection that genuinely DID change, so an empty diff is not the signal — and the viewer that asked to be re-synced is precisely the one whose baseline the host cannot vouch for, so a delta against that baseline is the one thing it must not be sent.

The baseline is per RECIPIENT, not per seat: a spectator is diffed against what that spectator received. It is dropped on `onPlayerLeft`, so the map is bounded by the connected set.

The delta is computed **after** `StateProjector.project()`, per viewer (Invariants #3/#8) — never once for everyone, which would let a field reach a viewer whose own projection masked it.

On the receiving side `WsClientTransport` rebuilds the whole projection and publishes THAT, so `ClientTransport.onSnapshotReceived` still hands subscribers a whole snapshot and nothing above the transport learns a delta was on the wire. A delta it cannot apply is dropped — never partially applied — and the client sends `engine:sync_request`, once per broken chain, since that request makes the host broadcast to every viewer rather than only to the asker.

The checksum that reaches `onSnapshotReceived` is the one the host stamped on the frame, over that frame's own body, and is **not** recomputed on the rebuild. `ServerMessageSchema` rebuilds a parsed snapshot in the SCHEMA's key order rather than the host projector's, and `crc32Json` is order-sensitive, so a measurement of the rebuild would differ from the host's for two objects that are deeply equal. Comparing a host checksum with a client one — as `multiplayer-soak.spec.ts` does — is therefore only meaningful across a whole-snapshot frame, which is why that spec forces one with `engine:sync_request` before it compares.

An `ACTION` checksum mismatch produces `REJECT { reason: 'crc_mismatch' }` for that action only. The joined session remains connected; terminal session shutdown is signaled with `CLOSE { reason: 'host_closed' }`.

---

## PING / PONG Round-Trip Latency

Clients send a `PING` with `sentAt = performance.now()`. The server echoes it in a `PONG` immediately. `WsClientTransport` computes the RTT on receipt and fires `ClientTransport.onLatencyUpdate`. Where that value goes — and where the chain currently stops — is §6.

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
