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
 * Also handles automatic navigation: when a snapshot arrives (game started)
 * and the current path is /lobby, navigates to /game. This drives the CLIENT
 * window's navigation without requiring a snapshot subscription in lobby/page.
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
import { usePathname, useRouter } from 'next/navigation';
import { bootstrapGameStore } from '../state/gameStoreBootstrap';
import { useGameStore } from '../state/gameStore';
import { useLobbyUiStore } from '../state/lobbyUiStore';
import type { GameAPI, LobbyAPI } from '@chimera/electron/preload/api-types.js';

export function GameStoreBootstrap(): null {
    const router = useRouter();
    const pathname = usePathname();
    const snapshot = useGameStore((state) => state.snapshot);

    // Navigate to /game when a snapshot arrives on the lobby page.
    // This handles the CLIENT window — the host navigates via router.push in
    // handleStartGame(). Both end up at /game automatically.
    useEffect(() => {
        if (snapshot !== null && isLobbyPath(currentBrowserPathname(pathname))) {
            router.push('/game');
        }
    }, [snapshot, router, pathname]);

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

    // Populate localPlayerId without the lobby page when direct-game E2E
    // boots the renderer directly on /game (or any route that bypasses the
    // lobby flow). Safe to call unconditionally — it skips if the store is
    // already populated, and returns null outside of a live session.
    useEffect(() => {
        const chimera = (globalThis as { __chimera?: { lobby: LobbyAPI } }).__chimera;
        if (!chimera?.lobby) return;
        if (useLobbyUiStore.getState().localPlayerId !== null) return;

        void chimera.lobby.getLocalPlayerId().then((pid) => {
            if (pid !== null && useLobbyUiStore.getState().localPlayerId === null) {
                useLobbyUiStore.getState().setLocalLobbyContext(pid, [pid]);
            }
        });
    }, []);

    return null;
}

function isLobbyPath(pathname: string | null): boolean {
    return pathname === '/lobby' || pathname === '/lobby/' || pathname === '/lobby/index.html';
}

function currentBrowserPathname(pathname: string | null): string | null {
    if (typeof window === 'undefined') {
        return pathname;
    }

    return window.location.pathname;
}
