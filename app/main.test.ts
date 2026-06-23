// app/main.test.ts
//
// The in-tree composition root (F62/T2 — relocates to apps/tactics in F63). This
// is the sole place that names a game AND drives the Electron bootstrap: it
// constructs the tactics `MainGameContribution` from `@chimera/tactics/*` and
// injects it into the game-agnostic host `main(contributions)`.
//
// These tests pin the tactics wiring that used to live in
// electron/main/game/mainGameRegistry.test.ts (before the host went game-agnostic):
// a regression that drops or mis-wires a contribution field is caught here rather
// than at host startup.

import { describe, expect, it } from 'vitest';

import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import { entityId, playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import type { EngineAction } from '@chimera/simulation/engine/types.js';
import type { EngineSettings, GameSettingsSchema } from '@chimera/simulation/settings/index.js';
import { makeStubPlayerSnapshot } from '@chimera/simulation/engine/__test-support__/stubs.js';
import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';
import type { CommandContext, CommandScheduler } from '@chimera/ai';
import type { MainGameContribution } from '@chimera/electron/main';
import { tacticsManifest } from '@chimera/tactics/manifest.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_GAME_ID,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera/tactics/constants.js';

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
