// simulation/foundation/save-slots.test.ts
//
// Unit tests for the autosave slot contract (§4.11).

import { describe, expect, it } from 'vitest';
import { AUTOSAVE_SLOT_NAME, autosaveSlotId } from './save-slots.js';

describe('AUTOSAVE_SLOT_NAME', () => {
    it('is the bare slot name a save header carries', () => {
        expect(AUTOSAVE_SLOT_NAME).toBe('autosave');
    });
});

describe('autosaveSlotId', () => {
    it('qualifies the slot name with the game id, matching the repository key', () => {
        expect(autosaveSlotId('tactics')).toBe('tactics/autosave');
    });

    it('puts the game id first and the slot name last', () => {
        // Kills the transposed `${AUTOSAVE_SLOT_NAME}/${gameId}` form, which
        // the equality above would also catch but only for this one game id.
        expect(autosaveSlotId('chess').startsWith('chess')).toBe(true);
        expect(autosaveSlotId('chess').endsWith('autosave')).toBe(true);
    });

    it("separates the two halves with '/', the separator the repository qualifies with", () => {
        // Kills a `-` or `:` separator, which both anchors above survive.
        expect(autosaveSlotId('chess')).toBe(`chess/${AUTOSAVE_SLOT_NAME}`);
    });

    it('builds the id from the game id it was given, not a captured one', () => {
        expect(autosaveSlotId('sample-game')).toBe('sample-game/autosave');
        expect(autosaveSlotId('tactics')).toBe('tactics/autosave');
    });
});
