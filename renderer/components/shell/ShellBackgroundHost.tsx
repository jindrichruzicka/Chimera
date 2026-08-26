'use client';

import React from 'react';
import type { ComponentType } from 'react';
import { loadRendererGameShell } from '../../game/rendererGameRegistry';
import { SHELL_BACKGROUND_SURFACES } from '../../shell/shellRoutes';
import { useShellState } from '../../shell/shellStateStore';

let nextShellBackgroundInstanceId = 1;

type LoadedShellBackground = Readonly<{
    gameId: string | null;
    Background: ComponentType | null;
}>;

const UNRESOLVED: LoadedShellBackground = {
    gameId: null,
    Background: null,
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
                    setLoadedBackground({ gameId, Background: shell.shellBackground ?? null });
                }
            })
            .catch(() => {
                if (!disposed) {
                    setLoadedBackground({ gameId, Background: null });
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
    const { Background } = payloadIsForThisContext ? loadedBackground : UNRESOLVED;

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
            {Background === null ? null : <Background />}
        </div>
    );
}
