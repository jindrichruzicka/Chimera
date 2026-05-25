import { describe, expect, it } from 'vitest';
import { resolveMainMenuGameId, withShellGameId } from './resolveMainMenuGameId';

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

describe('withShellGameId', () => {
    it('adds gameId to a root-relative route', () => {
        expect(withShellGameId('/settings', 'tactics')).toBe('/settings?gameId=tactics');
    });

    it('preserves existing query parameters and hash fragments', () => {
        expect(withShellGameId('/settings?tab=audio#panel', 'tactics')).toBe(
            '/settings?tab=audio&gameId=tactics#panel',
        );
    });

    it('does not override an explicit target gameId', () => {
        expect(withShellGameId('/settings?gameId=custom', 'tactics')).toBe(
            '/settings?gameId=custom',
        );
    });

    it('leaves routes unchanged when no gameId is active', () => {
        expect(withShellGameId('/settings', null)).toBe('/settings');
    });
});
