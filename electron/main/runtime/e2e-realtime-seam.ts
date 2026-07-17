/**
 * electron/main/runtime/e2e-realtime-seam.ts
 *
 * E2E-only seam that forces a live wall-clock {@link RealtimeTicker} onto a host
 * whose manifest is turn-based. Tactics — the only game wired for e2e — is
 * `realtime: false`, so `resolveTickerHz` returns null and no Playwright e2e
 * ever exercises the real-time engine-tick heartbeat (its autonomous firing and
 * its broadcast to clients). This seam lets the heartbeat spec opt one host into
 * a live ticker via `CHIMERA_E2E_REALTIME_TICK_MS`.
 *
 * It is deliberately double-gated and production-inert: it fires ONLY when
 * `CHIMERA_E2E === '1'` (never set outside e2e) AND an explicit, valid tick
 * interval is declared. Every other case returns null, so the caller falls back
 * to the manifest's `resolveTickerHz` and production behaviour is unchanged.
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 */

/**
 * Resolve an e2e-forced ticker frequency (Hz) from the environment, mirroring
 * `resolveTickerHz`'s `1000 / tickRateMs` conversion. Returns null unless e2e is
 * active and `CHIMERA_E2E_REALTIME_TICK_MS` is a finite positive number.
 */
export function resolveE2eForcedTickerHz(env: NodeJS.ProcessEnv): number | null {
    if (env['CHIMERA_E2E'] !== '1') {
        return null;
    }
    const raw = env['CHIMERA_E2E_REALTIME_TICK_MS'];
    if (raw === undefined) {
        return null;
    }
    const tickRateMs = Number(raw);
    if (!Number.isFinite(tickRateMs) || tickRateMs <= 0) {
        return null;
    }
    return 1000 / tickRateMs;
}
