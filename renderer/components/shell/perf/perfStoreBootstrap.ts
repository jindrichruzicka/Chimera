import type { StoreApi } from 'zustand';

import type { HostPerfMetrics, Unsubscribe } from '@chimera-engine/simulation/bridge/api-types.js';

import type { GameStore } from '../../../state/gameStore.js';
import type { PerfStoreState } from './perfStore.js';

/**
 * The one bridge method this bootstrap needs. Narrowed to a port rather than
 * reaching for `window.__chimera` so the wiring is testable without a preload,
 * and absent whenever the bridge is (SSR, an e2e page without the namespace).
 */
export type HostMetricsPort = ((cb: (metrics: HostPerfMetrics) => void) => Unsubscribe) | undefined;

/** The bridge's `game.onHostMetrics`, or `undefined` where no bridge exists. */
function resolveHostMetricsPort(): HostMetricsPort {
    const game = (globalThis as { __chimera?: { game?: { onHostMetrics?: unknown } } }).__chimera
        ?.game;
    const onHostMetrics = game?.onHostMetrics;
    return typeof onHostMetrics === 'function'
        ? (onHostMetrics.bind(game) as NonNullable<HostMetricsPort>)
        : undefined;
}

export function bootstrapPerfStore(
    gameStore: StoreApi<GameStore>,
    perfStore: StoreApi<PerfStoreState>,
    now: () => number = () => performance.now(),
    onHostMetrics: HostMetricsPort = resolveHostMetricsPort(),
): () => void {
    const syncFromGameState = (state: GameStore): void => {
        perfStore.getState().setSimTick(state.currentTick);
        perfStore.getState().setPingMs(state.latencyMs > 0 ? state.latencyMs : null);
    };

    syncFromGameState(gameStore.getState());

    const unsubscribeGameStore = gameStore.subscribe((state, prevState) => {
        if (state.currentTick !== prevState.currentTick) {
            perfStore.getState().setSimTick(state.currentTick);
        }

        if (state.latencyMs !== prevState.latencyMs) {
            perfStore.getState().setPingMs(state.latencyMs > 0 ? state.latencyMs : null);
        }

        const currentSnapshot = state.snapshot;
        const previousSnapshot = prevState.snapshot;
        if (currentSnapshot !== null && currentSnapshot.tick !== previousSnapshot?.tick) {
            perfStore.getState().recordSnapshotReceived(currentSnapshot.tick, now());
        }
    });

    const perfIntervalId = globalThis.setInterval(() => {
        perfStore.getState().sampleHeap();
        perfStore.getState().prunePerfWindows();
    }, 1000);

    // The host owns this cadence: the push arrives on main's own low-rate timer,
    // so there is no interval here to keep in step with it. Absent bridge ⇒ the
    // two host fields stay null and the HUD renders them as unavailable.
    const unsubscribeHostMetrics = onHostMetrics?.((metrics) => {
        perfStore.getState().setHostMetrics(metrics);
    });

    return () => {
        unsubscribeGameStore();
        globalThis.clearInterval(perfIntervalId);
        unsubscribeHostMetrics?.();
    };
}
