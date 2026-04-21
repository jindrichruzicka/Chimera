// electron/preload/api.ts
//
// Dual role:
//
// 1. **Type surface.** Declares the full `window.__chimera` contract
//    (`ChimeraAPI` and every nested namespace interface) consumed by the
//    renderer through `renderer/types/chimera.d.ts` and by every namespace
//    factory under `electron/preload/*-api.ts`.
// 2. **Preload runtime entry.** At the bottom of this file, composes the
//    five namespace factories and calls
//    `contextBridge.exposeInMainWorld('__chimera', api)` exactly once — the
//    sole side effect Electron executes when loading this module as the
//    BrowserWindow preload script.
//
// The runtime code is an import-time side effect; nothing else imports
// `api.ts` for its values (every sibling module uses `import type` so the
// types are erased). Invariant 28: this file must NEVER expose a
// `__chimeraDebug` surface — the Debug Inspector preload lives elsewhere.

// ─── Primitive aliases ────────────────────────────────────────────────────────

/** Opaque player identifier. Canonical branded type: simulation/ (F03). */
export type PlayerId = string;

/** Opaque entity identifier. Canonical branded type: simulation/ (F03). */
export type EntityId = string;

/** Opaque commitment identifier. Canonical branded type: simulation/ (F27). */
export type CommitmentId = string;

/** Current phase of the game state machine. Canonical: simulation/ (F03). */
export type GamePhase = string;

// ─── Simulation domain stubs ──────────────────────────────────────────────────
// All superseded by simulation/snapshot.ts (F03).

/** Observed (potentially masked) state of a player in a projected snapshot. */
export interface ObservedPlayerState {
    readonly id: PlayerId;
}

/** Observed (potentially fog-filtered) state of an entity in a projected snapshot. */
export interface ObservedEntityState {
    readonly id: EntityId;
}

/** A game event visible to a specific viewer. */
export interface GameEvent {
    readonly type: string;
}

/** Cryptographic commitment envelope for a concealed value. */
export interface CommitmentEnvelope {
    readonly hash: string;
}

/**
 * Projected game state for the active viewer.
 * Canonical: simulation/snapshot.ts (F03).
 *
 * Invariant #1: GameSnapshot never crosses any IPC boundary. Only PlayerSnapshot does.
 */
export interface PlayerSnapshot {
    readonly tick: number;
    readonly viewerId: PlayerId;
    readonly players: Readonly<Record<PlayerId, ObservedPlayerState>>;
    readonly entities: Readonly<Record<EntityId, ObservedEntityState>>;
    readonly phase: GamePhase;
    readonly events: readonly GameEvent[];
    readonly commitments: Readonly<Record<CommitmentId, CommitmentEnvelope>>;
    readonly undoMeta: { readonly canUndo: boolean; readonly canRedo: boolean };
}

/**
 * Generic IPC action envelope dispatched through GameAPI.sendAction().
 * Canonical: simulation/ (F03).
 */
export interface EngineAction<
    TType extends string = string,
    TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
    readonly type: TType;
    readonly playerId: PlayerId;
    readonly tick: number;
    readonly payload: Readonly<TPayload>;
}

// ─── Lobby domain stubs ───────────────────────────────────────────────────────
// Superseded by networking/ (F09–F11).

/** Parameters for hosting a new lobby session. */
export interface HostLobbyParams {
    readonly gameId: string;
    readonly maxPlayers: number;
}

/** Parameters for joining an existing lobby session. */
export interface JoinLobbyParams {
    readonly address: string;
}

/** Metadata returned when a lobby is successfully hosted or joined. */
export interface LobbyInfo {
    readonly sessionId: string;
    readonly hostId: PlayerId;
    readonly gameId: string;
}

/** One player's entry in the live lobby roster. */
export interface LobbyPlayerEntry {
    readonly playerId: PlayerId;
    readonly displayName: string;
    readonly ready: boolean;
}

/** Full lobby state pushed to all clients via onUpdate(). */
export interface LobbyState {
    readonly info: LobbyInfo;
    readonly players: readonly LobbyPlayerEntry[];
}

/** A browsable lobby entry returned by LobbyDiscoveryAPI.list(). */
export interface LobbyListEntry {
    readonly address: string;
    readonly gameId: string;
    readonly playerCount: number;
    readonly maxPlayers: number;
}

// ─── Save domain stubs ────────────────────────────────────────────────────────
// Superseded by simulation/ saves module (F06).

/** Metadata for a single save slot. */
export interface SaveSlotMeta {
    readonly slotId: string;
    readonly gameId: string;
    readonly tick: number;
    readonly savedAt: number;
    readonly label?: string;
}

/** Parameters for writing a save slot. */
export interface SaveRequest {
    readonly gameId: string;
    readonly slotId?: string;
    readonly label?: string;
}

// ─── Settings domain stubs ────────────────────────────────────────────────────
// Superseded by simulation/ settings module (F07).

/** Fully merged settings tree (engine defaults + game defaults + user overrides). */
export type ResolvedSettings = Record<string, unknown>;

/** User-supplied settings overrides; a partial patch applied on top of defaults. */
export type UserSettings = Record<string, unknown>;

// ─── System domain types ──────────────────────────────────────────────────────

/** Current IPC / WebSocket connection health status as seen by the renderer. */
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

/** Returned by every subscription method; call to remove the listener. */
export type Unsubscribe = () => void;

// ─── Deferred namespace stubs ─────────────────────────────────────────────────
// Empty interfaces exist so that ChimeraAPI declares the full §4.1 shape.
// Each will be replaced with a concrete interface in the milestone listed.

/** Stub. Expanded in F14 — Player Profiles and Directory (§4.24). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProfileAPI {}

/** Stub. Expanded in F44 — Replay System (§4.28). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ReplayAPI {}

/** Stub. Expanded in F45 — Chat System (§4.29). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChatAPI {}

/** Stub. Expanded in F43 — Crash Reporter / Logging (§4.27). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LogsAPI {}

// ─── ChimeraAPI — root surface ────────────────────────────────────────────────

/**
 * The ONLY surface the renderer touches. Exposed at `window.__chimera` via
 * `contextBridge.exposeInMainWorld` in `electron/preload/api.ts`.
 *
 * Matches §4.1 exactly.
 *
 * - Invariant #4: The renderer reads state; it never writes state directly.
 *                 All writes go through `sendAction`.
 * - Invariant #5: All IPC methods are declared in `ipc-handlers.ts` and
 *                 exposed only through this file.
 */
export interface ChimeraAPI {
    game: GameAPI;
    lobby: LobbyAPI;
    saves: SavesAPI;
    settings: SettingsAPI;
    profile: ProfileAPI;
    replay: ReplayAPI;
    chat: ChatAPI;
    logs: LogsAPI;
    system: SystemAPI;
    /** Present only when the active MultiplayerProvider supports discovery. */
    lobbyDiscovery?: LobbyDiscoveryAPI;
}

// ─── game namespace ───────────────────────────────────────────────────────────

/** Action dispatch + snapshot stream (§4.1). */
export interface GameAPI {
    /** Dispatch a validated EngineAction built via ActionRegistry.build(). */
    sendAction(action: EngineAction): void;
    /** Stream of projected PlayerSnapshot for the active viewer. */
    onSnapshot(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe;
    /** Local multi-seat (pass-and-play): switch the active viewer for the current renderer. */
    switchActiveSeat(playerId: PlayerId): Promise<void>;
}

// ─── lobby namespace ──────────────────────────────────────────────────────────

/** Host, join, leave, discover (§4.1). */
export interface LobbyAPI {
    host(params: HostLobbyParams): Promise<LobbyInfo>;
    join(params: JoinLobbyParams): Promise<LobbyInfo>;
    leave(): void;
    onUpdate(cb: (lobby: LobbyState) => void): Unsubscribe;
}

// ─── lobbyDiscovery namespace ─────────────────────────────────────────────────

/**
 * Present on `window.__chimera.lobbyDiscovery` only when the active
 * MultiplayerProvider satisfies `BrowsableProvider` (§4.14, §4.1).
 */
export interface LobbyDiscoveryAPI {
    list(): Promise<LobbyListEntry[]>;
}

// ─── saves namespace (host only) ─────────────────────────────────────────────

/** List, save, load, delete save slots — host only (§4.1). */
export interface SavesAPI {
    list(gameId: string): Promise<SaveSlotMeta[]>;
    save(request: SaveRequest): Promise<SaveSlotMeta>;
    load(slotId: string): Promise<void>;
    delete(slotId: string): Promise<void>;
    /** Fires after save / delete / autosave. */
    onSlotUpdate(cb: (slots: SaveSlotMeta[]) => void): Unsubscribe;
}

// ─── settings namespace ───────────────────────────────────────────────────────

/** Per-game and engine-wide settings (§4.1). */
export interface SettingsAPI {
    /** Fully merged ResolvedSettings (engine defaults + game defaults + user overrides). */
    get(gameId: string): Promise<ResolvedSettings>;
    update(gameId: string, patch: Partial<UserSettings>): Promise<ResolvedSettings>;
    reset(gameId: string): Promise<ResolvedSettings>;
    onChange(cb: (gameId: string, settings: ResolvedSettings) => void): Unsubscribe;
}

// ─── system namespace ─────────────────────────────────────────────────────────

/** Connection status, platform info, quit (§4.1). */
export interface SystemAPI {
    onConnectionStatus(cb: (status: ConnectionStatus) => void): Unsubscribe;
    platform(): Promise<{ os: 'macos' | 'windows' | 'linux'; version: string }>;
    quit(): void;
}

// ─── Preload runtime entry point ──────────────────────────────────────────────
//
// Electron loads this file (after compilation to `electron/preload/api.js`)
// as the `BrowserWindow` preload script. The side effect below is the one
// and only call to `contextBridge.exposeInMainWorld` for the game renderer.
// Invariant 28: no `__chimeraDebug` key is exposed here.
//
// Every namespace factory accepts a narrow port interface so they remain
// unit-testable without a real Electron module. Electron's real
// `ipcRenderer` has a wider, historically-typed signature (event arg,
// `any[]` rest) than our ports declare. We adapt it once, here, via a
// small universal `IpcRendererPort` shape that is structurally assignable
// to each namespace's port type.

import { contextBridge, ipcRenderer } from 'electron';
import { createGameApi } from './game-api.js';
import { createLobbyApi } from './lobby-api.js';
import { createSavesApi } from './saves-api.js';
import { createSettingsApi } from './settings-api.js';
import { createSystemApi } from './system-api.js';

/**
 * Shape of an `ipcRenderer` listener as seen by our narrow port interfaces.
 * Electron's real listener signature uses `IpcRendererEvent` for the first
 * argument; `unknown` is broader, so a listener declared against this type
 * is safely callable with any event payload.
 */
type IpcRendererListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Universal renderer-side IPC port. Structurally assignable to every
 * `*ApiIpcPort` in the namespace modules — each of them asks for a subset
 * of these four methods. Declared locally so the adapter is the only place
 * the real `ipcRenderer` leaks into the namespace composition.
 */
interface IpcRendererPort {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    send(channel: string, ...args: unknown[]): void;
    on(channel: string, listener: IpcRendererListener): void;
    removeListener(channel: string, listener: IpcRendererListener): void;
}

const port: IpcRendererPort = {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => {
        ipcRenderer.send(channel, ...args);
    },
    on: (channel, listener) => {
        ipcRenderer.on(channel, listener);
    },
    removeListener: (channel, listener) => {
        ipcRenderer.removeListener(channel, listener);
    },
};

/**
 * Compose the full {@link ChimeraAPI} from the five namespace factories. Each
 * factory owns its own channel constants (invariant 5); this file's only job
 * is to wire them onto the single shared port and hand the result to
 * `contextBridge`.
 */
const api: ChimeraAPI = {
    game: createGameApi(port),
    lobby: createLobbyApi(port),
    saves: createSavesApi(port),
    settings: createSettingsApi(port),
    system: createSystemApi(port),
    // Deferred namespaces — the interfaces are empty stubs today (see the
    // `*API` declarations above) and will gain concrete methods in their
    // respective milestones (F14, F44, F45, F43). Exposing empty objects now
    // keeps `window.__chimera` shape-stable for the renderer.
    profile: {},
    replay: {},
    chat: {},
    logs: {},
};

contextBridge.exposeInMainWorld('__chimera', api);
