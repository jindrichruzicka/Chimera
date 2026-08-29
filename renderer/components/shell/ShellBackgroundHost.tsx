'use client';

import React from 'react';
import type { ComponentType } from 'react';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import { GameAssetSession } from '../../app/gameAssetSession';
import { loadRendererGameShell } from '../../game/rendererGameRegistry';
import { SHELL_BACKGROUND_SURFACES } from '../../shell/shellRoutes';
import { useShellState } from '../../shell/shellStateStore';

let nextShellBackgroundInstanceId = 1;

type LoadedShellBackground = Readonly<{
    gameId: string | null;
    Background: ComponentType | null;
    assets: AssetManifest | null;
}>;

const UNRESOLVED: LoadedShellBackground = {
    gameId: null,
    Background: null,
    assets: null,
};

const hostStyle = {
    position: 'fixed',
    inset: 'var(--ch-space-none)',
    zIndex: 'var(--ch-z-base)',
    pointerEvents: 'none',
    overflow: 'hidden',
    backgroundColor: 'var(--ch-color-surface)',
} satisfies React.CSSProperties;

/**
 * The shell background mount (§4.37.9).
 *
 * It classifies nothing: `ShellStateBridge` publishes the surface and the game
 * context on the shell-state store, and this component decides on those two
 * alone (§4.37.18). Mounting on a set of SURFACES — the three engine screens
 * plus every game-declared page — is what keeps ONE pinned background instance
 * alive across `/main-menu → /<game page> → /settings`.
 */
export function ShellBackgroundHost(): React.ReactElement | null {
    const surface = useShellState((state) => state.surface);
    const gameId = useShellState((state) => state.gameId);
    const isShellBackgroundSurface = SHELL_BACKGROUND_SURFACES.has(surface);
    const instanceIdRef = React.useRef(String(nextShellBackgroundInstanceId++));
    const [loadedBackground, setLoadedBackground] =
        React.useState<LoadedShellBackground>(UNRESOLVED);

    React.useEffect(() => {
        if (!isShellBackgroundSurface || gameId === null) {
            setLoadedBackground(UNRESOLVED);
            return;
        }

        let disposed = false;

        loadRendererGameShell(gameId)
            .then((shell) => {
                if (!disposed) {
                    setLoadedBackground({
                        gameId,
                        Background: shell.shellBackground ?? null,
                        assets: shell.shellBackgroundAssets ?? null,
                    });
                }
            })
            .catch(() => {
                if (!disposed) {
                    setLoadedBackground({ gameId, Background: null, assets: null });
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
    const payloadIsForThisContext = loadedBackground.gameId === gameId;
    const { Background, assets } = payloadIsForThisContext ? loadedBackground : UNRESOLVED;

    if (!isShellBackgroundSurface) {
        return null;
    }

    // With a game in context, nothing is painted until that game's payload has
    // landed: an engine default drawn here would flash before the game's own
    // background replaced it a frame later.
    if (gameId !== null && !payloadIsForThisContext) {
        return null;
    }

    const backgroundKind = Background === null ? 'engine-default' : 'game';

    return (
        <div
            data-testid="shell-background"
            data-shell-background-kind={backgroundKind}
            data-shell-background-instance-id={instanceIdRef.current}
            data-shell-game-id={gameId ?? undefined}
            style={hostStyle}
            aria-hidden="true"
        >
            {renderBackground(Background, assets)}
        </div>
    );
}

/**
 * The background subtree, with the game's asset session around it when the
 * shell payload declared one (§4.10).
 *
 * `GameAssetSession` is REUSED rather than re-implemented: it already owns the
 * one-effect allocate → preload → abandon → dispose lifecycle a manager with no
 * `GameShell` above it needs — the disposal and the commit-phase allocation are
 * Invariant #21's, the critical preload and its abandon are §4.10's — and it
 * already declines to register the app-level `SetGameAssetManagerContext`
 * delegate. A second session hook written for this mount would be a second
 * place to get all of it wrong.
 *
 * The session sits INSIDE the host element rather than around it, so the plate
 * — the fixed, surface-coloured layer the host is — lands on the commit its
 * payload lands on. The cost is that a declared background's own DOM arrives
 * one commit later than the plate, because the session renders `null` until
 * its manager is committed.
 *
 * A declared manifest with NO background component builds nothing: a session
 * publishes to a subtree, and there is none.
 */
function renderBackground(
    Background: ComponentType | null,
    assets: AssetManifest | null,
): React.ReactNode {
    if (Background === null) {
        return null;
    }
    if (assets === null) {
        return <Background />;
    }
    return (
        <GameAssetSession assetManifest={assets}>
            <Background />
        </GameAssetSession>
    );
}
