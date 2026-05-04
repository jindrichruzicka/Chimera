---
title: 'Multiplayer Provider & WebSocket'
description: 'MultiplayerProvider and BrowsableProvider interfaces, HostedSession/JoinedSession, HostTransport/ClientTransport, SideChannelMessage, LobbyManager, StateBroadcaster/MessageRouter decoupling, LocalWebSocketProvider architecture, and SteamNetworkProvider stub.'
tags: [multiplayer, websocket, lobby, provider, networking]
---

# Multiplayer Provider & WebSocket

> §4.14 of the Chimera architecture.
> Related: [WebSocket Message Protocol](websocket-message-protocol.md) · [Electron Shell](electron-shell-ipc-bridge.md) · [Simulation Core](simulation-core-action-pipeline.md)

---

## Executive Decision

The networking layer is abstracted behind a `MultiplayerProvider` interface. `LocalWebSocketProvider` (default) starts a WebSocket server in Electron's main process for LAN/localhost play. Future providers (e.g. `SteamNetworkProvider`) wire in by **changing one line in `electron/main/index.ts`** — zero changes to simulation, IPC bridge, or renderer.

---

## Provider Table

| Provider                 | Transport                | Discovery                   | Status                |
| ------------------------ | ------------------------ | --------------------------- | --------------------- |
| `LocalWebSocketProvider` | WebSocket (`ws`) in main | Manual IP / local room code | Default — implemented |
| `SteamNetworkProvider`   | Steamworks P2P / relay   | Steam lobby browser/invites | Future placeholder    |

---

## Core Interfaces

```typescript
// networking/provider/MultiplayerProvider.ts

interface HostedSession {
    readonly lobbyCode: string;
    readonly transport: HostTransport;
    close(): Promise<void>;
}

interface HostTransport {
    sendSnapshot(playerId: PlayerId, snapshot: PlayerSnapshot): void;
    broadcastLobbyState(state: LobbyState): void;
    /** Side-channel: non-authoritative, not in ActionHistory, not in saves/replays */
    sendSideChannel(target: PlayerId | 'broadcast', msg: SideChannelMessage): void;
    /** Push a cryptographic commitment reveal to one client or all clients. */
    sendReveal(target: PlayerId | 'broadcast', reveal: WireCommitmentReveal): void;
    onActionReceived(cb: (from: PlayerId, action: EngineAction) => void): Unsubscribe;
    onSideChannelReceived(cb: (from: PlayerId, msg: SideChannelMessage) => void): Unsubscribe;
    onPlayerJoined(cb: (player: LobbyPlayerEntry) => void): Unsubscribe;
    onPlayerLeft(cb: (playerId: PlayerId, reason: DisconnectReason) => void): Unsubscribe;
}

interface JoinedSession {
    readonly lobbyInfo: LobbyInfo;
    readonly initialLobbyState: LobbyState;
    readonly transport: ClientTransport;
    disconnect(): Promise<void>;
}

interface ClientTransport {
    sendAction(action: EngineAction): void;
    sendReadyStateUpdate(ready: boolean): void;
    sendSideChannel(msg: SideChannelMessage): void;
    onSnapshotReceived(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe;
    onSideChannelReceived(cb: (msg: SideChannelMessage) => void): Unsubscribe;
    /** @remarks Always verify via CommitmentScheme.verify() before trusting reveal.value (Invariant #9). */
    onReveal(cb: (reveal: WireCommitmentReveal) => void): Unsubscribe;
    onLobbyStateChanged(cb: (state: LobbyState) => void): Unsubscribe;
    onDisconnected(cb: (reason: DisconnectReason) => void): Unsubscribe;
    onLatencyUpdate(cb: (latencyMs: number) => void): Unsubscribe;
}

/** Discriminated union — extend for new out-of-band channels, never for gameplay */
type SideChannelMessage =
    | { kind: 'chat'; payload: ChatMessage } // §4.29
    | { kind: 'profile'; payload: PlayerProfile }; // §4.24

interface MultiplayerProvider {
    hostLobby(params: HostLobbyParams): Promise<HostedSession>;
    joinLobby(params: JoinLobbyParams): Promise<JoinedSession>;
    dispose(): void;
}

/** Optional browsable capability — implemented as a separate interface (ISP) */
interface BrowsableProvider {
    listLobbies(): Promise<LobbyListEntry[]>;
}

function isBrowsable(p: MultiplayerProvider): p is MultiplayerProvider & BrowsableProvider;
```

---

## LobbyManager (electron/main)

`LobbyManager` holds the active provider and translates IPC calls into provider calls. The simulation (`StateBroadcaster`, `MessageRouter`) talks to `HostTransport`, never to WebSocket connections directly.

```typescript
class LobbyManager {
    constructor(private readonly provider: MultiplayerProvider) {}

    // IPC: 'chimera:host-lobby'
    async hostLobby(params: HostLobbyParams): Promise<LobbyInfo>;

    // IPC: 'chimera:join-lobby'
    async joinLobby(params: JoinLobbyParams): Promise<LobbyInfo>;

    async closeLobby(): Promise<void>;
}
```

---

## StateBroadcaster & MessageRouter Decoupling

Neither module references WebSocket directly:

- **`StateBroadcaster`** — wired as `BroadcastContext.broadcast` callback. Pipeline stage 7 → `StateBroadcaster` → `transport.sendSnapshot(playerId, projected)`.
- **`MessageRouter`** — subscribes to `transport.onActionReceived()`. `LocalWebSocketProvider` deserialises frames and delivers typed `EngineAction` objects.

Both are provider-agnostic and require zero changes when switching to Steam.

---

## LocalWebSocketProvider Internal Architecture

```
LocalWebSocketProvider.hostLobby()
  └── LobbyServer — binds ws server to localhost:<port>
        ├── MessageRouter subscribes ws 'message' → fires transport.onActionReceived()
        └── HostTransport.sendSnapshot() → serialises PlayerSnapshot → ws.send()

LocalWebSocketProvider.joinLobby()
  └── ServerConnection — ws client connecting to host IP:port
        ├── ClientTransport.sendAction() → serialises EngineAction → ws.send()
        └── ws 'message' → deserialise → fires transport.onSnapshotReceived()
```

`LocalWebSocketProvider` is the sole owner of `networking/server/` and `networking/client/`. No code outside `networking/provider/` imports from those directories.

---

## SteamNetworkProvider Stub

```typescript
// networking/provider/SteamNetworkProvider.ts
export class SteamNetworkProvider implements MultiplayerProvider {
    async hostLobby(_params: HostLobbyParams): Promise<HostedSession> {
        throw new Error('SteamNetworkProvider not yet implemented');
    }
    async joinLobby(_params: JoinLobbyParams): Promise<JoinedSession> {
        throw new Error('SteamNetworkProvider not yet implemented');
    }
    async listLobbies(): Promise<LobbyListEntry[]> {
        throw new Error('SteamNetworkProvider not yet implemented');
    }
    dispose(): void {
        /* leave lobby, close all P2P channels */
    }
}
```

---

## Provider Injection (single wiring point)

```typescript
// electron/main/index.ts
const multiplayerProvider: MultiplayerProvider = new LocalWebSocketProvider();
// Future: isSteam() ? new SteamNetworkProvider() : new LocalWebSocketProvider();
const lobbyManager = new LobbyManager(multiplayerProvider);
```

---

## Invariants

| #   | Rule                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #37 | `MultiplayerProvider` is injected into `LobbyManager`. `LobbyManager` never imports `LocalWebSocketProvider` by name.                                                                   |
| #38 | `HostTransport.sendSideChannel()` / `ClientTransport.sendSideChannel()` carry only `SideChannelMessage` variants. No `EngineAction` or `PlayerSnapshot` may flow over the side channel. |
| #39 | `StateBroadcaster` and `MessageRouter` depend only on `HostTransport`/`ClientTransport` interfaces. They have no imports from `networking/server/` or `networking/client/`.             |
| #40 | `networking/provider/local/` may only import from within `local/`. It must not import engine or renderer internals.                                                                     |
| #41 | `InMemorySaveRepository` must pass the identical contract test suite as `FileSaveRepository`.                                                                                           |

---

## Game Shape Fitness (§4.15)

The same `LocalWebSocketProvider` / `HostTransport` / `ClientTransport` abstraction serves Tic Tac Toe (2 players, trivial state), Monopoly (2–8 players, rich state), Turn-Based Strategy (fog-of-war), and 4X (large snapshots, many screens). The engine core requires no changes per game type.

---

## Cross-References

- [WebSocket Message Protocol](websocket-message-protocol.md) — wire message format (CLIENT/SERVER messages, CRC32, PING/PONG)
- [Electron Shell](electron-shell-ipc-bridge.md) — `LobbyAPI` IPC namespace
- [State Projection](state-projection-interfaces.md) — `StateProjector.project()` used in `StateBroadcaster`
- [Player Profiles](player-profiles-directory.md) — `SideChannelMessage { kind: 'profile' }`
- [Chat System](chat-system.md) — `SideChannelMessage { kind: 'chat' }`
