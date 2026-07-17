// Composition root for the __Game Title__ Electron app — the SOLE module that
// names this game AND drives the Electron bootstrap. It builds the game's
// `MainGameContribution` from its own `@chimera-engine/__game_kebab__/*` modules and
// injects it into the game-agnostic host `main()` from `@chimera-engine/electron`. The
// host ships no game-specific code; the game enters only here, at runtime.
//
// The `@chimera-engine/__game_kebab__/*` self-imports resolve to this app's own source:
// the app-owned bundler (electron/build-main.ts) aliases `@chimera-engine/<game>` (read
// from package.json `name`) onto the app directory.

import { main, type MainGameContribution } from '@chimera-engine/electron/main';

import { register__GamePascal__Actions } from '@chimera-engine/__game_kebab__/simulation/actions.js';
import { resolve__GamePascal__FirstPlayer } from '@chimera-engine/__game_kebab__/simulation/init.js';
import { __gameCamel__Manifest } from '@chimera-engine/__game_kebab__/manifest.js';
import { __gameCamel__SettingsSchema } from '@chimera-engine/__game_kebab__/settings-schema.js';
import { __gameCamel__VisibilityRules } from '@chimera-engine/__game_kebab__/simulation/visibility-rules.js';
import { __GAME_CONSTANT___GAME_ID } from '@chimera-engine/__game_kebab__/simulation/constants.js';

/**
 * __Game Title__'s main-side contribution. Exported for the composition-root
 * test; injected into the host below. Only the required fields are set. Add
 * optional capabilities as your game grows:
 *
 *   - `contentSchemas` — per-collection Zod schemas (validates `data/<collection>`
 *     at startup). Import `__GAME_CONSTANT___CONTENT_SCHEMAS` from
 *     `@chimera-engine/__game_kebab__/content/__gameCamel__Content.js` and set it here
 *     once you add a content collection + its `data/` directory.
 *   - `lobbySetup` — a customizable-lobby descriptor.
 *   - `createAIState` — an AI policy for hosted AI seats.
 *   - `commitment` / `resolveIsMyTurn` — simultaneous (commit-then-sync) turns.
 */
export const __gameCamel__Contribution: MainGameContribution = {
    gameId: __GAME_CONSTANT___GAME_ID,
    gameVersion: '0.1.0',
    manifest: __gameCamel__Manifest,
    registerActions: register__GamePascal__Actions,
    registerSettings: (manager) => manager.registerSchema(__gameCamel__SettingsSchema),
    visibilityRules: __gameCamel__VisibilityRules,
    resolveFirstPlayer: resolve__GamePascal__FirstPlayer,
};

// Auto-bootstrap only when executed by Electron, not when imported by Vitest.
if (process.env['VITEST'] === undefined) {
    void main([__gameCamel__Contribution]);
}
