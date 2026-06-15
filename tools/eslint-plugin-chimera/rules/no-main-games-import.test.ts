/**
 * tools/eslint-plugin-chimera/rules/no-main-games-import.test.ts
 *
 * Unit tests for the `chimera/no-main-games-import` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * The host (electron/main) must stay agnostic of which games exist; only the
 * three composition registries may import `games/*`, and test files are exempt.
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-main-games-import.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('chimera/no-main-games-import', rule, {
    // ── Valid — rule must NOT fire ───────────────────────────────────────────
    valid: [
        // The composition registries are the sole coupling points (exempt).
        {
            filename: 'electron/main/game/mainGameRegistry.ts',
            code: `import { registerTacticsActions } from '@chimera/games/tactics/actions.js';`,
        },
        {
            filename: 'electron/main/content/gameContentRegistry.ts',
            code: `import { TACTICS_CONTENT_SCHEMAS } from '@chimera/games/tactics/content/tacticsContent.js';`,
        },
        {
            filename: 'electron/main/lobby/lobbySetupRegistry.ts',
            code: `import { buildTacticsLobbySetup } from '@chimera/games/tactics/lobby/lobby-setup.js';`,
        },
        // Test files import game modules as fixtures (exempt).
        {
            filename: 'electron/main/index.test.ts',
            code: `import { tacticsVisibilityRules } from '@chimera/games/tactics/visibility-rules.js';`,
        },
        {
            filename: 'electron/main/content/loadGameContent.test.ts',
            code: `import { paletteFromCollections } from '@chimera/games/tactics/content/tacticsContent.js';`,
        },
        // electron/main core importing non-games modules is fine.
        {
            filename: 'electron/main/index.ts',
            code: `import { hostedGame } from './game/mainGameRegistry.js';`,
        },
        {
            filename: 'electron/main/index.ts',
            code: `import { ActionPipeline } from '@chimera/simulation/engine/ActionPipeline.js';`,
        },
        // The rule only guards electron/main — other layers are out of scope here.
        {
            filename: 'renderer/game/rendererGameRegistry.ts',
            code: `import { TacticsGameScreenRegistry } from '@chimera/games/tactics/screens/index.js';`,
        },
        // Dynamic import of a non-games module is fine.
        {
            filename: 'electron/main/index.ts',
            code: `const m = import('./game/mainGameRegistry.js');`,
        },
        // Dynamic import of a games module IS allowed inside a composition registry.
        {
            filename: 'electron/main/game/mainGameRegistry.ts',
            code: `const m = import('@chimera/games/tactics/actions.js');`,
        },
        // A computed dynamic specifier cannot be resolved statically — not flagged.
        {
            filename: 'electron/main/index.ts',
            code: `const m = import(gamePath);`,
        },
        // Re-export with no source must not crash the source guard.
        {
            filename: 'electron/main/index.ts',
            code: `const x = 1; export { x };`,
        },
    ],

    // ── Invalid — rule must fire ─────────────────────────────────────────────
    invalid: [
        // Core bootstrap importing a game directly (the original violation).
        {
            filename: 'electron/main/index.ts',
            code: `import { registerTacticsActions } from '@chimera/games/tactics/actions.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // A non-registry main module importing a game.
        {
            filename: 'electron/main/renderer-url.ts',
            code: `import { TACTICS_GAME_ID } from '@chimera/games/tactics/index.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // Relative path navigating into games/.
        {
            filename: 'electron/main/runtime/SomeRuntime.ts',
            code: `import { x } from '../../games/tactics/entities.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // Bare specifier starting with games/.
        {
            filename: 'electron/main/runtime/SomeRuntime.ts',
            code: `import { x } from 'games/tactics/stamina.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // Dynamic import() of a games module in a non-allowlisted main file.
        {
            filename: 'electron/main/index.ts',
            code: `const m = import('@chimera/games/tactics/actions.js');`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // Re-export from a games module.
        {
            filename: 'electron/main/index.ts',
            code: `export { registerTacticsActions } from '@chimera/games/tactics/actions.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // Export-all from a games module.
        {
            filename: 'electron/main/index.ts',
            code: `export * from '@chimera/games/tactics/actions.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
    ],
});
