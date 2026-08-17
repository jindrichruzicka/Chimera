/**
 * electron/dev-tools/eslint/rules/no-game-renderer-internals.test.ts
 *
 * Unit tests for the `chimera/no-game-renderer-internals` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Architecture reference: §3 Module Boundaries, §4.35 UI Design System
 */

import { Linter, RuleTester } from 'eslint';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import rule from './no-game-renderer-internals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
            // components/ is a renderer surface: it holds the game's reusable
            // React, DOM and in-Canvas alike, and a shared component that plays
            // a cue needs the audio barrel exactly as a screen does.
            filename: 'apps/tactics/components/TacticsAmbience.tsx',
            code: `import { useMusicTrack } from '@chimera-engine/renderer/audio';`,
        },
        {
            // …and the r3f barrel from the same directory, which is where the
            // in-Canvas primitives now live.
            filename: 'apps/tactics/components/TacticsUnitPrimitive.tsx',
            code: `import { useModelAnimation } from '@chimera-engine/renderer/components/r3f';`,
        },
        {
            // Documentation, not coverage: the rule compares `source ===` and
            // never sees the imported names, so other fixtures on this exact
            // specifier already cover everything this one can fail on. It is
            // kept because the symbols are the interesting part for a reader —
            // `useCamera` lives in `renderer/hooks/` and `easeOut` in
            // `renderer/utils/`, and the invalid cases reject exactly those two
            // directories by specifier.
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { useCamera, useTween, easeOut } from '@chimera-engine/renderer/components/r3f';`,
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
        {
            // The public input barrel (§4.26) — the subpath that lets a game
            // SUBSCRIBE to the rebindable actions it already declares:
            // useInputAction, useInputManager, the InputManagerProvider, and
            // the action/event types.
            filename: 'apps/tactics/screens/TacticsMenu.tsx',
            code: `import { useInputAction } from '@chimera-engine/renderer/input';`,
        },
        {
            filename: 'apps/tactics/shell/TacticsShellHud.tsx',
            code: `import { useInputManager } from '@chimera-engine/renderer/input/index.js';`,
        },
        {
            // Extensionless and .ts forms of the same barrel, matching its
            // sibling predicates — a game surface may name any of the four spellings.
            filename: 'apps/tactics/renderer/register.ts',
            code: `import { InputManagerProvider } from '@chimera-engine/renderer/input/index';`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `import { useInputAction } from '@chimera-engine/renderer/input/index.ts';`,
        },
        // ── Dynamic import() — the same permissions as the static position ──
        // A public barrel stays permitted when it is code-split rather than
        // imported eagerly; lazy-loading a heavy screen is the ordinary reason
        // a game reaches for import() at all.
        {
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `const ui = await import('@chimera-engine/renderer/components/ui');`,
        },
        {
            filename: 'apps/tactics/renderer/register.ts',
            code: `const seam = await import('@chimera-engine/renderer/game');`,
        },
        // A non-renderer specifier is out of this rule's scope in every position.
        {
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `const sim = await import('@chimera-engine/simulation/engine/index.js');`,
        },
        // A specifier assembled at runtime names no one module.
        {
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `const mod = await import(specifier);`,
        },
        {
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: 'const mod = await import(`@chimera-engine/renderer/state/${name}.js`);',
        },
        // A non-STRING literal specifier. Unreachable from typechecked TS, but
        // it is what separates `typeof source === 'string'` from a mere
        // defined-check: under the looser test `checkImport` is handed a number
        // and crashes on `.replace`, so the rule dies instead of ignoring it.
        {
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `const mod = await import(5);`,
        },
    ],
    invalid: [
        // ── Dynamic import() — Invariant #96 holds in this position too ─────
        // The bash Check 17 covers part of this ground: it scans
        // `apps/*/{screens,components,shell}` for a QUOTED renderer specifier, so it
        // sees neither the template form nor the non-surface file below.
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: `const store = await import('@chimera-engine/renderer/state/gameStore.js');`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `const button = await import('@chimera-engine/renderer/components/ui/Button.js');`,
            errors: [{ messageId: 'gameRendererUiDeepImport' }],
        },
        // A non-surface file inside a game may not reach renderer at all.
        {
            filename: 'apps/tactics/simulation/rules.ts',
            code: `const ui = await import('@chimera-engine/renderer/components/ui');`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        // A no-substitution template resolves to exactly one module.
        {
            filename: 'apps/tactics/screens/TacticsDebugPanel.tsx',
            code: 'const store = await import(`@chimera-engine/renderer/state/gameStore.js`);',
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
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
            // The extension gate holds on components/ as it does on screens/:
            // a plain-.ts module there is a helper, not a React surface, and
            // stays off the barrels. This is the pair to the components/*.tsx
            // valid cases above — without it, "components/ is a surface" would
            // read as "everything under components/ is".
            filename: 'apps/demo/components/useDemoBuffer.ts',
            code: `import { useAudioManager } from '@chimera-engine/renderer/audio';`,
            errors: [{ messageId: 'gameRendererImportOutsideSurface' }],
        },
        {
            // A game directory that is NOT a surface stays blocked whatever the
            // extension — the surface list is three named directories plus the
            // composition root, not "any .tsx under apps/".
            filename: 'apps/demo/lib/DemoUnitPrimitive.tsx',
            code: `import { GameCanvas } from '@chimera-engine/renderer/components/r3f';`,
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
            // `renderer/hooks/` exposes only its barrel; deep file imports stay
            // forbidden — exactly as for `assets/AssetManager.js` above, and for
            // the same reason. `useCamera` is public through `components/r3f`;
            // this spelling of the same symbol is still an internal, because the
            // rule is on the specifier and never on where the symbol lives.
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { useCamera } from '@chimera-engine/renderer/hooks/useCamera.js';`,
            errors: [{ messageId: 'gameRendererInternalImport' }],
        },
        {
            // The curve primitives take the same shape: public through the
            // barrel, forbidden through `renderer/utils/`.
            filename: 'apps/tactics/screens/TacticsBoard.tsx',
            code: `import { easeOut } from '@chimera-engine/renderer/utils/curves.js';`,
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

// ─── The two prose enumerations, derived rather than restated ─────────────────
//
// `meta.docs.description` and the `gameRendererInternalImport` message both
// spell the barrel set out, because a developer who hits the rule has only the
// message to go on. Nothing else asserts either string, so both can silently
// come to name a set the predicates no longer accept. These cases derive the
// accepted set by RUNNING the rule over one import per candidate barrel and
// compare the two strings against that, so the rule cannot disagree with itself.
describe('chimera/no-game-renderer-internals — barrel enumerations in prose', () => {
    // The candidate set is read from the package manifest rather than typed
    // here: a barrel this file forgot to list would otherwise be a barrel the
    // comparison never asks about. Wildcard keys (`./shell/*`, `./styles/*.css`)
    // are excluded — they are not barrels and the rule handles `shell/*` under
    // its own file-scoped carve-out.
    const manifest = JSON.parse(
        readFileSync(resolve(__dirname, '../../../../renderer/package.json'), 'utf8'),
    ) as { exports?: Record<string, unknown> };
    const candidates = Object.keys(manifest.exports ?? {})
        .filter((key) => !key.includes('*'))
        .map((key) => `@chimera-engine/renderer/${key.slice('./'.length)}`);

    /** Every candidate the rule lets through from a plain game screen. */
    function acceptedBarrels(): readonly string[] {
        const linter = new Linter();
        return candidates.filter((specifier) => {
            const messages = linter.verify(
                `import x from '${specifier}';`,
                [
                    {
                        // Flat config matches on `files`; without it every
                        // verify() returns "No matching configuration found"
                        // and the probe reads as "nothing is accepted".
                        files: ['**/*.tsx'],
                        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
                        plugins: { chimera: { rules: { 'no-game-renderer-internals': rule } } },
                        rules: { 'chimera/no-game-renderer-internals': 'error' },
                    },
                ],
                'apps/tactics/screens/TacticsBoard.tsx',
            );
            return messages.length === 0;
        });
    }

    it('accepts the barrels the manifest ships, and only those', () => {
        // Fails in BOTH directions: a barrel that stops being accepted, and a
        // manifest key that was never meant to be a game-surface barrel.
        expect([...acceptedBarrels()].sort()).toEqual([
            '@chimera-engine/renderer/assets',
            '@chimera-engine/renderer/audio',
            '@chimera-engine/renderer/components/chat',
            '@chimera-engine/renderer/components/r3f',
            '@chimera-engine/renderer/components/ui',
            '@chimera-engine/renderer/game',
            '@chimera-engine/renderer/i18n',
            '@chimera-engine/renderer/input',
        ]);
    });

    it('names exactly the accepted barrels in the message a developer actually reads', () => {
        // Read the SPECIFIER LIST, not the whole string, and compare it as a set
        // — the same shape as the description case below and for the same
        // reason. A `toContain` per accepted barrel only fails when the message
        // drops one; it says nothing about a barrel the message names and the
        // predicates reject, which is the half that sends a developer to import
        // something the rule will flag.
        const message = rule.meta?.messages?.['gameRendererInternalImport'] ?? '';
        const listed = /only the public (.*?) barrels from renderer code\./u
            .exec(message)?.[1]
            ?.split(',')
            .map((entry) => entry.trim().replace(/^or\s+/u, ''));

        expect(listed, message).toBeDefined();
        expect([...(listed ?? [])].sort()).toEqual([...acceptedBarrels()].sort());
    });

    it('names exactly the accepted barrels in meta.docs.description', () => {
        // Read the PARENTHESISED list, not the sentence. A bare `toContain`
        // over the whole string is hollow for short entries: the description
        // opens "Allow games to import only…", so `toContain('game')` is
        // satisfied by the word "games" and dropping the `game` barrel from the
        // list goes unnoticed.
        const description = rule.meta?.docs?.description ?? '';
        const listed = /\(([^)]*)\)/u
            .exec(description)?.[1]
            ?.split(',')
            .map((entry) => entry.trim());

        expect(listed, description).toBeDefined();
        expect([...(listed ?? [])].sort()).toEqual(
            acceptedBarrels()
                .map((specifier) => specifier.slice('@chimera-engine/renderer/'.length))
                .sort(),
        );
    });

    it('names no barrel the rule rejects', () => {
        // The other half: an enumeration may not out-run the predicates either.
        // `assets/AssetManager` stands for any deep path behind a barrel.
        for (const rejected of [
            '@chimera-engine/renderer/hooks',
            '@chimera-engine/renderer/state',
            '@chimera-engine/renderer/assets/AssetManager',
        ]) {
            expect(rule.meta?.messages?.['gameRendererInternalImport'] ?? '').not.toContain(
                rejected,
            );
        }
    });
});
