import { describe, expect, it } from 'vitest';

import { TACTICS_GAME_ID } from './constants.js';
import { tacticsManifest } from './manifest.js';

describe('tacticsManifest', () => {
    it('uses the canonical tactics game id', () => {
        expect(tacticsManifest.gameId).toBe(TACTICS_GAME_ID);
    });

    it('displays as "Tactics"', () => {
        expect(tacticsManifest.displayName).toBe('Tactics');
    });

    it('is turn-based: realtime is false so no heartbeat ticker runs', () => {
        expect(tacticsManifest.realtime).toBe(false);
    });

    it('does not override the app icon (defaults to the Chimera icon)', () => {
        expect(tacticsManifest.icon).toBeUndefined();
    });
});
