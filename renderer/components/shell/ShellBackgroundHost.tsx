'use client';

import React from 'react';
import type { ComponentType } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { getDefaultLobbyConfig } from '../../app/lobby/lobbyConfig';
import { loadRendererGameShell } from '../../game/rendererGameRegistry';
import { resolveShellGameId } from '../../shell/resolveMainMenuGameId';

const SHELL_BACKGROUND_ROUTES = new Set(['/main-menu', '/settings', '/lobby']);
const DEFAULT_LOBBY_GAME_ID = getDefaultLobbyConfig().gameId;

let nextShellBackgroundInstanceId = 1;

type LoadedShellBackground = Readonly<{
    gameId: string | null;
    Background: ComponentType | null;
}>;

const hostStyle = {
    position: 'fixed',
    inset: 'var(--ch-space-none)',
    zIndex: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
    backgroundColor: 'var(--ch-color-surface)',
} satisfies React.CSSProperties;

export function ShellBackgroundHost(): React.ReactElement | null {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const routePath = normalizeRoutePath(pathname);
    const search = searchParams.toString();
    const isShellBackgroundRoute = SHELL_BACKGROUND_ROUTES.has(routePath);
    const gameId = React.useMemo(
        () => resolveShellBackgroundGameId(routePath, new URLSearchParams(search)),
        [routePath, search],
    );
    const instanceIdRef = React.useRef(String(nextShellBackgroundInstanceId++));
    const [loadedBackground, setLoadedBackground] = React.useState<LoadedShellBackground>({
        gameId: null,
        Background: null,
    });

    React.useEffect(() => {
        if (!isShellBackgroundRoute || gameId === null) {
            setLoadedBackground({ gameId: null, Background: null });
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
    }, [gameId, isShellBackgroundRoute]);

    if (!isShellBackgroundRoute) {
        return null;
    }

    if (gameId !== null && loadedBackground.gameId !== gameId) {
        return null;
    }

    const Background = loadedBackground.gameId === gameId ? loadedBackground.Background : null;
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

function normalizeRoutePath(pathname: string | null): string {
    if (pathname === null || pathname.length === 0) {
        return '/';
    }

    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function resolveShellBackgroundGameId(
    routePath: string,
    searchParams: URLSearchParams,
): string | null {
    if (routePath === '/lobby') {
        const explicitGameId = resolveShellGameId(searchParams);
        if (explicitGameId !== null) {
            return explicitGameId;
        }

        const explicitThemeId = searchParams.get('themeId')?.trim();
        if (explicitThemeId !== undefined && explicitThemeId.length > 0) {
            return null;
        }

        return DEFAULT_LOBBY_GAME_ID;
    }

    if (routePath === '/main-menu' || routePath === '/settings') {
        return resolveShellGameId(searchParams);
    }

    return null;
}
