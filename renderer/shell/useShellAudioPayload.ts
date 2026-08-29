'use client';

// renderer/shell/useShellAudioPayload.ts
//
// The ONE resolution of what the active game contributes as its shell AUDIO
// (§4.25): the inventory a shell-scoped `AssetManager` is built over, and the
// optional menu bed the engine plays across the shell screens.
//
// Split from `useShellBackgroundPayload` rather than folded into it because the
// two answer for different surface sets and have different lifetimes — the bed
// plays on `/saves` and `/replays`, where no background mounts — and because a
// game may declare either one alone.
//
// It classifies nothing: `ShellStateBridge` publishes the surface and the game
// context on the shell-state store, and this reads those two (§4.37.18).
//
// Architecture reference: §4.25 — Audio System

import { useEffect, useState } from 'react';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';

import { loadRendererGameShell, type GameShellMusicBed } from '../game/rendererGameRegistry';
import { SHELL_AUDIO_SURFACES } from './shellRoutes';
import { useShellState } from './shellStateStore';

/**
 * What the active game contributes as its shell audio on the current surface.
 *
 * Both fields are already gated on the surface, so nothing here reports the
 * surface itself: a session opened off one is exactly the pair being `null`, and
 * a second way to ask would be a second thing a consumer could get wrong.
 */
export interface ResolvedShellAudio {
    /** The inventory to open the shell audio session over, or `null` for none. */
    readonly assets: AssetManifest | null;
    /**
     * The declared menu bed, or `null`. Always `null` without {@link assets}: a
     * bed whose ref resolves against nothing is inert by declaration, and
     * answering it here would make every consumer re-derive that rule.
     */
    readonly musicBed: GameShellMusicBed | null;
}

type LoadedShellAudio = Readonly<{
    gameId: string | null;
    assets: AssetManifest | null;
    musicBed: GameShellMusicBed | null;
}>;

const UNRESOLVED: LoadedShellAudio = { gameId: null, assets: null, musicBed: null };

export function useShellAudioPayload(): ResolvedShellAudio {
    const surface = useShellState((state) => state.surface);
    const gameId = useShellState((state) => state.gameId);
    const isShellAudioSurface = SHELL_AUDIO_SURFACES.has(surface);
    const [loaded, setLoaded] = useState<LoadedShellAudio>(UNRESOLVED);

    useEffect(() => {
        if (!isShellAudioSurface || gameId === null) {
            setLoaded(UNRESOLVED);
            return;
        }

        let disposed = false;

        loadRendererGameShell(gameId)
            .then((shell) => {
                if (!disposed) {
                    setLoaded({
                        gameId,
                        assets: shell.shellAudioAssets ?? null,
                        musicBed: shell.shellMusicBed ?? null,
                    });
                }
            })
            .catch(() => {
                if (!disposed) {
                    setLoaded({ gameId, assets: null, musicBed: null });
                }
            });

        return () => {
            disposed = true;
        };
        // `isShellAudioSurface` is load-bearing here, not hygiene: a route can
        // reach a shell surface with the game context ALREADY set — a
        // `/logo-screen?gameId=x` boot into `/main-menu?gameId=x` — and an effect
        // keyed on the game alone would never run its load for that hop.
    }, [gameId, isShellAudioSurface]);

    // A payload answers only for the game context it was loaded for. Anything
    // else is stale — a context change whose load is still in flight, or a route
    // that dropped `?gameId=` before the effect above cleared the state — and a
    // stale payload answers NOTHING. Read ONCE, through the destructuring below,
    // so no later line can reach past it to the raw state.
    const { assets, musicBed } = loaded.gameId === gameId ? loaded : UNRESOLVED;

    return {
        assets: isShellAudioSurface ? assets : null,
        musicBed: isShellAudioSurface && assets !== null ? musicBed : null,
    };
}
