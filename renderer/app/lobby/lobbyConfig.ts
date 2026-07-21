import { resolveShellGameId } from '../../shell/resolveMainMenuGameId';
import { themeId as makeThemeId } from '../../theme/types';
import type { ThemeId } from '../../theme/types';

export interface LobbyConfig {
    /**
     * The game this lobby hosts for, read from `?gameId=` alone. The engine names
     * and derives no game: a bare URL yields `null`, never a fallback pick from
     * the registry. `null` ⇒ no game context, so hosting is unavailable (joining
     * still is — the host's response carries the game).
     */
    readonly gameId: string | null;
    readonly maxPlayers: number;
    readonly themeId?: ThemeId;
}

const DEFAULT_MAX_PLAYERS = 4;
const MIN_MAX_PLAYERS = 2;
const MAX_MAX_PLAYERS = 16;

export function getDefaultLobbyConfig(): LobbyConfig {
    return {
        gameId: null,
        maxPlayers: DEFAULT_MAX_PLAYERS,
    };
}

export function parseLobbyConfig(searchParams: URLSearchParams): LobbyConfig {
    const gameId = resolveShellGameId(searchParams);

    const rawMaxPlayers = searchParams.get('maxPlayers');
    const hasValidInteger = rawMaxPlayers !== null && /^-?\d+$/.test(rawMaxPlayers.trim());
    const parsedMaxPlayers = hasValidInteger
        ? Number.parseInt(rawMaxPlayers, 10)
        : DEFAULT_MAX_PLAYERS;

    const normalizedMaxPlayers = Number.isFinite(parsedMaxPlayers)
        ? parsedMaxPlayers
        : DEFAULT_MAX_PLAYERS;
    const maxPlayers = Math.min(Math.max(normalizedMaxPlayers, MIN_MAX_PLAYERS), MAX_MAX_PLAYERS);

    const rawThemeId = searchParams.get('themeId');
    const parsedThemeId =
        rawThemeId !== null && rawThemeId.length > 0 ? makeThemeId(rawThemeId) : undefined;

    return {
        gameId,
        maxPlayers,
        ...(parsedThemeId !== undefined && { themeId: parsedThemeId }),
    };
}
