// games/tactics/constants.test.ts
//
// Unit tests for the tactics commitment battle-mode turn-mode match setting
// (T6 / #726). `readTacticsTurnMode` is the single pure reader both the lobby
// (over `matchSettings`) and the simulation reducers (over
// `snapshot.setup?.matchSettings`) use to decide whether a match runs in
// sequential (default) or commitment turn mode.
//
// Design note: docs/security-trust/tactics-commitment-battle-mode.md

import { describe, expect, it } from 'vitest';

import {
    TACTICS_DEFAULT_TURN_MODE,
    TACTICS_TURN_MODE_SETTING,
    readTacticsTurnMode,
} from './constants.js';

describe('readTacticsTurnMode (T6 / #726 — commitment battle-mode toggle)', () => {
    it('defaults to sequential when match settings are absent', () => {
        expect(readTacticsTurnMode(undefined)).toBe('sequential');
        expect(TACTICS_DEFAULT_TURN_MODE).toBe('sequential');
    });

    it('defaults to sequential when the key is missing', () => {
        expect(readTacticsTurnMode({})).toBe('sequential');
        expect(readTacticsTurnMode({ boardColor: 'slate' })).toBe('sequential');
    });

    it('reads sequential when explicitly set', () => {
        expect(readTacticsTurnMode({ [TACTICS_TURN_MODE_SETTING]: 'sequential' })).toBe(
            'sequential',
        );
    });

    it('reads commitment only for the exact literal "commitment"', () => {
        expect(readTacticsTurnMode({ [TACTICS_TURN_MODE_SETTING]: 'commitment' })).toBe(
            'commitment',
        );
    });

    it('treats any unrecognised value as sequential (fail-safe to the default)', () => {
        expect(readTacticsTurnMode({ [TACTICS_TURN_MODE_SETTING]: 'Commitment' })).toBe(
            'sequential',
        );
        expect(readTacticsTurnMode({ [TACTICS_TURN_MODE_SETTING]: 'on' })).toBe('sequential');
        expect(readTacticsTurnMode({ [TACTICS_TURN_MODE_SETTING]: '' })).toBe('sequential');
    });

    it('exposes the setting key as the stable "turnMode" string', () => {
        expect(TACTICS_TURN_MODE_SETTING).toBe('turnMode');
    });
});
