/**
 * electron/dev-tools/eslint/rules/no-game-renderer-internals.test.ts
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
            code: `import { Button, Card } from '@chimera-engine/renderer/components/ui/index.js';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameMenu.tsx',
            code: `import { Button } from '@chimera-engine/renderer/components/ui';`,
        },
        {
            filename: 'apps/tactics/shell/TacticsShellBackground.tsx',
            code: `import { Panel } from '@chimera-engine/renderer/components/ui/index.js';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { Button } from '@chimera-engine/renderer/components/ui/index.ts';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `export { Button } from '@chimera-engine/renderer/components/ui/index.js';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { resolveGameResultOutcome } from '@chimera-engine/simulation/foundation/game-screen-contract.js';`,
        },
        {
            // Public chat library barrel is allowed from a game surface.
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { ChatPanel } from '@chimera-engine/renderer/components/chat';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { ChatPanel } from '@chimera-engine/renderer/components/chat/index.js';`,
        },
        {
            filename: 'apps/tactics/shell/TacticsShellChat.tsx',
            code: `import { ChatPanel } from '@chimera-engine/renderer/components/chat';`,
        },
        {
            filename: 'apps/tactics/actions/MoveUnitAction.ts',
            code: `import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';`,
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
            code: `import { useGameStore } from '@chimera-engine/renderer/state/gameStore.js';`,
        },
        {
            // The renderer composition root may import the public game seam.
            filename: 'apps/tactics/renderer/register.ts',
            code: `import { registerRendererGame } from '@chimera-engine/renderer/game';`,
        },
        {
            // The seam may also be imported by the loaders.
            filename: 'apps/tactics/renderer/loaders.ts',
            code: `import { LoadedRendererGame } from '@chimera-engine/renderer/game';`,
        },
        {
            // A game's own renderer/ helper dir is not a renderer-package crossing.
            filename: 'apps/tactics/renderer/loaders.ts',
            code: `import { thing } from '../screens/index.js';`,
        },
        {
            // F65 Phase 2c: the app's OWN Next host route tree (renderer/app/**) may
            // re-export the engine GUI shell from the public @chimera-engine/renderer/shell/* surface.
            filename: 'apps/tactics/renderer/app/lobby/page.tsx',
            code: `export { default } from '@chimera-engine/renderer/shell/lobby/page';`,
        },
        {
            filename: 'apps/tactics/renderer/app/layout.tsx',
            code: `export { default, metadata } from '@chimera-engine/renderer/shell/layout';`,
        },
        {
            // The allowance is on the importing FILE, not on the shape of the
            // import (Invariant #96): a route may COMPOSE a shell composition
            // module — a named value import of a non-page `shell/*` module —
            // as well as re-export a shell page.
            filename: 'apps/tactics/renderer/app/model-showcase/page.tsx',
            code: `import { GameAssetSession } from '@chimera-engine/renderer/shell/gameAssetSession';`,
        },
        {
            // Public r3f barrel (the GameCanvas root and its Canvas-bound
            // hooks) is allowed from a game surface.
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { GameCanvas } from '@chimera-engine/renderer/components/r3f';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { GameCanvas } from '@chimera-engine/renderer/components/r3f/index.js';`,
        },
        {
            // F71: the engine i18n runtime barrel (I18nProvider, useTranslate, the
            // engine token catalogue) is allowed from a game surface.
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { I18nProvider, useTranslate } from '@chimera-engine/renderer/i18n';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { SETTINGS_KEYS } from '@chimera-engine/renderer/i18n/index.js';`,
        },
        {
            // A game i18n token-catalogue (translations/*.ts) may import the
            // public i18n barrel for the `translationKey` brand factory.
            filename: 'apps/tactics/shell/translations/keys.ts',
            code: `import { translationKey } from '@chimera-engine/renderer/i18n';`,
        },
        {
            filename: 'apps/tactics/screens/translations/keys.ts',
            code: `import { translationKey } from '@chimera-engine/renderer/i18n/index.js';`,
        },
        {
            // The public audio barrel (useSound / useMusicTrack /
            // useAudioManager + the cue and fade option types) is allowed from a
            // game surface — the subpath that makes the cue/fade/crossfade verbs
            // reachable by an adopter at all.
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { useMusicTrack, MUSIC_PRIORITY } from '@chimera-engine/renderer/audio';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { useSound } from '@chimera-engine/renderer/audio/index.js';`,
        },
        {
            // Extensionless and .ts forms of the same barrel, matching its
            // sibling predicates — a game surface may name any of the four spellings.
            filename: 'apps/tactics/renderer/register.ts',
            code: `import { useAudioManager } from '@chimera-engine/renderer/audio/index';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { MUSIC_PRIORITY } from '@chimera-engine/renderer/audio/index.ts';`,
        },
        {
            // The public assets barrel (§4.10) — the subpath that makes any
            // loaded asset reachable by a game surface at all: useAsset,
            // useAssetManager, useModelInstance, and the provider.
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { useAsset, useModelInstance } from '@chimera-engine/renderer/assets';`,
        },
        {
            filename: 'apps/tactics/shell/TacticsShellHud.tsx',
            code: `import { useAssetManager } from '@chimera-engine/renderer/assets/index.js';`,
        },
        {
            // Extensionless and .ts forms of the same barrel, matching its
            // sibling predicates — a game surface may name any of the four spellings.
            filename: 'apps/tactics/renderer/register.ts',
            code: `import { useAssetManager } from '@chimera-engine/renderer/assets/index';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { useModelInstance } from '@chimera-engine/renderer/assets/index.ts';`,
        },
    ],
    invalid: [
        {
            // The shell surface is for the app's Next host route tree only — the
            // composition root must still reach the game via the public seam, not shell/*.
            filename: 'apps/tactics/renderer/register.ts',
            code: `export { default } from '@chimera-engine/renderer/shell/lobby/page';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // Game screens may not import the shell surface either (barrels only).
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { GameShell } from '@chimera-engine/renderer/shell/game/page';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // The composition root still may not reach renderer internals.
            filename: 'apps/tactics/renderer/register.ts',
            code: `import { useGameStore } from '@chimera-engine/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { Button } from '@chimera-engine/renderer/components/ui/Button.js';`,
            errors: [{ messageId: 'gameRendererUiDeepImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { useGameStore } from '@chimera-engine/renderer/state/gameStore.js';`,
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
            code: `export { useGameStore } from '@chimera-engine/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `export * from '@chimera-engine/renderer/components/ui/Button.js';`,
            errors: [{ messageId: 'gameRendererUiDeepImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `import { getGameBridge } from '@chimera-engine/renderer/bridge/game-bridge.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsMenu.tsx',
            code: `import { GameShell } from '@chimera-engine/renderer/components/shell/GameShell.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { GameCanvas } from '@chimera-engine/renderer/components/r3f/GameCanvas.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // r3f exposes only its barrel; the underlying shell/perf internals
            // stay forbidden via deep import.
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { PerfProbe } from '@chimera-engine/renderer/components/shell/perf/PerfProbe.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsMenu.tsx',
            code: `import { useInputAction } from '@chimera-engine/renderer/input/useInputAction.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // The audio barrel exposes only its index; the modules behind it —
            // the manager class, the ramp primitive, the cue-sheet parser — stay
            // forbidden as deep imports, exactly as r3f's do.
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { DefaultAudioManager } from '@chimera-engine/renderer/audio/AudioManager.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { parseAudioCueSheet } from '@chimera-engine/renderer/audio/audioCueSheet.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // A game i18n token-catalogue's permission is the i18n barrel and
            // nothing else — widening the surface list must not widen the
            // catalogue carve-out with it.
            filename: 'apps/tactics/screens/translations/keys.ts',
            code: `import { useSound } from '@chimera-engine/renderer/audio';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsMenu.tsx',
            code: `import '@chimera-engine/renderer/styles/tokens.css';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/actions/MoveUnitAction.ts',
            code: `import { Button } from '@chimera-engine/renderer/components/ui/index.js';`,
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
            code: `import { Button } from '@chimera-engine/renderer/components/ui/index.js';`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        {
            // shell .tsx file importing a renderer internal (not the barrel)
            filename: 'apps/tactics/shell/TacticsShellSidebar.tsx',
            code: `import { useGameStore } from '@chimera-engine/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // A game i18n catalogue is allowed ONLY the i18n barrel — any other
            // renderer internal stays forbidden even from translations/*.ts.
            filename: 'apps/tactics/shell/translations/keys.ts',
            code: `import { useGameStore } from '@chimera-engine/renderer/state/gameStore.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // The catalogue carve-out is narrow to translations/*.ts — a generic
            // shell .ts helper is still a non-surface and may not import the barrel.
            filename: 'apps/tactics/shell/tacticsShellHelpers.ts',
            code: `import { translationKey } from '@chimera-engine/renderer/i18n';`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        {
            // chat exposes only its barrel; deep file imports stay forbidden.
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { ChatPanel } from '@chimera-engine/renderer/components/chat/ChatPanel.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        // ── #774: lock Invariant #96 across the @chimera-engine/renderer package cut ──
        // Every renderer-internal category named by Invariant #96 must stay
        // off-limits to a game surface when reached through the package
        // specifier. The rule already flags any non-barrel `@chimera-engine/renderer/*`
        // import; these planted violations pin that across the remaining
        // categories (asset managers, hooks, the top-level shell/ utilities).
        {
            // Asset managers — renderer-owned, not part of the public surface.
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { AssetManager } from '@chimera-engine/renderer/assets/AssetManager.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // Renderer hooks are internal; games receive props, not hooks.
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { useCamera } from '@chimera-engine/renderer/hooks/useCamera.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // Top-level renderer/shell/ utilities (distinct from components/shell)
            // are shell-page plumbing — never a game-surface dependency.
            filename: 'apps/tactics/shell/TacticsShellMenu.tsx',
            code: `import { renderMainMenuDefinition } from '@chimera-engine/renderer/shell/renderMainMenuDefinition.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
    ],
});
