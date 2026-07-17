/**
 * Real-time heartbeat — end-to-end.
 * §13 E2E Testing (Playwright) · §4.2.1 Action-Driven Clock
 *
 * Proves the engine's wall-clock heartbeat — the host-side `RealtimeTicker` that
 * dispatches `engine:tick` at the manifest's `tickRateMs` — actually drives a
 * live match and reaches clients. Tactics is the only game wired for e2e and it
 * is turn-based (`realtime: false`), so `resolveTickerHz` returns null and no
 * other spec ever starts a live ticker: its autonomous firing and its broadcast
 * path had zero end-to-end coverage. The `realtimeTickMs` fixture option flips
 * an e2e-only seam (`CHIMERA_E2E_REALTIME_TICK_MS`) that forces the host to run
 * a real ticker for this file only, without touching tactics' real manifest.
 *
 * Two-human host + client (no AI seat) so the ONLY thing that can advance state
 * is the heartbeat — `afterTick → tickAll` has no agent to pump and the test
 * never dispatches a player action. The climbing tick therefore isolates the
 * ticker as its cause.
 *
 * Probe choice — the authoritative main-process clock, not the renderer.
 * A pure idle `engine:tick` does not change the projected board, so the host
 * broadcasts a lightweight clock-only frame (StateBroadcaster.broadcastTick),
 * NOT a full snapshot wave. That advances each process's `__e2eHooks.currentTick`
 * — on the host via `onClockTick`, on the client via `onClientTickReceived →
 * onClockTick` — but it does NOT refresh the cached `PlayerSnapshot` the renderer
 * exposes through `getCurrentSnapshot()`. So the spec reads `getSimulationTick()`
 * (the `__e2eHooks.currentTick` truth), not `GamePage.currentTick()`.
 *
 * Invariant #42 upheld: the ticker advances the clock THROUGH the pipeline
 * (`applyAction`/`processAction`), never by poking `snapshot.tick`. Because the
 * host broadcasts each tick to every viewer, the client's received clock climbs
 * too — proving the heartbeat reaches a remote peer.
 *
 * Dedicated port: no other spec binds it, so the two processes never contend
 * with a concurrently-scheduled fixture spec on the shared 7779 under
 * `workers: 2`. The ticker is a MAIN-process `setInterval` (Node), which is not
 * subject to the renderer background-throttling that freezes occluded-window
 * timers — so it fires normally even while the windows are backgrounded.
 *
 * Ticker start/stop lifecycle is covered deterministically by the unit suite
 * (RealtimeTicker.test.ts); this spec owns the autonomous-firing + broadcast
 * proof that unit tests cannot give.
 */

import { test, expect } from '../fixtures/direct-game.fixture';
import { getSimulationTick } from '../helpers/ipc-spy';

// 50ms → 20 Hz. `engine:tick` does not trigger autosave (that fires only after
// engine:end_turn), so a fast interval causes no disk churn. Several ticks
// accrue in a few hundred ms; the assertions keep a generous budget for slow CI.
test.use({ port: '7794', realtimeTickMs: 50 });

// Small, unambiguous margin: proving the clock climbs by several steps with no
// player action is enough to isolate the heartbeat as its driver.
const TICK_ADVANCE = 5;

test.describe('Real-time heartbeat', () => {
    test('advances the simulation on the wall clock with no player action, and broadcasts to the client', async ({
        hostApp,
        clientApp,
    }) => {
        // Baseline the moment the match is live (the direct-game `_gameStarted`
        // fixture already waited for both canvases, so the ticker has started).
        const hostBaseline = await getSimulationTick(hostApp);

        // The host clock climbs on its own — no move, no end-turn — proving the
        // wall-clock heartbeat drives the pipeline autonomously.
        await expect
            .poll(() => getSimulationTick(hostApp), {
                timeout: 15_000,
                message: 'host clock should advance autonomously under the real-time heartbeat',
            })
            .toBeGreaterThanOrEqual(hostBaseline + TICK_ADVANCE);

        // The ticked frames reach the joined client (onClientTickReceived), so
        // the client's received clock advances past its own baseline too —
        // proving the heartbeat broadcasts to a remote peer.
        const clientBaseline = await getSimulationTick(clientApp);
        await expect
            .poll(() => getSimulationTick(clientApp), {
                timeout: 15_000,
                message: 'client should receive the broadcast heartbeat ticks',
            })
            .toBeGreaterThanOrEqual(clientBaseline + TICK_ADVANCE);
    });
});
