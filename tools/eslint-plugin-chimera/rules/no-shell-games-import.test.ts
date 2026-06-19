/**
 * tools/eslint-plugin-chimera/rules/no-shell-games-import.test.ts
 *
 * Unit tests for the `chimera/no-shell-games-import` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Architecture reference: §4.35 — UI Design System, §4.37 — Shell Pages UI Contract
 * Invariants #93 and #94:
 *   #93 — Game token override CSS must not be imported directly by any shell page component.
 *   #94 — Engine shell pages must not import from any `games/*` path.
 *
 * Issue: #561
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-shell-games-import.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
    },
});

ruleTester.run('chimera/no-shell-games-import', rule, {
    // ── Valid — rule must NOT fire ───────────────────────────────────────────
    valid: [
        // game/page.tsx may depend on renderer-owned game loading helpers.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `import { loadRendererGame } from '../../game/rendererGameRegistry';`,
        },
        // Shell pages may import from renderer/ — only games/* is blocked
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import { Button } from '../../components/ui/Button';`,
        },
        // Non-shell renderer file importing from games is not a shell-page issue
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `import React from 'react';`,
        },
        // settings page importing from non-games path is allowed
        {
            filename: 'renderer/app/settings/page.tsx',
            code: `import { useSettingsStore } from '../../state/settingsStore';`,
        },
        // saves page: importing from electron/preload types is allowed
        {
            filename: 'renderer/app/saves/page.tsx',
            code: `import { useSaveStore } from '../../state/saveStore.js';`,
        },
        // lobby page is exempt from the games/* restriction (loads LobbyConfig helpers)
        // but must NOT import tokens-override.css or game screen modules directly
        {
            filename: 'renderer/app/lobby/page.tsx',
            code: `import { Button } from '../../components/ui/Button';`,
        },
        // component-gallery: importing from renderer components is allowed
        {
            filename: 'renderer/app/component-gallery/page.tsx',
            code: `import { Button } from '../../components/ui/Button';`,
        },
        {
            filename: 'renderer/app/component-gallery/ComponentGalleryClient.tsx',
            code: `import { Tabs } from '../../components/ui/Tabs';`,
        },
        // Engine packages share the @chimera/* scope with games but are allowed
        // on shell pages — detection is by package name, not a `/games/` path.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `import { applyAction } from '@chimera/simulation/engine/types.js';`,
        },
        {
            filename: 'renderer/app/lobby/page.tsx',
            code: `import { playerId } from '@chimera/electron/preload/api-types.js';`,
        },
        // Re-export from an engine package is allowed (engine, not a game).
        {
            filename: 'renderer/app/game/page.tsx',
            code: `export { playerId } from '@chimera/simulation/engine/types.js';`,
        },
        // Dynamic import of a non-game module is allowed.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `const m = import('../../game/rendererGameRegistry.js');`,
        },
    ],

    // ── Invalid — rule must fire ─────────────────────────────────────────────
    invalid: [
        // Invariant #93: shell page importing tokens-override.css directly
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import 'games/tactics/styles/tokens-override.css';`,
            errors: [{ messageId: 'shellGamesTokenOverrideImport' }],
        },
        // Invariant #94: shell page importing from games/* (screen module)
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import { TacticsBoard } from 'games/tactics/screens/TacticsBoard';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #94: settings page importing from games/*
        {
            filename: 'renderer/app/settings/page.tsx',
            code: `import { tacticsSettings } from 'games/tactics/settings-schema';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #93: saves page importing tokens-override.css
        {
            filename: 'renderer/app/saves/page.tsx',
            code: `import 'games/tactics/styles/tokens-override.css';`,
            errors: [{ messageId: 'shellGamesTokenOverrideImport' }],
        },
        // Invariant #94: lobby page importing from games/* screen module directly
        {
            filename: 'renderer/app/lobby/page.tsx',
            code: `import { TacticsGameScreenRegistry } from 'games/tactics/screens/index';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #94: game page importing from games/* directly
        {
            filename: 'renderer/app/game/page.tsx',
            code: `import { TacticsGameScreenRegistry } from 'games/tactics/screens/index';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #93: lobby page importing tokens-override.css
        {
            filename: 'renderer/app/lobby/page.tsx',
            code: `import 'games/tactics/styles/tokens-override.css';`,
            errors: [{ messageId: 'shellGamesTokenOverrideImport' }],
        },
        // Invariant #93: relative path to tokens-override.css
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import '../../../games/tactics/styles/tokens-override.css';`,
            errors: [{ messageId: 'shellGamesTokenOverrideImport' }],
        },
        // Invariant #93: component-gallery importing tokens-override.css
        {
            filename: 'renderer/app/component-gallery/page.tsx',
            code: `import 'games/tactics/styles/tokens-override.css';`,
            errors: [{ messageId: 'shellGamesTokenOverrideImport' }],
        },
        // Invariant #94: component-gallery importing from games/*
        {
            filename: 'renderer/app/component-gallery/page.tsx',
            code: `import { TacticsBoard } from 'games/tactics/screens/TacticsBoard';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #94: shell page importing the game as a @chimera/* package
        // (the post-F57 specifier form — no `/games/` substring).
        {
            filename: 'renderer/app/game/page.tsx',
            code: `import { TacticsGameScreenRegistry } from '@chimera/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #93: shell page importing the game's tokens-override.css via
        // its @chimera/* package specifier.
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import '@chimera/tactics/styles/tokens-override.css';`,
            errors: [{ messageId: 'shellGamesTokenOverrideImport' }],
        },
        // Invariant #94: the boundary cannot be bypassed by re-export or a lazy
        // dynamic import — mirrors chimera/no-main-games-import parity.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `export { TacticsGameScreenRegistry } from '@chimera/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/settings/page.tsx',
            code: `export * from 'games/tactics/settings-schema';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/lobby/page.tsx',
            code: `const m = import('@chimera/tactics/screens/index.js');`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
    ],
});
