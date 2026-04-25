---
title: 'M5 — State Projection & Obfuscation (v0.5.0)'
description: 'F26–F29: StateProjector/VisibilityRules, Cryptographic Commitment Scheme (SHA-256), Host Renderer Obfuscation Enforcement, and Projection Property Tests (fast-check). Every client receives only its authoritative PlayerSnapshot; fog of war and commitment scheme are verified.'
tags:
    [
        milestone,
        m5,
        state-projection,
        fog-of-war,
        commitment-scheme,
        sha256,
        obfuscation,
        property-tests,
    ]
---

# M5 — State Projection & Obfuscation (v0.5.0)

> **Goal**: Every client — including the host renderer — receives only its authoritative `PlayerSnapshot`; fog of war and commitment scheme are verified.
> Architecture sections: §4.6, §8, §10.1

---

## F26 — StateProjector and VisibilityRules `§4.6, §8`

Implement `StateProjector`, `VisibilityRules` interface (`isEntityVisible`, `maskEntity`, `maskPlayerState`, `filterEvents`), and `VisibilityScope` classification. Ensure fog-hidden entities are entirely absent from `PlayerSnapshot.entities` (not masked with `null`).

---

## F27 — Cryptographic Commitment Scheme `§4.6, §8`

Implement `CommitmentScheme`, `CommitmentEnvelope`, `CommitmentReveal`, and the SHA-256 commit / verify flow. Wire `REVEAL` server message. Restore `pendingCommitments` from `SaveFile` on load. Add client-side `verify()` call before trusting any revealed value.

---

## F28 — Host Renderer Obfuscation Enforcement `§8, §9`

Confirm that the host's own renderer receives `PlayerSnapshot` via the same IPC path as remote clients. Disable any devtools shortcut that would expose `GameSnapshot`. Add an E2E assertion (`assertNoLeakedFields`) that the host window never contains an opponent's `owner-only` fields.

---

## F29 — Projection Property Tests `§10.1`

Write `fast-check` property tests asserting: (a) no `owner-only` or `hidden` field ever appears in a non-owner `PlayerSnapshot` across 10 000 random snapshots; (b) fog-of-war entities are absent (not null) in views of players who cannot see them.

---

## Cross-References

- [State Projection Interfaces](../core-components/state-projection-interfaces.md)
- [Fog of War & Cryptographic Commitment](../security-trust/fog-of-war-cryptographic-commitment.md)
- [IPC Security Model](../security-trust/ipc-security-model.md)
- [Testing Strategy](../testing/property-tests-soak.md) — `StateProjector` property tests, obfuscation soak
- [Architecture Invariants](../executive-architecture/architecture-invariants-appendix.md) — invariant #1 (snapshot boundary)
