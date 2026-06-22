/**
 * electron/main/lobby/lobbySetupRegistry.ts
 *
 * Main-side registry mapping `gameId → lobby-setup builder`, plus the pure glue
 * that turns a live `LobbyState` into the `GameSetupConfig` carried into the
 * match at `engine:start_game`.
 *
 * This module is a designated *composition point* for game lobby descriptors: it
 * is one of the few places permitted to import `games/*` lobby code. Because a
 * game's selectable options now come from the content database, the registry
 * holds a BUILDER per game `(content) => GameLobbySetup` rather than a static
 * descriptor. `createResolveLobbySetup` closes a builder over the game's loaded
 * content so `LobbyManager` keeps receiving a plain
 * `(gameId) => GameLobbySetup | undefined` resolver and stays free of game and
 * content-loader imports (Invariant #2).
 *
 * Architecture: §4.14 — LobbyManager; §4.4 — Lobby State Sync; §4.8 — Content Database
 * Task: #706 (part of #702 — Customizable Lobby)
 */

import { buildTacticsLobbySetup } from '@chimera/tactics/lobby/lobby-setup.js';
import { paletteFromCollections } from '@chimera/tactics/content/tacticsContent.js';
import type { LobbyState } from '@chimera/networking';
import type { GameContent } from '@chimera/simulation/foundation/game-content-contract.js';
import type {
    GameLobbySetup,
    GameSetupConfig,
} from '@chimera/simulation/foundation/game-lobby-contract.js';

/**
 * `gameId → lobby-setup builder`. Each builder turns the game's transmitted
 * content into its full `GameLobbySetup`. Concrete games register here by
 * importing their `games/*` lobby + content modules (the sole place allowed).
 */
export const lobbySetupBuilders: Readonly<
    Record<string, (content: GameContent) => GameLobbySetup>
> = {
    tactics: (content) => buildTacticsLobbySetup(paletteFromCollections(content)),
};

/**
 * Build the `resolveLobbySetup` resolver injected into `LobbyManager`, closing
 * each game's builder over its loaded content. `getContent` returns the game's
 * plain `GameContent` (or `undefined` when the game declares none); the resolver
 * returns `undefined` for any game without both a builder and content.
 */
export function createResolveLobbySetup(
    getContent: (gameId: string) => GameContent | undefined,
): (gameId: string) => GameLobbySetup | undefined {
    return (gameId: string): GameLobbySetup | undefined => {
        const builder = lobbySetupBuilders[gameId];
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
