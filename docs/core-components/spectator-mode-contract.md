---
title: 'Spectator Mode Contract'
description: 'How a read-only spectator watches a running match without joining it (F72). Defines the read-only session-viewer model (never in GameSnapshot.players, saves, or replays), the opt-in manifest capability + reserved engine.allowSpectators host toggle, the join classifier and its reject reasons, the host-local SpectatorRegistry + perspective-projection broadcast, and the out-of-band SPECTATE_TARGET_UPDATE perspective switch. Ratifies invariants #114 and #115.'
tags:
    [
        spectator,
        multiplayer,
        projection,
        read-only,
        host-authority,
        out-of-band,
        manifest-capability,
        snapshot-setup,
    ]
---

# Spectator Mode Contract

> A **spectator** is a read-only session viewer: it watches a running match from
> a seated player's perspective without ever joining the match. It is never a
> participant — not in `GameSnapshot.players`, the host's seat ledger, saves, or
> replays — and everything it sees crosses the wire as an already-projected
> `PlayerSnapshot` (Invariants #3 / #8). Spectating is **opt-in per game** and
> **off by default per match**. Ratifies **Invariant #114** (read-only viewers)
> and **Invariant #115** (out-of-band perspective switch).
>
> Related: [Multiplayer Provider](multiplayer-provider-websocket.md) ·
> [Customizable Lobby Contract](customizable-lobby-contract.md) ·
> [State Projection Interfaces](state-projection-interfaces.md)

---

## 1. Opting in — manifest capability + host toggle

Spectating is enabled by two independent, additive gates. A game with neither
declared is behaviour-neutral: a join into a running match is always rejected,
exactly as before F72.

**Game capability** — `simulation/foundation/game-manifest-contract.ts`:

- `GameManifest.spectators?: GameSpectatorSupport` — a game opts in by declaring
  `{ mode: 'perspective' }` (the only v1 mode: a spectator follows one seated
  player's projected perspective).
- `resolveSpectatorSupport(manifest)` returns `{ mode: 'perspective' }` only when
  the game declares it, else `undefined`. It never throws — an absent field is a
  first-class "not supported".

**Host match-setting** — `simulation/foundation/game-lobby-contract.ts`:

- `ALLOW_SPECTATORS_SETTING = 'engine.allowSpectators'` — a reserved,
  `engine.`-namespaced, host-authored match setting (Invariant #99). It is
  synced verbatim into the running match via `snapshot.setup` (Invariant #101),
  which is where the join classifier reads it.
- `ALLOW_SPECTATORS_DEFAULT = 'false'` — off until the host turns it on.
- `readAllowSpectators(matchSettings)` returns `true` **only** when the value is
  exactly `'true'` (fail-safe closed).

A game surfaces the toggle in its lobby screen as a host-only control that calls
the engine-provided `setMatchSetting(ALLOW_SPECTATORS_SETTING, next ? 'true' :
'false')` (Invariant #100). Tactics is the reference adopter
(`apps/tactics/manifest.ts` declares the capability; `TacticsLobbyScreen` renders
the toggle).

## 2. Join classifier — admission (Invariant #114)

`HostTransport.setJoinClassifier(classify)` runs after the profile gate admits a
JOIN and decides the role. The pure decision lives in
`electron/main/lobby/joinClassifier.ts`; the policy is injected at the
composition root (`electron/main/index.ts` `onSessionHosted`), where the host
knows the live `GameSnapshot.phase`, `resolveSpectatorSupport(manifest)`, and
`readAllowSpectators(matchSettings)` — so `LobbyManager`/providers stay
provider-agnostic (Invariant #38).

```ts
type JoinClassification =
    | { role: 'player' } // seated player (default; no classifier ⇒ this)
    | { role: 'spectator' } // read-only viewer, no seat
    | { reject: string }; // REJECT { reason } + close
```

| Situation                                               | Result                              |
| ------------------------------------------------------- | ----------------------------------- |
| `lobby` phase, or a reconnect (retained/restored seat)  | `{ role: 'player' }` (unchanged)    |
| running match, game spectator-capable **and** toggle on | `{ role: 'spectator' }`             |
| running match, capable but toggle off                   | `{ reject: 'spectators_disabled' }` |
| running match, not spectator-capable                    | `{ reject: 'match_in_progress' }`   |

Admission mechanics (LobbyServer + parity in `InMemoryMultiplayerProvider`,
Invariant #41): a spectator is admitted into a **separate** `spectatorConnections`
map, never `connections`, so it never counts against the `maxPlayers` gate (the
player-capacity check runs after classification) and is bounded independently by
`DEFAULT_MAX_SPECTATORS = 8` (shared via `networking/provider/spectator-policy.ts`).
The joining client learns its role from `WELCOME.role` (defaulted to `'player'`
by the wire schema for legacy hosts), surfaced as `JoinedSession.role`.

A spectator is **never** added to `GameSnapshot.players`, the seat ledger,
`registeredPlayers`/`activePlayers`, saves (`SaveFile.session`, Invariant #108),
or replays; it gets no `HumanPlayerAgent` and never advances the match-start
gate. Any `EngineAction` arriving on a spectator connection is dropped at both
the `LobbyServer` and the host (spoofed-envelope protection).

## 3. Viewer registry + perspective broadcast (Invariant #114)

`electron/main/lobby/SpectatorRegistry.ts` is a host-local ledger
`Map<spectatorId, followedSeatId>` — pure orchestration state that, like the
spectators themselves, never enters the simulation, saves, or replays. It is
exposed to the runtime through the structural `SpectatorViewSource` seam so the
broadcaster never imports the lobby registry.

`electron/main/runtime/StateBroadcaster.ts` delivers perspectives through the
single `StateProjector.project()` gate (Invariant #8):

- `broadcast(snapshot, viewerId)` — point-send to one seated viewer; never
  touches spectator traffic.
- `broadcastWave(snapshot, viewerId)` — the Stage-7 wave: the seated point-send
  **plus** a fan-out to every spectator, deduped on snapshot-reference identity
  so each spectator receives exactly one perspective send per wave regardless of
  the seated-viewer count.
- `broadcastSpectator(snapshot, spectatorId)` — unicast one spectator the
  followed seat's projection; used for the join-time first push and the
  perspective switch, so a spectator sees the match immediately rather than
  waiting for the next wave.

Lifecycle (host, `electron/main/index.ts`): on a spectator join → register it
following the first seated player and push that seat's projection. On a
spectator leave → drop it from the registry only (it held no seat). On a
**seated** player's deliberate departure → `repointFollowersOf(departedSeat,
nextSeat)` moves its followers to another live seat.

## 4. Perspective switch — out-of-band (Invariant #115)

A spectator changes which seat it follows through a cosmetic, out-of-band
channel that is **never** simulation — the direct analog of CHAT / PROFILE_UPDATE
(Invariants #72 / #62). `SPECTATE_TARGET_UPDATE` is never an `EngineAction`, never
advances `tick`, and never enters `ActionHistory`, saves, or replays.

Path: `window.__chimera.spectate.setFollowedTarget(targetPlayerId)` →
`chimera:spectate:set-target` → `LobbyManager.setSpectatorTarget` → transport
`sendSpectateTarget` → host `onSpectateTargetUpdate`. The host derives the
spectator from the **connection**, never a client-supplied id (Invariant #99),
validates the target is a currently-seated player, re-points the
`SpectatorRegistry` entry, and `broadcastSpectator`s the newly-followed seat's
projection so the switch is immediate. The switch is invisible to every other
peer.

## 5. Renderer spectator UX

- **Role** — the client hydrates its authoritative role once per session from
  `chimera:lobby:get-local-role` (`window.__chimera.lobby.getLocalRole()`) into
  `lobbyUiStore.role`; `useIsSpectator()` selects it. (The WELCOME role is not
  inferred from the viewer id — that is unsafe under pass-and-play.)
- **Read-only board** — `GameShell` sets `controlsLocked` when `isSpectator`,
  disabling undo/redo/end-turn and withholding the host-only save affordance;
  `renderer/app/game/page.tsx` additionally no-ops `sendAction` for a spectator
  (defense in depth) and derives `isHost = false` for a spectator (a spectator
  following the host's seat has `viewerId === hostId`, so the role must win —
  the deterministic-replay export stays host-only, Invariants #71 / #98).
- **Spectator HUD** — `renderer/components/shell/SpectatorHud.tsx` self-gates to
  `null` for players. It names the followed seat from the **lobby roster**
  (profile-sourced, Invariant #62 — the profile directory is empty on clients),
  cycles through the live snapshot's seated ids, and drives the switch via the
  `engine:spectate-cycle` input action (default **Tab**) and a button.

## 6. Invariants

- **Ratifies #114** — read-only spectator viewers (this doc, §1–§3).
- **Ratifies #115** — out-of-band `SPECTATE_TARGET_UPDATE` (this doc, §4).
- **Upholds** #3 / #8 / #38 / #41 / #62 / #71 / #98 / #99 / #100 / #101 / #108
  across the feature.

## Cross-References

- [Multiplayer Provider (WebSocket)](multiplayer-provider-websocket.md) — the
  join classifier admission seam and REJECT reasons.
- [Customizable Lobby Contract](customizable-lobby-contract.md) — host-authored
  match settings and the `snapshot.setup` projection the toggle rides on.
- [State Projection Interfaces](state-projection-interfaces.md) — the single
  `StateProjector.project()` gate that produces every spectator perspective.
- [Architecture Invariants](../executive-architecture/architecture-invariants.md)
  — #114 and #115.
