---
title: 'State Obfuscation & Fog of War (Cryptographic Commitment)'
description: 'CQRS-Adjacent State Projection pattern, Information Classification table (public/owner-only/hidden/committed), fog-of-war entity absence, SHA-256 cryptographic commitment scheme (Phase 1 Commit / Phase 2 Reveal), trust boundary ASCII diagram, and reconnect handling.'
tags: [security, fog-of-war, cryptography, state-projection, obfuscation, multiplayer, anti-cheat]
---

# State Obfuscation & Fog of War (Cryptographic Commitment)

> §8 of the Chimera architecture.
> Related: [State Projection Interfaces](../core-components/state-projection-interfaces.md) · [IPC Security Model](ipc-security-model.md) · [Simulation Core](../core-components/simulation-core-action-pipeline.md)

---

## Design Pattern: CQRS-Adjacent State Projection

The host owns the single authoritative `GameSnapshot` (full truth). Before any transmission, `StateProjector` produces a `PlayerSnapshot` — a filtered, masked view for each player. This mirrors the **Projection / Read Model** pattern from CQRS: reads are projections tuned per consumer; writes use the full model.

**Critical invariant**: `GameSnapshot` never leaves the host's main process. The **host's own renderer is treated as an untrusted client** and receives a `PlayerSnapshot`. This prevents the host player from gaining an information advantage via devtools inspection.

---

## Information Classification

| Scope        | Examples                                                    | On-Wire Representation                                                                                 |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `public`     | Unit positions, HP, terrain, turn order                     | Transmitted as-is to all players                                                                       |
| `owner-only` | Card hand contents, resource totals, hidden objectives      | True value to owner only; others receive `null` or an opaque count                                     |
| `hidden`     | Server RNG seed, scheduled future events, internal counters | **Never** transmitted to any client                                                                    |
| `committed`  | Shuffled deck order, die roll result, card drawn            | SHA-256 commitment broadcast at generation; true value sent via `REVEAL` at the appropriate game event |

---

## Fog of War

Invisible entities are **entirely absent** from `PlayerSnapshot.entities` — not masked with nulls. This prevents entity count inference from object key enumeration.

```typescript
// StateProjector internal
const visibleEntities = Object.fromEntries(
    Object.entries(fullState.entities)
        .filter(([, e]) => rules.isEntityVisible(e, viewerId, fullState))
        .map(([id, e]) => [id, rules.maskEntity(e, viewerId, fullState)]),
);
```

---

## Cryptographic Commitment Scheme (Anti-Cheat for Hidden-Info Games)

For values that must be provably fixed at generation time but remain hidden until revealed (shuffled decks, rolled dice, drawn cards):

### Phase 1 — Commit (at generation time, before action resolves)

```
nonce      ← crypto.randomBytes(32)
value      ← shuffledDeckOrder
commitment ← SHA-256(JSON.stringify(value) + nonce)
→ broadcast CommitmentEnvelope { id, commitment } to ALL clients immediately
```

### Phase 2 — Reveal (at the appropriate game event)

```
→ broadcast CommitmentReveal { id, value, nonce }
Client: SHA-256(JSON.stringify(value) + nonce) === storedCommitment?
  ✔ OK        → trust the value
  ✖ MISMATCH  → host tampered; flag + log with cryptographic proof
```

This makes hidden-information games auditable without a trusted third party. A cheating host cannot retroactively change a shuffled deck order after seeing how it would affect outcomes.

---

## Obfuscation Trust Boundary

```
Host Main Process
│
├── GameSnapshot (full truth) ──────────── NEVER leaves this process
│       │
│       ▼
│   project(snap, playerA) → PlayerSnapshot(A) ──► IPC ──► Host Renderer (own view only)
│
│   project(snap, playerB) → PlayerSnapshot(B) ──► WebSocket ──► Client B
│
│   project(snap, playerC) → PlayerSnapshot(C) ──► WebSocket ──► Client C
```

---

## Reconnect Handling

On reconnect, the client receives a fresh `PlayerSnapshot` at the current tick — not a replay of full game history. This prevents reconnection from becoming an information leak (e.g. a player should not receive history showing cards that were in an opponent's hand before they were played).

---

## Perspective Replays (Post-Projection)

A _perspective_ replay (`PerspectiveReplayFile`, `kind: 'perspective'`; §4.28, Invariant #98) stores only the already-projected `PlayerSnapshot`s that a single, locked `viewerId` legitimately saw during the match. Projection and fog of war are applied **before** each frame is recorded — the file never holds `GameSnapshot`, `seed`, or `actions`, and is never re-simulated. It is therefore the same trust artifact as a live `PlayerSnapshot` stream: sharing one leaks no hidden information beyond what that viewer already observed in real time. This is the privacy-preserving counterpart to the deterministic `ReplayFile` of Invariant #71, which stores host-internal `seed` + `actions` and must stay host-only. See [Replay System](../core-components/replay-system.md).

---

## Implementation Location

```
simulation/projection/
├── StateProjector.ts        # project() function, VisibilityRules interface
├── CommitmentScheme.ts      # commit(), verify(), CommitmentEnvelope, CommitmentReveal
└── VisibilityRules.ts       # VisibilityScope, default rules

simulation/persistence/
└── SaveFile.ts              # pendingCommitments: must be restored on load (invariant #26)
```

---

## Cross-References

- [State Projection Interfaces](../core-components/state-projection-interfaces.md) — `StateProjector.project()`, `VisibilityRules`, `CommitmentScheme` interfaces
- [Tactics Commitment-Scheme Battle Mode](tactics-commitment-battle-mode.md) — the first gameplay consumer of commit/reveal: a tactics-local commit-then-sync turn (player-authored action bundles, deterministic attack-first reveal order)
- [IPC Security Model](ipc-security-model.md) — trust boundary table, IPC attack surface audit
- [WebSocket Message Protocol](../core-components/websocket-message-protocol.md) — `COMMIT`/`REVEAL` wire messages
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #3, #8, #9, #26, #98
- [Replay System](../core-components/replay-system.md) — `PerspectiveReplayFile`, why its frames are post-projection and information-safe
