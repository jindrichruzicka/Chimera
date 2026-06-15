// electron/main/game/mainGameRegistry.test.ts
//
// The main-side game composition root. These tests pin the generic contract the
// host bootstrap consumes (index.ts) so a regression that drops a contribution
// or mis-derives a lookup map is caught here rather than at host startup.

import { describe, expect, it } from 'vitest';

import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import type { EngineSettings, GameSettingsSchema } from '@chimera/simulation/settings/index.js';
import { tacticsVisibilityRules } from '@chimera/games/tactics/visibility-rules.js';
import { TACTICS_GAME_ID, TACTICS_MOVE_UNIT_ACTION } from '@chimera/shared/tactics.js';

import type { SettingsManager } from '../settings/SettingsManager.js';
import {
    gameVersions,
    hostedGame,
    knownGameIds,
    mainGameRegistry,
    visibilityRulesByGameId,
} from './mainGameRegistry.js';

describe('mainGameRegistry', () => {
    it('registers the tactics reference game with its id and version', () => {
        const tactics = mainGameRegistry[TACTICS_GAME_ID];
        expect(tactics).toBeDefined();
        expect(tactics?.gameId).toBe(TACTICS_GAME_ID);
        expect(tactics?.gameVersion).toBe('0.1.0');
    });

    it('exposes the single hosted game as the tactics entry (M1 single-game lifecycle)', () => {
        expect(hostedGame.gameId).toBe(TACTICS_GAME_ID);
        expect(hostedGame.gameVersion).toBe('0.1.0');
        expect(hostedGame).toBe(mainGameRegistry[TACTICS_GAME_ID]);
    });

    it('derives knownGameIds from the registry keys', () => {
        expect(knownGameIds).toEqual(Object.keys(mainGameRegistry));
        expect(knownGameIds).toContain(TACTICS_GAME_ID);
    });

    it('derives the gameId → version map', () => {
        expect(gameVersions.get(TACTICS_GAME_ID)).toBe('0.1.0');
        expect(gameVersions.size).toBe(knownGameIds.length);
    });

    it('derives the gameId → visibility rules map for the projection resolver', () => {
        expect(visibilityRulesByGameId[TACTICS_GAME_ID]).toBe(tacticsVisibilityRules);
    });

    it('registerActions wires the game reducers into a shared ActionRegistry', () => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        hostedGame.registerActions(registry);

        expect(registry.has(TACTICS_MOVE_UNIT_ACTION)).toBe(true);
        expect(registry.resolveGame(TACTICS_GAME_ID)).toBeDefined();
    });

    it('registerSettings registers the game settings schema with the SettingsManager', () => {
        const registered: GameSettingsSchema<EngineSettings>[] = [];
        const fakeManager = {
            registerSchema: (schema: GameSettingsSchema<EngineSettings>) => {
                registered.push(schema);
            },
        } as unknown as SettingsManager;

        hostedGame.registerSettings(fakeManager);

        expect(registered).toHaveLength(1);
        expect(registered[0]?.gameId).toBe(TACTICS_GAME_ID);
    });

    it('resolveFirstPlayer returns the chosen first player, defaulting to the host', () => {
        const host = toPlayerId('p1');
        const chosen = toPlayerId('p2');
        expect(hostedGame.resolveFirstPlayer({ hostPlayerId: host })).toBe(host);
        expect(hostedGame.resolveFirstPlayer({ hostPlayerId: host, firstPlayer: chosen })).toBe(
            chosen,
        );
    });
});
