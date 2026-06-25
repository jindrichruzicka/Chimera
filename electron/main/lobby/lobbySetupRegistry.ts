/**
 * electron/main/lobby/lobbySetupRegistry.ts
 *
 * Game-agnostic main-side glue for customizable lobbies: it turns a `gameId →
 * lobby-setup builder` map (injected at bootstrap) plus the host's content
 * accessor into the plain `(gameId) => GameLobbySetup | undefined` resolver
 * `LobbyManager` consumes, and turns a live `LobbyState` into the
 * `GameSetupConfig` carried into the match at `engine:start_game`.
 *
 * This module names NO game. The per-game builders arrive by injection from the
 * consumer composition root via `MainGameContribution.lobbySetup` (#789),
 * derived by the host into `lobbySetupByGameId` — so `@chimera/electron` imports
 * no game lobby code (Invariant #2). `createResolveLobbySetup` closes each
 * builder over the game's loaded content; `LobbyManager` stays free of game and
 * content-loader imports.
 *
 * Architecture: §4.14 — LobbyManager; §4.4 — Lobby State Sync; §4.8 — Content Database
 * Task: #706 (part of #702 — Customizable Lobby); #789 (game-injection seam)
 */

import type { LobbyState } from '@chimera/networking';
import type { GameContent } from '@chimera/simulation/foundation/game-content-contract.js';
import type {
    GameLobbySetup,
    GameSetupConfig,
} from '@chimera/simulation/foundation/game-lobby-contract.js';

/**
 * Build the `resolveLobbySetup` resolver injected into `LobbyManager`, closing
 * each game's injected builder over its loaded content. `getContent` returns the
 * game's plain `GameContent` (or `undefined` when the game declares none);
 * `lobbySetupByGameId` is the host-derived `gameId → builder` map (from each
 * game's `MainGameContribution.lobbySetup`). The resolver returns `undefined`
 * for any game without both a builder and content.
 */
export function createResolveLobbySetup(
    getContent: (gameId: string) => GameContent | undefined,
    lobbySetupByGameId: Readonly<Record<string, (content: GameContent) => GameLobbySetup>>,
): (gameId: string) => GameLobbySetup | undefined {
    return (gameId: string): GameLobbySetup | undefined => {
        const builder = lobbySetupByGameId[gameId];
        if (builder === undefined) {
            return undefined;
        }
        const content = getContent(gameId);
        if (content === undefined) {
            return undefined;
        }
        return builder(content);
    };
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
