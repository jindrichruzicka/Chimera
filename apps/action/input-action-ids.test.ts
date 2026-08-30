import { describe, expect, it } from 'vitest';
import { ENGINE_DEFAULTS } from '@chimera-engine/simulation/settings/index.js';

import {
    ACTION_DEFAULT_MOVE_BINDINGS,
    ACTION_MOVE_ACTION_IDS,
    ACTION_MOVE_DIRECTIONS,
    ACTION_MOVE_DOWN_ACTION,
    ACTION_MOVE_LEFT_ACTION,
    ACTION_MOVE_RIGHT_ACTION,
    ACTION_MOVE_UP_ACTION,
} from './input-action-ids.js';

// The four movement actions are named in three places — the settings schema's
// default bindings, the renderer's `InputAction` table, and the playfield's
// subscriptions — so they are declared ONCE here and each site reads them.
// These assertions hold the properties none of those three sites can hold alone.
describe('action movement input actions', () => {
    it('names four distinct actions, all in the game namespace', () => {
        expect(ACTION_MOVE_ACTION_IDS).toEqual([
            ACTION_MOVE_UP_ACTION,
            ACTION_MOVE_DOWN_ACTION,
            ACTION_MOVE_LEFT_ACTION,
            ACTION_MOVE_RIGHT_ACTION,
        ]);
        expect(new Set(ACTION_MOVE_ACTION_IDS).size).toBe(4);
        for (const id of ACTION_MOVE_ACTION_IDS) {
            expect(id, id).toMatch(/^game:/u);
        }
    });

    it('shadows no engine binding', () => {
        // A game action bound over an engine one is a conflict the rebind UI
        // reports at runtime; catching it here is cheaper.
        for (const id of ACTION_MOVE_ACTION_IDS) {
            expect(ENGINE_DEFAULTS.controls.bindings[id], id).toBeUndefined();
        }
    });

    it('binds each action to its own arrow key by default', () => {
        expect(ACTION_DEFAULT_MOVE_BINDINGS).toEqual({
            [ACTION_MOVE_UP_ACTION]: { primary: 'ArrowUp' },
            [ACTION_MOVE_DOWN_ACTION]: { primary: 'ArrowDown' },
            [ACTION_MOVE_LEFT_ACTION]: { primary: 'ArrowLeft' },
            [ACTION_MOVE_RIGHT_ACTION]: { primary: 'ArrowRight' },
        });
    });

    it('binds no two actions to the same key', () => {
        const keys = Object.values(ACTION_DEFAULT_MOVE_BINDINGS).map((binding) => binding.primary);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('takes no engine default key', () => {
        const engineKeys = new Set(
            Object.values(ENGINE_DEFAULTS.controls.bindings).map((binding) => binding.primary),
        );
        for (const [id, binding] of Object.entries(ACTION_DEFAULT_MOVE_BINDINGS)) {
            expect(engineKeys.has(binding.primary), `${id} → ${binding.primary}`).toBe(false);
        }
    });

    it('maps each action to a unit step on exactly one axis', () => {
        for (const id of ACTION_MOVE_ACTION_IDS) {
            const { dx, dy } = ACTION_MOVE_DIRECTIONS[id];
            expect(Math.abs(dx) + Math.abs(dy), id).toBe(1);
        }
    });

    it('maps up/down and left/right to opposite steps', () => {
        // A copy-paste that gave two actions the same delta would leave one
        // arrow key silently doing another's job.
        expect(ACTION_MOVE_DIRECTIONS[ACTION_MOVE_UP_ACTION]).toEqual({ dx: 0, dy: -1 });
        expect(ACTION_MOVE_DIRECTIONS[ACTION_MOVE_DOWN_ACTION]).toEqual({ dx: 0, dy: 1 });
        expect(ACTION_MOVE_DIRECTIONS[ACTION_MOVE_LEFT_ACTION]).toEqual({ dx: -1, dy: 0 });
        expect(ACTION_MOVE_DIRECTIONS[ACTION_MOVE_RIGHT_ACTION]).toEqual({ dx: 1, dy: 0 });
    });

    it('gives every declared action a direction and a binding', () => {
        for (const id of ACTION_MOVE_ACTION_IDS) {
            expect(ACTION_MOVE_DIRECTIONS[id], id).toBeDefined();
            expect(ACTION_DEFAULT_MOVE_BINDINGS[id], id).toBeDefined();
        }
        expect(Object.keys(ACTION_MOVE_DIRECTIONS).sort()).toEqual(
            [...ACTION_MOVE_ACTION_IDS].sort(),
        );
        expect(Object.keys(ACTION_DEFAULT_MOVE_BINDINGS).sort()).toEqual(
            [...ACTION_MOVE_ACTION_IDS].sort(),
        );
    });
});
