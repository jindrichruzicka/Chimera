// apps/action/electron/main.test.ts
//
// The action composition root. This is the sole place that names this game AND
// drives the Electron bootstrap: it constructs the action `MainGameContribution`
// from `@chimera-engine/action/*` and injects it into the game-agnostic host
// `main(contributions)`.
//
// A regression that drops or mis-wires a contribution field is caught here
// rather than at host startup — which for the realtime flag would mean a match
// that renders and never ticks.

import { describe, expect, it, vi } from 'vitest';

import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { playerId } from '@chimera-engine/simulation/engine/types.js';
import type { MainGameContribution } from '@chimera-engine/electron/main';
import { actionManifest } from '@chimera-engine/action/manifest.js';
import { actionSettingsSchema } from '@chimera-engine/action/settings-schema.js';
import { actionVisibilityRules } from '@chimera-engine/action/simulation/visibility-rules.js';
import {
    ACTION_GAME_ID,
    ACTION_SELECT_PRIMITIVE_ACTION,
    ACTION_SET_VELOCITY_ACTION,
    ACTION_TICK_RATE_MS,
} from '@chimera-engine/action/simulation/constants.js';
import { buildInitialActionEntities } from '@chimera-engine/action/simulation/entities.js';

import { actionContribution } from './main.js';

/** The SettingsManager shape `registerSettings` is called with. */
type SettingsManagerArg = Parameters<MainGameContribution['registerSettings']>[0];

describe('action composition root', () => {
    it('contributes the action game with its id and version', () => {
        expect(actionContribution.gameId).toBe(ACTION_GAME_ID);
        expect(actionContribution.gameVersion).toBe('0.1.0');
    });

    it('contributes the manifest that makes this app REALTIME', () => {
        // The host reads `realtime` to decide whether to start a
        // `RealtimeTicker`. Wired wrong, the match renders and never ticks.
        expect(actionContribution.manifest).toBe(actionManifest);
        expect(actionContribution.manifest.displayName).toBe('Action');
        expect(actionContribution.manifest.realtime).toBe(true);
        expect(actionContribution.manifest.tickRateMs).toBe(ACTION_TICK_RATE_MS);
    });

    it('registers both game actions and the per-beat game definition', () => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);

        actionContribution.registerActions(registry);

        expect(registry.has(ACTION_SET_VELOCITY_ACTION)).toBe(true);
        expect(registry.has(ACTION_SELECT_PRIMITIVE_ACTION)).toBe(true);
        const game = registry.resolveGame(ACTION_GAME_ID);
        expect(game).toBeDefined();
        expect(game?.buildInitialEntities).toBe(buildInitialActionEntities);
        // The per-beat hook is what turns the host's heartbeat into movement;
        // without it `engine:tick` advances the tick and nothing else.
        expect(game?.onBeat).toBeDefined();
    });

    it('registers the settings schema through the manager it is handed', () => {
        const registerSchema = vi.fn();
        const manager = { registerSchema } as unknown as SettingsManagerArg;

        actionContribution.registerSettings(manager);

        expect(registerSchema).toHaveBeenCalledTimes(1);
        expect(registerSchema).toHaveBeenCalledWith(actionSettingsSchema);
    });

    it('contributes the omniscient visibility rules', () => {
        expect(actionContribution.visibilityRules).toBe(actionVisibilityRules);
    });

    it('contributes a first-player resolver that seats the host by default', () => {
        const host = playerId('host');

        expect(actionContribution.resolveFirstPlayer({ hostPlayerId: host })).toBe(host);
    });

    it('claims no capability it has not built', () => {
        // Each of these is a real engine feature the host branches on. An empty
        // object or a no-op function here would announce a lobby, an AI seat or
        // a commit-then-sync turn mode this app does not have.
        expect(actionContribution.contentSchemas).toBeUndefined();
        expect(actionContribution.lobbySetup).toBeUndefined();
        expect(actionContribution.createAIState).toBeUndefined();
        expect(actionContribution.commitment).toBeUndefined();
        expect(actionContribution.resolveIsMyTurn).toBeUndefined();
        expect(actionContribution.registerScenes).toBeUndefined();
    });
});
