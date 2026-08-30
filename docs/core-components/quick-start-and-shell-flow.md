---
title: 'Quick Start, Session Mode & the Shell Flow Layer'
description: 'How a match is born without the lobby UI, and what a live shell surface may do before one exists: the QuickStartConfig seat contract, QuickStartCoordinator as sugar over the public LobbyManager verbs, the engine-owned engine.sessionMode stamp and the Leave fork it drives, the atomic close-session verb, the autosave slot contract behind a reactive Continue, the shell-state spine the game pages read, and the ordered handover into a match the background, the shell audio session and GameShell share.'
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
        shell-background,
        shell-audio,
        input-actions,
        invariants,
    ]
---

# Quick Start, Session Mode & the Shell Flow Layer

> §4.41 of the Chimera architecture.
> Related: [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) · [Customizable Lobby Contract](customizable-lobby-contract.md) · [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md) · [Save / Load Persistence](save-load-persistence.md) · [Renderer State Stores](renderer-state-stores.md) · [GameShell & UI Design System](gameshell-ui-design-system.md) · [Asset Reference System](asset-reference-system.md) · [Camera System](camera-system.md) · [Audio System](audio-system.md) · [Input & Keybindings](input-keybindings.md)

---

## Overview

§4.37 says what a game may **show** on the engine's shell — a menu definition, a settings page, a
lobby screen, a background, its own routes. This section is the layer underneath: what a shell
surface may **do**, and the one rule every part of it obeys.

**Every layer here changes what the renderer shows, never how a match is born.** A Quick Match
button on a main menu takes the road a player clicking through the lobby dialog takes: the
composition root's `onSessionHosted`, reached through `LobbyManager.hostLobby`. What "skipping the
lobby" skips is the **UI**, not the lifecycle.

Two features built this layer. F87 gave it its flows — the verbs, the routes, the store. F88 gave the
surface underneath them a life: assets, pointer input, input actions before any match, and a voice.
The design records — the alternatives considered and why each died — live in the roadmap:
[F87 — Quick Start, Menu Verbs & Game Shell Pages](../roadmap-sections/m10-first-public-release-v1.0.0.md)
and [F88 — Live Shell Background](../roadmap-sections/m10-first-public-release-v1.0.0.md). This
section is the contract.

---

## Where each half lives

The flow layer spans two documents on purpose: §4.37 owns the shell's **presentation** contracts and
already carries the declarative surfaces, so restating them here would mint a second copy to keep
true. This section owns the **session** half and points at the other.

| What                                                                                         | Where                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `start-game` / `continue` menu actions, `confirm`, button testids                            | [§4.37.5](renderer-shell-pages-ui-contract.md#4375-game-customizable-main-menu-definition)       |
| `menuCommands` — renderer-local callbacks off a `command` action                             | [§4.37.8](renderer-shell-pages-ui-contract.md#4378-game-menu-command-registry)                   |
| `shellRoutes`, page chrome, the entry allow-set, the static check                            | [§4.37.17](renderer-shell-pages-ui-contract.md#43717-game-owned-shell-routes)                    |
| `shellStateStore` fields, surfaces, writers, the game barrel                                 | [§4.37.18](renderer-shell-pages-ui-contract.md#43718-shell-state-and-the-game-page-services)     |
| `setGameParam` / `setPlayerAttribute` authority, `snapshot.setup`                            | [§4.37.12](customizable-lobby-contract.md)                                                       |
| `shellBackgroundAssets` / `shellBackgroundInteractive` — the opt-ins and the hit-test layers | [§4.37.9](renderer-shell-pages-ui-contract.md#4379-game-customizable-shell-background-component) |
| `shellAudioAssets` / `shellMusicBed`, the session's surfaces, the fade verbs it picks        | [§4.25](audio-system.md#shell-scoped-audio)                                                      |
| `inputActions` on the shell payload, the one registrar, the binding slot                     | [§4.26](input-keybindings.md#action-registration)                                                |
| `shell-asset-manifest.ts` and what `validate-assets` reads it as                             | [§4.10](asset-reference-system.md#ci-validation)                                                 |
| The quick-start contract, the coordinator, the session stamp                                 | here                                                                                             |
| `close-session`, the Leave fork, the autosave slot contract                                  | here                                                                                             |
| What a live shell surface may DO, and the handover order into a match                        | here                                                                                             |

---

## A session is born in the lobby

`chimera:lobby:quick-start` is **orchestration sugar**, not a second session constructor.
`QuickStartCoordinator` (`electron/main/runtime/QuickStartCoordinator.ts`) — the third member of the
`SessionRestoreCoordinator` / `DevHarnessCoordinator` family — composes public `LobbyManager` verbs
and nothing else:

```text
hostLobby({ gameId, maxPlayers, agentSlots })   ← the AI roster, pre-seeded, one atomic decision
  → setGameParam('engine.sessionMode', 'quick')
  → setGameParam(k, v)             for each merged game param, in key order
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
    readonly gameParams?: Readonly<Record<string, string>>;
    readonly hostAttributes?: Readonly<Record<string, string>>;
    readonly localSeats?: readonly QuickStartSeat[];
    readonly aiSeats?: readonly QuickStartAiSeat[];
}
```

**Every seat kind carries its own attributes.** A bare seat COUNT can say how many seats to open but
not what any of them is playing, which is why the seat lists hold objects. The host seat is implicit
— it is the session's own seat — and carries its picks in `hostAttributes`.

A game declares its defaults on `GameLobbySetup.quickStart`; a request merges **over** them:

| Field                          | Merge                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `gameParams`, `hostAttributes` | per KEY — a request naming one param keeps the game's other defaults                                      |
| `localSeats`, `aiSeats`        | WHOLESALE — a list's length is its seat count, so a positional merge would silently invent or drop a seat |

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

`SESSION_MODE_PARAM` (`'engine.sessionMode'`) is a game-param key that is **engine-owned**, not
host-authored. `QuickStartCoordinator` is what stamps it, on every quick start and with one value:
`SESSION_MODE_QUICK` (`'quick'`). **Absence means the session was born in the lobby.**

Three refusals guard the key:

- `SetGameParamPayloadSchema` rejects the key, so no lobby screen may flip it.
- `QuickStartParamsSchema` rejects it inside a request's `gameParams`, so a quick-start caller
  cannot smuggle it in.
- `QuickStartCoordinator` refuses it once more **after** merging, which is what catches a **game's
  own declared `GameLobbySetup.quickStart` defaults** authoring it — main-process code, which
  neither schema sees.

It rides in `snapshot.setup.gameParams`, which is why it is the launch origin the renderer trusts:
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

## A shell surface that is alive

F87 made shell state readable. F88 makes the surface reading it a place where things happen, through
optional fields on the shell payload — each independent, each inert when absent, each contracted
where its own subject already lives — and the one file two of them name:

| Declared                                          | What it buys                                                                       | Contract                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `shellBackgroundAssets`                           | manifest assets resolve inside the background — models, sheets, clips              | [§4.37.9](renderer-shell-pages-ui-contract.md#background-asset-session) |
| `shellBackgroundInteractive`                      | the background takes pointer input, with every engine control still clickable      | [§4.37.9](renderer-shell-pages-ui-contract.md#interactive-background)   |
| `inputActions`                                    | the game's rebindable actions fire on shell routes, before any match has run       | [§4.26](input-keybindings.md#action-registration)                       |
| `shellAudioAssets`, `shellMusicBed`               | `useSound` / `useMusicTrack` resolve on menus, and the engine plays a declared bed | [§4.25](audio-system.md#shell-scoped-audio)                             |
| `shell-asset-manifest.ts` (the file the two name) | one inventory, discovered by NAME, validated exactly as the match manifest is      | [§4.10](asset-reference-system.md#ci-validation)                        |

What belongs here is the sentence none of those owns alone: **everything above changes what the
player sees, hears and points at, and none of it changes how a match is born.** That is this
section's one rule, stated again at the point where it is easiest to break.

A key press on a menu is the sharpest case, because F88 is what makes one possible. A game's actions
are registered at app boot, so `useInputAction` fires on a shell route exactly as it does in a match.
What a shell surface does with one stays renderer-local: it moves a selection ring, or names a pick in
`draft`. The pick becomes authoritative when `useQuickStart().start()` hands the draft to
`chimera:lobby:quick-start`, and the session is born in the lobby like any other.

### Three lifetimes, three owners

The three things a live shell surface holds are owned separately and expire on different terms, and
the differences are deliberate rather than incidental:

| What is held                        | Owner                                          | Lifetime                                                                               |
| ----------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| the background's own `AssetManager` | `GameAssetSession` under `ShellBackgroundHost` | the background's MOUNT — disposed on the surface flip                                  |
| the app-level delegate binding      | `ShellAudioSession`                            | opened on the `SHELL_AUDIO_SURFACES` shell screens, handed back at the match-entry arm |
| the game's registered input actions | `InputActionsBootstrap`                        | the APP — there is no unregister                                                       |

An asset manager is decoded audio and GPU textures, so it is disposed the moment its subtree is gone;
a delegate binding is one pointer, so it is opened across the widest surface set that reads sensibly
and handed back by identity at the arm below; an action table is plain data, so giving it a lifetime
would buy nothing and cost a second registry to keep in step with the first. What each of those
costs is stated at its own contract rather than softened here.

Neither of the two managers impersonates a match. The background's publishes to its own subtree and
registers no `SetGameAssetManagerContext` delegate at all; the audio session's does the opposite —
it binds the delegate and publishes to no subtree — and it opens on no match surface, touches no
listener pose, and hands the binding back before a match takes it (Invariant #21).

---

## Handing over to a match

The `transition` arm is the shared cue, and it is what makes the handover a definition rather than a
race. §4.37.18 enumerates who raises it: `underArmedTransition` in `renderer/shell/matchEntryVerbs.ts`
wraps the quick-start and continue IPC calls, and `GameStoreBootstrap`'s snapshot gate raises it when
a match snapshot lands on a shell surface — the lobby's own Start reaches `/game` through that one.
What both have in common is the property the handover rests on: the arm lands while the shell route is
still the current one, because neither entry verb navigates and the gate arms ahead of its own fade
and push. That buys a background the whole fade to dolly through, and buys the engine's own
shell owners an instant to let go at.

In order, on one entry:

1. **The arm.** `armShellTransition({ kind: 'to-match', durationMs })`, from a writer above. On the
   `matchEntryVerbs` path a synchronous throw and a rejected promise both clear it, so a refused entry
   never leaves a background dollied into a match that never came. A quick start passes BOTH writers,
   and the second arm changes nothing below: the session's effect is keyed on whether a `to-match`
   arm is standing, not on the transition object.
2. **The audio session lets go.** Its effect is keyed on the arm, so the arm's own commit runs its
   teardown: the bed leaves through the cue-aligned fade or the screen fade (§4.25), the delegate is
   released by IDENTITY, and the manager it built is disposed.
3. **The router commits `/game`.** `GameShell` registers the match manager as the app-level delegate
   during render, and owns that binding for the match's whole life.
4. **A commit later the surface flips.** `ShellStateBridge` publishes `'match'` from an effect, so the
   match route has already committed by the time `ShellBackgroundHost` returns `null` and the
   background's session disposes. The store clears the arrived transition at the same point.

Two of those steps are written the way they are because the obvious spelling is wrong. The release in
step 2 is by IDENTITY and not unconditional: step 4 lands AFTER step 3, so a teardown that cleared the
binding whatever it held would silence the match it had just handed over to. And the effect in step 2
is keyed on `kind === 'to-match'` rather than on the transition OBJECT, so that only a match ENTRY
runs the teardown — held by `ShellAudioSession.test.tsx` › _ignores a to-shell transition, which is a
match LEAVING rather than starting_, and the source's own comment records that nothing reachable arms
`to-shell` while this session is open.

An entry that is refused or cancelled clears the transition, and the shell owners simply rebuild: the
audio session re-registers and restarts the bed, which is what leaves the player on a menu that still
sounds like one.

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

| #    | Rule                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #137 | Quick start is SUGAR: `QuickStartCoordinator` composes only public `LobbyManager` verbs, so a quick-started session is born inside `onSessionHosted` like any other — held by the port slice, the ordered call log, and a scan of the coordinator's own source.                 |
| #138 | `engine.sessionMode` is engine-owned: `SetGameParamPayloadSchema`, `QuickStartParamsSchema` and the coordinator's own post-merge check each refuse the key, and `QuickStartCoordinator` stamps it on every quick start, so its absence means the session was born in the lobby. |
| #139 | Shell-state discipline: the route fields are written by enumerated engine sites and `draft` by the game, and reading or reacting to any of it opens no IPC channel, advances no tick and dispatches no `EngineAction`.                                                          |
| #140 | One confirm surface: a single `ConfirmDialogHost` mounted once by `AppShell`, reached by the declarative `GameMenuConfirm` and the imperative `useConfirmDialog()` alike, showing one queued question at a time.                                                                |
| #99  | Lobby game params are host-authored and per-player attributes owner-authored; `chimera:lobby:quick-start` is a third Zod-validated channel funnelling into those same verbs, and the host connection owns every pass-and-play local seat.                                       |
| #101 | `snapshot.setup` is passed through `StateProjector.project()` verbatim and carries every seat kind's attributes, so a quick-started seat reaches every viewer exactly as a lobby-configured one does.                                                                           |
| #96  | The `game` barrel publishes the shell PAGE SERVICES — `useShellState` / `getShellState` / `setShellDraft` / `useShellNavigate` / `useQuickStart` — and no setter for the route fields, so a game reacts to a route change and never authors one.                                |
| #108 | The snapshot-driven restore funnel is the sole disk→live-state entry; `close-session` is exit-side only and adds no second reader.                                                                                                                                              |
| #21  | What a live shell surface adds: `ShellBackgroundHost` wraps a declared background in `GameAssetSession`, which registers no app-level delegate, while `ShellAudioSession` binds one over the shell inventory on shell surfaces alone and releases it by identity.               |
| #52  | `validate-assets` discovers a game's shell inventory as `shell-asset-manifest.ts` beside its match `asset-manifest.ts`, under the same rules and into the same declared-ref union.                                                                                              |
| #65  | Game input actions register at shell load into the app-lifetime registry, through one registrar that leaves a held id alone and throws on a re-registration whose metadata differs.                                                                                             |
| #127 | An `overlay` `GameCanvas` may mount on a shell surface as well as inside a match; the role union is unchanged, and the background is still a game-mounted `GameCanvas` rather than a raw `<Canvas>`.                                                                            |

---

## File map

| Path                                                | What                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `simulation/foundation/quick-start-contract.ts`     | `QuickStartConfig`, `QuickStartSeat`, `QuickStartAiSeat` (zero-import)      |
| `simulation/foundation/game-lobby-contract.ts`      | `SESSION_MODE_PARAM`, `SESSION_MODE_QUICK`, `GameLobbySetup.quickStart`     |
| `simulation/foundation/save-slots.ts`               | `AUTOSAVE_SLOT_NAME`, `autosaveSlotId(gameId)`                              |
| `electron/main/runtime/QuickStartCoordinator.ts`    | the coordinator, its ports and its unwind                                   |
| `electron/main/ipc/ipc-schemas.ts`                  | `QuickStartParamsSchema`, `CloseSessionParamsSchema`, the two refusals      |
| `electron/main/index.ts`                            | `closeActiveSession`, the coordinator's port wiring                         |
| `electron/main/saves/SaveManager.ts`                | `onSlotsChanged` after every autosave                                       |
| `renderer/hooks/useQuickStart.ts`                   | `start` / `close` / `continueFromAutosave` / `hasAutosave`                  |
| `renderer/bridge/useLeaveGame.ts`                   | the role-aware Leave fork on the session stamp                              |
| `renderer/shell/matchEntryVerbs.ts`                 | the armed-transition wrapper every match entry runs under                   |
| `renderer/shell/shellStateStore.ts`                 | the store, its writers and the game-writable `draft`                        |
| `renderer/components/shell/ShellStateBridge.tsx`    | the single route-classification site                                        |
| `renderer/state/confirmDialogStore.ts`              | the promise-resolving confirm queue                                         |
| `renderer/components/shell/ConfirmDialogHost.tsx`   | the one confirm surface `AppShell` mounts                                   |
| `renderer/components/shell/ShellBackgroundHost.tsx` | the background mount, its asset session and the interactive flip            |
| `renderer/components/shell/ShellAudioSession.tsx`   | the shell delegate, the declared bed and the match handoff                  |
| `renderer/components/shell/ShellContentLayer.tsx`   | the `--ch-z-raised` frame that stands aside under the opt-in                |
| `renderer/app/InputActionsBootstrap.tsx`            | the app-boot registrar for a game's input actions                           |
| `renderer/input/registerInputActions.ts`            | the one registrar both sites call, and its identity assert                  |
| `renderer/shell/useShellBackgroundPayload.ts`       | the one derivation the host, the frame and `main-menu` read the opt-in from |

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
- **A background session that survives `/game`.** The session is keyed to its mount, so a match never
  runs with a menu inventory resident beside its own.
- **An asset-gated background REVEAL.** F83's loaded / failed / budget / nothing-to-load vocabulary
  composes with a menu scene later; nothing here gates a mount on a load.
- **Backdrop-specific frame pacing.** A menu canvas is paced by the same `display.targetFps` cap every
  other canvas is.
- **Spatialized menu audio.** The shell session consumes F84's features and extends none of them; a
  game that wants a positioned shell sound passes `spatial` to its own `useSound` call.

---

## Cross-References

- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — §4.37 menu definition, shell routes, shell state, page services
- [Customizable Lobby Contract](customizable-lobby-contract.md) — §4.37.12 host-authored game params, owner-authored attributes, `snapshot.setup`
- [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md) — §4.14 `LobbyManager` verbs and session lifecycle
- [Save / Load Persistence](save-load-persistence.md) — §4.11 `SaveFile`, the restore funnel, the autosave slot
- [Renderer State Stores](renderer-state-stores.md) — §4.4 store catalogue, `saveStore`, `lobbyStore`
- [Asset Reference System](asset-reference-system.md) — §4.10 `GameAssetSession`, the two manifests, `validate-assets`
- [Camera System](camera-system.md) — §4.22 `GameCanvas`, `role="overlay"` on a shell surface
- [Audio System](audio-system.md) — §4.25 the shell-scoped session, the declared bed, the cue-aligned handoff
- [Input & Keybindings](input-keybindings.md) — §4.26 action registration at shell load and the binding slot
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #21, #52, #65, #96, #99, #101, #108, #127, #137–#140
- [M10 Roadmap](../roadmap-sections/m10-first-public-release-v1.0.0.md) — the F87 and F88 design records and their alternatives graveyards
