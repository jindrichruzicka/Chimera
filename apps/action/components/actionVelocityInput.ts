// The keyboard half of movement, as a pure value transform.
//
// The engine's input layer dispatches on key DOWN and key UP (an `InputEvent`
// carries `pressed`), so a held arrow key is not a stream of events — it is one
// press event, then silence, then one release event. That makes "which movement
// keys are currently down" the state the playfield has to keep, and this module
// is that state plus the one derivation off it.
//
// The release is not always a key-up: the manager also dispatches one for every
// held action when the window loses focus, because the key-up for a key let go
// in another window never arrives. Nothing here has to know the difference —
// that is the point of taking the release as an event rather than reading the
// keyboard.
//
// A SET rather than "the last key pressed", because both of the obvious
// simplifications are wrong to play: with a last-key model, holding Up and then
// tapping Right leaves the player stopped when Right is released, and diagonal
// movement is unreachable. Keeping the set and summing it gives both for free.
//
// Pure, React-free and r3f-free, so every claim about it is a plain unit test.

import type { ActionVelocityComponent } from '../simulation/action-types.js';
import { ACTION_MOVE_DIRECTIONS, type ActionMoveActionId } from '../input-action-ids.js';

/** The movement keys currently held down. */
export type ActionHeldDirections = ReadonlySet<ActionMoveActionId>;

/** Nothing held — the state the playfield starts in. */
export const NO_HELD_DIRECTIONS: ActionHeldDirections = new Set<ActionMoveActionId>();

/**
 * Adds or removes one direction, returning a NEW set. A new object every time is
 * what makes the result usable as React state: mutating the held set in place
 * would leave the component re-rendering against a value it cannot tell has
 * changed.
 */
export function setHeldDirection(
    held: ActionHeldDirections,
    id: ActionMoveActionId,
    pressed: boolean,
): ActionHeldDirections {
    const next = new Set(held);
    if (pressed) {
        next.add(id);
    } else {
        next.delete(id);
    }
    return next;
}

/** Clamps a summed axis back into the `-1 | 0 | 1` vocabulary the action takes. */
function unitStep(sum: number): ActionVelocityComponent {
    if (sum > 0) return 1;
    if (sum < 0) return -1;
    return 0;
}

/**
 * Sums the held directions into one velocity.
 *
 * The two axes are summed and clamped INDEPENDENTLY: holding Left and Right
 * cancels the horizontal axis while a simultaneously-held Down keeps moving the
 * primitive south. Clamping the pair together would stop it dead instead.
 */
export function velocityFromHeld(held: ActionHeldDirections): {
    readonly dx: ActionVelocityComponent;
    readonly dy: ActionVelocityComponent;
} {
    let dx = 0;
    let dy = 0;
    for (const id of held) {
        const direction = ACTION_MOVE_DIRECTIONS[id];
        dx += direction.dx;
        dy += direction.dy;
    }
    return { dx: unitStep(dx), dy: unitStep(dy) };
}
