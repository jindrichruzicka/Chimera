// apps/action/shell/main-menu.ts
//
// The action app's main menu — four entries, and the shape §4.37 is for.
//
// Continue · Start · Settings · Quit. There is no lobby entry and no saves
// browser: this app has no multiplayer flow to open a lobby for, and its one
// save is the autosave Continue already resumes, so a Load button would open a
// browser onto a slot the button above it already reaches.
//
// START IS A NAVIGATION, not a `start-game`. The pick belongs to the player, so
// the button goes to the game's own `/select` page (declared through
// `shellRoutes` in `renderer/loaders.ts`) and the page opens the match itself
// through `useQuickStart().start()`. That is what makes the F87 draft
// load-bearing rather than decorative: the config that reaches
// `chimera:lobby:quick-start` is the one the picker wrote.
//
// The confirmation is on START rather than on the page's own button, and it is
// `'autosave-exists'` rather than `'always'`: a first-run player has nothing to
// overwrite and must not be told they have. The engine resolves that through
// the ONE confirm surface (Invariant #140) once the save slot list has
// hydrated, so the question is never asked about a save that does not exist.
//
// Module boundary (§3): this module's workspace imports are
// simulation/foundation only — it must NEVER import from renderer/*, which is
// also why the labels below are raw token strings rather than the branded
// constants in `translations/keys.ts`. The engine resolves each through `t()`
// at render (an identity for text with no matching token), and
// `translations.test.ts` is what keeps the two spellings in step.
//
// Invariants:
//   #96  — a plain `.ts` under `shell/` is not a game renderer surface, so the
//          renderer barrels are closed to this file by rule
//   #140 — one confirm surface

import type {
    GameMainMenuDefinition,
    GameMenuCommandId,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';

/** The game-owned route the Start button navigates to. */
export const ACTION_SELECT_ROUTE = '/select';

/**
 * The action app's main menu definition, contributed through the renderer game
 * registry.
 *
 * Layout: a vertical stack in the lower half of the viewport, so the three
 * primitives and the ground plane behind it stay in frame — the menu sits over
 * a live scene, and a centred column would cover the thing the player is meant
 * to be looking at.
 */
export const actionMainMenuDefinition: GameMainMenuDefinition = {
    layout: {
        orientation: 'vertical',
        align: 'center',
        anchor: 'center',
        offsetY: 120,
        gap: 16,
    },
    buttons: [
        // Continue first: a returning player resumes, and a new one falls to the
        // entry below. It declares no `disabled` — availability is engine-computed
        // and reactive (§4.37.5), following the live save slot list, so the button
        // enables the moment an autosave lands and disables again when one is
        // deleted.
        {
            label: 'game.action.menu.continue',
            action: { type: 'continue' },
            variant: 'primary',
        },
        {
            // Declared because the engine derives `main-menu-<slug>` from the
            // action alone, and a `navigate` to a game-owned route is exactly the
            // case that derivation cannot name.
            id: 'start',
            label: 'game.action.menu.start',
            action: { type: 'navigate', target: ACTION_SELECT_ROUTE },
            variant: 'primary',
            confirm: {
                when: 'autosave-exists',
                title: 'game.action.menu.startConfirmTitle',
                body: 'game.action.menu.startConfirmBody',
                confirmLabel: 'game.action.menu.startConfirmAccept',
            },
        },
        {
            label: 'game.action.menu.settings',
            action: { type: 'navigate', target: '/settings' },
            variant: 'secondary',
        },
        {
            label: 'game.action.menu.quit',
            action: { type: 'quit' },
            variant: 'danger',
        },
    ],
} as const;

/**
 * The action app uses built-in shell actions only — no `command` entry, so
 * there is nothing to register.
 */
export const actionMenuCommands: Record<GameMenuCommandId, () => void> = {};
