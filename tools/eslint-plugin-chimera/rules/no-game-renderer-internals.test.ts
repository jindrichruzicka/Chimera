/**
 * tools/eslint-plugin-chimera/rules/no-game-renderer-internals.test.ts
 *
 * Unit tests for the `chimera/no-game-renderer-internals` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Architecture reference: §3 Module Boundaries, §4.35 UI Design System
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-game-renderer-internals.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        parserOptions: { ecmaFeatures: { jsx: true } },
        sourceType: 'module',
    },
});

ruleTester.run('chimera/no-game-renderer-internals', rule, {
    valid: [
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { Button, Card } from '@chimera/renderer/components/ui/index.js';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameMenu.tsx',
            code: `import { Button } from '@chimera/renderer/components/ui';`,
        },
        {
            filename: 'apps/tactics/shell/TacticsShellBackground.tsx',
            code: `import { Panel } from '@chimera/renderer/components/ui/index.js';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { Button } from '@chimera/renderer/components/ui/index.ts';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `export { Button } from '@chimera/renderer/components/ui/index.js';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { resolveGameResultOutcome } from '@chimera/simulation/foundation/game-screen-contract.js';`,
        },
        {
            // Public chat library barrel is allowed from a game surface.
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { ChatPanel } from '@chimera/renderer/components/chat';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { ChatPanel } from '@chimera/renderer/components/chat/index.js';`,
        },
        {
            filename: 'apps/tactics/shell/TacticsShellChat.tsx',
            code: `import { ChatPanel } from '@chimera/renderer/components/chat';`,
        },
        {
            filename: 'apps/tactics/actions/MoveUnitAction.ts',
            code: `import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';`,
        },
        {
            filename: 'apps/tactics/actions/MoveUnitAction.ts',
            code: `import { makeRendererHelper } from '../renderer/makeRendererHelper.js';`,
        },
        {
            filename: '/repo/apps/tactics/actions/MoveUnitAction.ts',
            code: `import { makeRendererHelper } from '../renderer/makeRendererHelper.js';`,
        },
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `import { useGameStore } from '@chimera/renderer/state/gameStore.js';`,
        },
        {
            // #784: the renderer composition root may import the public game seam.
            filename: 'apps/tactics/renderer/register.ts',
            code: `import { registerRendererGame } from '@chimera/renderer/game';`,
        },
        {
            // The seam may also be imported by the loaders.
            filename: 'apps/tactics/renderer/loaders.ts',
            code: `import { LoadedRendererGame } from '@chimera/renderer/game';`,
        },
        {
            // A game's own renderer/ helper dir is not a renderer-package crossing.
            filename: 'apps/tactics/renderer/loaders.ts',
            code: `import { thing } from '../screens/index.js';`,
        },
        {
            // F65 Phase 2c: the app's OWN Next host route tree (renderer/app/**) may
            // re-export the engine GUI shell from the public @chimera/renderer/shell/* surface.
            filename: 'apps/tactics/renderer/app/lobby/page.tsx',
            code: `export { default } from '@chimera/renderer/shell/lobby/page';`,
        },
        {
            filename: 'apps/tactics/renderer/app/layout.tsx',
            code: `export { default, metadata } from '@chimera/renderer/shell/layout';`,
        },
    ],
    invalid: [
        {
            // The shell surface is for the app's Next host route tree only — the
            // composition root must still reach the game via the public seam, not shell/*.
            filename: 'apps/tactics/renderer/register.ts',
            code: `export { default } from '@chimera/renderer/shell/lobby/page';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // Game screens may not import the shell surface either (barrels only).
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { GameShell } from '@chimera/renderer/shell/game/page';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // The composition root still may not reach renderer internals.
            filename: 'apps/tactics/renderer/register.ts',
            code: `import { useGameStore } from '@chimera/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { Button } from '@chimera/renderer/components/ui/Button.js';`,
            errors: [{ messageId: 'gameRendererUiDeepImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { useGameStore } from '@chimera/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { useGameStore } from '../../../renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: '/repo/apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { useGameStore } from '../../../renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `export { useGameStore } from '@chimera/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `export * from '@chimera/renderer/components/ui/Button.js';`,
            errors: [{ messageId: 'gameRendererUiDeepImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { getGameBridge } from '@chimera/renderer/bridge/game-bridge.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsMenu.tsx',
            code: `import { GameShell } from '@chimera/renderer/components/shell/GameShell.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { GameCanvas } from '@chimera/renderer/components/r3f/GameCanvas.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsMenu.tsx',
            code: `import { useInputAction } from '@chimera/renderer/input/useInputAction.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsMenu.tsx',
            code: `import '@chimera/renderer/styles/tokens.css';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/actions/MoveUnitAction.ts',
            code: `import { Button } from '@chimera/renderer/components/ui/index.js';`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        {
            filename: 'apps/tactics/actions/MoveUnitAction.ts',
            code: `import { Button } from '../../../renderer/components/ui/index.js';`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        {
            // .ts file inside screens/ is not a renderer surface (.tsx/.jsx required)
            filename: 'apps/tactics/screens/tacticsScreenHelpers.ts',
            code: `import { Button } from '@chimera/renderer/components/ui/index.js';`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        {
            // shell .tsx file importing a renderer internal (not the barrel)
            filename: 'apps/tactics/shell/TacticsShellSidebar.tsx',
            code: `import { useGameStore } from '@chimera/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // chat exposes only its barrel; deep file imports stay forbidden.
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { ChatPanel } from '@chimera/renderer/components/chat/ChatPanel.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        // ── #774: lock Invariant #96 across the @chimera/renderer package cut ──
        // Every renderer-internal category named by Invariant #96 must stay
        // off-limits to a game surface when reached through the package
        // specifier. The rule already flags any non-barrel `@chimera/renderer/*`
        // import; these planted violations pin that across the remaining
        // categories (asset managers, hooks, the top-level shell/ utilities).
        {
            // Asset managers — renderer-owned, not part of the public surface.
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { AssetManager } from '@chimera/renderer/assets/AssetManager.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // Renderer hooks are internal; games receive props, not hooks.
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { useCamera } from '@chimera/renderer/hooks/useCamera.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // Top-level renderer/shell/ utilities (distinct from components/shell)
            // are shell-page plumbing — never a game-surface dependency.
            filename: 'apps/tactics/shell/TacticsShellMenu.tsx',
            code: `import { renderMainMenuDefinition } from '@chimera/renderer/shell/renderMainMenuDefinition.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
    ],
});
