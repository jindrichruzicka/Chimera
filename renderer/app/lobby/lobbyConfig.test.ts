import { describe, expect, it } from 'vitest';
import { getDefaultLobbyConfig, parseLobbyConfig } from './lobbyConfig';

describe('parseLobbyConfig', () => {
    it('resolves a null gameId when the param is missing — the engine picks no game', () => {
        const config = parseLobbyConfig(new URLSearchParams(''));

        expect(config).toEqual({
            gameId: null,
            maxPlayers: 4,
            themeId: undefined,
        });
    });

    it('resolves a null gameId for a blank/whitespace param', () => {
        expect(parseLobbyConfig(new URLSearchParams('gameId=')).gameId).toBeNull();
        expect(parseLobbyConfig(new URLSearchParams('gameId=%20%20')).gameId).toBeNull();
    });

    it('never consults the renderer game registry for a fallback', () => {
        // No game is registered here at all. A registry-derived default would
        // throw or invent an id; the URL is the only source of game context.
        expect(() => parseLobbyConfig(new URLSearchParams(''))).not.toThrow();
        expect(getDefaultLobbyConfig().gameId).toBeNull();
    });

    it('uses provided gameId and maxPlayers when valid', () => {
        const config = parseLobbyConfig(new URLSearchParams('gameId=arena&maxPlayers=8'));

        expect(config).toEqual({
            gameId: 'arena',
            maxPlayers: 8,
            themeId: undefined,
        });
    });

    it('clamps maxPlayers to min and max bounds', () => {
        const minConfig = parseLobbyConfig(new URLSearchParams('maxPlayers=1'));
        const maxConfig = parseLobbyConfig(new URLSearchParams('maxPlayers=999'));

        expect(minConfig.maxPlayers).toBe(2);
        expect(maxConfig.maxPlayers).toBe(16);
    });

    it('falls back to default maxPlayers for invalid values', () => {
        const nanConfig = parseLobbyConfig(new URLSearchParams('maxPlayers=foo'));
        const floatConfig = parseLobbyConfig(new URLSearchParams('maxPlayers=3.5'));
        const emptyConfig = parseLobbyConfig(new URLSearchParams('maxPlayers='));

        expect(nanConfig.maxPlayers).toBe(4);
        expect(floatConfig.maxPlayers).toBe(4);
        expect(emptyConfig.maxPlayers).toBe(4);
    });

    it('parses themeId when provided', () => {
        const config = parseLobbyConfig(new URLSearchParams('themeId=engine-default'));

        expect(config.themeId).toBe('engine-default');
    });

    it('returns undefined themeId when param is absent', () => {
        const config = parseLobbyConfig(new URLSearchParams('gameId=tactics'));

        expect(config.themeId).toBeUndefined();
    });
});
