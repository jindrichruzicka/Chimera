import { describe, expect, it } from 'vitest';

import { ActionGameScreenRegistry } from './index.js';

/** React.lazy components are exotic OBJECTS, not plain functions. */
function isLazyComponent(value: unknown): boolean {
    return typeof value === 'object' && value !== null;
}

describe('ActionGameScreenRegistry', () => {
    it('fills the one required slot with a code-split playfield (Invariants #81/#87)', () => {
        expect(ActionGameScreenRegistry.playfield).toBeDefined();
        expect(isLazyComponent(ActionGameScreenRegistry.playfield)).toBe(true);
    });

    it('registers a code-split HUD (Invariant #87)', () => {
        expect(ActionGameScreenRegistry.hud).toBeDefined();
        expect(isLazyComponent(ActionGameScreenRegistry.hud)).toBe(true);
    });

    it('points the engine game scene at the playfield', () => {
        expect(ActionGameScreenRegistry.sceneDefaultScreens?.['engine:game']).toBe('playfield');
    });

    it('takes the ENGINE-DEFAULT in-game menu by omitting the slot', () => {
        // Three states, and they are not interchangeable: a component overrides
        // the menu, the string `'none'` opts out so Escape is a no-op, and an
        // OMITTED slot is what selects the engine default. Only `undefined` gets
        // the Resume/Leave menu the issue asks for.
        expect(ActionGameScreenRegistry.inGameMenu).toBeUndefined();
        expect(ActionGameScreenRegistry.inGameMenu).not.toBe('none');
    });

    it('contributes no screens, covers, banner or event audio yet', () => {
        // The app ships one scene and one HUD. Declaring an empty map instead of
        // omitting the slot would read as a contribution the app has not made.
        expect(ActionGameScreenRegistry.screens).toBeUndefined();
        expect(ActionGameScreenRegistry.loadingScreen).toBeUndefined();
        expect(ActionGameScreenRegistry.loadingScreens).toBeUndefined();
        expect(ActionGameScreenRegistry.transitionOverlay).toBeUndefined();
        expect(ActionGameScreenRegistry.gameResultBanner).toBeUndefined();
        expect(ActionGameScreenRegistry.eventAudioBinding).toBeUndefined();
    });

    it('names exactly the slots it fills', () => {
        // The whole shape in one literal, so a slot added without a decision
        // fails here rather than passing every per-slot check above.
        expect(Object.keys(ActionGameScreenRegistry).sort()).toEqual([
            'hud',
            'playfield',
            'sceneDefaultScreens',
        ]);
    });
});
