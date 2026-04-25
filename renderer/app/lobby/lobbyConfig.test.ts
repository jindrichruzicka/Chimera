import { describe, expect, it } from 'vitest';
import { parseLobbyConfig } from './lobbyConfig';

describe('parseLobbyConfig', () => {
    it('uses defaults when params are missing', () => {
        const config = parseLobbyConfig(new URLSearchParams(''));

        expect(config).toEqual({
            gameId: 'tactics',
            maxPlayers: 4,
        });
    });

    it('uses provided gameId and maxPlayers when valid', () => {
        const config = parseLobbyConfig(new URLSearchParams('gameId=arena&maxPlayers=8'));

        expect(config).toEqual({
            gameId: 'arena',
            maxPlayers: 8,
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
});
