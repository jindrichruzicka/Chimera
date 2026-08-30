// apps/action/shell/main-menu.test.ts
//
// The action app's main-menu definition. What is worth asserting here is not
// that four buttons exist but that each one is the ENTRY it claims to be:
// Start navigates rather than starting, its confirmation is conditional rather
// than unconditional, and Continue leaves its availability to the engine.
//
// Module boundary enforced by the imports below: simulation/foundation and own
// files only, never renderer/.

import { describe, expect, it } from 'vitest';
import type { GameMainMenuDefinition } from '@chimera-engine/simulation/foundation/game-shell-contract.js';

import { ACTION_SELECT_ROUTE, actionMainMenuDefinition, actionMenuCommands } from './main-menu';

const buttons = actionMainMenuDefinition.buttons;
const labelled = (label: string) => buttons.find((button) => button.label === label);

describe('actionMainMenuDefinition', () => {
    it('is a GameMainMenuDefinition', () => {
        const definition: GameMainMenuDefinition = actionMainMenuDefinition;
        expect(definition.buttons.length).toBeGreaterThan(0);
    });

    it('lists Continue, Start, Settings and Quit, in that order', () => {
        expect(buttons.map((button) => button.label)).toEqual([
            'game.action.menu.continue',
            'game.action.menu.start',
            'game.action.menu.settings',
            'game.action.menu.quit',
        ]);
    });

    it('resumes the autosave from Continue', () => {
        expect(labelled('game.action.menu.continue')?.action).toEqual({ type: 'continue' });
    });

    it('leaves Continue’s availability to the engine rather than declaring it', () => {
        // A game-declared `disabled` would be a snapshot of the slot list taken
        // at render; the engine's own gate follows it live (§4.37.5).
        expect(labelled('game.action.menu.continue')).not.toHaveProperty('disabled');
    });

    it('NAVIGATES from Start rather than starting a match', () => {
        // The pick belongs to the player: a `start-game` here would open a match
        // on the game's own defaults and the picker would never be reached.
        expect(labelled('game.action.menu.start')?.action).toEqual({
            type: 'navigate',
            target: ACTION_SELECT_ROUTE,
        });
    });

    it('gives Start a declared id, since the engine cannot derive one for a game route', () => {
        expect(labelled('game.action.menu.start')?.id).toBe('start');
    });

    it('asks before Start only when an autosave would be overwritten', () => {
        // `'always'` would tell a first-run player they are about to lose a save
        // that does not exist.
        expect(labelled('game.action.menu.start')?.confirm?.when).toBe('autosave-exists');
    });

    it('gives the Start confirmation a title, a body and an accepting label', () => {
        const confirm = labelled('game.action.menu.start')?.confirm;

        expect(confirm?.title).toBe('game.action.menu.startConfirmTitle');
        expect(confirm?.body).toBe('game.action.menu.startConfirmBody');
        expect(confirm?.confirmLabel).toBe('game.action.menu.startConfirmAccept');
    });

    it('confirms NOTHING else', () => {
        // Continue resumes what is already there and Quit is the engine's own
        // exit; a confirmation on either would be a question with no stake.
        const confirmed = buttons.filter((button) => button.confirm !== undefined);

        expect(confirmed.map((button) => button.label)).toEqual(['game.action.menu.start']);
    });

    it('routes Settings at the engine’s own page', () => {
        expect(labelled('game.action.menu.settings')?.action).toEqual({
            type: 'navigate',
            target: '/settings',
        });
    });

    it('quits from Quit, and marks it danger', () => {
        expect(labelled('game.action.menu.quit')?.action).toEqual({ type: 'quit' });
        expect(labelled('game.action.menu.quit')?.variant).toBe('danger');
    });

    it('opens no lobby and no saves browser', () => {
        // Both would be an entry onto a flow this app does not have: no
        // multiplayer, and one save that Continue already reaches.
        const types = buttons.map((button) => button.action.type);

        expect(types).not.toContain('open-lobby');
        expect(types).not.toContain('start-game');
        expect(buttons.map((button) => button.label)).not.toContain('game.action.menu.loadGame');
    });

    it('labels every button with a game-namespaced token', () => {
        for (const button of buttons) {
            expect(button.label, button.label).toMatch(/^game\.action\./u);
        }
    });

    it('anchors the button column clear of the primitives behind it', () => {
        // The menu sits over a live scene; a column centred on the viewport
        // would cover the three primitives the player is meant to be looking at.
        expect(actionMainMenuDefinition.layout?.orientation).toBe('vertical');
        expect(actionMainMenuDefinition.layout?.offsetY).toBeGreaterThan(0);
    });
});

describe('actionMenuCommands', () => {
    it('registers no command, because the menu declares no command action', () => {
        const commandButtons = buttons.filter((button) => button.action.type === 'command');

        expect(commandButtons).toEqual([]);
        expect(Object.keys(actionMenuCommands)).toEqual([]);
    });
});
