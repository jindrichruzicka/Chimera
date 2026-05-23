import { describe, expect, it } from 'vitest';
import { resolveMainMenuGameId } from './resolveMainMenuGameId';

describe('resolveMainMenuGameId', () => {
    it('uses the explicit gameId query parameter', () => {
        const params = new URLSearchParams('gameId=tactics');

        expect(resolveMainMenuGameId(params)).toBe('tactics');
    });

    it('trims surrounding whitespace from gameId', () => {
        const params = new URLSearchParams('gameId=%20tactics%20');

        expect(resolveMainMenuGameId(params)).toBe('tactics');
    });

    it('returns null when gameId is absent', () => {
        const params = new URLSearchParams('themeId=engine-default');

        expect(resolveMainMenuGameId(params)).toBeNull();
    });

    it('returns null when gameId is blank', () => {
        const params = new URLSearchParams('gameId=');

        expect(resolveMainMenuGameId(params)).toBeNull();
    });
});
