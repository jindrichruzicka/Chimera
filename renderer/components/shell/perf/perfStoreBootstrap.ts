import type { StoreApi } from 'zustand';

import type { GameStore } from '@chimera/renderer/state/gameStore.js';
import type { PerfStoreState } from './perfStore.js';

export function bootstrapPerfStore(
    gameStore: StoreApi<GameStore>,
    perfStore: StoreApi<PerfStoreState>,
    now: () => number = () => performance.now(),
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

    const heapIntervalId = globalThis.setInterval(() => {
        perfStore.getState().sampleHeap();
    }, 1000);

    return () => {
        unsubscribeGameStore();
        globalThis.clearInterval(heapIntervalId);
    };
}
