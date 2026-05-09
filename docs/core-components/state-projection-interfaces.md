---
title: 'State Projection Interfaces'
description: 'StateProjector.project(), VisibilityRules, CommitmentEnvelope/CommitmentReveal/CommitmentScheme. The mandatory gate between GameSnapshot and any outbound message.'
tags: [state-projection, visibility, fog-of-war, commitment-scheme, anti-cheat]
---

# State Projection Interfaces

> §4.6 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Fog of War and Cryptographic Commitment](../security-trust/fog-of-war-cryptographic-commitment.md) · [WebSocket Protocol](websocket-message-protocol.md)

---

## StateProjector

`StateProjector.project()` is the **mandatory gate** between `GameSnapshot` and any outbound message. `StateBroadcaster` never reads `GameSnapshot` directly.

```typescript
interface StateProjector {
    project(fullState: GameSnapshot, viewerId: PlayerId): PlayerSnapshot;
}

interface PlayerSnapshot {
    tick: number;
    viewerId: PlayerId;
    players: Record<PlayerId, ObservedPlayerState>;
    entities: Record<EntityId, ObservedEntityState>;
    phase: GamePhase;
    events: GameEvent[];
    commitments: Record<CommitmentId, CommitmentEnvelope>;
    undoMeta: { readonly canUndo: boolean; readonly canRedo: boolean };
    isMyTurn: boolean; // Derived: true if turnClock is undefined or activePlayerId === viewerId
}
```

> **Invariant #8** — `StateProjector.project()` is the mandatory gate between `GameSnapshot` and any outbound message. `StateBroadcaster` never reads `GameSnapshot` directly.

---

## VisibilityRules

Games implement `VisibilityRules` to declare their information model. Different game modes can swap in different implementations.

```typescript
interface VisibilityRules {
    // Fog-of-war: is this entity present in the viewer's snapshot at all?
    isEntityVisible(entity: EntityState, viewer: PlayerId, state: GameSnapshot): boolean;

    // Field masking: return copy with owner-only/hidden fields nulled
    maskEntity(entity: EntityState, viewer: PlayerId, state: GameSnapshot): ObservedEntityState;
    maskPlayerState(
        target: PlayerState,
        viewer: PlayerId,
        state: GameSnapshot,
    ): ObservedPlayerState;

    // Event filtering: which events does this viewer perceive this tick?
    filterEvents(events: GameEvent[], viewer: PlayerId, state: GameSnapshot): GameEvent[];
}
```

### Visibility Classification

Every game-state field is classified at design time:

| Scope        | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `public`     | All players see the true value                                           |
| `owner-only` | Only the owning player sees the value; others receive null/count         |
| `hidden`     | No player sees this (server-only: RNG seeds, internal counters)          |
| `committed`  | Concealed until a reveal event; SHA-256 commitment hash broadcast to all |

### Fog of War

Entities absent from a player's visibility are **omitted entirely** from their `PlayerSnapshot.entities` — they are **not** present as nulls or placeholders. A client cannot infer an entity's position from it being null; it simply isn't there.

---

## CommitmentScheme — Anti-Cheat for Hidden Values

```typescript
interface CommitmentEnvelope {
    id: CommitmentId;
    commitment: string; // SHA-256( JSON(value) + nonce )
    revealedAt?: number; // Tick of reveal (undefined = still hidden)
}

interface CommitmentReveal {
    id: CommitmentId;
    value: unknown; // The original hidden value
    nonce: string; // Random nonce generated at commit time
}

interface CommitmentScheme {
    // Host: called when a hidden value is generated (shuffle, die roll, card draw)
    commit(value: unknown): CommitmentEnvelope;
    // Client: called on REVEAL — throws if tampered; call before trusting the value
    verify(reveal: CommitmentReveal, envelope: CommitmentEnvelope): boolean;
}
```

### Commit / Reveal Protocol

```
Phase 1 — Commit:
  Host generates value (e.g. shuffled deck order)
  Host calls commit(value) → CommitmentEnvelope { commitment: SHA-256(JSON(value)+nonce) }
  Host broadcasts envelope to all clients via next SNAPSHOT
  Clients store the hash but cannot compute the value

Phase 2 — Reveal:
  At reveal time, host sends REVEAL { value, nonce }
  Every client calls verify(reveal, envelope)
    → recomputes SHA-256(JSON(reveal.value) + reveal.nonce)
    → checks equality with stored commitment
    → throws CommitmentVerificationError if tampered
  Clients now trust the revealed value
```

> **Invariant #9** — `CommitmentScheme.verify()` is always called client-side on receipt of a `REVEAL` message before the revealed value is trusted.

---

## Cross-References

- [Fog of War and Cryptographic Commitment](../security-trust/fog-of-war-cryptographic-commitment.md) — §8 full state obfuscation design
- [WebSocket Protocol](websocket-message-protocol.md) — `SNAPSHOT` and `REVEAL` wire messages
- [Simulation Core](simulation-core-action-pipeline.md) — `VisibilityScope` type, `PlayerSnapshot`
