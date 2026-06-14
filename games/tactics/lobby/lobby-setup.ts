/**
 * games/tactics/lobby/lobby-setup.ts
 *
 * Tactics' pure, declarative lobby-setup descriptor (§4.37). `main` reads it to
 * seed seat defaults and validate host/join requests (via the injected resolver
 * in `electron/main/lobby/lobbySetupRegistry.ts`); the renderer's
 * `TacticsLobbyScreen` reads it to build the lobby controls. Contains data and a
 * pure resolver only — no React, no IPC, no side effects.
 *
 * Tactics is the first adopter of the customizable lobby: the host picks a board
 * background colour and assigns each seat a unit colour (replacing the old
 * own/opponent fill binary). The `*_HEX` maps below back the lobby swatches today
 * and are the intended single source of truth for the in-match 3D renderer once
 * #710 adopts them — until then the in-match modules still carry their own copies.
 *
 * Module boundary (§3): a `games/*` descriptor may import only `shared/`. The
 * sole import is the type-only lobby contract, erased at build — this module
 * carries zero runtime imports and is safe to load in both `main` and renderer.
 *
 * Architecture: §4.37 — Renderer Shell Pages UI Contract; §4.4 — Lobby State Sync
 * Task: #708 (T6, part of #702 — Customizable Lobby)
 */

import type { GameLobbySetup, LobbyFieldOption } from '@chimera/shared/game-lobby-contract.js';

/**
 * The four selectable player (unit) colours, in seat-assignment order. Seat `n`
 * defaults to the colour at index `n` (see {@link tacticsLobbySetup}). Blue and
 * red preserve the historic own/opponent fills.
 */
export const TACTICS_PLAYER_COLORS: readonly LobbyFieldOption[] = [
    { value: 'blue', label: 'Blue' },
    { value: 'red', label: 'Red' },
    { value: 'green', label: 'Green' },
    { value: 'amber', label: 'Amber' },
];

/** The selectable board-background colours; `slate` matches the historic ground. */
export const TACTICS_BOARD_COLORS: readonly LobbyFieldOption[] = [
    { value: 'slate', label: 'Slate' },
    { value: 'stone', label: 'Stone' },
    { value: 'navy', label: 'Navy' },
];

/**
 * `playerColour → hex`. Backs the lobby swatches today; the intended source for
 * the per-player unit material colour once the in-match renderer adopts it (#710).
 * Keys mirror {@link TACTICS_PLAYER_COLORS} values.
 */
export const TACTICS_PLAYER_COLOR_HEX: Readonly<Record<string, string>> = {
    blue: '#2563eb',
    red: '#dc2626',
    green: '#16a34a',
    amber: '#f59e0b',
};

/**
 * `boardColour → hex`. To be reused by the in-match ground plane in #710. Keys
 * mirror {@link TACTICS_BOARD_COLORS} values; `slate` is the historic ground colour.
 */
export const TACTICS_BOARD_COLOR_HEX: Readonly<Record<string, string>> = {
    slate: '#3f3f46',
    stone: '#44403c',
    navy: '#1e293b',
};

/**
 * Default board colour seeded into a fresh lobby's match settings. Exported so
 * the lobby screen reuses the same fallback instead of re-hardcoding it.
 */
export const DEFAULT_BOARD_COLOR = 'slate';

/**
 * Seat-0 player colour; the strict-typing fallback in the seat resolver and the
 * lobby screen's render-time fallback for a seat with no assigned colour.
 */
export const DEFAULT_PLAYER_COLOR = 'blue';

/**
 * Hex for {@link DEFAULT_BOARD_COLOR} (`slate`). The guaranteed-string fallback the
 * in-match ground plane (#710) uses when `setup` is absent or the chosen board colour
 * is off-palette. Kept beside {@link TACTICS_BOARD_COLOR_HEX} so the two cannot drift.
 */
export const DEFAULT_BOARD_COLOR_HEX = '#3f3f46';

/**
 * Hex for {@link DEFAULT_PLAYER_COLOR} (`blue`). The guaranteed-string fallback for a
 * unit's colour (#710) when `setup` is absent, the owner has no colour, or it is
 * off-palette. Kept beside {@link TACTICS_PLAYER_COLOR_HEX} so the two cannot drift.
 */
export const DEFAULT_PLAYER_COLOR_HEX = '#2563eb';

/**
 * Tactics' lobby-setup descriptor: 4 seats, a host-chosen board colour, and a
 * per-seat unit colour. `resolveDefaultPlayerAttributes` assigns seat `n` the
 * palette colour at index `n`, wrapping via modulo so it stays total for any
 * index `main` might pass.
 */
export const tacticsLobbySetup: GameLobbySetup = {
    maxPlayers: 4,
    matchSettingsDefaults: { boardColor: DEFAULT_BOARD_COLOR },
    matchSettingsOptions: { boardColor: TACTICS_BOARD_COLORS },
    playerAttributeOptions: { color: TACTICS_PLAYER_COLORS },
    resolveDefaultPlayerAttributes(seatIndex: number): Record<string, string> {
        // Modulo keeps the index in-bounds for any seat count; the `?? slate`-style
        // fallback to the first palette value only satisfies strict index typing.
        const option = TACTICS_PLAYER_COLORS[seatIndex % TACTICS_PLAYER_COLORS.length];
        return { color: option?.value ?? DEFAULT_PLAYER_COLOR };
    },
};
