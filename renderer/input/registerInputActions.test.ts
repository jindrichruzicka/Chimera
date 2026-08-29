/**
 * renderer/input/registerInputActions.test.ts
 *
 * Unit tests for the shared idempotent input-action registrar.
 *
 * Architecture reference: §4.26 — Input & Keybindings
 *
 * Tests written first (TDD — red confirmed: the module did not exist, so the
 * import failed to resolve).
 */

import { describe, it, expect } from 'vitest';
import type { InputAction } from './InputAction.js';
import { createInputActionRegistry } from './InputActionRegistry.js';
import { registerInputActions } from './registerInputActions.js';

function makeAction(id: InputAction['id'], overrides: Partial<InputAction> = {}): InputAction {
    return {
        id,
        description: `Description for ${id}`,
        category: 'Game',
        oneShot: true,
        ...overrides,
    };
}

describe('registerInputActions', () => {
    it('registers every action that is not already registered', () => {
        const registry = createInputActionRegistry();

        registerInputActions(registry, [makeAction('game:end-turn'), makeAction('game:cycle')]);

        expect(registry.getAll().map((action) => action.id)).toEqual([
            'game:end-turn',
            'game:cycle',
        ]);
    });

    it('leaves an already-registered action untouched rather than throwing a duplicate', () => {
        const first = makeAction('game:end-turn');
        const registry = createInputActionRegistry([first]);

        registerInputActions(registry, [makeAction('game:end-turn')]);

        expect(registry.getAll()).toHaveLength(1);
        // The FIRST registration wins: a re-register with equivalent metadata
        // must not replace the held object, or a consumer holding it drifts.
        expect(registry.get('game:end-turn')).toBe(first);
    });

    it('registers the unseen actions of a partially-registered list', () => {
        const registry = createInputActionRegistry([makeAction('game:end-turn')]);

        registerInputActions(registry, [makeAction('game:end-turn'), makeAction('game:cycle')]);

        expect(registry.getAll().map((action) => action.id)).toEqual([
            'game:end-turn',
            'game:cycle',
        ]);
    });

    it('throws when a re-registered action carries a different description', () => {
        const registry = createInputActionRegistry([makeAction('game:end-turn')]);

        expect(() =>
            registerInputActions(registry, [
                makeAction('game:end-turn', { description: 'Something else' }),
            ]),
        ).toThrow("Input action 'game:end-turn' is already registered with different metadata.");
    });

    it('throws when a re-registered action carries a different category', () => {
        const registry = createInputActionRegistry([makeAction('game:end-turn')]);

        expect(() =>
            registerInputActions(registry, [
                makeAction('game:end-turn', { category: 'Somewhere else' }),
            ]),
        ).toThrow("Input action 'game:end-turn' is already registered with different metadata.");
    });

    it('throws when a re-registered action carries a different oneShot flag', () => {
        const registry = createInputActionRegistry([makeAction('game:end-turn')]);

        expect(() =>
            registerInputActions(registry, [makeAction('game:end-turn', { oneShot: false })]),
        ).toThrow("Input action 'game:end-turn' is already registered with different metadata.");
    });

    it('accepts an undefined list as nothing to register', () => {
        const registry = createInputActionRegistry();

        registerInputActions(registry, undefined);

        expect(registry.getAll()).toEqual([]);
    });
});
