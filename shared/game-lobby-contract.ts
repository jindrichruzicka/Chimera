/**
 * shared/game-lobby-contract.ts
 *
 * Shared declarative contract for customizable game lobbies (§4.37).
 * This is the data contract every game's lobby builds on:
 *   - `GameLobbySetup`   — a pure setup descriptor `main` reads for defaults and
 *                          validation (max players, available match settings and
 *                          their options, player-attribute options, and
 *                          seat-based default-attribute resolution).
 *   - `GameSetupConfig`  — the synced match-setup shape (chosen match settings +
 *                          per-player attributes) carried alongside the snapshot.
 *   - `GameLobbyScreenProps` — props passed to a game's lobby-screen component.
 *
 * Consumed by both renderer/ (to render the lobby) and games/* (to declare it),
 * mirroring `shared/game-shell-contract.ts`.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 * Task: #703 (part of #702 — game lobby contract types)
 *
 * Module boundary (§3 Module Boundary Table): `shared/` must not import from
 * `renderer/`, `games/*`, `electron/`, or simulation runtime. The sole import
 * below is a *type-only* re-use of the canonical `LobbyState`/`PlayerId` from a
 * sibling `shared/` module; `import type` is erased at build, so the emitted
 * module carries zero runtime imports — the constraint stays structurally
 * enforced just as in `game-shell-contract.ts`.
 */

import type { LobbyState, PlayerId } from './messages-schemas.js';

// ─── Field options ──────────────────────────────────────────────────────────────

/**
 * A single selectable value for a match setting or player attribute: the stored
 * `value` paired with the human-readable `label` the lobby renders.
 */
export interface LobbyFieldOption {
    readonly value: string;
    readonly label: string;
}

// ─── Setup descriptor ─────────────────────────────────────────────────────────

/**
 * Pure, declarative description of a game's customizable lobby. `main` reads it
 * to seed defaults and validate host/join requests; the renderer reads it to
 * build the lobby controls. Contains data and a pure resolver only — no side
 * effects, no React, no IPC.
 */
export interface GameLobbySetup {
    /** Maximum number of seats this game's lobby admits. */
    readonly maxPlayers: number;

    /** Default value for each match setting, keyed by setting id. */
    readonly matchSettingsDefaults: Record<string, string>;

    /** Selectable options for each match setting, keyed by setting id. */
    readonly matchSettingsOptions: Record<string, readonly LobbyFieldOption[]>;

    /** Selectable options for each per-player attribute, keyed by attribute id. */
    readonly playerAttributeOptions: Record<string, readonly LobbyFieldOption[]>;

    /**
     * Pure resolver returning the default attributes for the seat at
     * `seatIndex` (e.g. alternating teams or starting factions). Must not
     * mutate external state.
     */
    resolveDefaultPlayerAttributes(seatIndex: number): Record<string, string>;
}

// ─── Synced setup config ──────────────────────────────────────────────────────

/**
 * The resolved, synced match-setup shape: the match settings chosen for the
 * session plus each player's chosen attributes, keyed by `PlayerId`. Carried
 * alongside the snapshot so every peer agrees on the agreed-upon configuration.
 */
export interface GameSetupConfig {
    readonly matchSettings: Record<string, string>;
    readonly playerAttributes: Record<PlayerId, Record<string, string>>;
}

// ─── Lobby screen props ───────────────────────────────────────────────────────

/**
 * In-flight lobby operation, or `null` when idle. Mirrors the renderer's
 * `renderer/app/lobby/lobbyTypes.ts` `PendingAction` so the renderer can later
 * collapse onto this canonical, shared definition.
 *
 * Note: `setPlayerAttribute` carries the target `playerId` so a host screen can
 * author *any* seat's attribute (e.g. per-player unit colour), matching the
 * host-authority IPC (`chimera:lobby:set-player-attribute`). Writes are
 * host-only — `main` rejects them from a joined session (#706).
 */
export type LobbyPendingAction =
    | 'hosting'
    | 'joining'
    | 'leaving'
    | 'starting'
    | 'updating-ready'
    | null;

/**
 * Props passed to a game's lobby-screen component. Reuses the shared
 * `LobbyState`/`PlayerId` types so the engine roster, ready state, and host
 * derivation stay in lock-step with the wire contract. Synchronous setters push
 * local edits; the `on*` lifecycle callbacks are async authoritative actions
 * routed through the engine's lobby API.
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

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns a defensive shallow copy of the setup's match-setting defaults, so
 * callers can seed editable lobby state without aliasing the immutable setup.
 */
export function resolveMatchSettingsDefaults(setup: GameLobbySetup): Record<string, string> {
    return { ...setup.matchSettingsDefaults };
}

/**
 * Resolves the default attributes for the seat at `seatIndex` by delegating to
 * the setup's pure resolver.
 */
export function resolvePlayerAttributeDefaults(
    setup: GameLobbySetup,
    seatIndex: number,
): Record<string, string> {
    return setup.resolveDefaultPlayerAttributes(seatIndex);
}

/**
 * Looks up the option matching `value` within `options`. Returns `undefined`
 * when no option matches — never throws.
 */
export function lookupFieldOption(
    options: readonly LobbyFieldOption[],
    value: string,
): LobbyFieldOption | undefined {
    return options.find((option) => option.value === value);
}

/**
 * Returns the label for `value` within `options`, falling back to the raw
 * `value` when no option matches (so the lobby can always render something).
 */
export function optionLabel(options: readonly LobbyFieldOption[], value: string): string {
    return lookupFieldOption(options, value)?.label ?? value;
}
