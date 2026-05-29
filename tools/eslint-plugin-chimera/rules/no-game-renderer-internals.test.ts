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
            filename: 'games/tactics/screens/TacticsGameHud.tsx',
            code: `import { Button, Card } from '@chimera/renderer/components/ui/index.js';`,
        },
        {
            filename: 'games/tactics/screens/TacticsGameMenu.tsx',
            code: `import { Button } from '@chimera/renderer/components/ui';`,
        },
        {
            filename: 'games/tactics/shell/TacticsShellBackground.tsx',
            code: `import { Panel } from '@chimera/renderer/components/ui/index.js';`,
        },
        {
            filename: 'games/tactics/screens/TacticsGameHud.tsx',
            code: `import { Button } from '@chimera/renderer/components/ui/index.ts';`,
        },
        {
            filename: 'games/tactics/screens/TacticsGameHud.tsx',
            code: `export { Button } from '@chimera/renderer/components/ui/index.js';`,
        },
        {
            filename: 'games/tactics/screens/TacticsGameHud.tsx',
            code: `import { resolveGameResultOutcome } from '@chimera/shared/game-screen-contract.js';`,
        },
        {
            filename: 'games/tactics/actions/MoveUnitAction.ts',
            code: `import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';`,
        },
        {
            filename: 'games/tactics/actions/MoveUnitAction.ts',
            code: `import { makeRendererHelper } from '../renderer/makeRendererHelper.js';`,
        },
        {
            filename: '/repo/games/tactics/actions/MoveUnitAction.ts',
            code: `import { makeRendererHelper } from '../renderer/makeRendererHelper.js';`,
        },
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `import { useGameStore } from '@chimera/renderer/state/gameStore.js';`,
        },
    ],
    invalid: [
        {
            filename: 'games/tactics/screens/TacticsGameHud.tsx',
            code: `import { Button } from '@chimera/renderer/components/ui/Button.js';`,
            errors: [{ messageId: 'gameRendererUiDeepImport' }],
        },
        {
            filename: 'games/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { useGameStore } from '@chimera/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'games/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { useGameStore } from '../../../renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: '/repo/games/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { useGameStore } from '../../../renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'games/tactics/screens/TacticsDebugPanel.tsx',
            code: `export { useGameStore } from '@chimera/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'games/tactics/screens/TacticsDebugPanel.tsx',
            code: `export * from '@chimera/renderer/components/ui/Button.js';`,
            errors: [{ messageId: 'gameRendererUiDeepImport' }],
        },
        {
            filename: 'games/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { getGameBridge } from '@chimera/renderer/bridge/game-bridge.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'games/tactics/screens/TacticsMenu.tsx',
            code: `import { GameShell } from '@chimera/renderer/components/shell/GameShell.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'games/tactics/screens/TacticsBoard.tsx',
            code: `import { GameCanvas } from '@chimera/renderer/components/r3f/GameCanvas.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'games/tactics/screens/TacticsMenu.tsx',
            code: `import { useInputAction } from '@chimera/renderer/input/useInputAction.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'games/tactics/screens/TacticsMenu.tsx',
            code: `import '@chimera/renderer/styles/tokens.css';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'games/tactics/actions/MoveUnitAction.ts',
            code: `import { Button } from '@chimera/renderer/components/ui/index.js';`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        {
            filename: 'games/tactics/actions/MoveUnitAction.ts',
            code: `import { Button } from '../../../renderer/components/ui/index.js';`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        {
            // .ts file inside screens/ is not a renderer surface (.tsx/.jsx required)
            filename: 'games/tactics/screens/tacticsScreenHelpers.ts',
            code: `import { Button } from '@chimera/renderer/components/ui/index.js';`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        {
            // shell .tsx file importing a renderer internal (not the barrel)
            filename: 'games/tactics/shell/TacticsShellSidebar.tsx',
            code: `import { useGameStore } from '@chimera/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
    ],
});
