---
title: 'Quick Start, Session Mode & the Shell Flow Layer'
description: 'How a match is born without the lobby UI: the QuickStartConfig seat contract, QuickStartCoordinator as sugar over the public LobbyManager verbs, the engine-owned engine.sessionMode stamp and the Leave fork it drives, the atomic close-session verb, the autosave slot contract behind a reactive Continue, and the shell-state spine the game pages read.'
tags:
    [
        quick-start,
        lobby,
        session,
        menu,
        shell-pages,
        shell-state,
        saves,
        autosave,
        confirm,
        invariants,
    ]
---

# Quick Start, Session Mode & the Shell Flow Layer

> §4.41 of the Chimera architecture.
> Related: [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) · [Customizable Lobby Contract](customizable-lobby-contract.md) · [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md) · [Save / Load Persistence](save-load-persistence.md) · [Renderer State Stores](renderer-state-stores.md) · [GameShell & UI Design System](gameshell-ui-design-system.md)

---

## Overview

§4.37 says what a game may **show** on the engine's shell — a menu definition, a settings page, a
lobby screen, a background, its own routes. This section is the layer underneath: what a shell
surface may **do**, and the one rule every part of it obeys.

**Every layer here changes what the renderer shows, never how a match is born.** A Quick Match
button on a main menu takes the road a player clicking through the lobby dialog takes: the
composition root's `onSessionHosted`, reached through `LobbyManager.hostLobby`. What "skipping the
lobby" skips is the **UI**, not the lifecycle.

The design record — the alternatives considered and why each died — lives in the roadmap:
[F87 — Quick Start, Menu Verbs & Game Shell Pages](../roadmap-sections/m10-first-public-release-v1.0.0.md).
This section is the contract.

---

## Where each half lives

The flow layer spans two documents on purpose: §4.37 owns the shell's **presentation** contracts and
already carries the declarative surfaces, so restating them here would mint a second copy to keep
true. This section owns the **session** half and points at the other.

| What                                                                 | Where                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `start-game` / `continue` menu actions, `confirm`, button testids    | [§4.37.5](renderer-shell-pages-ui-contract.md#4375-game-customizable-main-menu-definition)   |
| `menuCommands` — renderer-local callbacks off a `command` action     | [§4.37.8](renderer-shell-pages-ui-contract.md#4378-game-menu-command-registry)               |
| `shellRoutes`, page chrome, the entry allow-set, the static check    | [§4.37.17](renderer-shell-pages-ui-contract.md#43717-game-owned-shell-routes)                |
| `shellStateStore` fields, surfaces, writers, the game barrel         | [§4.37.18](renderer-shell-pages-ui-contract.md#43718-shell-state-and-the-game-page-services) |
| `setMatchSetting` / `setPlayerAttribute` authority, `snapshot.setup` | [§4.37.12](customizable-lobby-contract.md)                                                   |
| The quick-start contract, the coordinator, the session stamp         | here                                                                                         |
| `close-session`, the Leave fork, the autosave slot contract          | here                                                                                         |

---

## A session is born in the lobby

`chimera:lobby:quick-start` is **orchestration sugar**, not a second session constructor.
`QuickStartCoordinator` (`electron/main/runtime/QuickStartCoordinator.ts`) — the third member of the
`SessionRestoreCoordinator` / `DevHarnessCoordinator` family — composes public `LobbyManager` verbs
and nothing else:

```text
hostLobby({ gameId, maxPlayers, agentSlots })   ← the AI roster, pre-seeded, one atomic decision
  → setMatchSetting('engine.sessionMode', 'quick')
  → setMatchSetting(k, v)          for each merged match setting, in key order
  → setPlayerAttribute(hostId, k, v)  for each host attribute, in key order
  → addLocalSeat(seatId, { ready: true, attributes })  for each pass-and-play seat
  → updatePlayerReadyState(true)
  → startGame()
```

The stamp goes **first**, so it is present for every write that follows and for every lobby-state
broadcast after the hosting one.

The AI roster rides on `hostLobby`'s existing `agentSlots` seam rather than through an `addAi()`
loop: a loop allocates each slot against the roster as it stood at that moment, while one
pre-seeded list is a single decision. The roster is **exactly full** by design
(`maxPlayers = 1 + localSeats + aiSeats`), so no seat is left open for a stranger to fill.

The coordinator holds **no session objects** — only its own in-flight flag — and reaches the outside
world exclusively through injected ports (Invariants #37/#67). The lobby half of those ports is a
structural slice of the real `LobbyManager`, and the coordinator's own test pins `LobbyManager`
assignable to it: a port that grew into a bespoke session door reds `pnpm typecheck` rather than
review.

### Guards and unwind

Three synchronous refusals, each before anything is hosted: an active session, an active
menu-load restore, and a quick start already in flight. The in-flight flag is raised at the guard
and cleared when the sequence settles, so it also covers the `hostLobby` await — the window in which
the composition root's own `activeSession` is still `null` and a `saves:load` arriving would
otherwise route into the menu-restore flow against a lobby being born.

Any throw **after** the lobby exists tears it down through `closeLobby()`, so a failed start never
leaves a zombie session behind. A failure of the teardown itself is logged, never surfaced: the
caller must see the failure that actually broke the start.

---

## `QuickStartConfig` — the seats

`simulation/foundation/quick-start-contract.ts` is a zero-import foundation leaf, so both the
renderer and the main process compile against one declaration.

```typescript
interface QuickStartSeat {
    readonly attributes?: Readonly<Record<string, string>>;
}
interface QuickStartAiSeat extends QuickStartSeat {
    readonly omniscient?: boolean;
}
interface QuickStartConfig {
    readonly matchSettings?: Readonly<Record<string, string>>;
    readonly hostAttributes?: Readonly<Record<string, string>>;
    readonly localSeats?: readonly QuickStartSeat[];
    readonly aiSeats?: readonly QuickStartAiSeat[];
}
```

**Every seat kind carries its own attributes.** A bare seat COUNT can say how many seats to open but
not what any of them is playing, which is why the seat lists hold objects. The host seat is implicit
— it is the session's own seat — and carries its picks in `hostAttributes`.

A game declares its defaults on `GameLobbySetup.quickStart`; a request merges **over** them:

| Field                             | Merge                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `matchSettings`, `hostAttributes` | per KEY — a request naming one setting keeps the game's other defaults                                    |
| `localSeats`, `aiSeats`           | WHOLESALE — a list's length is its seat count, so a positional merge would silently invent or drop a seat |

AI slots sit **above** the local seats in the slot ledger, so a local seat's roster position equals
its ledger slot index and therefore equals the seat index its declared default attributes resolve
at. An AI slot with no attributes from either source is written without the key at all rather than
with `{}`, so it stays out of `setup` exactly as a lobby-added AI seat does.

Seat attributes reach `snapshot.setup` through the same carrier a lobby writes — Invariant #101 — so
a quick-started seat and a lobby-configured one are indistinguishable downstream. On a shared
machine the host connection owns every pass-and-play local seat: such a seat has no connection to
author from, so its attributes are seeded at host time and there is no runtime attribute channel for
one (Invariant #99).

---

## `engine.sessionMode` — the stamp that survives

`SESSION_MODE_SETTING` (`'engine.sessionMode'`) is a match-setting key that is **engine-owned**, not
host-authored. `QuickStartCoordinator` is what stamps it, on every quick start and with one value:
`SESSION_MODE_QUICK` (`'quick'`). **Absence means the session was born in the lobby.**

Three refusals guard the key:

- `SetMatchSettingPayloadSchema` rejects the key, so no lobby screen may flip it.
- `QuickStartParamsSchema` rejects it inside a request's `matchSettings`, so a quick-start caller
  cannot smuggle it in.
- `QuickStartCoordinator` refuses it once more **after** merging, which is what catches a **game's
  own declared `GameLobbySetup.quickStart` defaults** authoring it — main-process code, which
  neither schema sees.

It rides in `snapshot.setup.matchSettings`, which is why it is the launch origin the renderer trusts:
a renderer-store flag survives neither a window reload nor a session restore, and the snapshot does
both.

---

## Leaving: `close-session` and the Leave fork

`useLeaveGame` resolves the local player's role and forks:

| Who                          | Exit                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| Joined client                | records the leaving-to-main-menu intent and disconnects                 |
| Host, lobby-born session     | `returnToLobby()` — back to the lobby it came from                      |
| Host, `sessionMode: 'quick'` | `closeSession({ autosave })` — out of a lobby-less session, in one call |

`chimera:lobby:close-session` composes the same two steps the crash path composes — `captureSaveFile`
then `saveManager.autoSave` — and adds the teardown. It is **atomic because it is one call**: a
game-side "save, then leave" pair would race, since a leave that landed first leaves the capture with
no session to read. The capture is the first thing the call does with no `await` ahead of it, so no
action can be applied between the request arriving and the snapshot being read. There is no second
save reader or writer and no `engine:save` dispatch — the capture stays an out-of-band host call
(Invariant #25).

`activeSession !== null` **is** the host gate: the reference is set only inside `onSessionHosted`, so
a joined client reaches this with `null` and is refused. The teardown is `closeLobby()`, the same
public verb the ordinary leave path uses, so the restore funnel is untouched (Invariant #108) — this
verb is exit-side only.

---

## The autosave slot, and why Continue is reactive

Continue needs an answer to "is there something to continue?" that no game-side probe supplies.

`simulation/foundation/save-slots.ts` carries the slot name once: `AUTOSAVE_SLOT_NAME` is the BARE
name a `SaveFile` header records, and `autosaveSlotId(gameId)` is the QUALIFIED `'<gameId>/autosave'`
id the repository keys, lists and deletes by — the form `SaveSlotMeta.slotId` carries into the
renderer. Both halves exist because the slot is written under one spelling and read under the other;
`tools/autosave-slot-spelling.test.ts` fails on any other production spelling of either.

`SaveManager` fires its injected `onSlotsChanged` seam after **every** autosave, which the
composition root wires to the `chimera:saves:slot-update` push. Before that seam existed only the
manual save/delete handler path pushed, so a Continue button would have gone stale the moment an
esc-exit wrote a save behind it.

That push is what makes the §4.37.5 engine-computed availability **reactive** rather than
resolve-once: `RenderMainMenuDefinition` subscribes to `saveStore`, so Continue enables the moment an
autosave lands and disables again the moment one is deleted.

---

## Reading the shell

A game's own surfaces — a custom page, a live background, a character picker — read the shell through
one module singleton, `shellStateStore`, and write back exactly one field, `draft`. The store's
fields, its surfaces, its writer table and the game-barrel services are §4.37.18's; what belongs here
is the **discipline** that makes it safe to react to:

Reading or reacting to shell state opens no IPC channel, advances no tick and dispatches no
`EngineAction`. The state is plain data throughout — nothing on it is callable — and the modules that
own the surface name no dispatcher, so a reader has nothing to reach authoritative state **with**.
Shell-page navigation is renderer-local: `useShellNavigate()` is a `router.push` that carries the
active `?gameId=` along, and the one hop that is not renderer-local — the entry into `/game` — belongs
to the snapshot gate, fade included.

`draft` is a `QuickStartConfig` and not a free-form bag, so what a character-select page accumulates is
exactly what `useQuickStart().start()` can hand to `chimera:lobby:quick-start`.

---

## One confirm surface

`AppShell` mounts a single `ConfirmDialogHost`. Both ways of asking route through it: the declarative
`GameMainMenuButton.confirm` (§4.37.5) and the imperative `useConfirmDialog()` on the
`components/ui` barrel. A second host would answer the same question twice.

The store behind it is a promise-resolving **queue**, and only its head is ever displayed — one
confirm surface, one visible question — so a request made while one is open waits its turn instead of
being dropped or stealing the dialog from under the player. The resolvers live in the factory closure
rather than in store state: state is read by React through selectors, and a resolver is neither
renderable nor comparable.

Strings arrive already resolved. A caller passes display text — the menu renderer resolves its
declaration's tokens through `t()` before asking — so the host translates nothing but the dialog's own
default control labels.

---

## Invariants

| #    | Rule                                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #137 | Quick start is SUGAR: `QuickStartCoordinator` composes only public `LobbyManager` verbs, so a quick-started session is born inside `onSessionHosted` like any other — held by the port slice, the ordered call log, and a scan of the coordinator's own source.                    |
| #138 | `engine.sessionMode` is engine-owned: `SetMatchSettingPayloadSchema`, `QuickStartParamsSchema` and the coordinator's own post-merge check each refuse the key, and `QuickStartCoordinator` stamps it on every quick start, so its absence means the session was born in the lobby. |
| #139 | Shell-state discipline: the route fields are written by enumerated engine sites and `draft` by the game, and reading or reacting to any of it opens no IPC channel, advances no tick and dispatches no `EngineAction`.                                                             |
| #140 | One confirm surface: a single `ConfirmDialogHost` mounted once by `AppShell`, reached by the declarative `GameMenuConfirm` and the imperative `useConfirmDialog()` alike, showing one queued question at a time.                                                                   |
| #99  | Lobby match settings are host-authored and per-player attributes owner-authored; `chimera:lobby:quick-start` is a third Zod-validated channel funnelling into those same verbs, and the host connection owns every pass-and-play local seat.                                       |
| #101 | `snapshot.setup` is passed through `StateProjector.project()` verbatim and carries every seat kind's attributes, so a quick-started seat reaches every viewer exactly as a lobby-configured one does.                                                                              |
| #96  | The `game` barrel publishes the shell PAGE SERVICES — `useShellState` / `getShellState` / `setShellDraft` / `useShellNavigate` / `useQuickStart` — and no setter for the route fields, so a game reacts to a route change and never authors one.                                   |
| #108 | The snapshot-driven restore funnel is the sole disk→live-state entry; `close-session` is exit-side only and adds no second reader.                                                                                                                                                 |

---

## File map

| Path                                              | What                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `simulation/foundation/quick-start-contract.ts`   | `QuickStartConfig`, `QuickStartSeat`, `QuickStartAiSeat` (zero-import)    |
| `simulation/foundation/game-lobby-contract.ts`    | `SESSION_MODE_SETTING`, `SESSION_MODE_QUICK`, `GameLobbySetup.quickStart` |
| `simulation/foundation/save-slots.ts`             | `AUTOSAVE_SLOT_NAME`, `autosaveSlotId(gameId)`                            |
| `electron/main/runtime/QuickStartCoordinator.ts`  | the coordinator, its ports and its unwind                                 |
| `electron/main/ipc/ipc-schemas.ts`                | `QuickStartParamsSchema`, `CloseSessionParamsSchema`, the two refusals    |
| `electron/main/index.ts`                          | `closeActiveSession`, the coordinator's port wiring                       |
| `electron/main/saves/SaveManager.ts`              | `onSlotsChanged` after every autosave                                     |
| `renderer/hooks/useQuickStart.ts`                 | `start` / `close` / `continueFromAutosave` / `hasAutosave`                |
| `renderer/bridge/useLeaveGame.ts`                 | the role-aware Leave fork on the session stamp                            |
| `renderer/shell/matchEntryVerbs.ts`               | the armed-transition wrapper every match entry runs under                 |
| `renderer/shell/shellStateStore.ts`               | the store, its writers and the game-writable `draft`                      |
| `renderer/components/shell/ShellStateBridge.tsx`  | the single route-classification site                                      |
| `renderer/state/confirmDialogStore.ts`            | the promise-resolving confirm queue                                       |
| `renderer/components/shell/ConfirmDialogHost.tsx` | the one confirm surface `AppShell` mounts                                 |

---

## Out of scope

Recorded so the boundary is a decision rather than an omission; the roadmap's F87 section carries the
mechanism that killed each alternative.

- **Write facades** (`useLobbySession()`, `useEngineSettings()`, a game taking over the lobby or
  settings page). The page mechanism gives them a home, but they renegotiate §4.37.4's "lobby screens
  render body content only" chrome contract and drag #99/#100 amendments with them.
- **Runtime local-seat attribute editing** — a lobby-phase "player 2 changes their character" channel.
  Host-time seeding only; a live channel is a genuinely new write path.
- **A chosen RNG seed on quick start.** The seed stays host-minted at `hostLobby` time.
- **A bespoke session constructor.** Every per-session collaborator exists only inside
  `onSessionHosted`, so a second constructor guarantees drift.
- **`LobbyManager.quickStart()` as a manager method.** The guards and collaborators live at the
  composition root, which is why all three coordinators are ports-injected classes.

---

## Cross-References

- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — §4.37 menu definition, shell routes, shell state, page services
- [Customizable Lobby Contract](customizable-lobby-contract.md) — §4.37.12 host-authored match settings, owner-authored attributes, `snapshot.setup`
- [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md) — §4.14 `LobbyManager` verbs and session lifecycle
- [Save / Load Persistence](save-load-persistence.md) — §4.11 `SaveFile`, the restore funnel, the autosave slot
- [Renderer State Stores](renderer-state-stores.md) — §4.4 store catalogue, `saveStore`, `lobbyStore`
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #96, #99, #101, #108, #137–#140
- [M10 Roadmap](../roadmap-sections/m10-first-public-release-v1.0.0.md) — F87 design record and alternatives graveyard
