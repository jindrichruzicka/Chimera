---
title: 'Tactics Commitment-Scheme Battle Mode'
description: 'Design + contract for tactics commit-then-sync turns built on the existing commit/reveal primitive: synced mode toggle, local action buffer, host-authoritative commit with nonce-retained reveal staging, deterministic attack-first reveal order, undo-before-commit with stamina refund, and the phase→primitive map.'
tags:
    [
        security,
        commitment,
        commit-reveal,
        tactics,
        determinism,
        anti-cheat,
        turn-mode,
        state-projection,
    ]
---

# Tactics Commitment-Scheme Battle Mode

> Design gate **T6** (#726) for feature **F54** (#720). Unblocks **T7** (#727, Battle Setup checkbox), **T8** (#728, commitment turn mode) and **T9** (#729, reveal-sync). Design + contract only — no production gameplay code beyond types.
> §4.4 — Lobby UI & State Sync · §4.6 / §8 — State Projection.
> Related: [Fog of War & Cryptographic Commitment](fog-of-war-cryptographic-commitment.md) · [State Projection Interfaces](../core-components/state-projection-interfaces.md) · [Customizable Lobby Contract](../core-components/customizable-lobby-contract.md) · [Architecture Invariants](../executive-architecture/architecture-invariants.md) (#3, #8, #9, #26).

---

## Goal

Tactics today runs **sequential** turns: every action is dispatched straight to the host, reduced, and the result projected back to all viewers. **Commitment battle mode** is an opt-in, tactics-local alternative in which all players act **simultaneously**: each player acts locally and privately, commits a hidden bundle, and a single `End Turn` reveals and applies every player's actions at once — in a deterministic order — using the **existing** cryptographic commit/reveal primitive.

The primitive (`CommitmentScheme`, `SessionCommitmentRuntime`, `HostTransport.sendReveal` / `ClientTransport.onReveal`, `PlayerSnapshot.commitments`) is built and tested (F27) but **used by no game**. This mode is the first consumer. Two gaps it must close, both verified in code:

1. **Reveal-send is plumbed but never triggered.** `WsHostTransport.sendReveal` exists and the client receive → `verifyReveal` → forward path (`registerClientRevealForwarding`) is wired, but no game logic ever calls `sendReveal`. This mode is the first caller.
2. **The nonce is discarded at commit.** `DefaultCommitmentScheme.commit(value)` generates a nonce, hashes with it, and returns only `{ id, commitment }`. `verify()` needs the original nonce, so the host cannot build a valid reveal without retaining `{ value, nonce }`. See [§Nonce-retention](#nonce-retention-additive).

## Trust model (why host-authoritative)

The mode keeps the architecture's existing host-authoritative shape: the host owns the single `GameSnapshot`, and the **host's own renderer is treated as an untrusted client** that receives only a `PlayerSnapshot`. The secret protected by a commitment here is **a player's chosen actions, kept secret from peer players until reveal**. The host _process_ may hold a committed bundle (it is the authority that holds full truth), but no **peer player** — and not even the host's own renderer — ever sees it before reveal, because only the envelope **hash** is projected via `PlayerSnapshot.commitments`. A cheating host still cannot bias the outcome: the reveal **order** is a deterministic function of `(seed, tick)` and game-end resolution is unchanged, so there is no ordering advantage to exploit ([§Reveal ordering](#reveal-ordering)).

A fully peer-trustless variant (client-side commit so even the host process never sees actions pre-reveal) was considered and rejected for this stub: it would not reuse the host `SessionCommitmentRuntime.commit` / `PlayerSnapshot.commitments` surface the feature is meant to exercise, and would add client→host envelope/reveal IPC plus renderer-side hashing.

---

## Turn lifecycle

```
                          COMMITMENT TURN (all players act at once)
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ Local play (each player, in parallel, private)                              │
 │   queue move/attack/reveal_tile ─▶ LocalActionBuffer (per-instance, main)   │
 │   optimistic local view + local stamina spend   (NOT sent to host)          │
 │   undo ◀─ pop buffer, refund local stamina                                  │
 └───────────────┬─────────────────────────────────────────────────────────────┘
                 │ Commit (player done)
                 ▼
   client ──buffer──▶ HOST                                  (host = authority)
   host: SessionCommitmentRuntime.commit(value)
        ├─ pendingCommitments[id] = envelope ──▶ PlayerSnapshot.commitments (all peers: "X committed", hash only)
        └─ RevealStagingPort.stage({ id, playerId, nonce, value })   (host retains value+nonce)
                 │
                 │ …all seated players committed → "awaiting commitment"
                 ▼ End Turn (reveal-only; enabled only now)
   host: order = resolveRevealOrder(committedTurns, seed, tick)   (attack-committers first, seeded shuffle)
   for each player in order:
        HostTransport.sendReveal('broadcast', reveal)
        each instance: onReveal ─▶ verifyReveal ─▶ CommitmentScheme.verify()   ◀── Invariant #9 gate
        host: re-dispatch that player's buffered actions through ActionPipeline (buffered order)
              resolveTacticsGameResult() after each action  → attack reveal can end the game
   host: RevealStagingPort.clearTurn(); advance to next commitment turn
```

---

## 1. Mode toggle (T7)

The mode is a **synced, host-authored match setting**, off by default. It rides the F53 customizable-lobby plumbing with no new IPC:

- Key `TACTICS_TURN_MODE_SETTING = 'turnMode'` on `GameSetupConfig.matchSettings`, union `TacticsTurnMode = 'sequential' | 'commitment'`, default `'sequential'` (`TACTICS_DEFAULT_TURN_MODE`). Defined in [`shared/tactics.ts`](../../shared/tactics.ts).
- T7 adds a host-only Battle Setup checkbox in `TacticsLobbyScreen.tsx` (same gating as `boardColor`), written through the existing `chimera:lobby:set-match-setting` → `LobbyManager.setMatchSetting()` path; every accepted change rebroadcasts to all peers.
- The agreed config is carried into the match by `engine:start_game` → `snapshot.setup` and projected verbatim by `StateProjector`. Reducers and the renderer decode it with the single pure reader `readTacticsTurnMode(matchSettings)` — fail-safe: anything but the exact literal `'commitment'` is `'sequential'`.

## 2. Local play & the action buffer (T8)

While `readTacticsTurnMode(...) === 'commitment'` and it is the player's turn, selections do **not** dispatch to the host. Instead each one is appended to a **per-instance `LocalActionBuffer`** held in that player's own main process (the host's main process for the host player; the joined client's main process otherwise).

- The board renders an **optimistic local view**: a pure tactics function applies the buffer to the viewer's own latest `PlayerSnapshot`. This is sufficient because a player only ever moves **owned** units and attacks **visible** enemies — everything the buffer touches is already in that viewer's projection.
- **Stamina** is spent against the **local** view using the existing [`stamina.ts`](../../games/tactics/stamina.ts) semantics (`readStamina`, 1 per `move`/`attack`); the authoritative `playerStamina` ledger is untouched until reveal/apply, where the normal reducers spend it again identically.
- Contract: `BufferedTacticsAction` (a discriminated union over the three existing payloads — `tactics:move_unit`, `tactics:attack`, `tactics:reveal_tile`) and `LocalActionBuffer = readonly BufferedTacticsAction[]`, in [`games/tactics/commitment/contract.ts`](../../games/tactics/commitment/contract.ts).

## 3. Commit (T8 / T9)

On **Commit**, the player's instance sends its buffer to the host. The host:

1. Builds the committed value `TacticsCommitmentEnvelopeValue = { playerId, turnNumber, actions }`. `turnNumber` binds the commitment to its turn so a stale reveal cannot be replayed later.
2. Calls the host commit path (`SessionRuntime.commit` → `SessionCommitmentRuntime.commit`), storing the envelope in `pendingCommitments`. The envelope reaches **all** peers on the next broadcast via the already-wired `getPendingCommitments` → `PlayerSnapshot.commitments` projection — peers learn _"player X committed"_ (hash only), never the actions.
3. Stages `{ envelopeId, playerId, nonce, value }` in the new host-side **reveal-staging store** ([§Nonce-retention](#nonce-retention-additive)).

**One envelope per player-turn**, not per action: it is simpler, matches the "a player has committed" signal peers need, and lets reveal apply a player's whole turn as one ordered group.

## 4. End-turn gating (T7 / T8)

In commitment mode, `End Turn` is **reveal-only** and is enabled **only while awaiting commitment** — i.e. once every seated player (humans **and** AI) has a staged commitment for the current turn (`RevealStagingPort.committedTurns()` covers all seats). Pressing it triggers the reveal/apply sequence; it is a distinct path from the sequential `engine:end_turn` (which only advances `turnClock`). Before all players have committed, `End Turn` is disabled.

## 5. Reveal ordering (T9) {#reveal-ordering}

Once every seat is staged, the host derives the reveal order with the pure `ResolveRevealOrder` contract:

```
resolveRevealOrder(committed: CommittedTurn[], seed, tick): PlayerId[]
  1. Partition committed players into attack-committers (bundle has ≥1 tactics:attack) and the rest.
  2. Shuffle each partition independently with the seeded RNG
     (xoshiro256**, seeded from (seed, tick) — NO Math.random()).
  3. Attack-committers first, then the rest.
```

`CommittedTurn.hasAttack` is derived with the pure `bufferHasAttack(buffer)` helper. For each player in order, the host reveals via `HostTransport.sendReveal('broadcast', reveal)`; every receiving instance runs `onReveal` → `verifyReveal` → `CommitmentScheme.verify()` (the Invariant #9 gate) **before** trusting the bundle, after which the host re-dispatches that player's buffered actions through the existing `ActionPipeline` in buffered order.

**Game-end** resolves on the attack reveal exactly as sequential mode does today: `resolveTacticsGameResult()` runs after each applied action via the `ActionRegistry` game callback. Putting attack-committers first means an attack that ends the match is resolved before any non-attack reveals — non-attack actions need no special end-state handling.

**Determinism.** The order is a pure function of `(seed, tick)` and never host-discretionary, so it reproduces under deterministic replay (the `ReplayFile` stores host-internal `seed` + `actions`, Invariant #71) and leaves `verify()` (a pure hash check) sound. This is the property that lets a deterministic order coexist with anti-tamper.

## 6. Undo before commit + stamina refund (T8)

**Before-commit undo operates only on the local buffer — it is _not_ `engine:undo`/`UndoManager`.** It pops the last buffered action and **refunds local stamina** by recomputing the optimistic view from the shortened buffer. Nothing has been sent to the host, so there is no authoritative state to roll back.

This is deliberately separate from the host `UndoManager`, which holds **turn-start mementos of authoritative state** and only becomes relevant _after_ reveal/apply. Accordingly:

- `PlayerSnapshot.undoMeta` (`{ canUndo, canRedo }`) continues to reflect **authoritative** undo, unchanged.
- The local buffer exposes its **own** can-undo, derived purely from buffer length (`buffer.length > 0`), for the in-turn Undo control.

Restoring the full snapshot via `UndoManager` already reimplants the entire `playerStamina` ledger, so authoritative stamina refund (post-reveal) needs no new code; the local refund is the only new behaviour, and it is a buffer operation.

## Nonce-retention (additive primitive change) {#nonce-retention}{#nonce-retention-additive}

Because `DefaultCommitmentScheme.commit()` discards the nonce, the host cannot later build a valid `CommitmentReveal`. The minimal, **additive** fix (T8) — leaving `verify()` and the existing `commit()` (and all fog-of-war usage) untouched:

- Add one method to the primitive: `CommitmentScheme.commitRevealable(value): { envelope: CommitmentEnvelope; reveal: CommitmentReveal }`, returning the nonce inside `reveal`. Existing committed-value callers (decks, dice) keep using `commit()`.
- Add a host-side **`RevealStagingPort`** next to `SessionCommitmentRuntime` that retains `PendingReveal` entries (`{ envelopeId, playerId, nonce, value }`) keyed by player and exposes `stage`, `hasCommitted`, `committedTurns`, `buildReveal`, `clearTurn`, plus `capture` / `restore` mirroring `capturePendingCommitments` / `restorePendingCommitments`. The interface + `PendingReveal` / `StagedReveals` types are defined now in [`contract.ts`](../../games/tactics/commitment/contract.ts); T8/T9 implement them.

## Persistence (Invariant #26)

A save taken mid-commit (some players committed, awaiting others) must still be revealable after load. Envelopes already persist via `SaveFile.pendingCommitments` and restore through `SessionRuntime.applyRestoredFile` (Invariant #26). The new staging map carries the matching `{ value, nonce }`, so it is **persisted alongside** `pendingCommitments` (via `RevealStagingPort.capture`) and **restored together** (`restore`). A load that restores envelopes but not staging must not apply reveals — the two move as a unit.

---

## Phase → existing primitive map

| Phase             | Concrete existing function / channel                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode select       | `GameSetupConfig.matchSettings['turnMode']` → `chimera:lobby:set-match-setting` → `engine:start_game` → `snapshot.setup`; decode `readTacticsTurnMode()` |
| Local play        | per-instance `LocalActionBuffer` + pure optimistic view over `PlayerSnapshot`; `stamina.ts` `readStamina` (local)                                        |
| Commit            | `SessionRuntime.commit` → `SessionCommitmentRuntime.commit` (+ `RevealStagingPort.stage`)                                                                |
| Envelope egress   | `StateProjector.project()` `getPendingCommitments` → `PlayerSnapshot.commitments` (Invariant #8 gate)                                                    |
| End turn / reveal | `HostTransport.sendReveal('broadcast', reveal)` in `resolveRevealOrder()` order                                                                          |
| Verify            | `ClientTransport.onReveal` → `SessionCommitmentRuntime.verifyReveal` → `CommitmentScheme.verify()` (Invariant #9)                                        |
| Apply             | host re-dispatches revealed actions through `ActionPipeline`; `resolveTacticsGameResult()` on attack                                                     |
| Persist           | `RevealStagingPort.capture`/`restore` beside `SaveFile.pendingCommitments` (Invariant #26)                                                               |

---

## Invariants

### Existing invariants this mode upholds

- **#3 / #8** — `GameSnapshot` stays host-local. Buffered actions cross the trust boundary **only** as (a) the projected envelope **hash** in `PlayerSnapshot.commitments` (pre-reveal) and (b) the verified reveal payload (post-commit). The local buffer and optimistic view never egress except through the commit→reveal path; all egress still passes `StateProjector.project()`.
- **#9** — `CommitmentScheme.verify()` (via `verifyReveal`) remains the mandatory client-side gate before any revealed bundle is trusted or applied. `commitRevealable()` does not change `verify()`.
- **#26** — `pendingCommitments` (and now the matching reveal staging) restore from `SaveFile` on load; a loaded game without them restored must not process reveals.

### New invariants ratified here (#103–#105, T11 / #731)

- **Mode is toggle-gated — #103.** Commitment turn mode is enabled **only** by the synced `turnMode === 'commitment'` match setting carried in `snapshot.setup`; `sequential` is the default and is unchanged. The host drives the whole loop through the game-supplied `CommitmentTurnOrchestration` and never names a game.
- **End turn is reveal-only while awaiting commitment — #103 (engine mechanism #102).** In commitment mode `End Turn` triggers reveal and is enabled only once every seated player has staged a commitment for the current turn.
- **Reveal order is deterministic — #104.** Reveal order is derived from `(snapshot.seed, snapshot.tick)`, grouped by player, attack-committers before non-attack-committers — never host-discretionary; `CommitmentScheme.verify()` (#9) gates every revealed bundle.
- **Per-turn resource state is deterministic and projection-only — #105.** The stamina spent and refunded around commit (§2, §6) lives in `GameSnapshot`, is seeded/refreshed/decremented only by reducers, and reaches clients only via `StateProjector.project()`.

---

## Acceptance criteria → where addressed

- Design note + contract types committed; T7/T8/T9 implementable with no open design question → this note + [`shared/tactics.ts`](../../shared/tactics.ts) + [`games/tactics/commitment/contract.ts`](../../games/tactics/commitment/contract.ts).
- Each phase mapped to a concrete existing primitive → [§Phase → primitive map](#phase--existing-primitive-map).
- Reveal ordering specified deterministically → [§Reveal ordering](#reveal-ordering).
- Undo-before-commit + stamina refund specified → [§6](#6-undo-before-commit--stamina-refund-t8).
- Invariants #3/#8/#9/#26 explicitly addressed → [§Invariants](#invariants).

## Cross-references

- [Fog of War & Cryptographic Commitment](fog-of-war-cryptographic-commitment.md) — the commit/reveal primitive this mode reuses (host-generated `committed` values vs. the player-authored actions committed here).
- [Customizable Lobby Contract](../core-components/customizable-lobby-contract.md) — F53 `matchSettings` sync + `snapshot.setup` projection the toggle rides.
- [State Projection Interfaces](../core-components/state-projection-interfaces.md) — `PlayerSnapshot.commitments`, `StateProjector.project()`.
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — #3, #8, #9, #26, #71; end-turn gate #102; commit-then-sync turns #103–#105.
