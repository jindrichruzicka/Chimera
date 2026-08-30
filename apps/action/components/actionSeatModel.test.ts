import { describe, expect, it } from 'vitest';
import { playerId } from '@chimera-engine/simulation/engine/types.js';
import type { GameSetupConfig } from '@chimera-engine/simulation/engine/types.js';

import {
    ACTION_CONTROL_ATTRIBUTE,
    ACTION_PRIMITIVE_ATTRIBUTE,
    ACTION_WASD_CONTROL,
} from '../simulation/constants.js';
import { findActionPassAndPlaySeat } from './actionSeatModel.js';

const HOST = playerId('host-1');
const LOCAL_TWO = playerId('host-1-local-2');
const STRANGER = playerId('peer-9');

const setup = (playerAttributes: GameSetupConfig['playerAttributes']): GameSetupConfig => ({
    gameParams: {},
    playerAttributes,
});

const WASD_SEAT = {
    [ACTION_PRIMITIVE_ATTRIBUTE]: 'sphere',
    [ACTION_CONTROL_ATTRIBUTE]: ACTION_WASD_CONTROL,
};

describe('findActionPassAndPlaySeat', () => {
    it('finds the seat the shell marked as WASD-driven', () => {
        const seat = findActionPassAndPlaySeat(
            setup({ [HOST]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube' }, [LOCAL_TWO]: WASD_SEAT }),
            HOST,
            true,
        );

        expect(seat).toBe(LOCAL_TWO);
    });

    it('answers null when no seat carries the marker', () => {
        const seat = findActionPassAndPlaySeat(
            setup({ [HOST]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube' } }),
            HOST,
            true,
        );

        expect(seat).toBeNull();
    });

    it('answers null with no setup at all', () => {
        expect(findActionPassAndPlaySeat(undefined, HOST, true)).toBeNull();
    });

    it('never answers the VIEWER’s own seat', () => {
        // The viewer already drives with the arrows. Handing it the WASD cluster
        // as well would move one primitive from two key clusters.
        const seat = findActionPassAndPlaySeat(setup({ [HOST]: WASD_SEAT }), HOST, true);

        expect(seat).toBeNull();
    });

    it('answers null for a NON-HOST viewer, whatever the setup says', () => {
        // A joined client owns exactly one seat. Dispatching for another
        // machine's seat is an action the host would refuse — and a client that
        // tried would be authoring input for someone else's player.
        const seat = findActionPassAndPlaySeat(
            setup({ [HOST]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube' }, [LOCAL_TWO]: WASD_SEAT }),
            HOST,
            false,
        );

        expect(seat).toBeNull();
    });

    it('ignores a seat whose control attribute names something else', () => {
        const seat = findActionPassAndPlaySeat(
            setup({ [LOCAL_TWO]: { [ACTION_CONTROL_ATTRIBUTE]: 'gamepad' } }),
            HOST,
            true,
        );

        expect(seat).toBeNull();
    });

    it('reads the control attribute, not merely the presence of attributes', () => {
        // A check that answered "the first non-viewer seat with any attributes"
        // would hand a stranger's seat to the local WASD keys.
        const seat = findActionPassAndPlaySeat(
            setup({ [STRANGER]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cone' } }),
            HOST,
            true,
        );

        expect(seat).toBeNull();
    });

    it('answers the marked seat even when another seat is listed first', () => {
        const seat = findActionPassAndPlaySeat(
            setup({
                [STRANGER]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cone' },
                [LOCAL_TWO]: WASD_SEAT,
            }),
            HOST,
            true,
        );

        expect(seat).toBe(LOCAL_TWO);
    });
});
