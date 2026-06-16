/**
 * games/tactics/lobby/lobby-setup.test.ts
 *
 * Unit tests for the pure Tactics lobby-setup builder. The selectable colours
 * now come from the content database; `buildTacticsLobbySetup` takes the
 * interpreted {@link TacticsPalette} and produces the descriptor `main` reads
 * for seat defaults and host/join validation (#702). The `DEFAULT_*` constants
 * remain the guaranteed-string fallbacks.
 *
 * Architecture: §4.37 — Renderer Shell Pages UI Contract; §4.4 — Lobby State Sync
 * Task: #708 (T6, part of #702 — Customizable Lobby)
 */

import { describe, it, expect } from 'vitest';
import { TACTICS_DEFAULT_TURN_MODE, TACTICS_TURN_MODE_SETTING } from '@chimera/shared/tactics.js';
import {
    buildTacticsLobbySetup,
    DEFAULT_BOARD_COLOR,
    DEFAULT_BOARD_COLOR_HEX,
    DEFAULT_PLAYER_COLOR,
    DEFAULT_PLAYER_COLOR_HEX,
    type TacticsPalette,
} from './lobby-setup.js';

const PALETTE: TacticsPalette = {
    playerColors: [
        { value: 'blue', label: 'Blue' },
        { value: 'red', label: 'Red' },
        { value: 'green', label: 'Green' },
        { value: 'amber', label: 'Amber' },
    ],
    boardColors: [
        { value: 'slate', label: 'Slate' },
        { value: 'stone', label: 'Stone' },
        { value: 'navy', label: 'Navy' },
    ],
    playerColorHex: { blue: '#2563eb', red: '#dc2626', green: '#16a34a', amber: '#f59e0b' },
    boardColorHex: { slate: '#3f3f46', stone: '#44403c', navy: '#1e293b' },
};

describe('buildTacticsLobbySetup', () => {
    it('admits up to 4 seats', () => {
        expect(buildTacticsLobbySetup(PALETTE).maxPlayers).toBe(4);
    });

    it('seeds the board colour and the off-by-default commitment turn mode', () => {
        // turnMode is seeded to 'sequential' so the synced LobbyState carries the
        // off-by-default commitment battle mode (T7 → snapshot.setup for T8).
        expect(buildTacticsLobbySetup(PALETTE).matchSettingsDefaults).toEqual({
            boardColor: DEFAULT_BOARD_COLOR,
            [TACTICS_TURN_MODE_SETTING]: TACTICS_DEFAULT_TURN_MODE,
        });
    });

    it('wires the board and player options from the supplied palette', () => {
        const setup = buildTacticsLobbySetup(PALETTE);
        expect(setup.matchSettingsOptions['boardColor']).toBe(PALETTE.boardColors);
        expect(setup.playerAttributeOptions['color']).toBe(PALETTE.playerColors);
    });

    describe('resolveDefaultPlayerAttributes', () => {
        it('assigns each seat the palette colour at its index', () => {
            const setup = buildTacticsLobbySetup(PALETTE);
            expect(setup.resolveDefaultPlayerAttributes(0)).toEqual({ color: 'blue' });
            expect(setup.resolveDefaultPlayerAttributes(1)).toEqual({ color: 'red' });
            expect(setup.resolveDefaultPlayerAttributes(2)).toEqual({ color: 'green' });
            expect(setup.resolveDefaultPlayerAttributes(3)).toEqual({ color: 'amber' });
        });

        it('wraps via modulo so the resolver is total for any seat index', () => {
            const setup = buildTacticsLobbySetup(PALETTE);
            expect(setup.resolveDefaultPlayerAttributes(4)).toEqual({ color: 'blue' });
            expect(setup.resolveDefaultPlayerAttributes(5)).toEqual({ color: 'red' });
        });

        it('falls back to the default player colour when the palette is empty', () => {
            const setup = buildTacticsLobbySetup({
                playerColors: [],
                boardColors: [],
                playerColorHex: {},
                boardColorHex: {},
            });
            expect(setup.resolveDefaultPlayerAttributes(0)).toEqual({
                color: DEFAULT_PLAYER_COLOR,
            });
        });

        it('returns a fresh object each call (no external mutation)', () => {
            const setup = buildTacticsLobbySetup(PALETTE);
            const first = setup.resolveDefaultPlayerAttributes(0);
            const second = setup.resolveDefaultPlayerAttributes(0);
            expect(first).not.toBe(second);
        });
    });

    describe('default constants', () => {
        it('exposes default colour names and their hexes', () => {
            expect(DEFAULT_PLAYER_COLOR).toBe('blue');
            expect(DEFAULT_BOARD_COLOR).toBe('slate');
            expect(DEFAULT_PLAYER_COLOR_HEX).toBe('#2563eb');
            expect(DEFAULT_BOARD_COLOR_HEX).toBe('#3f3f46');
        });

        it('keeps the default hexes in step with the seeded blue/slate content items', () => {
            // Guards against the static fallback drifting from data/player-colors/blue.json
            // and data/board-colors/slate.json.
            expect(PALETTE.playerColorHex[DEFAULT_PLAYER_COLOR]).toBe(DEFAULT_PLAYER_COLOR_HEX);
            expect(PALETTE.boardColorHex[DEFAULT_BOARD_COLOR]).toBe(DEFAULT_BOARD_COLOR_HEX);
        });
    });
});
