import { describe, expect, it } from 'vitest';
import type { QuickStartConfig } from '@chimera-engine/simulation/foundation/quick-start-contract.js';

import {
    ACTION_CONTROL_ATTRIBUTE,
    ACTION_PRIMITIVE_ATTRIBUTE,
    ACTION_WASD_CONTROL,
} from '../simulation/constants.js';
import {
    ensureActionHostPick,
    readActionShellPicks,
    selectActionPick,
    setActionSecondPlayer,
    stepActionPick,
} from './actionShellSelection.js';

/** A draft with the host on `host` and, when given, a second seat on `second`. */
function draftOf(host: string, second?: string): QuickStartConfig {
    return {
        hostAttributes: { [ACTION_PRIMITIVE_ATTRIBUTE]: host },
        ...(second === undefined
            ? {}
            : {
                  localSeats: [
                      {
                          attributes: {
                              [ACTION_PRIMITIVE_ATTRIBUTE]: second,
                              [ACTION_CONTROL_ATTRIBUTE]: ACTION_WASD_CONTROL,
                          },
                      },
                  ],
              }),
    };
}

describe('readActionShellPicks', () => {
    it('reads the host pick off hostAttributes', () => {
        expect(readActionShellPicks(draftOf('cone'))).toEqual({ host: 'cone', second: null });
    });

    it('reads the second pick off the first local seat', () => {
        expect(readActionShellPicks(draftOf('cone', 'cube'))).toEqual({
            host: 'cone',
            second: 'cube',
        });
    });

    it('defaults an empty draft to the first seeded shape, with no second seat', () => {
        expect(readActionShellPicks({})).toEqual({ host: 'cube', second: null });
    });

    it('falls back to the default for a host primitive that names no shape', () => {
        expect(readActionShellPicks(draftOf('dodecahedron'))).toEqual({
            host: 'cube',
            second: null,
        });
    });

    it('reports no second seat when the seat names no readable shape', () => {
        // A seat is only a PICK once it names one; a marker with an unreadable
        // primitive must not draw a ring on a shape nobody chose.
        expect(readActionShellPicks(draftOf('cone', 'dodecahedron')).second).toBeNull();
    });

    it('reads the local seat, not merely the presence of the array', () => {
        expect(readActionShellPicks({ localSeats: [] }).second).toBeNull();
    });
});

describe('ensureActionHostPick', () => {
    it('writes the default host pick into a draft that carries none', () => {
        expect(ensureActionHostPick({})).toEqual({
            hostAttributes: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube' },
        });
    });

    it('answers null when the draft already names a readable host pick', () => {
        // A page that re-wrote the default on every mount would throw away the
        // pick the player made before opening Settings.
        expect(ensureActionHostPick(draftOf('cone'))).toBeNull();
    });

    it('keeps the other host attributes a draft already carries', () => {
        const patch = ensureActionHostPick({ hostAttributes: { colour: 'red' } });

        expect(patch?.hostAttributes).toEqual({
            colour: 'red',
            [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube',
        });
    });

    it('replaces an unreadable host pick with the default', () => {
        expect(ensureActionHostPick(draftOf('dodecahedron'))).toEqual({
            hostAttributes: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube' },
        });
    });
});

describe('selectActionPick', () => {
    it('moves the host pick', () => {
        expect(selectActionPick(draftOf('cube'), 'host', 'cone')).toEqual({
            hostAttributes: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cone' },
        });
    });

    it('answers null when the host already holds that shape', () => {
        expect(selectActionPick(draftOf('cube'), 'host', 'cube')).toBeNull();
    });

    it('refuses a shape the second seat holds', () => {
        // Exclusivity: two seats on one primitive is a match the simulation
        // would seat by falling back, silently ignoring one player's pick.
        expect(selectActionPick(draftOf('cube', 'cone'), 'host', 'cone')).toBeNull();
    });

    it('moves the second pick and keeps its WASD marker', () => {
        expect(selectActionPick(draftOf('cube', 'cone'), 'second', 'sphere')).toEqual({
            localSeats: [
                {
                    attributes: {
                        [ACTION_PRIMITIVE_ATTRIBUTE]: 'sphere',
                        [ACTION_CONTROL_ATTRIBUTE]: ACTION_WASD_CONTROL,
                    },
                },
            ],
        });
    });

    it('refuses a second pick when there is no second seat', () => {
        expect(selectActionPick(draftOf('cube'), 'second', 'cone')).toBeNull();
    });

    it('refuses the shape the HOST holds for the second seat', () => {
        expect(selectActionPick(draftOf('cube', 'cone'), 'second', 'cube')).toBeNull();
    });

    it('keeps the host attributes a draft already carries when moving the host pick', () => {
        const patch = selectActionPick(
            { hostAttributes: { colour: 'red', [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube' } },
            'host',
            'cone',
        );

        expect(patch?.hostAttributes).toEqual({
            colour: 'red',
            [ACTION_PRIMITIVE_ATTRIBUTE]: 'cone',
        });
    });

    it('never mutates the draft it is handed', () => {
        const draft = draftOf('cube', 'cone');
        const before = JSON.stringify(draft);

        selectActionPick(draft, 'host', 'sphere');

        expect(JSON.stringify(draft)).toBe(before);
    });
});

describe('setActionSecondPlayer', () => {
    it('opens a second seat on the first shape the host is not holding', () => {
        expect(setActionSecondPlayer(draftOf('cube'), true)).toEqual({
            localSeats: [
                {
                    attributes: {
                        [ACTION_PRIMITIVE_ATTRIBUTE]: 'sphere',
                        [ACTION_CONTROL_ATTRIBUTE]: ACTION_WASD_CONTROL,
                    },
                },
            ],
        });
    });

    it('skips the host’s shape when choosing the opening pick', () => {
        // With the host on the sphere, opening the seat on the sphere too would
        // be refused by the simulation's fallback rather than by the picker.
        const patch = setActionSecondPlayer(draftOf('sphere'), true);

        expect(patch?.localSeats?.[0]?.attributes?.[ACTION_PRIMITIVE_ATTRIBUTE]).toBe('cube');
    });

    it('closes the seat by emptying the list, never by dropping the key', () => {
        // `setShellDraft` merges per key: omitting `localSeats` would leave the
        // seat the player just turned off still in the draft.
        expect(setActionSecondPlayer(draftOf('cube', 'cone'), false)).toEqual({ localSeats: [] });
    });

    it('answers null when the seat is already in the state asked for', () => {
        expect(setActionSecondPlayer(draftOf('cube', 'cone'), true)).toBeNull();
        expect(setActionSecondPlayer(draftOf('cube'), false)).toBeNull();
    });
});

describe('stepActionPick', () => {
    it('steps the host pick one shape to the right', () => {
        const patch = stepActionPick(draftOf('cube'), 'host', 1);

        expect(patch?.hostAttributes?.[ACTION_PRIMITIVE_ATTRIBUTE]).toBe('sphere');
    });

    it('steps left, wrapping off the first shape onto the last', () => {
        const patch = stepActionPick(draftOf('cube'), 'host', -1);

        expect(patch?.hostAttributes?.[ACTION_PRIMITIVE_ATTRIBUTE]).toBe('cone');
    });

    it('skips a shape the other seat holds', () => {
        // Cube → (sphere, taken) → cone.
        const patch = stepActionPick(draftOf('cube', 'sphere'), 'host', 1);

        expect(patch?.hostAttributes?.[ACTION_PRIMITIVE_ATTRIBUTE]).toBe('cone');
    });

    it('steps the second seat’s pick, skipping the host’s', () => {
        const patch = stepActionPick(draftOf('sphere', 'cube'), 'second', 1);

        expect(patch?.localSeats?.[0]?.attributes?.[ACTION_PRIMITIVE_ATTRIBUTE]).toBe('cone');
    });

    it('answers null for a zero step', () => {
        // Up and down arrows carry `dx: 0`; a row of three shapes has no second
        // axis to move on, so the keypress is a no-op rather than a re-write.
        expect(stepActionPick(draftOf('cube'), 'host', 0)).toBeNull();
    });

    it('answers null when there is no second seat to step', () => {
        expect(stepActionPick(draftOf('cube'), 'second', 1)).toBeNull();
    });
});
