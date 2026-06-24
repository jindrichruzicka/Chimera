import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    _resetRendererGameRegistryForTest,
    registerRendererGame,
} from '../../game/rendererGameRegistry';
import { parseLobbyConfig } from './lobbyConfig';

describe('parseLobbyConfig', () => {
    beforeEach(() => {
        _resetRendererGameRegistryForTest();
        registerRendererGame({
            gameId: 'tactics',
            loadGame: () => Promise.reject(new Error('not loaded in lobbyConfig test')),
            loadShell: () => Promise.reject(new Error('not loaded in lobbyConfig test')),
            isDefault: true,
        });
    });

    afterEach(() => {
        _resetRendererGameRegistryForTest();
    });

    it('uses defaults when params are missing', () => {
        const config = parseLobbyConfig(new URLSearchParams(''));

        expect(config).toEqual({
            gameId: 'tactics',
            maxPlayers: 4,
            themeId: undefined,
        });
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
