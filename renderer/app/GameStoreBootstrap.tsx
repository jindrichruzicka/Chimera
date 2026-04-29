'use client';

/**
 * renderer/app/GameStoreBootstrap.tsx
 *
 * Thin client component that wires the chimera:game:snapshot push channel
 * into the gameStore on mount. Renders nothing.
 *
 * Registers the IPC onSnapshot listener so that incoming PlayerSnapshot
 * pushes from the main process are routed into gameStore via
 * `confirmPrediction` + `applySnapshot`.
 *
 * Architecture reference: §4.4 — Renderer State Stores;
 *                         §6  — simulation/prediction · Client Prediction (F17)
 *
 * Invariants upheld:
 *   #1  — Only PlayerSnapshot (never GameSnapshot) crosses the IPC boundary.
 *   #4  — addPrediction / confirmPrediction are called only via ipcClient
 *          (bootstrapGameStore wires this); components never call them.
 */

import { useEffect } from 'react';
import { bootstrapGameStore } from '../state/gameStoreBootstrap';
import type { GameAPI } from '../../electron/preload/api-types';

export function GameStoreBootstrap(): null {
    useEffect(() => {
        const chimera = (globalThis as { __chimera?: { game: GameAPI } }).__chimera;
        if (!chimera?.game) return;

        // Track whether the component unmounted before the async bootstrap resolved.
        // If so, immediately call the returned unsubscribe so no dangling listener
        // accumulates against the already-unmounted store.
        let cancelled = false;
        let cleanup: (() => void) | undefined;

        void bootstrapGameStore(chimera.game).then((unsubscribe) => {
            if (cancelled) {
                unsubscribe();
            } else {
                cleanup = unsubscribe;
            }
        });

        return () => {
            cancelled = true;
            cleanup?.();
        };
    }, []);

    return null;
}
