export interface LobbyConfig {
    readonly gameId: string;
    readonly maxPlayers: number;
}

const DEFAULT_GAME_ID = 'tactics';
const DEFAULT_MAX_PLAYERS = 4;
const MIN_MAX_PLAYERS = 2;
const MAX_MAX_PLAYERS = 16;

export function getDefaultLobbyConfig(): LobbyConfig {
    return {
        gameId: DEFAULT_GAME_ID,
        maxPlayers: DEFAULT_MAX_PLAYERS,
    };
}

export function parseLobbyConfig(searchParams: URLSearchParams): LobbyConfig {
    const gameId = searchParams.get('gameId') ?? DEFAULT_GAME_ID;

    const rawMaxPlayers = searchParams.get('maxPlayers');
    const hasValidInteger = rawMaxPlayers !== null && /^-?\d+$/.test(rawMaxPlayers.trim());
    const parsedMaxPlayers = hasValidInteger
        ? Number.parseInt(rawMaxPlayers, 10)
        : DEFAULT_MAX_PLAYERS;

    const normalizedMaxPlayers = Number.isFinite(parsedMaxPlayers)
        ? parsedMaxPlayers
        : DEFAULT_MAX_PLAYERS;
    const maxPlayers = Math.min(Math.max(normalizedMaxPlayers, MIN_MAX_PLAYERS), MAX_MAX_PLAYERS);

    return {
        gameId,
        maxPlayers,
    };
}
