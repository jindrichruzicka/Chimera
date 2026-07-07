// __Game Title__'s settings schema — the engine defaults with no game-specific
// fields yet. The host registers it with the SettingsManager at startup so the
// settings page and persistence work out of the box. To add a game setting,
// extend all three: the interface, the defaults, and the Zod shape.

import { z } from 'zod';
import {
    ENGINE_DEFAULTS,
    engineSettingsZodShape,
} from '@chimera-engine/simulation/settings/index.js';
import type {
    EngineSettings,
    GameSettingsSchema,
} from '@chimera-engine/simulation/settings/index.js';

import { __GAME_CONSTANT___GAME_ID } from './simulation/constants.js';

export type __GamePascal__Settings = EngineSettings;

export const __GAME_CONSTANT___DEFAULTS: __GamePascal__Settings = {
    ...ENGINE_DEFAULTS,
};

const __gameCamel__ZodSchema = z.object({
    ...engineSettingsZodShape,
});

export const __gameCamel__SettingsSchema: GameSettingsSchema<__GamePascal__Settings> = {
    gameId: __GAME_CONSTANT___GAME_ID,
    defaults: __GAME_CONSTANT___DEFAULTS,
    schema: __gameCamel__ZodSchema,
};
