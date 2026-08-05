/**
 * electron/dev-tools/eslint/rules/no-main-games-import.test.ts
 *
 * Unit tests for the `chimera/no-main-games-import` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * The host (electron/main) must stay agnostic of which games exist: there are
 * NO in-package composition points — content schemas and
 * lobby setup arrive by runtime injection — so every non-test `electron/main`
 * module is guarded (the former gameContentRegistry.ts/lobbySetupRegistry.ts
 * exemptions are gone). Test files stay exempt (they import game fixtures). The
 * game wiring lives in the out-of-scope consumer app composition root
 * apps/tactics/electron/main.ts.
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
        // Test files import game modules as fixtures (exempt).
        {
            filename: 'electron/main/index.test.ts',
            code: `import { tacticsVisibilityRules } from '@chimera-engine/tactics/visibility-rules.js';`,
        },
        {
            filename: 'electron/main/content/loadGameContent.test.ts',
            code: `import { paletteFromCollections } from '@chimera-engine/tactics/content/tacticsContent.js';`,
        },
        // electron/main core importing non-games modules is fine.
        {
            filename: 'electron/main/index.ts',
            code: `import { createMainGameRegistry } from './game/mainGameRegistry.js';`,
        },
        {
            filename: 'electron/main/index.ts',
            code: `import { ActionPipeline } from '@chimera-engine/simulation/engine/ActionPipeline.js';`,
        },
        // Engine packages (the allowlist) share the @chimera-engine/* scope with games
        // but are always importable by main — detection is by package name, not
        // by a `/games/` path substring.
        {
            filename: 'electron/main/index.ts',
            code: `import { logger } from '@chimera-engine/simulation/foundation/logging.js';`,
        },
        {
            filename: 'electron/main/index.ts',
            code: `import { playerId } from '@chimera-engine/electron/preload/api-types.js';`,
        },
        {
            filename: 'electron/main/index.ts',
            code: `import { MultiplayerProvider } from '@chimera-engine/networking/provider/MultiplayerProvider.js';`,
        },
        {
            filename: 'electron/main/index.ts',
            code: `import { createScheduler } from '@chimera-engine/ai/engine/index.js';`,
        },
        // The rule only guards electron/main — other layers are out of scope here.
        {
            filename: 'renderer/game/rendererGameRegistry.ts',
            code: `import { TacticsGameScreenRegistry } from '@chimera-engine/tactics/screens/index.js';`,
        },
        // The consumer app composition root lives outside electron/main — a flat file under electron/, not
        // electron/main/ — so it may import a game to build the injected
        // MainGameContribution.
        {
            filename: 'apps/tactics/electron/main.ts',
            code: `import { registerTacticsActions } from '@chimera-engine/tactics/actions.js';`,
        },
        // Dynamic import of a non-games module is fine.
        {
            filename: 'electron/main/index.ts',
            code: `const m = import('./game/mainGameRegistry.js');`,
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
        // Detection is path-SEGMENT-anchored at BOTH ends. Leading anchor: the
        // letters mid-segment (`webapps/`) are not a game app. Trailing slash:
        // neither is a segment those letters merely START (`gamestate.js`,
        // `appsettings.ts`) — an anchor pinned at one end only leaves the other
        // free to be deleted.
        {
            filename: 'electron/main/index.ts',
            code: `import { x } from './runtime/webapps/registry.js';`,
        },
        {
            filename: 'electron/main/index.ts',
            code: `import { state } from './runtime/gamestate.js';`,
        },
        {
            filename: 'electron/main/index.ts',
            code: `import { config } from './config/appsettings.js';`,
        },
        // A template specifier built at runtime resolves to no single module.
        {
            filename: 'electron/main/index.ts',
            code: `const m = import(\`../../apps/\${gameId}/electron/main.js\`);`,
        },
    ],

    // ── Invalid — rule must fire ─────────────────────────────────────────────
    invalid: [
        // Core bootstrap importing a game directly (the original violation).
        {
            filename: 'electron/main/index.ts',
            code: `import { registerTacticsActions } from '@chimera-engine/tactics/actions.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // mainGameRegistry.ts is not exempt: it is a game-agnostic
        // factory and must not import a game — statically or dynamically.
        {
            filename: 'electron/main/game/mainGameRegistry.ts',
            code: `import { registerTacticsActions } from '@chimera-engine/tactics/actions.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // The content + lobby registries carry no exemption: their
        // game coupling moved into the injected MainGameContribution, so they must
        // no longer import a game — statically or dynamically.
        {
            filename: 'electron/main/content/gameContentRegistry.ts',
            code: `import { TACTICS_CONTENT_SCHEMAS } from '@chimera-engine/tactics/content/tacticsContent.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        {
            filename: 'electron/main/lobby/lobbySetupRegistry.ts',
            code: `import { buildTacticsLobbySetup } from '@chimera-engine/tactics/lobby/lobby-setup.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        {
            filename: 'electron/main/lobby/lobbySetupRegistry.ts',
            code: `const m = import('@chimera-engine/tactics/content/tacticsContent.js');`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        {
            filename: 'electron/main/game/mainGameRegistry.ts',
            code: `const m = import('@chimera-engine/tactics/actions.js');`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // A non-registry main module importing a game.
        {
            filename: 'electron/main/renderer-url.ts',
            code: `import { TACTICS_GAME_ID } from '@chimera-engine/tactics/index.js';`,
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
            code: `const m = import('@chimera-engine/tactics/actions.js');`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // Re-export from a games module.
        {
            filename: 'electron/main/index.ts',
            code: `export { registerTacticsActions } from '@chimera-engine/tactics/actions.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // Export-all from a games module.
        {
            filename: 'electron/main/index.ts',
            code: `export * from '@chimera-engine/tactics/actions.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // ── The `apps/` path family — a game's on-disk home ──────────────────
        // Same classifier as the renderer side: a game reached by that path
        // carries neither a `games/` segment nor a `@chimera-engine/` specifier.
        // Pinned in each specifier position, matching the sibling bash Check.
        {
            filename: 'electron/main/runtime/SomeRuntime.ts',
            code: `import { x } from '../../../apps/tactics/entities.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        {
            filename: 'electron/main/index.ts',
            code: `const m = import('../../apps/tactics/electron/contribution.js');`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        {
            filename: 'electron/main/index.ts',
            code: `export * from 'apps/tactics/actions.js';`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        // A no-substitution template specifier names exactly one module, so it
        // is as resolvable as a string literal and must be classified alike.
        {
            filename: 'electron/main/index.ts',
            code: `const m = import(\`../../apps/tactics/electron/contribution.js\`);`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
        {
            filename: 'electron/main/game/mainGameRegistry.ts',
            code: `const m = import(\`@chimera-engine/tactics/actions.js\`);`,
            errors: [{ messageId: 'mainGamesImport' }],
        },
    ],
});
