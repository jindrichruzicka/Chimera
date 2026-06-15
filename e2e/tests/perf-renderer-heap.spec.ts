/**
 * F49 / #715 — perf-renderer-heap.spec.ts
 * §13.4 Memory baseline — renderer heap ≤ 32 MB during an active match.
 *
 * Establishes the renderer-heap baseline by driving a real Tactics match through
 * ~1 000 authoritative ticks and reading `performance.memory.usedJSHeapSize` the
 * same way `perfStore.readHeapMb()` (and therefore the PerfHud) does — so the
 * gate and the HUD never disagree.
 *
 * Gating policy (decided for F49): strict locally / under `CHIMERA_PERF_STRICT=1`,
 * informational on CI. The measured heap is always logged so the baseline is
 * visible on every run. Replay-playback heap is covered by an additional
 * assertion in replay.spec.ts (which already owns the record→play flow).
 *
 * Invariant #42: the tick driver advances the clock through the real
 * ActionPipeline; it never injects state.
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';
import { tick } from '../helpers/tick-driver';
import { getSimulationTick } from '../helpers/ipc-spy';
// §13.4 — the single source of truth. Imported by relative path (not the
// @chimera/* alias, which the Playwright spec runner does not resolve) so the
// gate and the canonical budget can never drift; shared/perf-budget.test.ts
// locks the canonical value.
import { RENDERER_HEAP_BUDGET_MB } from '../../shared/perf-budget';

const TICKS_TO_DRIVE = 1000;

/** Hard-assert locally or when opted in; informational (logged) on CI. */
const STRICT = process.env['CHIMERA_PERF_STRICT'] === '1' || process.env['CI'] === undefined;

// This spec only exercises the host window; no client process is needed.
test.use({ passAndPlay: true });

/** Read the renderer heap in MB exactly as perfStore.readHeapMb() does. */
async function readHeapMb(window: Page): Promise<number | null> {
    return window.evaluate(() => {
        const mem = (performance as unknown as Record<string, unknown>)['memory'] as
            | { usedJSHeapSize: number }
            | undefined;
        if (mem === undefined || typeof mem.usedJSHeapSize !== 'number') {
            return null;
        }
        return mem.usedJSHeapSize / (1024 * 1024);
    });
}

/** Median of several samples — absorbs GC sawtooth without needing --expose-gc. */
async function sampleMedianHeapMb(window: Page, samples = 5): Promise<number | null> {
    const readings: number[] = [];
    for (let i = 0; i < samples; i += 1) {
        const mb = await readHeapMb(window);
        if (mb !== null) {
            readings.push(mb);
        }
        await window.waitForTimeout(300);
    }
    if (readings.length === 0) {
        return null;
    }
    readings.sort((a, b) => a - b);
    return readings[Math.floor(readings.length / 2)] ?? null;
}

test.describe('Renderer heap baseline (§13.4)', () => {
    test('stays within budget during an active match', async ({ hostApp, hostWindow }) => {
        const game = new GamePage(hostWindow);
        await expect(game.canvas).toBeVisible();

        const before = await getSimulationTick(hostApp);
        await tick(hostApp, TICKS_TO_DRIVE);
        await expect
            .poll(() => getSimulationTick(hostApp), { timeout: 30_000 })
            .toBeGreaterThan(before);

        const medianMb = await sampleMedianHeapMb(hostWindow);

        console.log(
            `[perf] renderer heap (live match, +${TICKS_TO_DRIVE} ticks): ` +
                `${medianMb === null ? 'unavailable' : `${medianMb.toFixed(1)}MB`} ` +
                `(budget ${RENDERER_HEAP_BUDGET_MB}MB, strict=${STRICT})`,
        );

        test.skip(medianMb === null, 'performance.memory unavailable in this Chromium build');

        const label = `renderer heap ${(medianMb ?? 0).toFixed(1)}MB ≤ ${RENDERER_HEAP_BUDGET_MB}MB`;
        if (STRICT) {
            expect(medianMb ?? Infinity, label).toBeLessThanOrEqual(RENDERER_HEAP_BUDGET_MB);
        } else {
            if ((medianMb ?? Infinity) > RENDERER_HEAP_BUDGET_MB) {
                console.warn(`[perf][CI-informational] ${label} exceeded`);
            }
            expect.soft(medianMb ?? Infinity, label).toBeLessThanOrEqual(RENDERER_HEAP_BUDGET_MB);
        }
    });
});
