/**
 * electron/main/runtime/e2e-realtime-seam.test.ts
 *
 * Unit tests for the e2e-only real-time seam. `resolveE2eForcedTickerHz` lets
 * the heartbeat e2e spec force a live `RealtimeTicker` onto the (turn-based)
 * tactics host — the only game wired for e2e — so the wall-clock engine-tick
 * loop and its broadcast path get end-to-end coverage. The seam MUST be inert
 * outside e2e: it is double-gated on `CHIMERA_E2E === '1'` AND an explicit,
 * valid `CHIMERA_E2E_REALTIME_TICK_MS`, and returns null (⇒ the caller falls
 * back to the manifest's `resolveTickerHz`) in every other case.
 */

import { describe, expect, it } from 'vitest';
import { resolveE2eForcedTickerHz } from './e2e-realtime-seam.js';

describe('resolveE2eForcedTickerHz', () => {
    it('converts a valid tick interval to Hz when e2e is active', () => {
        // 50ms → 20 Hz (mirrors resolveTickerHz's 1000 / tickRateMs).
        expect(
            resolveE2eForcedTickerHz({
                CHIMERA_E2E: '1',
                CHIMERA_E2E_REALTIME_TICK_MS: '50',
            }),
        ).toBe(20);
    });

    it('returns null when e2e is not active even if the interval is set (production-inert)', () => {
        expect(
            resolveE2eForcedTickerHz({
                CHIMERA_E2E_REALTIME_TICK_MS: '50',
            }),
        ).toBeNull();
        expect(
            resolveE2eForcedTickerHz({
                CHIMERA_E2E: '0',
                CHIMERA_E2E_REALTIME_TICK_MS: '50',
            }),
        ).toBeNull();
    });

    it('returns null when e2e is active but no interval is declared', () => {
        expect(resolveE2eForcedTickerHz({ CHIMERA_E2E: '1' })).toBeNull();
    });

    it('returns null for a non-positive interval', () => {
        expect(
            resolveE2eForcedTickerHz({ CHIMERA_E2E: '1', CHIMERA_E2E_REALTIME_TICK_MS: '0' }),
        ).toBeNull();
        expect(
            resolveE2eForcedTickerHz({ CHIMERA_E2E: '1', CHIMERA_E2E_REALTIME_TICK_MS: '-10' }),
        ).toBeNull();
    });

    it('returns null for a non-numeric or non-finite interval', () => {
        expect(
            resolveE2eForcedTickerHz({ CHIMERA_E2E: '1', CHIMERA_E2E_REALTIME_TICK_MS: 'abc' }),
        ).toBeNull();
        expect(
            resolveE2eForcedTickerHz({ CHIMERA_E2E: '1', CHIMERA_E2E_REALTIME_TICK_MS: '' }),
        ).toBeNull();
        expect(
            resolveE2eForcedTickerHz({
                CHIMERA_E2E: '1',
                CHIMERA_E2E_REALTIME_TICK_MS: 'Infinity',
            }),
        ).toBeNull();
    });
});
