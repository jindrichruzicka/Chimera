---
title: 'Electron Shell and IPC Bridge'
description: 'ChimeraAPI preload surface, all IPC namespace interfaces, the Extension System, security boundaries, and IPC channel conventions. Everything in electron/preload/ and the IPC side of electron/main/.'
tags: [electron, ipc, preload, security, api, extensions]
---

# Electron Shell and IPC Bridge

> § 4.1 and § 4.1a of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [IPC Security Model](../security-trust/ipc-security-model.md) · [Module Boundaries](../executive-architecture/module-boundaries-file-tree.md)

---

## Overview

The Electron preload script is the **only** conduit between the renderer (Next.js) and the main process. It is compiled separately, enforces `contextIsolation: true` / `nodeIntegration: false`, and exposes a typed `ChimeraAPI` surface via `contextBridge.exposeInMainWorld`.

```typescript
// electron/preload/api-types.ts — ALL namespace interfaces (type-only module)
interface ChimeraAPI {
    readonly game: GameAPI;
    readonly lobby: LobbyAPI;
    readonly saves: SavesAPI;
    readonly settings: SettingsAPI;
    readonly profile: ProfileAPI;
    readonly replay: ReplayAPI;
    readonly chat: ChatAPI;
    readonly logs: LogsAPI;
    readonly system: SystemAPI;
    readonly lobbyDiscovery: LobbyDiscoveryAPI;
    readonly extensions: ChimeraExtensions;
}
```

---

## GameAPI — Action Dispatch and Snapshot Stream

```typescript
interface GameAPI {
    /** Dispatch an action to the simulation host via IPC. */
    sendAction(action: EngineAction): void;
    /**
     * Subscribe to projected snapshots for the local player.
     * Returns an unsubscribe function. Do NOT call directly from components —
     * use `useSendAction()` and the Zustand store instead.
     */
    onSnapshot(listener: (snapshot: PlayerSnapshot) => void): () => void;
    /** Subscribe to action rejection notifications. */
    onActionRejected(listener: (rejection: ActionRejection) => void): () => void;
}

interface ActionRejection {
    readonly type: string; // Action type that was rejected
    readonly tick: number; // Tick at rejection
    readonly reason: string; // Human-readable reason for developer/debug use
}
```

---

## LobbyAPI

```typescript
interface LobbyAPI {
    /** Host a new lobby via the current MultiplayerProvider. */
    hostLobby(config: LobbyConfig): Promise<LobbyState>;
    /** Join an existing lobby. */
    joinLobby(token: string): Promise<LobbyState>;
    /** Leave / close the current lobby. */
    leaveLobby(): Promise<void>;
    /** Subscribe to lobby state changes (players joining/leaving, seat changes). */
    onLobbyStateChanged(listener: (state: LobbyState) => void): () => void;
}
```

---

## SavesAPI

```typescript
interface SavesAPI {
    /** List all save slots for the current game. */
    list(gameId: string): Promise<SaveSlotMeta[]>;
    /** Save current state to slot. */
    save(request: SaveRequest): Promise<SaveSlotMeta>;
    /** Load a save slot. Main process replaces simulation state. */
    load(slotId: string): Promise<void>;
    /** Permanently delete a slot. */
    delete(slotId: string): Promise<void>;
    /**
     * Cached crash-recovery status captured once at app startup
     * (before the clean-exit flag is cleared).  `needsRecovery: true`
     * means the previous session crashed and the autosave at
     * `slotId` is available to resume from.
     */
    checkCrashRecovery(): Promise<CrashRecoveryStatus>;
    /**
     * Subscribe to slot-list updates pushed via
     * `chimera:saves:slot-update` after every save / delete.  The
     * callback receives the full refreshed `SaveSlotMeta[]` for the
     * currently active game.
     */
    onSlotUpdate(listener: (slots: SaveSlotMeta[]) => void): () => void;
}
```

Channels:

- `chimera:saves:list` — invoke
- `chimera:saves:save` — invoke
- `chimera:saves:load` — invoke
- `chimera:saves:delete` — invoke
- `chimera:saves:check-crash-recovery` — invoke
- `chimera:saves:slot-update` — push (main → renderer)

---

## SettingsAPI

```typescript
interface SettingsAPI {
    getSettings(gameId?: string): Promise<ResolvedSettings>;
    updateSettings(patch: Partial<UserSettings>, gameId?: string): Promise<void>;
    resetSettings(gameId?: string): Promise<void>;
    onSettingsChanged(listener: (settings: ResolvedSettings) => void): () => void;
}
```

---

## ProfileAPI

```typescript
interface ProfileAPI {
    /** Returns this machine's local player profile. */
    getLocalProfile(): Promise<PlayerProfile>;
    /** Update this machine's local profile. Mid-lobby updates use the attest-first flow. */
    updateLocal(patch: Partial<EngineProfile>): Promise<void>;
    /** Returns all profiles known in the current lobby (keyed by PlayerId). */
    getLobbyDirectory(): Promise<Readonly<Record<PlayerId, PlayerProfile>>>;
    onDirectoryChanged(
        listener: (directory: Readonly<Record<PlayerId, PlayerProfile>>) => void,
    ): () => void;
}
```

---

## ReplayAPI

```typescript
interface ReplayAPI {
    /** Export a completed match replay to disk. */
    export(matchId: string): Promise<string>; // Returns file path
    /** Load a replay file for playback. */
    load(filePath: string): Promise<ReplayFile>;
    /** List available replay files. */
    list(): Promise<ReplayFileMeta[]>;
}
```

---

## ChatAPI

```typescript
interface ChatAPI {
    send(body: string, scope: ChatScope): Promise<void>;
    onMessage(listener: (message: ChatMessage) => void): () => void;
    /** Returns the last 500 messages (renderer buffer). */
    history(): ChatMessage[];
    /** Mute a player locally (client-side — does not affect host relay). */
    mute(playerId: PlayerId): void;
    unmute(playerId: PlayerId): void;
}
```

---

## LogsAPI

```typescript
interface LogsAPI {
    /** Renderer forwards structured log entries to main for unified log files. */
    send(entry: LogEntry): void;
}
```

---

## SystemAPI

```typescript
interface SystemAPI {
    /** Platform / Electron version info. */
    getPlatformInfo(): Promise<PlatformInfo>;
    /** Connection quality summary. */
    getConnectionStatus(): Promise<ConnectionStatus>;
    /** Device info — see §4.17. */
    getDeviceInfo(): Promise<DeviceInfo>;
    onDeviceInfoChange(listener: (info: DeviceInfo) => void): () => void;
    quit(): void;
}
```

---

## LobbyDiscoveryAPI

```typescript
interface LobbyDiscoveryAPI {
    /** Returns lobbies advertised by the current BrowsableProvider (LAN, etc.). */
    browse(): Promise<DiscoveredLobby[]>;
    onLobbiesChanged(listener: (lobbies: DiscoveredLobby[]) => void): () => void;
}
```

---

## IPC Channel Naming Conventions

Every `ipcMain.handle` / `ipcRenderer.invoke` call uses a `chimera:<namespace>/<method>` prefix. The namespace matches the `ChimeraAPI` key:

| Namespace          | Example channels                                                            |
| ------------------ | --------------------------------------------------------------------------- |
| `chimera:game`     | `chimera:game/send-action`, `chimera:game/get-current-snapshot`             |
| `chimera:lobby`    | `chimera:lobby/host`, `chimera:lobby/join`, `chimera:lobby/leave`           |
| `chimera:saves`    | `chimera:saves/list`, `chimera:saves/save`, `chimera:saves/load`            |
| `chimera:settings` | `chimera:settings/get`, `chimera:settings/update`, `chimera:settings/reset` |
| `chimera:profile`  | `chimera:profile/get-local`, `chimera:profile/update-local`                 |
| `chimera:replay`   | `chimera:replay/export`, `chimera:replay/load`, `chimera:replay/list`       |
| `chimera:chat`     | `chimera:chat/send`                                                         |
| `chimera:logs`     | `chimera:logs/send`                                                         |
| `chimera:system`   | `chimera:system/platform`, `chimera:system/device-info`                     |
| `chimera:debug`    | `chimera:debug/*` (debug builds only; Inspector Window only)                |

Every `ipcMain.handle` input is validated with **Zod** before passing to the simulation. See [IPC Security Model](../security-trust/ipc-security-model.md) for the full audit table.

---

## 4.1a Extension System

### Design: TypeScript Declaration Merging

```typescript
// electron/preload/api-types.ts
// Default: empty interface. Games augment this to add their own API namespaces.
interface ChimeraExtensions {}
```

A game (or engine module) extends the surface:

```typescript
// games/<game>/preload-extension.ts
import type {} from '@chimera/core/electron/preload/api-types';

declare module '@chimera/core/electron/preload/api-types' {
    interface ChimeraExtensions {
        readonly <game>: GameExtensionAPI;
    }
}
```

### Registration

```typescript
// electron/preload/extensions-api.ts
type ExtensionFactory = () => unknown;
const _registry = new Map<string, ExtensionFactory>();

/** Register before api.ts loads. */
export function registerExtension(key: keyof ChimeraExtensions, factory: ExtensionFactory): void {
    if (_built) throw new Error('Extensions registry is frozen; too late to register');
    _registry.set(key as string, factory);
}

/** Called exactly once by api.ts immediately before contextBridge.exposeInMainWorld. */
export function buildExtensionsApi(): ChimeraExtensions {
    _built = true;
    const result: Record<string, unknown> = {};
    for (const [key, factory] of _registry) result[key] = factory();
    return Object.freeze(result) as ChimeraExtensions;
}
```

### Invocation Order Constraint

Extensions must be registered **before** `api.ts` is evaluated. In a game's preload entry:

```typescript
// games/<game>/preload.ts
import './preload-extension'; // FIRST — register extension
import '@chimera/core/electron/preload/api.js'; // SECOND — build + expose
```

Do **not** mix a body-level `registerExtension()` call and `import './api.js'` in the same file — ESM's static import hoisting means `api.js` always evaluates before any body code in the importing module.

### Security Boundary

- Extensions are registered in the **preload script** — same security context as all other preload code.
- `buildExtensionsApi()` freezes the returned object before it is passed to `exposeInMainWorld`.
- `contextBridge` independently clones values into the renderer world; the freeze guards the preload-world side.
- Core (`@chimera/core`) registers **zero** extensions in 1.0.0.

### Invariant

> **Invariant #79:** `buildExtensionsApi()` is called exactly once per preload session, immediately before `contextBridge.exposeInMainWorld`. No extension may be registered after that call.

---

## Key Invariants

- **Invariant #1** — `GameSnapshot` never leaves the main process. Only `PlayerSnapshot` crosses boundaries.
- **Invariant #5** — All IPC methods are declared in `ipc-handlers.ts` and exposed only through `preload/api.ts`.
- **Invariant #6** — Network messages are validated before they touch the simulation.
- **Invariant #79** — Extensions registry is frozen before `contextBridge.exposeInMainWorld`.

---

## Cross-References

- [IPC Security Model](../security-trust/ipc-security-model.md) — full IPC attack surface audit table
- [Simulation Core](simulation-core-action-pipeline.md) — what `sendAction` dispatches into
- [Renderer State Stores](renderer-state-stores.md) — how `onSnapshot` drives `gameStore`
- [Module Boundaries](../executive-architecture/module-boundaries-file-tree.md) — `electron/preload/` file tree
