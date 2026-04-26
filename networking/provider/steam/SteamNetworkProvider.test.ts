/**
 * networking/provider/SteamNetworkProvider.test.ts
 *
 * Written first (red) per TDD mandate — SteamNetworkProvider.ts does not exist yet.
 *
 * Verifies:
 *   1. SteamNetworkProvider satisfies MultiplayerProvider & BrowsableProvider structurally
 *   2. hostLobby() throws 'not yet implemented'
 *   3. joinLobby() throws 'not yet implemented'
 *   4. listLobbies() throws 'not yet implemented'
 *   5. dispose() is callable without throwing
 *   6. isBrowsable() returns true
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider
 * Task: F09 / T3 (issue #203)
 */

import { describe, it, expect } from 'vitest';

import { SteamNetworkProvider } from './SteamNetworkProvider.js';
import { isBrowsable } from '../MultiplayerProvider.js';
import type { MultiplayerProvider, BrowsableProvider } from '../MultiplayerProvider.js';

// ─── Structural compliance ────────────────────────────────────────────────────

describe('SteamNetworkProvider', () => {
    it('satisfies MultiplayerProvider & BrowsableProvider structurally', () => {
        // TypeScript enforces this at compile time; runtime check mirrors it
        const provider: MultiplayerProvider & BrowsableProvider = new SteamNetworkProvider();
        expect(provider).toBeDefined();
        expect(typeof provider.hostLobby).toBe('function');
        expect(typeof provider.joinLobby).toBe('function');
        expect(typeof provider.listLobbies).toBe('function');
        expect(typeof provider.dispose).toBe('function');
    });

    it('hostLobby throws "not yet implemented"', async () => {
        const provider = new SteamNetworkProvider();
        await expect(provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 })).rejects.toThrow(
            'not yet implemented',
        );
    });

    it('joinLobby throws "not yet implemented"', async () => {
        const provider = new SteamNetworkProvider();
        await expect(provider.joinLobby({ address: '127.0.0.1:3456' })).rejects.toThrow(
            'not yet implemented',
        );
    });

    it('dispose() does not throw', () => {
        const provider = new SteamNetworkProvider();
        expect(() => provider.dispose()).not.toThrow();
    });

    it('listLobbies() throws "not yet implemented"', async () => {
        const provider = new SteamNetworkProvider();
        await expect(provider.listLobbies()).rejects.toThrow('not yet implemented');
    });

    it('isBrowsable returns true — SteamNetworkProvider implements BrowsableProvider', () => {
        const provider = new SteamNetworkProvider();
        expect(isBrowsable(provider)).toBe(true);
    });
});
