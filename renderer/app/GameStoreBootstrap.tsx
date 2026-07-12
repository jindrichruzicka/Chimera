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
 * and the current path is /lobby — or /saves for a completed session restore
 * — navigates to /game. This drives the CLIENT window's navigation without
 * requiring a snapshot subscription in lobby/page or saves/page.
 *
 * Architecture reference: §4.4 — Renderer State Stores;
 *                         §6  — simulation/prediction · Client Prediction
 *
 * Invariants upheld:
 *   #1  — Only PlayerSnapshot (never GameSnapshot) crosses the IPC boundary.
 *   #4  — addPrediction / confirmPrediction are called only via ipcClient
 *          (bootstrapGameStore wires this); components never call them.
 */

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { StoreApi } from 'zustand';
import { bootstrapGameStore } from '../state/gameStoreBootstrap';
import { useGameStore, type GameStore } from '../state/gameStore';
import { useLobbyUiStore } from '../state/lobbyUiStore';
import { useOptionalFade } from '../components/shell/FadeContext.js';
import { screenFadeMs } from '../components/shell/screenFadeDuration.js';
import { resolveShellGameId, withShellGameId } from '../shell/resolveMainMenuGameId';
import { bootstrapPerfStore } from '../components/shell/perf/perfStoreBootstrap.js';
import { usePerfStore, type PerfStoreState } from '../components/shell/perf/perfStore.js';
import type { GameAPI, LobbyAPI } from '@chimera-engine/simulation/bridge/api-types.js';

export function GameStoreBootstrap(): null {
    const router = useRouter();
    const pathname = usePathname();
    const snapshot = useGameStore((state) => state.snapshot);
    // App-level screen fade. Kept in a ref so the navigation effects don't
    // re-run on the per-frame opacity changes; `useOptionalFade` degrades to
    // instant (no-fade) navigation when rendered without the provider (tests).
    const fade = useOptionalFade();
    const fadeRef = useRef(fade);
    fadeRef.current = fade;
    // Shared latch across BOTH navigation effects below: once a lobby⇄game
    // transition starts, it owns the fade-out and the navigation, and the other
    // effect (and re-runs of this one during the async fade) must stand down.
    // This also prevents the effect-B reset()→snapshot-null→effect-A bounce.
    const transitioningRef = useRef(false);

    useEffect(() => {
        return () => {
            transitioningRef.current = false;
        };
    }, []);

    // Navigate to /game when a snapshot arrives on the lobby page — fading out to
    // black first. This is the SOLE owner of the lobby→game transition for both
    // windows: the host's handleStartGame() only calls startGame() and lets this
    // fire when the snapshot lands, so the fade-out runs to completion uncontested
    // (a second fade-out from the lobby would cancel this one and skip the fade).
    //
    // /saves joins the gate for session restore: the saves page issues
    // load() and stays put; when the restored match snapshot lands, this effect
    // carries the host (and single-player loads) into /game. Restricted to
    // non-'lobby' phases there so a return-to-lobby broadcast cannot bounce
    // /saves through /game into the reverse effect's reset() below.
    useEffect(() => {
        const browserPath = currentBrowserPathname(pathname);
        if (
            snapshot === null ||
            !(
                isLobbyPath(browserPath) ||
                (isSavesPath(browserPath) && snapshot.phase !== 'lobby')
            ) ||
            transitioningRef.current
        ) {
            return;
        }
        transitioningRef.current = true;
        const go = (): void => {
            router.push(withShellGameId('/game', currentBrowserGameId()));
            transitioningRef.current = false;
        };
        const control = fadeRef.current;
        if (control === null) {
            go();
        } else {
            void control.fadeOut(screenFadeMs()).then(go);
        }
    }, [snapshot, router, pathname]);

    // Symmetric reverse of the /lobby → /game redirect above: when a
    // phase:'lobby' snapshot arrives on /game (host return-to-lobby plus every
    // following client — both receive the broadcast lobby snapshot), drop
    // the stale match snapshot and return to /lobby. Reset first so the
    // /lobby → /game effect above does not immediately bounce back to /game on
    // /lobby. Invariant #1: only PlayerSnapshot.phase drives this decision.
    //
    // The replay player route is included alongside /game: a post-game replay is
    // opened from the live match's summary while the session is still alive, so
    // its Leave (host returnToLobby) also broadcasts a phase:'lobby' snapshot.
    // Without this, the host's return-to-lobby fires the IPC but nothing
    // navigates — the leave silently does nothing from the replay player.
    useEffect(() => {
        const browserPath = currentBrowserPathname(pathname);
        if (
            snapshot?.phase !== 'lobby' ||
            !(isGamePath(browserPath) || isReplayPlayerPath(browserPath)) ||
            transitioningRef.current
        ) {
            return;
        }
        transitioningRef.current = true;
        // Fade out FIRST, then reset (nulls the snapshot → GameShell unmounts) and
        // navigate. Doing reset() under the fully-black overlay hides the unmount.
        const go = (): void => {
            useGameStore.getState().reset();
            router.push(withShellGameId('/lobby', currentBrowserGameId()));
            transitioningRef.current = false;
        };
        const control = fadeRef.current;
        if (control === null) {
            go();
        } else {
            void control.fadeOut(screenFadeMs()).then(go);
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
        const stopPerfBootstrap = bootstrapPerfStore(
            useGameStore as unknown as StoreApi<GameStore>,
            usePerfStore as unknown as StoreApi<PerfStoreState>,
        );

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
            stopPerfBootstrap();
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

function isGamePath(pathname: string | null): boolean {
    return pathname === '/game' || pathname === '/game/' || pathname === '/game/index.html';
}

function isSavesPath(pathname: string | null): boolean {
    return pathname === '/saves' || pathname === '/saves/' || pathname === '/saves/index.html';
}

function isReplayPlayerPath(pathname: string | null): boolean {
    return (
        pathname === '/replays/player' ||
        pathname === '/replays/player/' ||
        pathname === '/replays/player/index.html'
    );
}

function currentBrowserPathname(pathname: string | null): string | null {
    if (typeof window === 'undefined') {
        return pathname;
    }

    return window.location.pathname;
}

// The active game id from the live URL — `withShellGameId` carries it onto the
// /lobby ⇄ /game hops so the game's shell (incl. the main-menu override) keeps
// resolving after the match. Returns null off-window or when no game is selected.
function currentBrowserGameId(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    return resolveShellGameId(new URLSearchParams(window.location.search));
}
