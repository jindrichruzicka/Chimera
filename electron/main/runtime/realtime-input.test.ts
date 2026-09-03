/**
 * electron/main/runtime/realtime-input.test.ts
 *
 * Unit tests for `restampForHeartbeatHost` — the envelope a host applies for a
 * player action it received. On a heartbeat-driven host the ticker advances
 * `tick` on its own, so the tick a sender stamped is behind by the time the
 * envelope arrives; the helper re-stamps it with the host's current tick. On a
 * turn-based host it returns the envelope untouched, so the pipeline's
 * `StaleActionError` stays reachable there.
 */

import { describe, expect, it } from 'vitest';
import type { ActionEnvelope } from '@chimera-engine/simulation/engine/types.js';
import { playerId } from '@chimera-engine/simulation/engine/types.js';
import { restampForHeartbeatHost } from './realtime-input.js';

const SEAT = playerId('seat-1');

function makeEnvelope(tick: number): ActionEnvelope {
    return {
        type: 'game:steer',
        playerId: SEAT,
        tick,
        payload: { dx: 1, dy: 0 },
    };
}

describe('restampForHeartbeatHost', () => {
    it('re-stamps a stale envelope with the host tick on a heartbeat-driven host', () => {
        const stale = makeEnvelope(7);

        const applied = restampForHeartbeatHost(stale, { heartbeatDriven: true, hostTick: 12 });

        expect(applied.tick).toBe(12);
        // Only the tick moves: the action, its seat and its payload are the
        // sender's, verbatim.
        expect(applied).toEqual({ ...stale, tick: 12 });
        expect(applied.payload).toBe(stale.payload);
    });

    it('re-stamps an envelope stamped AHEAD of the host tick too', () => {
        // The rule is "applied at the beat it arrives on", not "late envelopes
        // catch up": a stamp from the future is no more a reason to refuse an
        // intent than a stamp from the past.
        const ahead = makeEnvelope(40);

        expect(restampForHeartbeatHost(ahead, { heartbeatDriven: true, hostTick: 12 }).tick).toBe(
            12,
        );
    });

    it('does not mutate the envelope it re-stamps', () => {
        const stale = makeEnvelope(7);

        restampForHeartbeatHost(stale, { heartbeatDriven: true, hostTick: 12 });

        expect(stale.tick).toBe(7);
    });

    it('returns the input reference when the stamp is already the host tick', () => {
        const current = makeEnvelope(12);

        expect(restampForHeartbeatHost(current, { heartbeatDriven: true, hostTick: 12 })).toBe(
            current,
        );
    });

    it('returns a stale envelope untouched on a turn-based host', () => {
        // Where the clock moves only when someone acts, a stale tick means the
        // sender acted on a state that no longer exists — the pipeline's
        // refusal is right, and this helper must leave it reachable.
        const stale = makeEnvelope(7);

        const applied = restampForHeartbeatHost(stale, { heartbeatDriven: false, hostTick: 12 });

        expect(applied).toBe(stale);
        expect(applied.tick).toBe(7);
    });
});
