'use client';

// renderer/shell/useShellBackgroundPayload.ts
//
// The ONE resolution of what the active game contributes as its shell
// background (§4.37.9): the component, its optional asset manifest, and whether
// the player may click it.
//
// It is a hook rather than a field on `ShellBackgroundHost` because the opt-in
// has a second consumer. Making a background clickable is not a property of the
// background alone — the engine's own layers sit above it and each is a hit
// target over its whole box whether or not it paints anything, so the layer
// carrying page content has to stand aside for the same routes.
//
// It classifies nothing: `ShellStateBridge` publishes the surface and the game
// context on the shell-state store, and this reads those two (§4.37.18).
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract

import { useEffect, useState, type ComponentType } from 'react';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';

import { loadRendererGameShell } from '../game/rendererGameRegistry';
import { SHELL_BACKGROUND_SURFACES } from './shellRoutes';
import { useShellState } from './shellStateStore';

/** What the active game contributes as its background on the current surface. */
export interface ResolvedShellBackground {
    /** The game's background component, or `null` for the engine default. */
    readonly Background: ComponentType | null;
    /** The manifest to open a `GameAssetSession` with, or `null` for none. */
    readonly assets: AssetManifest | null;
    /**
     * Whether the background takes pointer input and is exposed to assistive
     * tech. TRUE needs three things at once: a background surface, a payload
     * that answers for the current game context, and a game that declared both
     * the opt-in AND a component — an opt-in over the engine's plain coloured
     * plate has nothing to click and nothing worth exposing.
     */
    readonly isInteractive: boolean;
    /** Whether the current surface carries a shell background at all. */
    readonly isShellBackgroundSurface: boolean;
    /**
     * Whether the resolved payload belongs to the game context in the store
     * right now. `false` means a load is still in flight for a context that
     * just changed — the caller paints nothing rather than the previous game's
     * background or an engine default that would flash before it.
     */
    readonly isForThisContext: boolean;
}

type LoadedShellBackground = Readonly<{
    gameId: string | null;
    Background: ComponentType | null;
    assets: AssetManifest | null;
    interactive: boolean;
}>;

const UNRESOLVED: LoadedShellBackground = {
    gameId: null,
    Background: null,
    assets: null,
    interactive: false,
};

export function useShellBackgroundPayload(): ResolvedShellBackground {
    const surface = useShellState((state) => state.surface);
    const gameId = useShellState((state) => state.gameId);
    const isShellBackgroundSurface = SHELL_BACKGROUND_SURFACES.has(surface);
    const [loaded, setLoaded] = useState<LoadedShellBackground>(UNRESOLVED);

    useEffect(() => {
        if (!isShellBackgroundSurface || gameId === null) {
            setLoaded(UNRESOLVED);
            return;
        }

        let disposed = false;

        loadRendererGameShell(gameId)
            .then((shell) => {
                if (!disposed) {
                    setLoaded({
                        gameId,
                        Background: shell.shellBackground ?? null,
                        assets: shell.shellBackgroundAssets ?? null,
                        interactive: shell.shellBackgroundInteractive === true,
                    });
                }
            })
            .catch(() => {
                if (!disposed) {
                    setLoaded({ gameId, Background: null, assets: null, interactive: false });
                }
            });

        return () => {
            disposed = true;
        };
    }, [gameId, isShellBackgroundSurface]);

    // A payload answers only for the game context it was loaded for. Anything
    // else is stale — a context change whose load is still in flight, or a route
    // that dropped `?gameId=` before the effect above cleared the state — and a
    // stale payload answers NOTHING. Read ONCE, through the destructuring below,
    // so no later line can reach past it to the raw state.
    const isForThisContext = loaded.gameId === gameId;
    const { Background, assets, interactive } = isForThisContext ? loaded : UNRESOLVED;

    return {
        Background,
        assets,
        isInteractive: isShellBackgroundSurface && interactive && Background !== null,
        isShellBackgroundSurface,
        isForThisContext,
    };
}

/**
 * Whether the shell background takes pointer input right now — the one field of
 * {@link ResolvedShellBackground} a layer that only has to stand aside needs.
 *
 * Sharing the DERIVATION is the point, and it is all that is shared: each
 * caller keeps its own state and runs its own load, so agreement rests on
 * identical inputs rather than on a single resolution, and two callers can
 * settle in different commits. What that rules out is the drift a second,
 * separately written reading of the opt-in would introduce.
 */
export function useShellBackgroundIsInteractive(): boolean {
    return useShellBackgroundPayload().isInteractive;
}
