/**
 * games/tactics/lobby/lobby-setup.test.ts
 *
 * Unit tests for the pure Tactics lobby-setup descriptor and its reusable
 * colour maps. The descriptor declares the customizable-lobby contract (#702)
 * that `main` reads for defaults/validation and the renderer reads to build
 * controls; the hex maps are the single source of truth reused by the in-match
 * renderer (#710).
 *
 * Architecture: §4.37 — Renderer Shell Pages UI Contract; §4.4 — Lobby State Sync
 * Task: #708 (T6, part of #702 — Customizable Lobby)
 */

import { describe, it, expect } from 'vitest';
import {
    tacticsLobbySetup,
    TACTICS_PLAYER_COLORS,
    TACTICS_BOARD_COLORS,
    TACTICS_PLAYER_COLOR_HEX,
    TACTICS_BOARD_COLOR_HEX,
} from './lobby-setup.js';

const HEX = /^#[0-9a-f]{6}$/;

describe('tacticsLobbySetup', () => {
    it('admits up to 4 seats', () => {
        expect(tacticsLobbySetup.maxPlayers).toBe(4);
    });

    it('declares a 4-colour player palette in seat order', () => {
        expect(TACTICS_PLAYER_COLORS.map((option) => option.value)).toEqual([
            'blue',
            'red',
            'green',
            'amber',
        ]);
    });

    it('defaults the board colour to slate, which is a valid option', () => {
        expect(tacticsLobbySetup.matchSettingsDefaults).toEqual({ boardColor: 'slate' });
        expect(TACTICS_BOARD_COLORS.map((option) => option.value)).toContain('slate');
    });

    it('exposes the palette as the match-setting and player-attribute options', () => {
        expect(tacticsLobbySetup.matchSettingsOptions['boardColor']).toBe(TACTICS_BOARD_COLORS);
        expect(tacticsLobbySetup.playerAttributeOptions['color']).toBe(TACTICS_PLAYER_COLORS);
    });

    describe('resolveDefaultPlayerAttributes', () => {
        it('assigns each seat the palette colour at its index', () => {
            expect(tacticsLobbySetup.resolveDefaultPlayerAttributes(0)).toEqual({ color: 'blue' });
            expect(tacticsLobbySetup.resolveDefaultPlayerAttributes(1)).toEqual({ color: 'red' });
            expect(tacticsLobbySetup.resolveDefaultPlayerAttributes(2)).toEqual({ color: 'green' });
            expect(tacticsLobbySetup.resolveDefaultPlayerAttributes(3)).toEqual({ color: 'amber' });
        });

        it('wraps via modulo so the resolver is total for any seat index', () => {
            expect(tacticsLobbySetup.resolveDefaultPlayerAttributes(4)).toEqual({ color: 'blue' });
            expect(tacticsLobbySetup.resolveDefaultPlayerAttributes(5)).toEqual({ color: 'red' });
        });

        it('returns a fresh object each call (no external mutation)', () => {
            const first = tacticsLobbySetup.resolveDefaultPlayerAttributes(0);
            const second = tacticsLobbySetup.resolveDefaultPlayerAttributes(0);
            expect(first).not.toBe(second);
        });
    });

    describe('colour maps', () => {
        it('maps every player-colour option to a 6-digit hex', () => {
            for (const option of TACTICS_PLAYER_COLORS) {
                expect(TACTICS_PLAYER_COLOR_HEX[option.value]).toMatch(HEX);
            }
            expect(Object.keys(TACTICS_PLAYER_COLOR_HEX)).toHaveLength(
                TACTICS_PLAYER_COLORS.length,
            );
        });

        it('maps every board-colour option to a 6-digit hex', () => {
            for (const option of TACTICS_BOARD_COLORS) {
                expect(TACTICS_BOARD_COLOR_HEX[option.value]).toMatch(HEX);
            }
            expect(Object.keys(TACTICS_BOARD_COLOR_HEX)).toHaveLength(TACTICS_BOARD_COLORS.length);
        });

        it('keeps the historic own/opponent and ground colours in the palette', () => {
            expect(TACTICS_PLAYER_COLOR_HEX['blue']).toBe('#2563eb');
            expect(TACTICS_PLAYER_COLOR_HEX['red']).toBe('#dc2626');
            expect(TACTICS_BOARD_COLOR_HEX['slate']).toBe('#3f3f46');
        });
    });

    it('declares well-formed options with non-empty labels', () => {
        for (const option of [...TACTICS_PLAYER_COLORS, ...TACTICS_BOARD_COLORS]) {
            expect(typeof option.value).toBe('string');
            expect(option.value.length).toBeGreaterThan(0);
            expect(option.label.length).toBeGreaterThan(0);
        }
    });
});
