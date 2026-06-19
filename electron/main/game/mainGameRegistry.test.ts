// electron/main/game/mainGameRegistry.test.ts
//
// The main-side game composition root. These tests pin the generic contract the
// host bootstrap consumes (index.ts) so a regression that drops a contribution
// or mis-derives a lookup map is caught here rather than at host startup.

import { describe, expect, it } from 'vitest';

import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import { entityId, playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import type { EngineSettings, GameSettingsSchema } from '@chimera/simulation/settings/index.js';
import { makeStubPlayerSnapshot } from '@chimera/simulation/engine/__test-support__/stubs.js';
import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';
import type { CommandContext } from '@chimera/ai/engine/CommandContext.js';
import type { CommandScheduler } from '@chimera/ai/engine/CommandScheduler.js';
import type { EngineAction } from '@chimera/simulation/engine/types.js';
import { tacticsVisibilityRules } from '@chimera/games/tactics/visibility-rules.js';
import { tacticsManifest } from '@chimera/games/tactics/manifest.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_GAME_ID,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera/games/tactics/constants.js';

import type { SettingsManager } from '../settings/SettingsManager.js';
import {
    gameVersions,
    hostedGame,
    knownGameIds,
    mainGameRegistry,
    manifestsByGameId,
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

    it('contributes the tactics game manifest (display name, turn-based loop)', () => {
        expect(mainGameRegistry[TACTICS_GAME_ID]?.manifest).toBe(tacticsManifest);
        expect(hostedGame.manifest.displayName).toBe('Tactics');
        expect(hostedGame.manifest.realtime).toBe(false);
    });

    it('derives the gameId → manifest map', () => {
        expect(manifestsByGameId[TACTICS_GAME_ID]).toBe(tacticsManifest);
        expect(Object.keys(manifestsByGameId)).toEqual(knownGameIds);
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

    it('contributes a tactics AI state that emits tactics actions (issue #725)', () => {
        const ai = toPlayerId('ai-x');
        const enemy = toPlayerId('enemy-x');
        const myUnit = entityId('u-ai');
        const enemyUnit = entityId('u-enemy');
        const snapshot = {
            ...makeStubPlayerSnapshot(1),
            viewerId: ai,
            isMyTurn: true,
            entities: {
                [myUnit]: { id: myUnit, kind: 'unit', ownerId: ai, x: 0, y: 0, hp: 1 },
                [enemyUnit]: { id: enemyUnit, kind: 'unit', ownerId: enemy, x: 1, y: 0, hp: 1 },
            },
            players: { [ai]: { id: ai }, [enemy]: { id: enemy } },
        } as unknown as PlayerSnapshot;

        const state = hostedGame.createAIState?.(ai);
        expect(state?.name).toBe('tactics:auto-play');

        const dispatched: EngineAction[] = [];
        const context: CommandContext = {
            dispatch: (action) => dispatched.push(action),
            transitionState: () => undefined,
        };
        state?.onIdle(snapshot, snapshot.tick, {}, {} as unknown as CommandScheduler, context);

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]?.type).toBe(TACTICS_ATTACK_ACTION);
    });
});
