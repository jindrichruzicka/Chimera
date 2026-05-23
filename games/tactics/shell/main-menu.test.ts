// games/tactics/shell/main-menu.test.ts
//
// Unit tests for the Tactics main menu definition and command registry.
// Written first (TDD — red confirmed before implementation).
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract
// Task: #620
//
// Module boundary enforced by import statement below:
//   - games/tactics/shell/ may import from shared/ only (not renderer/)

import { describe, expect, it } from 'vitest';
import type { GameMainMenuDefinition } from '@chimera/shared/game-shell-contract.js';
import { tacticsMainMenuDefinition, tacticsMenuCommands } from './main-menu';

// ─── Export shape ─────────────────────────────────────────────────────────────

describe('tacticsMainMenuDefinition shape', () => {
    it('is a GameMainMenuDefinition', () => {
        const _: GameMainMenuDefinition = tacticsMainMenuDefinition;
        expect(tacticsMainMenuDefinition).toBeDefined();
    });

    it('has a buttons array with at least 4 entries', () => {
        expect(tacticsMainMenuDefinition.buttons.length).toBeGreaterThanOrEqual(4);
    });
});

// ─── Button labels ────────────────────────────────────────────────────────────

describe('button labels', () => {
    function findButton(label: string) {
        return tacticsMainMenuDefinition.buttons.find((b) => b.label === label);
    }

    it('includes a "New Game" button', () => {
        expect(findButton('New Game')).toBeDefined();
    });

    it('includes a "Load Game" button', () => {
        expect(findButton('Load Game')).toBeDefined();
    });

    it('includes a "Settings" button', () => {
        expect(findButton('Settings')).toBeDefined();
    });

    it('includes a "Quit" button', () => {
        expect(findButton('Quit')).toBeDefined();
    });

    it('buttons appear in the correct order: New Game, Load Game, Settings, Quit', () => {
        const labels = tacticsMainMenuDefinition.buttons.map((b) => b.label);
        expect(labels).toEqual(['New Game', 'Load Game', 'Settings', 'Quit']);
    });
});

// ─── Button actions ───────────────────────────────────────────────────────────

describe('button actions', () => {
    function findButton(label: string) {
        const btn = tacticsMainMenuDefinition.buttons.find((b) => b.label === label);
        if (!btn) throw new Error(`Button "${label}" not found`);
        return btn;
    }

    it('"New Game" navigates to /game', () => {
        const btn = findButton('New Game');
        expect(btn.action.type).toBe('navigate');
        if (btn.action.type === 'navigate') {
            expect(btn.action.target).toBe('/game');
        }
    });

    it('"Load Game" navigates to /saves', () => {
        const btn = findButton('Load Game');
        expect(btn.action.type).toBe('navigate');
        if (btn.action.type === 'navigate') {
            expect(btn.action.target).toBe('/saves');
        }
    });

    it('"Settings" navigates to /settings', () => {
        const btn = findButton('Settings');
        expect(btn.action.type).toBe('navigate');
        if (btn.action.type === 'navigate') {
            expect(btn.action.target).toBe('/settings');
        }
    });

    it('"Quit" has action type "quit"', () => {
        const btn = findButton('Quit');
        expect(btn.action.type).toBe('quit');
    });
});

// ─── Button variants ──────────────────────────────────────────────────────────

describe('button variants', () => {
    function findButton(label: string) {
        return tacticsMainMenuDefinition.buttons.find((b) => b.label === label)!;
    }

    it('"New Game" is primary variant', () => {
        expect(findButton('New Game').variant).toBe('primary');
    });

    it('"Quit" is danger variant', () => {
        expect(findButton('Quit').variant).toBe('danger');
    });
});

// ─── Layout ───────────────────────────────────────────────────────────────────

describe('layout', () => {
    it('uses vertical orientation', () => {
        expect(tacticsMainMenuDefinition.layout?.orientation).toBe('vertical');
    });

    it('anchors to center-bottom', () => {
        expect(tacticsMainMenuDefinition.layout?.anchor).toBe('bottom');
    });

    it('has a defined numeric gap', () => {
        expect(typeof tacticsMainMenuDefinition.layout?.gap).toBe('number');
    });

    it('gap value is a valid token-mapped spacing (0, 4, 8, 16, 24, or 40)', () => {
        const validGaps = [0, 4, 8, 16, 24, 40];
        expect(validGaps).toContain(tacticsMainMenuDefinition.layout?.gap);
    });
});

// ─── tacticsMenuCommands ──────────────────────────────────────────────────────

describe('tacticsMenuCommands shape', () => {
    it('is empty because the current menu uses route navigation only', () => {
        expect(tacticsMenuCommands).toEqual({});
    });
});
