/**
 * electron/main/runtime/realtime-input.test.ts
 *
 * Unit tests for `envelopeToApply` — the envelope a host applies for a
 * player action it received. On a heartbeat-driven host the ticker advances
 * `tick` on its own, so the tick a sender stamped is behind by the time the
 * envelope arrives; the helper re-stamps it with the host's current tick. On a
 * turn-based host it returns the envelope untouched, so the pipeline's
 * `StaleActionError` stays reachable there — except for
 * `engine:sync_request`, which it re-stamps on every host.
 */

import { describe, expect, it } from 'vitest';
import type { ActionEnvelope } from '@chimera-engine/simulation/engine/types.js';
import { playerId } from '@chimera-engine/simulation/engine/types.js';
import { envelopeToApply } from './realtime-input.js';

const SEAT = playerId('seat-1');

function makeEnvelope(tick: number): ActionEnvelope {
    return {
        type: 'game:steer',
        playerId: SEAT,
        tick,
        payload: { dx: 1, dy: 0 },
    };
}

describe('envelopeToApply', () => {
    it('re-stamps a stale envelope with the host tick on a heartbeat-driven host', () => {
        const stale = makeEnvelope(7);

        const applied = envelopeToApply(stale, { heartbeatDriven: true, hostTick: 12 });

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

        expect(envelopeToApply(ahead, { heartbeatDriven: true, hostTick: 12 }).tick).toBe(12);
    });

    it('does not mutate the envelope it re-stamps', () => {
        const stale = makeEnvelope(7);

        envelopeToApply(stale, { heartbeatDriven: true, hostTick: 12 });

        expect(stale.tick).toBe(7);
    });

    it('returns the input reference when the stamp is already the host tick', () => {
        const current = makeEnvelope(12);

        expect(envelopeToApply(current, { heartbeatDriven: true, hostTick: 12 })).toBe(current);
    });

    it('returns a stale envelope untouched on a turn-based host', () => {
        // Where the clock moves only when someone acts, a stale tick means the
        // sender acted on a state that no longer exists — the pipeline's
        // refusal is right, and this helper must leave it reachable.
        const stale = makeEnvelope(7);

        const applied = envelopeToApply(stale, { heartbeatDriven: false, hostTick: 12 });

        expect(applied).toBe(stale);
        expect(applied.tick).toBe(7);
    });

    it('returns a stale engine action untouched on a turn-based host', () => {
        // The exemption below is `engine:sync_request`, not the `engine:`
        // namespace: a stale end-turn still ends a turn that is no longer the
        // one its sender saw.
        const staleEndTurn: ActionEnvelope = {
            type: 'engine:end_turn',
            playerId: SEAT,
            tick: 7,
            payload: {},
        };

        expect(envelopeToApply(staleEndTurn, { heartbeatDriven: false, hostTick: 12 })).toBe(
            staleEndTurn,
        );
    });

    describe('engine:sync_request', () => {
        function makeSyncRequest(tick: number): ActionEnvelope {
            return { type: 'engine:sync_request', playerId: SEAT, tick, payload: {} };
        }

        it('re-stamps a stale sync request with the host tick on a turn-based host', () => {
            // Its sender stamps the tick it last HOLDS, which need not be the
            // host's.
            const stale = makeSyncRequest(7);

            const applied = envelopeToApply(stale, { heartbeatDriven: false, hostTick: 12 });

            expect(applied).toEqual({ ...stale, tick: 12 });
            expect(applied.payload).toBe(stale.payload);
            expect(stale.tick).toBe(7);
        });

        it('re-stamps a sync request stamped ahead of the host tick on a turn-based host', () => {
            const ahead = makeSyncRequest(40);

            expect(envelopeToApply(ahead, { heartbeatDriven: false, hostTick: 12 }).tick).toBe(12);
        });

        it('returns a sync request already at the host tick as is on a turn-based host', () => {
            const current = makeSyncRequest(12);

            expect(envelopeToApply(current, { heartbeatDriven: false, hostTick: 12 })).toBe(
                current,
            );
        });
    });
});
