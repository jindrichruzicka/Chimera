'use client';

/**
 * renderer/app/GameStoreBootstrap.tsx
 *
 * Thin client component that wires the chimera:game:snapshot push channel
 * into the gameStore on mount. Renders nothing.
 *
 * Registers the IPC onSnapshot listener so that incoming PlayerSnapshot
 * pushes from the main process are routed into gameStore via
 * `applySnapshot`.
 *
 * Also handles automatic navigation: when a snapshot arrives (game started) on
 * a surface in the entry allow-set — `lobby`, `saves`, `main-menu` or a game
 * page (see `entersMatchFromSurface`) — navigates to /game. This drives the
 * CLIENT window's navigation without requiring a snapshot subscription in the
 * pages themselves.
 *
 * It classifies no routes of its own (§4.37.18): the surface and the game
 * context both come from the shell-state store, which `ShellStateBridge`
 * publishes, and both navigations ARM the store's transition so a game's
 * background can move on the same fade this effect runs.
 *
 * Architecture reference: §4.4 — Renderer State Stores
 *
 * Invariants upheld:
 *   #3  — Only PlayerSnapshot (never GameSnapshot) crosses the IPC boundary.
 *   #4  — The renderer reads state and never writes it directly: components
 *          never call the store's `apply*` methods.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { StoreApi } from 'zustand';
import { bootstrapGameStore } from '../state/gameStoreBootstrap';
import { useGameStore, type GameStore } from '../state/gameStore';
import { useLobbyUiStore } from '../state/lobbyUiStore';
import { useOptionalFade } from '../components/shell/FadeContext.js';
import { screenFadeMs } from '../components/shell/screenFadeDuration.js';
import { withShellGameId } from '../shell/resolveMainMenuGameId';
import { armShellTransition, useShellState, type ShellSurface } from '../shell/shellStateStore';
import { bootstrapPerfStore } from '../components/shell/perf/perfStoreBootstrap.js';
import { usePerfStore, type PerfStoreState } from '../components/shell/perf/perfStore.js';
import type {
    GameAPI,
    LobbyAPI,
    PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';

export function GameStoreBootstrap(): null {
    const router = useRouter();
    const surface = useShellState((state) => state.surface);
    const gameId = useShellState((state) => state.gameId);
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
    //
    // /main-menu and the game's declared shell pages join it on the same terms
    // (§4.37.17): a match can now be born from a menu verb (`start-game`,
    // `continue`) or from a game-owned page, and without them the session starts
    // and the player is left staring at the screen that started it.
    //
    // The `page` surface arrives ASYNCHRONOUSLY (the declaration behind it is a
    // shell payload), so `surface` is a dependency of this effect rather than a
    // value read once: a reload straight onto a game page can deliver the
    // snapshot before the declaration is known, and re-evaluating when the
    // bridge re-publishes is what carries the player into the match instead of
    // stranding them there.
    useEffect(() => {
        if (
            snapshot === null ||
            !entersMatchFromSurface(surface, snapshot.phase) ||
            transitioningRef.current
        ) {
            return;
        }
        transitioningRef.current = true;
        const durationMs = screenFadeMs();
        // Armed HERE, before the fade, not after it: a background timing a
        // dolly-in on `transition.durationMs` needs the whole fade to move in.
        // The store clears it when the match surface lands.
        armShellTransition({ kind: 'to-match', durationMs });
        const go = (): void => {
            router.push(withShellGameId('/game', gameId));
            transitioningRef.current = false;
        };
        const control = fadeRef.current;
        if (control === null) {
            go();
        } else {
            void control.fadeOut(durationMs).then(go);
        }
    }, [snapshot, router, surface, gameId]);

    // Symmetric reverse of the /lobby → /game redirect above: when a
    // phase:'lobby' snapshot arrives on /game (host return-to-lobby plus every
    // following client — both receive the broadcast lobby snapshot), drop
    // the stale match snapshot and return to /lobby. Reset first so the
    // /lobby → /game effect above does not immediately bounce back to /game on
    // /lobby. Invariant #1: only PlayerSnapshot.phase drives this decision.
    //
    // The replay player route is included alongside /game: a post-game replay is
    // opened from the live match's summary while the session is still alive, so a
    // phase:'lobby' snapshot can land there too. Without this, the IPC that
    // produced it fires and nothing navigates — the leave silently does nothing
    // from the replay player.
    useEffect(() => {
        if (
            snapshot?.phase !== 'lobby' ||
            !LEAVES_MATCH_SURFACES.has(surface) ||
            transitioningRef.current
        ) {
            return;
        }
        transitioningRef.current = true;
        const durationMs = screenFadeMs();
        armShellTransition({ kind: 'to-shell', durationMs });
        // Fade out FIRST, then reset (nulls the snapshot → GameShell unmounts) and
        // navigate. Doing reset() under the fully-black overlay hides the unmount.
        const go = (): void => {
            useGameStore.getState().reset();
            router.push(withShellGameId('/lobby', gameId));
            transitioningRef.current = false;
        };
        const control = fadeRef.current;
        if (control === null) {
            go();
        } else {
            void control.fadeOut(durationMs).then(go);
        }
    }, [snapshot, router, surface, gameId]);

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

/**
 * The surfaces the reverse hop acts on: the match itself, and the replay
 * PLAYER — a post-game replay is opened from the live match's summary while the
 * session is still alive, so a phase:'lobby' snapshot can land there too.
 * Without it the IPC that produced it fires and nothing navigates.
 *
 * The replay BROWSER is deliberately not a member: it is reached from the menu,
 * with no match behind it.
 */
const LEAVES_MATCH_SURFACES: ReadonlySet<ShellSurface> = new Set<ShellSurface>([
    'match',
    'replay-player',
]);

/**
 * The allow-set the snapshot → /game hop gates on, as an enumerated union
 * rather than "every surface except match" (§4.37.17). A deny-list would drag
 * every present and future surface — the engine developer routes, a game's own
 * undeclared pages — into a hop none of them asked for; an allow-set only ever
 * admits a surface someone named.
 *
 * `lobby` is admitted on ANY phase: it is the route the lobby⇄game pair is
 * built around, and its own snapshot is what starts the match. Every other
 * member additionally requires a non-'lobby' phase, so a return-to-lobby
 * broadcast cannot bounce a menu, a saves browser or a game page through /game
 * into the reverse effect's reset().
 */
function entersMatchFromSurface(surface: ShellSurface, phase: PlayerSnapshot['phase']): boolean {
    if (surface === 'lobby') {
        return true;
    }

    if (phase === 'lobby') {
        return false;
    }

    return surface === 'saves' || surface === 'main-menu' || surface === 'page';
}
