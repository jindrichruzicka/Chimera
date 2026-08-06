/**
 * electron/dev-tools/eslint/rules/no-shell-games-import.test.ts
 *
 * Unit tests for the `chimera/no-shell-games-import` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Architecture reference: §4.35 — UI Design System, §4.37 — Shell Pages UI Contract
 * Invariants #93 and #94:
 *   #93 — Game token override CSS must not be imported directly by any shell page component.
 *   #94 — Engine shell pages must not import from any `apps/*` path. The rule reads
 *         that as any game path: an `apps/` or legacy `games/` segment, or a
 *         non-engine `@chimera-engine/<game>` specifier.
 *
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
        // Shell pages may import from renderer/ — only a game path is blocked
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import { Button } from '../../components/ui/Button';`,
        },
        // Invariant #80: GameShell / InGameMenuHost are game-agnostic shell hosts.
        // Non-game imports (React, engine packages, renderer internals) are fine —
        // only a game path is blocked.
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `import React from 'react';`,
        },
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `import { resolveGameResultOutcome } from '@chimera-engine/simulation/foundation/game-screen-contract.js';`,
        },
        {
            filename: 'renderer/components/shell/InGameMenuHost.tsx',
            code: `import { playerId } from '@chimera-engine/electron/preload/api-types.js';`,
        },
        {
            filename: 'renderer/components/shell/InGameMenuHost.tsx',
            code: `import { useEscapeLayer } from './EscapeStack.js';`,
        },
        // A different shell component (not GameShell/InGameMenuHost) is outside
        // Invariant #80's named coupling surfaces — the rule must not fire on it.
        {
            filename: 'renderer/components/shell/EscapeStack.tsx',
            code: `import { TacticsBoard } from 'games/tactics/screens/TacticsBoard';`,
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
        // The lobby page is a shell page like any other: it may reach engine
        // helpers (it parses LobbyConfig through them) but no game path — the
        // invalid cases below fire on it for all three namings.
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
        // Engine packages share the @chimera-engine/* scope with games but are
        // allowed on shell pages — a scoped specifier is classified by package
        // name against the engine allowlist, never by a path segment.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `import { applyAction } from '@chimera-engine/simulation/engine/types.js';`,
        },
        {
            filename: 'renderer/app/lobby/page.tsx',
            code: `import { playerId } from '@chimera-engine/electron/preload/api-types.js';`,
        },
        // Re-export from an engine package is allowed (engine, not a game).
        {
            filename: 'renderer/app/game/page.tsx',
            code: `export { playerId } from '@chimera-engine/simulation/engine/types.js';`,
        },
        // Dynamic import of a non-game module is allowed.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `const m = import('../../game/rendererGameRegistry.js');`,
        },
        // Detection is path-SEGMENT-anchored at BOTH ends, not a substring
        // match. Leading anchor: a specifier carrying the letters mid-segment
        // (`webapps/`) is a renderer-owned module. Trailing slash: so is one
        // that merely STARTS a longer segment (`gamestate.js`,
        // `appsettings.ts`) — an anchor pinned at one end only leaves the other
        // free to be deleted.
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import { Panel } from '../../components/webapps/Panel.js';`,
        },
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `const m = import('../../state/webapps/registry.js');`,
        },
        {
            filename: 'renderer/app/settings/page.tsx',
            code: `import { state } from '../../state/gamestate.js';`,
        },
        {
            filename: 'renderer/app/saves/page.tsx',
            code: `import { config } from '../../config/appsettings.js';`,
        },
        {
            filename: 'renderer/components/shell/InGameMenuHost.tsx',
            code: `import { gamestate } from './gamestate.js';`,
        },
        // A template specifier built at runtime resolves to no single module, so
        // there is nothing to classify — same reason a computed specifier is not
        // flagged.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `const m = import(\`../../../apps/\${gameId}/screens/index.js\`);`,
        },
        // A non-STRING literal specifier. Unreachable from typechecked TS, but it
        // is what separates `typeof source === 'string'` from a mere defined-check:
        // under the looser test the classifier is handed a number and crashes on
        // `.replace`, so the rule dies instead of ignoring it.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `const m = import(5);`,
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
        // Invariant #94: shell page importing a game by the legacy games/ segment
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import { TacticsBoard } from 'games/tactics/screens/TacticsBoard';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #94: settings page importing a game by the legacy games/ segment
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
        // Invariant #94: lobby page importing a game screen module directly
        {
            filename: 'renderer/app/lobby/page.tsx',
            code: `import { TacticsGameScreenRegistry } from 'games/tactics/screens/index';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #94: game page importing a game directly
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
        // Invariant #94: component-gallery importing a game
        {
            filename: 'renderer/app/component-gallery/page.tsx',
            code: `import { TacticsBoard } from 'games/tactics/screens/TacticsBoard';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #94: shell page importing the game as a @chimera-engine/* package
        // (the post-F57 specifier form — no `/games/` substring).
        {
            filename: 'renderer/app/game/page.tsx',
            code: `import { TacticsGameScreenRegistry } from '@chimera-engine/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #93: shell page importing the game's tokens-override.css via
        // its @chimera-engine/* package specifier.
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import '@chimera-engine/tactics/styles/tokens-override.css';`,
            errors: [{ messageId: 'shellGamesTokenOverrideImport' }],
        },
        // Invariant #94: the boundary cannot be bypassed by re-export or a lazy
        // dynamic import — mirrors chimera/no-main-games-import parity.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `export { TacticsGameScreenRegistry } from '@chimera-engine/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/settings/page.tsx',
            code: `export * from 'games/tactics/settings-schema';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/lobby/page.tsx',
            code: `const m = import('@chimera-engine/tactics/screens/index.js');`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/saves/page.tsx',
            code: `const m = import('games/tactics/screens/index.js');`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // ── #774: lock Invariant #80 across the @chimera-engine/renderer package cut ──
        // GameShell.tsx / InGameMenuHost.tsx are the engine↔game-React coupling
        // surfaces; the GameScreenRegistry prop is the sole coupling point. They
        // must never import a game path — via a relative path, the package
        // specifier, a re-export, or a dynamic import.
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `import { TacticsBoard } from 'games/tactics/screens/TacticsBoard';`,
            errors: [{ messageId: 'shellHostGamesImport' }],
        },
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `import { TacticsGameScreenRegistry } from '@chimera-engine/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellHostGamesImport' }],
        },
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `import { registry } from '../../../games/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellHostGamesImport' }],
        },
        {
            filename: 'renderer/components/shell/InGameMenuHost.tsx',
            code: `import { TacticsInGameMenu } from 'games/tactics/screens/TacticsInGameMenu';`,
            errors: [{ messageId: 'shellHostGamesImport' }],
        },
        {
            filename: 'renderer/components/shell/InGameMenuHost.tsx',
            code: `export { TacticsInGameMenu } from '@chimera-engine/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellHostGamesImport' }],
        },
        {
            filename: 'renderer/components/shell/InGameMenuHost.tsx',
            code: `const m = import('@chimera-engine/tactics/screens/index.js');`,
            errors: [{ messageId: 'shellHostGamesImport' }],
        },
        // ── The `apps/` path family — a game's on-disk home ──────────────────
        // A game reached by that path carries neither a `games/` segment nor a
        // `@chimera-engine/` specifier, so the classifier must recognise an
        // `apps/` path segment in its own right. Each specifier position is
        // pinned separately: the renderer's stock `no-restricted-imports` zone
        // reaches the static ones but not a dynamic `import()`.
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import { registry } from '../../../apps/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/settings/page.tsx',
            code: `import { tacticsSettings } from 'apps/tactics/settings-schema.js';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/game/page.tsx',
            code: `const m = import('../../../apps/tactics/screens/index.js');`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/lobby/page.tsx',
            code: `export * from '../../../apps/tactics/settings-schema.js';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/component-gallery/page.tsx',
            code: `export { registry } from '../../../apps/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        // Invariant #93 rides the same classifier: a game's tokens-override.css
        // reached by its apps/ path is the token-override case, not the broad one.
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `import '../../../apps/tactics/styles/tokens-override.css';`,
            errors: [{ messageId: 'shellGamesTokenOverrideImport' }],
        },
        // Invariant #80: the same apps/ blindness on the two coupling surfaces.
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `import { registry } from '../../../apps/tactics/screens/index.js';`,
            errors: [{ messageId: 'shellHostGamesImport' }],
        },
        {
            filename: 'renderer/components/shell/InGameMenuHost.tsx',
            code: `const m = import('../../../apps/tactics/screens/TacticsInGameMenu.js');`,
            errors: [{ messageId: 'shellHostGamesImport' }],
        },
        // A no-substitution template specifier names exactly one module, so it
        // is as resolvable as a string literal and must be classified alike —
        // otherwise swapping one quote character walks a game past the guard.
        {
            filename: 'renderer/app/game/page.tsx',
            code: `const m = import(\`../../../apps/tactics/screens/index.js\`);`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `const m = import(\`@chimera-engine/tactics/screens/index.js\`);`,
            errors: [{ messageId: 'shellGamesImport' }],
        },
        {
            filename: 'renderer/components/shell/GameShell.tsx',
            code: `const m = import(\`games/tactics/screens/index.js\`);`,
            errors: [{ messageId: 'shellHostGamesImport' }],
        },
    ],
});
