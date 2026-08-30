/**
 * apps/action/settings-schema.ts
 *
 * The action app's settings schema — the engine defaults plus the movement
 * bindings, and nothing else. The host registers it with
 * `SettingsManager` at startup so the settings page and persistence work.
 *
 * There is no game-specific FIELD here on purpose: the app is a movement
 * sandbox, so an `arenaGridVisible`-style toggle would be a settings row
 * nothing reads. What it does own is `controls.bindings` — every movement
 * action has to arrive with a default key or the rebind UI lists it unbound and
 * nothing moves on a fresh install.
 *
 * Architecture reference: §4.13
 *
 * Module boundary: workspace imports are `@chimera-engine/simulation` and own
 * files only. Lint enforces the renderer half
 * (`chimera/no-game-renderer-internals`) and the electron/networking half (the
 * `no-restricted-imports` zone this path shares with a game's gameplay tree) —
 * which is why the movement ids come from the import-free
 * `./input-action-ids.js` rather than from `renderer/input-actions.ts`.
 */

import { z } from 'zod';
import {
    ENGINE_DEFAULTS,
    engineSettingsZodShape,
} from '@chimera-engine/simulation/settings/index.js';
import type {
    EngineSettings,
    GameSettingsSchema,
} from '@chimera-engine/simulation/settings/index.js';

import { ACTION_GAME_ID } from './simulation/constants.js';
import { ACTION_DEFAULT_MOVE_BINDINGS } from './input-action-ids.js';

/** The action app adds no field of its own — see the header. */
export type ActionSettings = EngineSettings;

export const ACTION_DEFAULTS: ActionSettings = {
    ...ENGINE_DEFAULTS,
    controls: {
        ...ENGINE_DEFAULTS.controls,
        bindings: {
            // Spread OVER the engine's bindings, never instead of them: a fresh
            // object here would drop Escape, undo/redo and the perf-HUD toggle.
            ...ENGINE_DEFAULTS.controls.bindings,
            ...ACTION_DEFAULT_MOVE_BINDINGS,
        },
    },
};

const actionZodSchema = z.object({
    ...engineSettingsZodShape,
});

export const actionSettingsSchema: GameSettingsSchema<ActionSettings> = {
    gameId: ACTION_GAME_ID,
    defaults: ACTION_DEFAULTS,
    schema: actionZodSchema,
};
