export function resolveShellGameId(searchParams: URLSearchParams): string | null {
    const gameId = searchParams.get('gameId')?.trim();
    return gameId === undefined || gameId.length === 0 ? null : gameId;
}

export function resolveMainMenuGameId(searchParams: URLSearchParams): string | null {
    return resolveShellGameId(searchParams);
}

export function withShellGameId(target: string, gameId: string | null): string {
    const trimmedGameId = gameId?.trim();
    if (trimmedGameId === undefined || trimmedGameId.length === 0 || !target.startsWith('/')) {
        return target;
    }

    const targetUrl = new URL(target, 'https://chimera.local');
    if (!targetUrl.searchParams.has('gameId')) {
        targetUrl.searchParams.set('gameId', trimmedGameId);
    }

    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}
