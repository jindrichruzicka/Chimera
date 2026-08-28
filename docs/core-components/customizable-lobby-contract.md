---
title: 'Customizable Lobby Contract'
description: 'Declarative contract for game-customizable multiplayer lobbies (F53). Defines the GameLobbySetup descriptor, the synced GameSetupConfig, GameLobbyScreenProps, the registry-loaded LobbyScreen slot, the lobby write path (renderer lobby API → IPC → LobbyManager) with host-authored game params and owner-authored per-player attributes, how snapshot.setup is projected to every peer verbatim, and the two host exits the session-mode stamp forks between (return-to-lobby vs the atomic close-session). Ratifies invariants #99, #100, #101.'
tags:
    [
        lobby,
        multiplayer,
        customization,
        shell-pages,
        host-authority,
        owner-authority,
        projection,
        snapshot-setup,
    ]
---

# Customizable Lobby Contract

> §4.37 of the Chimera architecture (lobby customization; see also §4.4 Renderer State Stores (`lobbyStore`), §4.14 LobbyManager).
> Related: [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) · [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md) · [Renderer State Stores](renderer-state-stores.md) · [Architecture Invariants](../executive-architecture/architecture-invariants.md)

---

## Overview

The lobby is an **engine-owned shell page** (`renderer/app/lobby/page.tsx`, §4.37.4) whose chrome —
dialog, host/join tabs, player roster, ready and start controls — is fixed by the engine. The
Leave/Start controls in particular are the engine dialog's **modal footer actions** (§4.37.4): a
game `LobbyScreen` must not render its own. A game customizes only the **configuration** it
needs: a set of host-chosen _game params_ (e.g. board colour) and per-seat _player attributes_
(e.g. unit colour). A game declares this surface declaratively through a `GameLobbySetup`
descriptor and, optionally, ships a registry-loaded `LobbyScreen` React component that renders
those controls inside the engine dialog.

The contract splits authorship by scope: **game params are host-authored** (only the host edits them;
clients read), while **per-player attributes are owner-authored** — each player edits only its OWN seat,
the host stays authoritative and rebroadcasts. Every accepted edit is broadcast through `LobbyState` so
all peers converge, and the agreed-upon configuration is carried into the match as `snapshot.setup`,
projected to every viewer verbatim. Tactics is the first adopter (the host picks a shared board colour
and each player picks their own unit colour).

This contract ratifies invariants **#99** (host-authored game params / owner-authored player
attributes), **#100** (no direct privileged writes from game lobby UI), and **#101** (`snapshot.setup`
is public, projected verbatim).

---

## Core Types

Declared in [`simulation/foundation/game-lobby-contract.ts`](../../simulation/foundation/game-lobby-contract.ts) — a
foundation contract module with no cross-package imports (mechanical Check 13), so it is safe to load
in both `main` and the renderer (mirroring `game-shell-contract.ts`).

```ts
/** A single selectable value for a game param or player attribute. */
export interface LobbyFieldOption {
    readonly value: string;
    readonly label: string;
}

/**
 * Pure, declarative description of a game's customizable lobby. `main` reads it
 * to seed defaults and validate host/join requests; the renderer reads it to
 * build the lobby controls. Data and a pure resolver only — no React, no IPC.
 */
export interface GameLobbySetup {
    readonly maxPlayers: number;
    readonly gameParamDefaults: Record<string, string>;
    readonly gameParamOptions: Record<string, readonly LobbyFieldOption[]>;
    readonly playerAttributeOptions: Record<string, readonly LobbyFieldOption[]>;
    resolveDefaultPlayerAttributes(seatIndex: number): Record<string, string>;
}

/**
 * The resolved, synced match-setup shape carried alongside the snapshot so every
 * peer agrees on the configuration.
 */
export interface GameSetupConfig {
    readonly gameParams: Record<string, string>;
    readonly playerAttributes: Record<PlayerId, Record<string, string>>;
}

/**
 * Props passed to a game's lobby-screen component. Synchronous setters push local
 * edits; the `on*` lifecycle callbacks are async authoritative actions.
 */
export interface GameLobbyScreenProps {
    readonly lobbyState: LobbyState;
    readonly localPlayerId: PlayerId;
    readonly isHost: boolean;
    readonly canStartGame: boolean;
    readonly pendingAction: LobbyPendingAction;
    readonly setGameParam: (key: string, value: string) => void;
    readonly setPlayerAttribute: (playerId: PlayerId, key: string, value: string) => void;
    readonly onToggleReady: (ready: boolean) => Promise<void>;
    readonly onStartGame: () => Promise<void>;
    readonly onLeave: () => Promise<void>;
}
```

The blocks above are abridged to the fields this contract explains; each cited module is the full surface.

The synced state lives on the wire types in [`simulation/foundation/messages-schemas.ts`](../../simulation/foundation/messages-schemas.ts):
`LobbyState.gameParams?`, `LobbyPlayerEntry.attributes?`, and `LobbyAgentSlot.attributes?` — the last being an
AI seat's host-authored picks, since an AI seat is never a `players` entry and so has no other carrier.
All three are **optional** — absent on games with no lobby setup. `gameParams` alone is not
compatible across its rename: a peer still sending `matchSettings` has it stripped by this
non-strict object, so its lobby renders with defaults and nothing warns.
There is no attribute-setter channel for an agent slot, so its per-attribute caps ride the state frame and the
host-request frames that carry a slot (`chimera:lobby:host`, `chimera:lobby:quick-start`); a player's
attributes are bounded at `chimera:lobby:set-player-attribute` instead.

### Quick-start defaults

`GameLobbySetup.quickStart?: QuickStartConfig` ([`simulation/foundation/quick-start-contract.ts`](../../simulation/foundation/quick-start-contract.ts),
a zero-import foundation leaf) declares what match a game opens when the player skips the lobby entirely:

```ts
export interface QuickStartConfig {
    readonly gameParams?: Readonly<Record<string, string>>;
    readonly hostAttributes?: Readonly<Record<string, string>>;
    readonly localSeats?: readonly QuickStartSeat[];
    readonly aiSeats?: readonly QuickStartAiSeat[];
}
```

Every seat kind carries its own `attributes` (an AI seat adds `omniscient?`), so a game whose seats differ by
character, colour, or faction can say so — a bare seat count could not. It lives on the lobby setup rather than
the manifest because a seat's attributes are drawn from the same vocabulary as `playerAttributeOptions`, and the
lobby setup is built from the game's `GameContent` (the manifest never sees it). `chimera:lobby:quick-start`
consumes it — see [Quick start](#quick-start-skipping-the-lobby) below.

---

## Write Path (host-authored params, owner-authored attributes)

A lobby edit never touches privileged state directly. It travels engine-owned indirection from the game
lobby screen to the authoritative `LobbyManager`, which is the sole writer and broadcasts back to peers.
The host authors the **game params**; each player authors only its OWN seat's **attributes**:

```
LobbyScreen                                          all peers
  │  setGameParam (host)     setPlayerAttribute (own seat)   ▲
  ▼  (GameLobbyScreenProps)                                  │ re-render from broadcast
useLobbyApi()  (renderer/app/lobby/useLobbyApi.ts)           │
  ▼  ipcRenderer.invoke                                      │
chimera:lobby:set-game-param                                 │
chimera:lobby:set-player-attribute   ── Zod-validated ───────┤  (ipc-schemas.ts)
  ▼  ipcMain.handle (ipc-handlers.ts)                        │
LobbyManager.setGameParam       → HOST-ONLY (rejects joined) │
LobbyManager.setPlayerAttribute → OWN-SEAT only:            │
  • hosted: merge own seat ────────────────────────────────┤
  • joined: send PLAYER_ATTRIBUTE_UPDATE to host ───────────┘
       host applies to the SENDER's seat (HostTransport.onPlayerAttributeUpdate)
  ▼  merge into LobbyState → publishLobbyState + broadcast
```

- **Write path.** Three Zod-validated renderer channels funnel into these same two manager verbs — the
  two above, plus `chimera:lobby:quick-start`, which drives them from main rather than adding a door of
  its own. `setGameParam()` rejects (returns a rejected
  `Promise`) when the active session is not a hosted session. `setPlayerAttribute()` rejects any
  `playerId` other than the caller's own seat; a joined client's own-seat write is forwarded to the host,
  which applies it to the connection-derived sender seat — never a client-supplied id (Invariant #99).
  This mirrors the owner-authored `ready` flow.
- **No direct privileged writes from the game UI.** A `LobbyScreen` calls the engine-provided
  `setGameParam` / `setPlayerAttribute` props only. It must not write the IPC-mirrored `lobbyStore`,
  call `LobbyManager`, or open IPC channels itself (Invariant #100).
- **Read-only where you have no authority.** A `LobbyScreen` disables the board-colour control for a
  non-host (`isHost === false`) and disables every per-player colour control except the local player's
  own row; all peers render the broadcast `LobbyState`.

---

## Quick start (skipping the lobby)

`chimera:lobby:quick-start` opens a match without the lobby UI. It adds no session door: the main-side
`QuickStartCoordinator` ([`electron/main/runtime/QuickStartCoordinator.ts`](../../electron/main/runtime/QuickStartCoordinator.ts))
composes the SAME public `LobbyManager` verbs the lobby screen drives, so the session is still born inside
the composition root's `onSessionHosted`.

```
window.__chimera.lobby.quickStart({ gameId, …QuickStartConfig })
  ▼  chimera:lobby:quick-start  ── Zod-validated (QuickStartParamsSchema) ──▶ ipc-handlers.ts
QuickStartCoordinator.quickStart
  │  guards: active session · active restore · quick start already in flight
  │  merge:  the game's GameLobbySetup.quickStart defaults UNDER the request
  │  seats:  maxPlayers = 1 + localSeats.length + aiSeats.length   (exactly full)
  ▼
LobbyManager.hostLobby({ gameId, maxPlayers, agentSlots })   ← AI roster pre-seeded, atomically
LobbyManager.setGameParam('engine.sessionMode', 'quick')  ← the engine stamp, first
LobbyManager.setGameParam(…merged game params…)
LobbyManager.setPlayerAttribute(hostId, …hostAttributes…)
LobbyManager.addLocalSeat(<host>-local-N, { ready, attributes })
LobbyManager.updatePlayerReadyState(true)
LobbyManager.startGame()
```

- **Sugar, never a second constructor.** No `SessionRuntime` is built and no `engine:start_game` is
  dispatched here; the coordinator holds no session objects and reaches the manager only through injected
  ports whose lobby half is a structural slice of the public manager (pinned assignable at compile time).
- **AI seats ride `agentSlots`, not `addAi()`.** Pre-seeding the roster on the host call is atomic; an
  `addAi()` loop would allocate slots against a roster still being filled.
- **Local seats are host-owned.** A pass-and-play seat has no connection, so the own-seat
  `setPlayerAttribute` channel cannot reach it. Its picks are seeded at host time through
  `addLocalSeat`, merged over the descriptor's seat defaults. There is no runtime attribute channel for
  a local seat.
- **The `engine.sessionMode` stamp is engine-owned.** `SetGameParamPayloadSchema` refuses
  `SESSION_MODE_PARAM` (`'engine.sessionMode'`) and `QuickStartParamsSchema` refuses it inside a
  requested `gameParams` map, so no lobby screen and no game default can flip it.
  It rides `gameParams` into `snapshot.setup`, which is why it survives a window reload and a restore.
  Its absence means the session was born in the lobby. The sibling reserved key `engine.allowSpectators`
  stays host-settable — it IS a host toggle.
- **Failure leaves nothing behind.** Any throw after the lobby exists tears it down via `closeLobby()`;
  a failure of the teardown itself is logged, and the caller still sees the failure that broke the start.

---

## Leaving: two exits, forked on the stamp

A lobby-born match has a lobby to go back to; a quick-started one does not. `useLeaveGame` (the hook
behind `InGameMenuProps.leaveGame`) picks the exit by reading `engine.sessionMode` off the live
snapshot's `setup` — the same stamp the quick-start road wrote, which is why the answer survives a
window reload and a save restore.

```
InGameMenuProps.leaveGame(options?)   ← the GAME's leave call
  ▼  useLeaveGame
host + snapshot.setup.gameParams['engine.sessionMode'] === 'quick'
  ▼  chimera:lobby:close-session { autosave }  ── Zod-validated (CloseSessionParamsSchema)
     SessionRuntime.captureSaveFile → SaveManager.autoSave   (only when autosave)
     LobbyManager.closeLobby()                                (always)
  ▼  renderer routing: leaving-to-main-menu intent → /main-menu, snapshot dropped
host, no stamp   ▶  chimera:lobby:return-to-lobby → session survives at phase 'lobby' → /lobby
client (any)     ▶  chimera:lobby:leave           → disconnect → /main-menu
```

- **Atomic by contract.** The capture and the teardown are one call. A game-side "save, then leave"
  pair would race: a leave that landed first leaves the capture with no session to read. The capture
  runs against the settled snapshot before anything is torn down.
- **No second save writer.** The verb composes exactly the pair the crash path composes —
  `SessionRuntime.captureSaveFile` then `SaveManager.autoSave` — so the autosave slot keeps one
  owner and the `chimera:saves:slot-update` push fires from the `SaveManager.onSlotsChanged` seam as
  it does for every other write. A "Continue" offered right after the exit therefore sees the fresh
  autosave.
- **Host-gated on the session, not on a second predicate.** `activeSession` is set only inside the
  composition root's `onSessionHosted`, so a joined client reaches the verb with none and is refused;
  it leaves through `chimera:lobby:leave` as before.
- **`autosave` is a parameter of the leave call, never the `gameplay.autoSave` user setting.** That
  toggle governs turn-interval autosaves during play; reading it here would silently lose the match for
  a player who turned it off. It defaults to `true`, so a menu must ASK to discard.
- **A stamp-less save keeps lobby semantics.** Every save written before the stamp existed leaves via
  `return-to-lobby` — the documented degraded default, not a repair.

---

## Snapshot Setup Projection

When the host starts the match, the agreed configuration is built from the live `LobbyState` and carried
into the simulation, where projection syncs it to every client:

```
LobbyState ──buildSetupFromLobbyState()──▶ GameSetupConfig
   (electron/main/lobby/lobbySetupRegistry.ts)        │
                                                       ▼ engine:start_game payload.setup
                                          GameSnapshot.setup  (simulation, full state)
                                                       │
                                  StateProjector.project() — passed through VERBATIM
                                                       ▼
                                          PlayerSnapshot.setup  (identical for every viewer)
```

`buildSetupFromLobbyState()` walks **both** rosters: every `players` entry (host, joined remote, pass-and-play
local seat) under its own `playerId`, and every `kind: 'ai'` agent slot under the synthetic `ai-<slotIndex>` id
the host seats it with — one map, keyed the same way whatever kind of seat it is. A `players` entry wins over an
agent slot claiming the same id. A human-kind agent slot contributes nothing: it is a placeholder for a joining
human whose own entry carries its attributes, and no synthetic seat is ever created for it. The function returns
`undefined` when there is nothing to carry (no game params and no seat attributes), so the start payload
omits `setup` — which is what a game with no lobby setup sends. Because `setup` is
**public host config** with no owner-only or per-viewer fields, `StateProjector.project()` copies it
through unchanged — every viewer's projected snapshot exposes an identical `setup` (Invariant #101). This
keeps simulation-affecting values in lobby-agreed game params rather than in user settings (Invariant #36).

---

## Game Contribution Pattern

A game contributes a customizable lobby in two places — never by importing engine internals or a game
package into the shell or host:

1. **Renderer — the `LobbyScreen` slot.** `GameScreenRegistry.LobbyScreen?: ComponentType<GameLobbyScreenProps>`
   ([`renderer/game/rendererGameRegistry.ts`](../../renderer/game/rendererGameRegistry.ts)) is the sole
   coupling point. `renderer/app/lobby/page.tsx` loads the active game's shell via the registry
   (`loadRendererGameShell`) and renders `gameShell.LobbyScreen` with `GameLobbyScreenProps` when present;
   otherwise it falls back to the engine's default roster UI.
2. **Main — the injected lobby-setup builder.** A game supplies `MainGameContribution.lobbySetup: (content) => GameLobbySetup`
   at the consumer composition root ([`apps/tactics/electron/main.ts`](../../apps/tactics/electron/main.ts), #789).
   The host derives a `gameId → builder` map and hands it to
   [`createResolveLobbySetup`](../../electron/main/lobby/lobbySetupRegistry.ts), which closes each builder over the
   game's loaded content and injects the resulting `(gameId) => GameLobbySetup | undefined` resolver into
   `LobbyManager`. The registry module itself names no game — `@chimera-engine/electron` imports no game lobby code.

### Tactics example

[`apps/tactics/lobby/lobby-setup.ts`](../../apps/tactics/lobby/lobby-setup.ts) declares the descriptor;
[`apps/tactics/shell/TacticsLobbyScreen.tsx`](../../apps/tactics/shell/TacticsLobbyScreen.tsx) renders it.

```ts
export const tacticsLobbySetup: GameLobbySetup = {
    maxPlayers: 4,
    gameParamDefaults: { boardColor: DEFAULT_BOARD_COLOR }, // 'slate'
    gameParamOptions: { boardColor: TACTICS_BOARD_COLORS }, // slate | stone | navy
    playerAttributeOptions: { color: TACTICS_PLAYER_COLORS }, // blue | red | green | amber
    resolveDefaultPlayerAttributes(seatIndex) {
        // Seat n defaults to palette colour n, wrapping via modulo to stay total.
        const option = TACTICS_PLAYER_COLORS[seatIndex % TACTICS_PLAYER_COLORS.length];
        return { color: option?.value ?? DEFAULT_PLAYER_COLOR };
    },
};
```

The board-colour `<Select>` is `disabled` for non-hosts (host-authored), while each per-seat unit-colour
`<Select>` is `disabled` on every row except the local player's own (owner-authored). The 4-player
colour-sync end-to-end test ([`apps/tactics/e2e/tests/tactics-lobby-color-sync.spec.ts`](../../apps/tactics/e2e/tests/tactics-lobby-color-sync.spec.ts))
proves each player's own-colour choice and the host's board choice reach every peer and land identically
on `snapshot.setup`.

---

## Module Tree

```
simulation/foundation/
├── game-lobby-contract.ts      # GameLobbySetup (incl. quickStart?), GameSetupConfig, GameLobbyScreenProps, LobbyFieldOption, SESSION_MODE_PARAM
├── quick-start-contract.ts     # QuickStartConfig / QuickStartSeat / QuickStartAiSeat — zero-import leaf
└── messages-schemas.ts         # LobbyState.gameParams?, LobbyPlayerEntry.attributes?, LobbyAgentSlot.attributes?
electron/
├── main/
│   ├── lobby/
│   │   ├── LobbyManager.ts          # Host-only setGameParam / owner-authored setPlayerAttribute + broadcast
│   │   └── lobbySetupRegistry.ts    # createResolveLobbySetup, buildSetupFromLobbyState (game-agnostic; builder injected via MainGameContribution.lobbySetup)
│   ├── runtime/
│   │   ├── QuickStartCoordinator.ts # chimera:lobby:quick-start orchestration over public manager verbs
│   │   └── syntheticAgentId.ts      # createSyntheticAIPlayerId — the one spelling of an AI seat's id
│   └── ipc/
│       ├── ipc-handlers.ts          # chimera:lobby:set-game-param / set-player-attribute / quick-start / close-session handlers
│       └── ipc-schemas.ts           # SetGameParamPayloadSchema, SetPlayerAttributePayloadSchema, QuickStartParamsSchema, CloseSessionParamsSchema
└── preload/
    └── apis/lobby-api.ts            # LobbyAPI.setGameParam / setPlayerAttribute / quickStart / closeSession + channel constants
simulation/
├── engine/EngineActions.ts          # engine:start_game payload.setup → GameSnapshot.setup
└── projection/StateProjector.ts     # passes fullState.setup through to PlayerSnapshot verbatim
renderer/
├── game/rendererGameRegistry.ts     # GameScreenRegistry.LobbyScreen slot (registry-loaded)
└── app/lobby/
    ├── page.tsx                     # Engine lobby route; renders gameShell.LobbyScreen when present
    └── useLobbyApi.ts               # setGameParam / setPlayerAttribute → IPC
apps/
└── tactics/
    ├── lobby/lobby-setup.ts         # tacticsLobbySetup descriptor + colour palettes
    └── shell/TacticsLobbyScreen.tsx # First LobbyScreen consumer (host board colour + own-seat unit colour)
```

---

## Invariants

| #    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #36  | Settings remain outside simulation state and the `ActionPipeline`. Any value that affects simulation outcomes belongs in the lobby-agreed `gameParams` map transmitted during lobby setup — i.e. `GameSetupConfig`, not user settings.                                                                                                                                                                                                                                                                                                   |
| #80  | The `GameScreenRegistry` is the sole coupling point between the engine renderer and a game's React code. The `LobbyScreen` slot follows the same registry indirection.                                                                                                                                                                                                                                                                                                                                                                   |
| #99  | Lobby game params are **host-authored**; per-player attributes are **owner-authored**. `LobbyManager.setGameParam()` rejects a non-hosted session; `setPlayerAttribute()` rejects any seat but the caller's own and (for a joined client) forwards the own-seat intent to the host, which applies it to the connection-derived sender seat. Three Zod-validated IPC channels funnel into those verbs; changes broadcast to every peer. The host connection owns every pass-and-play local seat on a shared machine, seeded at host time. |
| #100 | Game `LobbyScreen` components perform **no privileged writes directly** — they call the engine-provided `setGameParam` / `setPlayerAttribute` props (routed renderer API → IPC → `LobbyManager`) and never write `lobbyStore`, call `LobbyManager`, or open IPC channels themselves.                                                                                                                                                                                                                                                     |
| #101 | `GameSnapshot.setup` / `PlayerSnapshot.setup` is **public host config** passed through `StateProjector.project()` **verbatim** — no owner-only or per-viewer fields — so every viewer's projected snapshot carries an identical `setup`.                                                                                                                                                                                                                                                                                                 |

---

## Cross-References

- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — §4.37 shell pages, §4.37.4 lobby modal surface, §4.37.12 game-customizable lobby screen
- [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md) — §4.14 `LobbyManager`, `StateBroadcaster`, lobby broadcast
- [Renderer State Stores](renderer-state-stores.md) — §4.4 `lobbyStore`, `useLobbyApi()`
- [State Projection Interfaces](state-projection-interfaces.md) — §4.6 `StateProjector.project()`
- [Spectator Mode Contract](spectator-mode-contract.md) — the reserved `engine.allowSpectators` host toggle rides on `snapshot.setup` (F72)
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #36, #80, #99–#101
- [M8 Hardening Roadmap](../roadmap-sections/m8-hardening-v0.8.0.md) — F53 customizable lobby
