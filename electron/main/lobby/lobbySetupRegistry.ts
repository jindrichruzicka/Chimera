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
 * consumer composition root via `MainGameContribution.lobbySetup`,
 * derived by the host into `lobbySetupByGameId` — so `@chimera-engine/electron` imports
 * no game lobby code (Invariant #2). `createResolveLobbySetup` closes each
 * builder over the game's loaded content; `LobbyManager` stays free of game and
 * content-loader imports.
 *
 * Architecture: §4.14 — LobbyManager; §4.4 — Lobby State Sync; §4.8 — Content Database
 */

import type { LobbyState } from '@chimera-engine/networking';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';
import type {
    GameLobbySetup,
    GameSetupConfig,
} from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import { createSyntheticAIPlayerId } from '../runtime/syntheticAgentId.js';

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
 * values already present on `LobbyState`: the host-authored game params and
 * every seat's attributes.
 *
 * "Every seat" spans both rosters. A human seat — the host, a joined remote, or
 * a pass-and-play local seat — is a `players` entry and contributes its
 * owner-authored `attributes`. An AI seat is NOT a `players` entry: it lives in
 * `agentSlots` and is seated at match start under the synthetic
 * `ai-<slotIndex>` id (`collectGameStartAiPlayerSlots`), so its host-authored
 * attributes are keyed here by that same {@link createSyntheticAIPlayerId}
 * value — a reducer asks "what is seat N playing?" once, against one map,
 * whatever kind of seat N is. Only `kind: 'ai'` slots contribute: a human-kind
 * slot is a placeholder for a joining human whose own `players` entry carries
 * its attributes, and no `ai-<slotIndex>` seat is ever created for it. A
 * `players` entry WINS over an agent slot claiming the same id — a real seat's
 * owner-authored value is authoritative for its own id.
 *
 * Returns `undefined` when there is nothing to carry — no (non-empty) game
 * params and no seat with (non-empty) attributes — so the start payload omits
 * `setup`, which is what a game with no lobby setup sends. When defined, both
 * `GameSetupConfig` keys are always present (the shape is never partial);
 * `playerAttributes` includes only seats whose attributes are present and
 * non-empty.
 *
 * Every map in the returned config is a copy: the config is carried onto the
 * snapshot and projected, so it shares no object with the live lobby state.
 */
export function buildSetupFromLobbyState(state: LobbyState): GameSetupConfig | undefined {
    const gameParams = { ...state.gameParams };

    const playerAttributes: Record<string, Record<string, string>> = {};
    const carry = (seatId: string, attributes: Readonly<Record<string, string>> | undefined) => {
        if (attributes === undefined || Object.keys(attributes).length === 0) {
            return;
        }
        // `??=` keeps the FIRST writer — the `players` walk runs first, so a
        // real seat wins over an agent slot claiming the same id.
        playerAttributes[seatId] ??= { ...attributes };
    };

    for (const player of state.players) {
        carry(player.playerId, player.attributes);
    }
    for (const slot of state.agentSlots ?? []) {
        if (slot.kind === 'ai') {
            carry(createSyntheticAIPlayerId(slot.slotIndex), slot.attributes);
        }
    }

    if (Object.keys(gameParams).length === 0 && Object.keys(playerAttributes).length === 0) {
        return undefined;
    }

    return { gameParams, playerAttributes };
}
