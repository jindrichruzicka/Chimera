export function resolveMainMenuGameId(searchParams: URLSearchParams): string | null {
    const gameId = searchParams.get('gameId')?.trim();
    return gameId === undefined || gameId.length === 0 ? null : gameId;
}
