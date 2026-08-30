// Which seats this MACHINE drives, read off the synced lobby setup.
//
// A quick-started match may open a pass-and-play seat beside the host's own
// (`QuickStartConfig.localSeats`), and both are driven from one keyboard. The
// engine names the host's seat to the renderer as `localPlayerId`; it has no
// concept of a second seat sharing the machine, so which seat that is has to be
// something the GAME said — and the shell said it, as the `control` attribute
// it wrote onto the quick-start draft (`simulation/constants.ts`).
//
// Pure: no React, no r3f, no snapshot narrowing. It reads `setup` and answers a
// seat id, so every rule below — including the two refusals — is a plain unit
// test rather than a rendered screen.

import type { GameSetupConfig, PlayerId } from '@chimera-engine/simulation/engine/types.js';

import { ACTION_CONTROL_ATTRIBUTE, ACTION_WASD_CONTROL } from '../simulation/constants.js';

/**
 * The pass-and-play seat this machine drives with the WASD cluster, or `null`
 * when there is none.
 *
 * Two refusals, and neither is defensive tidiness:
 *
 *   - a NON-HOST viewer always gets `null`. A joined client owns exactly one
 *     seat; a second local cluster there would be one machine authoring input
 *     for a player another machine owns, which the host refuses anyway. The
 *     parameter is `GameScreenProps.isHost`, whose absent value the contract
 *     reads as host.
 *   - the viewer's OWN seat is never the answer. It already moves on the
 *     arrows, and returning it would drive one primitive from two clusters.
 */
export function findActionPassAndPlaySeat(
    setup: GameSetupConfig | undefined,
    viewerId: PlayerId,
    isHost: boolean,
): PlayerId | null {
    if (!isHost || setup === undefined) {
        return null;
    }

    for (const [seat, attributes] of Object.entries(setup.playerAttributes)) {
        if (seat === viewerId) {
            continue;
        }
        if (attributes[ACTION_CONTROL_ATTRIBUTE] === ACTION_WASD_CONTROL) {
            return seat as PlayerId;
        }
    }

    return null;
}
