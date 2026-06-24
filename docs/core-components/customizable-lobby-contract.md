---
title: 'Customizable Lobby Contract'
description: 'Declarative contract for game-customizable multiplayer lobbies (F53). Defines the GameLobbySetup descriptor, the synced GameSetupConfig, GameLobbyScreenProps, the registry-loaded LobbyScreen slot, the lobby write path (renderer lobby API → IPC → LobbyManager) with host-authored match settings and owner-authored per-player attributes, and how snapshot.setup is projected to every peer verbatim. Ratifies invariants #99, #100, #101.'
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
dialog, host/join tabs, player roster, ready and start controls — is fixed by the engine. A game
customizes only the **match configuration** it needs: a set of host-chosen _match settings_ (e.g. board
colour) and per-seat _player attributes_ (e.g. unit colour). A game declares this surface declaratively
through a `GameLobbySetup` descriptor and, optionally, ships a registry-loaded `LobbyScreen` React
component that renders those controls inside the engine dialog.

The contract splits authorship by scope: **match settings are host-authored** (only the host edits them;
clients read), while **per-player attributes are owner-authored** — each player edits only its OWN seat,
the host stays authoritative and rebroadcasts. Every accepted edit is broadcast through `LobbyState` so
all peers converge, and the agreed-upon configuration is carried into the match as `snapshot.setup`,
projected to every viewer verbatim. Tactics is the first adopter (the host picks a shared board colour
and each player picks their own unit colour).

This contract ratifies invariants **#99** (host-authored match settings / owner-authored player
attributes), **#100** (no direct privileged writes from game lobby UI), and **#101** (`snapshot.setup`
is public, projected verbatim).

---

## Core Types

Declared in [`shared/game-lobby-contract.ts`](../../shared/game-lobby-contract.ts) — a `shared/` module
with type-only imports, so it carries zero runtime imports and is safe to load in both `main` and the
renderer (mirroring `game-shell-contract.ts`).

```ts
/** A single selectable value for a match setting or player attribute. */
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
    readonly matchSettingsDefaults: Record<string, string>;
    readonly matchSettingsOptions: Record<string, readonly LobbyFieldOption[]>;
    readonly playerAttributeOptions: Record<string, readonly LobbyFieldOption[]>;
    resolveDefaultPlayerAttributes(seatIndex: number): Record<string, string>;
}

/**
 * The resolved, synced match-setup shape carried alongside the snapshot so every
 * peer agrees on the configuration.
 */
export interface GameSetupConfig {
    readonly matchSettings: Record<string, string>;
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
    readonly setMatchSetting: (key: string, value: string) => void;
    readonly setPlayerAttribute: (playerId: PlayerId, key: string, value: string) => void;
    readonly onToggleReady: (ready: boolean) => Promise<void>;
    readonly onStartGame: () => Promise<void>;
    readonly onLeave: () => Promise<void>;
}
```

The synced state lives on the wire types in [`shared/messages-schemas.ts`](../../shared/messages-schemas.ts):
`LobbyState.matchSettings?: Record<string, string>` and `LobbyPlayerEntry.attributes?: Record<string, string>`.
Both are **optional and backward-compatible** — absent on older clients and on games with no lobby setup.

---

## Write Path (host-authored settings, owner-authored attributes)

A lobby edit never touches privileged state directly. It travels engine-owned indirection from the game
lobby screen to the authoritative `LobbyManager`, which is the sole writer and broadcasts back to peers.
The host authors match **settings**; each player authors only its OWN seat's **attributes**:

```
LobbyScreen                                          all peers
  │  setMatchSetting (host)  setPlayerAttribute (own seat)   ▲
  ▼  (GameLobbyScreenProps)                                  │ re-render from broadcast
useLobbyApi()  (renderer/app/lobby/useLobbyApi.ts)           │
  ▼  ipcRenderer.invoke                                      │
chimera:lobby:set-match-setting                              │
chimera:lobby:set-player-attribute   ── Zod-validated ───────┤  (ipc-schemas.ts)
  ▼  ipcMain.handle (ipc-handlers.ts)                        │
LobbyManager.setMatchSetting    → HOST-ONLY (rejects joined) │
LobbyManager.setPlayerAttribute → OWN-SEAT only:            │
  • hosted: merge own seat ────────────────────────────────┤
  • joined: send PLAYER_ATTRIBUTE_UPDATE to host ───────────┘
       host applies to the SENDER's seat (HostTransport.onPlayerAttributeUpdate)
  ▼  merge into LobbyState → publishLobbyState + broadcast
```

- **Sole write path.** The two channels are the only way to author lobby config. `setMatchSetting()`
  rejects (returns a rejected `Promise`) when the active session is not a hosted session.
  `setPlayerAttribute()` rejects any `playerId` other than the caller's own seat; a joined client's
  own-seat write is forwarded to the host, which applies it to the connection-derived sender seat —
  never a client-supplied id (Invariant #99). This mirrors the owner-authored `ready` flow.
- **No direct privileged writes from the game UI.** A `LobbyScreen` calls the engine-provided
  `setMatchSetting` / `setPlayerAttribute` props only. It must not write the IPC-mirrored `lobbyStore`,
  call `LobbyManager`, or open IPC channels itself (Invariant #100).
- **Read-only where you have no authority.** A `LobbyScreen` disables the board-colour control for a
  non-host (`isHost === false`) and disables every per-player colour control except the local player's
  own row; all peers render the broadcast `LobbyState`.

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

`buildSetupFromLobbyState()` returns `undefined` when there is nothing to carry (no match settings and no
player attributes), so the start payload omits `setup` and stays backward-compatible. Because `setup` is
**public host config** with no owner-only or per-viewer fields, `StateProjector.project()` copies it
through unchanged — every viewer's projected snapshot exposes an identical `setup` (Invariant #101). This
keeps simulation-affecting parameters in match config rather than in user settings (Invariant #36).

---

## Game Contribution Pattern

A game contributes a customizable lobby in two registry-mediated places — never by importing engine
internals or `games/*` into the shell:

1. **Renderer — the `LobbyScreen` slot.** `GameScreenRegistry.LobbyScreen?: ComponentType<GameLobbyScreenProps>`
   ([`renderer/game/rendererGameRegistry.ts`](../../renderer/game/rendererGameRegistry.ts)) is the sole
   coupling point. `renderer/app/lobby/page.tsx` loads the active game's shell via the registry
   (`loadRendererGameShell`) and renders `gameShell.LobbyScreen` with `GameLobbyScreenProps` when present;
   otherwise it falls back to the engine's default roster UI.
2. **Main — the lobby-setup registry.** [`electron/main/lobby/lobbySetupRegistry.ts`](../../electron/main/lobby/lobbySetupRegistry.ts)
   is the one place permitted to import `games/*` lobby descriptors. It maps `gameId → GameLobbySetup`
   (`resolveLobbySetup`), injected into `LobbyManager` so the manager stays free of game imports.

### Tactics example

[`games/tactics/lobby/lobby-setup.ts`](../../games/tactics/lobby/lobby-setup.ts) declares the descriptor;
[`games/tactics/shell/TacticsLobbyScreen.tsx`](../../games/tactics/shell/TacticsLobbyScreen.tsx) renders it.

```ts
export const tacticsLobbySetup: GameLobbySetup = {
    maxPlayers: 4,
    matchSettingsDefaults: { boardColor: DEFAULT_BOARD_COLOR }, // 'slate'
    matchSettingsOptions: { boardColor: TACTICS_BOARD_COLORS }, // slate | stone | navy
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
shared/
├── game-lobby-contract.ts      # GameLobbySetup, GameSetupConfig, GameLobbyScreenProps, LobbyFieldOption
└── messages-schemas.ts         # LobbyState.matchSettings?, LobbyPlayerEntry.attributes?
electron/
├── main/
│   ├── lobby/
│   │   ├── LobbyManager.ts          # Host-only setMatchSetting / owner-authored setPlayerAttribute + broadcast
│   │   └── lobbySetupRegistry.ts    # resolveLobbySetup, buildSetupFromLobbyState (games/* composition point)
│   └── ipc/
│       ├── ipc-handlers.ts          # chimera:lobby:set-match-setting / set-player-attribute handlers
│       └── ipc-schemas.ts           # SetMatchSettingPayloadSchema, SetPlayerAttributePayloadSchema
└── preload/
    └── apis/lobby-api.ts            # LobbyAPI.setMatchSetting / setPlayerAttribute + channel constants
simulation/
├── engine/EngineActions.ts          # engine:start_game payload.setup → GameSnapshot.setup
└── projection/StateProjector.ts     # passes fullState.setup through to PlayerSnapshot verbatim
renderer/
├── game/rendererGameRegistry.ts     # GameScreenRegistry.LobbyScreen slot (registry-loaded)
└── app/lobby/
    ├── page.tsx                     # Engine lobby route; renders gameShell.LobbyScreen when present
    └── useLobbyApi.ts               # setMatchSetting / setPlayerAttribute → IPC
games/
└── tactics/
    ├── lobby/lobby-setup.ts         # tacticsLobbySetup descriptor + colour palettes
    └── shell/TacticsLobbyScreen.tsx # First LobbyScreen consumer (host board colour + own-seat unit colour)
```

---

## Invariants

| #    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #36  | Settings remain outside simulation state and the `ActionPipeline`. Any game parameter that affects simulation outcomes belongs in match config transmitted during lobby setup — i.e. `GameSetupConfig`, not user settings.                                                                                                                                                                                                       |
| #80  | The `GameScreenRegistry` is the sole coupling point between the engine renderer and a game's React code. The `LobbyScreen` slot follows the same registry indirection.                                                                                                                                                                                                                                                           |
| #99  | Lobby match settings are **host-authored**; per-player attributes are **owner-authored**. `LobbyManager.setMatchSetting()` rejects a non-hosted session; `setPlayerAttribute()` rejects any seat but the caller's own and (for a joined client) forwards the own-seat intent to the host, which applies it to the connection-derived sender seat. The two IPC channels are the sole write path; changes broadcast to every peer. |
| #100 | Game `LobbyScreen` components perform **no privileged writes directly** — they call the engine-provided `setMatchSetting` / `setPlayerAttribute` props (routed renderer API → IPC → `LobbyManager`) and never write `lobbyStore`, call `LobbyManager`, or open IPC channels themselves.                                                                                                                                          |
| #101 | `GameSnapshot.setup` / `PlayerSnapshot.setup` is **public host config** passed through `StateProjector.project()` **verbatim** — no owner-only or per-viewer fields — so every viewer's projected snapshot carries an identical `setup`.                                                                                                                                                                                         |

---

## Cross-References

- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — §4.37 shell pages, §4.37.4 lobby modal surface, §4.37.12 game-customizable lobby screen
- [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md) — §4.14 `LobbyManager`, `StateBroadcaster`, lobby broadcast
- [Renderer State Stores](renderer-state-stores.md) — §4.4 `lobbyStore`, `useLobbyApi()`
- [State Projection Interfaces](state-projection-interfaces.md) — §4.6 `StateProjector.project()`
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #36, #80, #99–#101
- [M8 Hardening Roadmap](../roadmap-sections/m8-hardening-v0.8.0.md) — F53 customizable lobby
