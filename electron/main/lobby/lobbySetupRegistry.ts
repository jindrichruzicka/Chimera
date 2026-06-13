/**
 * electron/main/lobby/lobbySetupRegistry.ts
 *
 * Main-side registry mapping `gameId → GameLobbySetup`, plus the pure glue that
 * turns a live `LobbyState` into the `GameSetupConfig` carried into the match at
 * `engine:start_game`.
 *
 * This module is the designated *composition point* for game lobby descriptors:
 * it is the only place permitted to import `games/*` lobby-setup descriptors and
 * register them here (so `LobbyManager` stays free of game imports — Invariant
 * #2; it receives the resolver injected). Tactics is the first adopter (#708,
 * T6); further games register their descriptors here the same way.
 *
 * Architecture: §4.14 — LobbyManager; §4.4 — Lobby State Sync
 * Task: #706 (part of #702 — Customizable Lobby)
 */

import { tacticsLobbySetup } from '@chimera/games/tactics/lobby/lobby-setup.js';
import type { LobbyState } from '@chimera/networking/provider/MultiplayerProvider.js';
import type { GameLobbySetup, GameSetupConfig } from '@chimera/shared/game-lobby-contract.js';

/**
 * `gameId → GameLobbySetup`. Concrete game descriptors are registered here by
 * importing them from `games/*` (the sole module allowed to do so).
 */
export const lobbySetupRegistry: Readonly<Record<string, GameLobbySetup>> = {
    tactics: tacticsLobbySetup,
};

/**
 * Resolve the lobby-setup descriptor for `gameId`, or `undefined` when the game
 * declares none. Injected into `LobbyManager` so it can seed defaults without
 * importing `games/*` directly.
 */
export function resolveLobbySetup(gameId: string): GameLobbySetup | undefined {
    return lobbySetupRegistry[gameId];
}

/**
 * Build the synced `GameSetupConfig` carried into `engine:start_game` from the
 * host-authored values already present on `LobbyState`: the chosen match
 * settings and each player's host-assigned attributes.
 *
 * Returns `undefined` when there is nothing to carry — no (non-empty) match
 * settings and no player with (non-empty) attributes — so the start payload
 * omits `setup` and stays backward-compatible with games that have no lobby
 * setup. When defined, both `GameSetupConfig` keys are always present (the
 * shape is never partial); `playerAttributes` is keyed by real `playerId` and
 * includes only players whose attributes are present and non-empty.
 */
export function buildSetupFromLobbyState(state: LobbyState): GameSetupConfig | undefined {
    const matchSettings = state.matchSettings ?? {};

    const playerAttributes: Record<string, Record<string, string>> = {};
    for (const player of state.players) {
        if (player.attributes !== undefined && Object.keys(player.attributes).length > 0) {
            playerAttributes[player.playerId] = player.attributes;
        }
    }

    if (Object.keys(matchSettings).length === 0 && Object.keys(playerAttributes).length === 0) {
        return undefined;
    }

    return { matchSettings, playerAttributes };
}
