import { describe, expect, it } from 'vitest';

import {
    ACTION_MOVE_ACTION_IDS,
    ACTION_MOVE_DOWN_ACTION,
    ACTION_MOVE_LEFT_ACTION,
    ACTION_MOVE_RIGHT_ACTION,
    ACTION_MOVE_UP_ACTION,
} from '../input-action-ids.js';
import { NO_HELD_DIRECTIONS, setHeldDirection, velocityFromHeld } from './actionVelocityInput.js';

// The keyboard half of movement: the input layer dispatches on key DOWN and key
// UP, so the playfield tracks WHICH movement keys are down and derives one
// velocity from the set. Held state is a set rather than "the last key pressed"
// because a player holding Up and then pressing Right expects to travel
// diagonally, and releasing Right expects to leave them still going up.
describe('setHeldDirection', () => {
    it('starts with nothing held', () => {
        expect(velocityFromHeld(NO_HELD_DIRECTIONS)).toEqual({ dx: 0, dy: 0 });
    });

    it('adds a pressed direction', () => {
        const held = setHeldDirection(NO_HELD_DIRECTIONS, ACTION_MOVE_UP_ACTION, true);

        expect(velocityFromHeld(held)).toEqual({ dx: 0, dy: -1 });
    });

    it('removes a released direction', () => {
        const held = setHeldDirection(
            setHeldDirection(NO_HELD_DIRECTIONS, ACTION_MOVE_UP_ACTION, true),
            ACTION_MOVE_UP_ACTION,
            false,
        );

        expect(velocityFromHeld(held)).toEqual({ dx: 0, dy: 0 });
    });

    it('returns a NEW set rather than mutating the one it is handed', () => {
        const before = setHeldDirection(NO_HELD_DIRECTIONS, ACTION_MOVE_UP_ACTION, true);

        const after = setHeldDirection(before, ACTION_MOVE_RIGHT_ACTION, true);

        expect(after).not.toBe(before);
        expect(velocityFromHeld(before)).toEqual({ dx: 0, dy: -1 });
    });

    it('is idempotent for a repeated press', () => {
        const once = setHeldDirection(NO_HELD_DIRECTIONS, ACTION_MOVE_UP_ACTION, true);
        const twice = setHeldDirection(once, ACTION_MOVE_UP_ACTION, true);

        expect(velocityFromHeld(twice)).toEqual(velocityFromHeld(once));
    });

    it('ignores a release of a direction that was never held', () => {
        const held = setHeldDirection(NO_HELD_DIRECTIONS, ACTION_MOVE_LEFT_ACTION, false);

        expect(velocityFromHeld(held)).toEqual({ dx: 0, dy: 0 });
    });
});

describe('velocityFromHeld', () => {
    it('combines two axes into a diagonal', () => {
        const held = setHeldDirection(
            setHeldDirection(NO_HELD_DIRECTIONS, ACTION_MOVE_UP_ACTION, true),
            ACTION_MOVE_RIGHT_ACTION,
            true,
        );

        expect(velocityFromHeld(held)).toEqual({ dx: 1, dy: -1 });
    });

    it('cancels opposing directions on the same axis', () => {
        const held = setHeldDirection(
            setHeldDirection(NO_HELD_DIRECTIONS, ACTION_MOVE_LEFT_ACTION, true),
            ACTION_MOVE_RIGHT_ACTION,
            true,
        );

        expect(velocityFromHeld(held)).toEqual({ dx: 0, dy: 0 });
    });

    it('leaves the other axis alone when one axis cancels', () => {
        // A "sum then clamp both axes together" implementation would zero the
        // whole vector here instead of only the cancelled axis.
        let held = setHeldDirection(NO_HELD_DIRECTIONS, ACTION_MOVE_LEFT_ACTION, true);
        held = setHeldDirection(held, ACTION_MOVE_RIGHT_ACTION, true);
        held = setHeldDirection(held, ACTION_MOVE_DOWN_ACTION, true);

        expect(velocityFromHeld(held)).toEqual({ dx: 0, dy: 1 });
    });

    it('resumes the surviving direction when one of an opposing pair is released', () => {
        let held = setHeldDirection(NO_HELD_DIRECTIONS, ACTION_MOVE_LEFT_ACTION, true);
        held = setHeldDirection(held, ACTION_MOVE_RIGHT_ACTION, true);
        held = setHeldDirection(held, ACTION_MOVE_RIGHT_ACTION, false);

        expect(velocityFromHeld(held)).toEqual({ dx: -1, dy: 0 });
    });

    it('never exceeds one step per axis with every key held', () => {
        let held = NO_HELD_DIRECTIONS;
        for (const id of ACTION_MOVE_ACTION_IDS) {
            held = setHeldDirection(held, id, true);
        }

        expect(velocityFromHeld(held)).toEqual({ dx: 0, dy: 0 });
    });
});
