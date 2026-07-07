// apps/tactics/electron/main.test.ts
//
// The tactics composition root (F62/T2; relocated here from `app/` in F63/#783).
// This is the sole place that names a game AND drives the Electron bootstrap: it
// constructs the tactics `MainGameContribution` from `@chimera-engine/tactics/*` and
// injects it into the game-agnostic host `main(contributions)`.
//
// These tests pin the tactics wiring that used to live in
// electron/main/game/mainGameRegistry.test.ts (before the host went game-agnostic):
// a regression that drops or mis-wires a contribution field is caught here rather
// than at host startup.

import { describe, expect, it } from 'vitest';

import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { entityId, playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { EngineAction } from '@chimera-engine/simulation/engine/types.js';
import type {
    EngineSettings,
    GameSettingsSchema,
} from '@chimera-engine/simulation/settings/index.js';
import { makeStubPlayerSnapshot } from '@chimera-engine/simulation/engine/__test-support__/stubs.js';
import type { PlayerSnapshot } from '@chimera-engine/simulation/projection/StateProjector.js';
import type { CommandContext, CommandScheduler } from '@chimera-engine/ai';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';
import type { MainGameContribution } from '@chimera-engine/electron/main';
import { tacticsManifest } from '@chimera-engine/tactics/manifest.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_GAME_ID,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera-engine/tactics/simulation/constants.js';

import { tacticsContribution } from './main.js';

/** The SettingsManager shape `registerSettings` is called with — derived from
 *  the contract so the test need not reach into the electron package internals. */
type SettingsManagerArg = Parameters<MainGameContribution['registerSettings']>[0];

describe('tactics composition root', () => {
    it('contributes the tactics game with its id and version', () => {
        expect(tacticsContribution.gameId).toBe(TACTICS_GAME_ID);
        expect(tacticsContribution.gameVersion).toBe('0.1.0');
    });

    it('contributes the tactics manifest (display name, turn-based loop)', () => {
        expect(tacticsContribution.manifest).toBe(tacticsManifest);
        expect(tacticsContribution.manifest.displayName).toBe('Tactics');
        expect(tacticsContribution.manifest.realtime).toBe(false);
    });

    it('contributes the tactics content schemas for the host content loader (#788)', () => {
        expect(tacticsContribution.contentSchemas).toBeDefined();
        expect(Object.keys(tacticsContribution.contentSchemas ?? {})).toEqual(
            expect.arrayContaining(['player-colors', 'board-colors']),
        );
    });

    it('contributes a lobby-setup builder that builds the tactics GameLobbySetup (#789)', () => {
        const content: GameContent = {
            'player-colors': [
                { id: 'blue', name: 'Blue', hex: '#2563eb', order: 0 },
                { id: 'red', name: 'Red', hex: '#dc2626', order: 1 },
            ],
            'board-colors': [{ id: 'slate', name: 'Slate', hex: '#3f3f46', order: 0 }],
        };
        const setup = tacticsContribution.lobbySetup?.(content);
        expect(setup?.maxPlayers).toBe(4);
        expect(setup?.playerAttributeOptions['color']).toEqual([
            { value: 'blue', label: 'Blue' },
            { value: 'red', label: 'Red' },
        ]);
    });

    it('registerActions wires the game reducers into a shared ActionRegistry', () => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);

        tacticsContribution.registerActions(registry);

        expect(registry.has(TACTICS_MOVE_UNIT_ACTION)).toBe(true);
        expect(registry.resolveGame(TACTICS_GAME_ID)).toBeDefined();
    });

    it('registerSettings registers the game settings schema with the SettingsManager', () => {
        const registered: GameSettingsSchema<EngineSettings>[] = [];
        const fakeManager = {
            registerSchema: (schema: GameSettingsSchema<EngineSettings>) => {
                registered.push(schema);
            },
        } as unknown as SettingsManagerArg;

        tacticsContribution.registerSettings(fakeManager);

        expect(registered).toHaveLength(1);
        expect(registered[0]?.gameId).toBe(TACTICS_GAME_ID);
    });

    it('resolveFirstPlayer returns the chosen first player, defaulting to the host', () => {
        const host = toPlayerId('p1');
        const chosen = toPlayerId('p2');
        expect(tacticsContribution.resolveFirstPlayer({ hostPlayerId: host })).toBe(host);
        expect(
            tacticsContribution.resolveFirstPlayer({ hostPlayerId: host, firstPlayer: chosen }),
        ).toBe(chosen);
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

        const state = tacticsContribution.createAIState?.(ai);
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
