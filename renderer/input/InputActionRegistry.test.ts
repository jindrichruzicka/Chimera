/**
 * renderer/input/InputActionRegistry.test.ts
 *
 * Unit tests for InputActionRegistry.
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Issue: #573 — Implement InputActionRegistry
 *
 * Invariants upheld:
 *   #65 — InputManager is renderer-only; this registry must never be
 *           imported by simulation/ or ai/.
 *
 * Tests written first (TDD — red confirmed: module did not exist before
 * this commit; `pnpm test` reported "cannot find module").
 */

import { describe, it, expect, vi } from 'vitest';
import type { InputAction } from './InputAction.js';
import {
    createInputActionRegistry,
    DuplicateInputActionError,
    UnknownInputActionError,
} from './InputActionRegistry.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAction(id: InputAction['id'], category = 'UI'): InputAction {
    return { id, description: `Description for ${id}`, category, oneShot: true };
}

const undoAction = makeAction('engine:undo');
const redoAction = makeAction('engine:redo');
const endTurnAction = makeAction('game:end-turn', 'Game');

// ─── createInputActionRegistry ────────────────────────────────────────────────

describe('createInputActionRegistry', () => {
    it('creates an empty registry when called with no arguments', () => {
        const registry = createInputActionRegistry();

        expect(registry.getAll()).toHaveLength(0);
    });

    it('creates a registry pre-loaded with the supplied actions', () => {
        const registry = createInputActionRegistry([undoAction, redoAction]);

        expect(registry.getAll()).toHaveLength(2);
    });
});

// ─── register ─────────────────────────────────────────────────────────────────

describe('InputActionRegistry.register', () => {
    it('registers an action so it can be retrieved by id', () => {
        const registry = createInputActionRegistry();
        registry.register(undoAction);

        expect(registry.get('engine:undo')).toBe(undoAction);
    });

    it('registers multiple distinct actions', () => {
        const registry = createInputActionRegistry();
        registry.register(undoAction);
        registry.register(redoAction);
        registry.register(endTurnAction);

        expect(registry.get('engine:undo')).toBe(undoAction);
        expect(registry.get('engine:redo')).toBe(redoAction);
        expect(registry.get('game:end-turn')).toBe(endTurnAction);
    });

    it('throws DuplicateInputActionError when the same id is registered twice', () => {
        const registry = createInputActionRegistry();
        registry.register(undoAction);

        expect(() => registry.register(undoAction)).toThrow(DuplicateInputActionError);
    });

    it('DuplicateInputActionError message includes the duplicate id', () => {
        const registry = createInputActionRegistry([undoAction]);

        expect(() => registry.register(undoAction)).toThrow("'engine:undo'");
    });

    it('also throws on duplicate detection when seeded via factory', () => {
        expect(() => createInputActionRegistry([undoAction, undoAction])).toThrow(
            DuplicateInputActionError,
        );
    });
});

// ─── get ──────────────────────────────────────────────────────────────────────

describe('InputActionRegistry.get', () => {
    it('returns the action object previously registered', () => {
        const registry = createInputActionRegistry([endTurnAction]);

        expect(registry.get('game:end-turn')).toBe(endTurnAction);
    });

    it('throws UnknownInputActionError for an id that was never registered', () => {
        const registry = createInputActionRegistry();

        expect(() => registry.get('engine:undo')).toThrow(UnknownInputActionError);
    });

    it('UnknownInputActionError message includes the requested id', () => {
        const registry = createInputActionRegistry();

        expect(() => registry.get('engine:undo')).toThrow("'engine:undo'");
    });
});

// ─── has ──────────────────────────────────────────────────────────────────────

describe('InputActionRegistry.has', () => {
    it('returns true for a registered id', () => {
        const registry = createInputActionRegistry([undoAction]);

        expect(registry.has('engine:undo')).toBe(true);
    });

    it('returns false for an id that has not been registered', () => {
        const registry = createInputActionRegistry();

        expect(registry.has('engine:undo')).toBe(false);
    });

    it('returns false after a registry is created with no actions', () => {
        const registry = createInputActionRegistry();

        expect(registry.has('game:end-turn')).toBe(false);
    });
});

// ─── getAll ───────────────────────────────────────────────────────────────────

describe('InputActionRegistry.getAll', () => {
    it('returns an empty array when no actions are registered', () => {
        const registry = createInputActionRegistry();

        expect(registry.getAll()).toEqual([]);
    });

    it('returns all registered actions', () => {
        const registry = createInputActionRegistry([undoAction, redoAction, endTurnAction]);

        const all = registry.getAll();
        expect(all).toHaveLength(3);
        expect(all).toContain(undoAction);
        expect(all).toContain(redoAction);
        expect(all).toContain(endTurnAction);
    });

    it('preserves registration order', () => {
        const registry = createInputActionRegistry();
        registry.register(endTurnAction);
        registry.register(undoAction);
        registry.register(redoAction);

        const all = registry.getAll();
        expect(all[0]).toBe(endTurnAction);
        expect(all[1]).toBe(undoAction);
        expect(all[2]).toBe(redoAction);
    });

    it('is not the registry map itself — draining a spread copy leaves it intact', () => {
        const registry = createInputActionRegistry([undoAction]);

        // getAll() returns readonly InputAction[]; spread into a mutable copy
        // to verify the registry's internal state is not shared. The returned
        // array is FROZEN and shared between reads (see the snapshot cases
        // below), so a caller that needs a mutable list must copy it — which is
        // what this does.
        const mutableCopy = [...registry.getAll()];
        mutableCopy.splice(0);

        expect(registry.getAll()).toHaveLength(1);
    });
});

// ─── Snapshot stability + subscribe ───────────────────────────────────────────

describe('InputActionRegistry.getAll snapshot stability', () => {
    it('returns the SAME array reference across reads with no registration between them', () => {
        const registry = createInputActionRegistry([undoAction]);

        // A stable snapshot is what lets a `useSyncExternalStore` consumer read
        // this directly: a fresh array every call re-renders forever.
        expect(registry.getAll()).toBe(registry.getAll());
    });

    it('returns a NEW array reference after a registration', () => {
        const registry = createInputActionRegistry([undoAction]);
        const before = registry.getAll();

        registry.register(endTurnAction);

        expect(registry.getAll()).not.toBe(before);
        expect(before.map((action) => action.id)).toEqual(['engine:undo']);
    });

    it('returns a frozen array, so a consumer cannot mutate the shared snapshot', () => {
        const registry = createInputActionRegistry([undoAction]);

        expect(Object.isFrozen(registry.getAll())).toBe(true);
    });
});

describe('InputActionRegistry.subscribe', () => {
    it('notifies a listener when an action is registered', () => {
        const registry = createInputActionRegistry();
        const listener = vi.fn();
        registry.subscribe(listener);

        registry.register(endTurnAction);

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('notifies every listener, and once per registration', () => {
        const registry = createInputActionRegistry();
        const first = vi.fn();
        const second = vi.fn();
        registry.subscribe(first);
        registry.subscribe(second);

        registry.register(endTurnAction);
        registry.register(undoAction);

        expect(first).toHaveBeenCalledTimes(2);
        expect(second).toHaveBeenCalledTimes(2);
    });

    it('stops notifying after the returned unsubscribe is called', () => {
        const registry = createInputActionRegistry();
        const listener = vi.fn();
        const unsubscribe = registry.subscribe(listener);

        unsubscribe();
        registry.register(endTurnAction);

        expect(listener).not.toHaveBeenCalled();
    });

    it('does not notify for a rejected duplicate registration', () => {
        const registry = createInputActionRegistry([endTurnAction]);
        const listener = vi.fn();
        registry.subscribe(listener);

        expect(() => registry.register(endTurnAction)).toThrow(DuplicateInputActionError);

        expect(listener).not.toHaveBeenCalled();
    });

    it('exposes the newly registered action to a listener reading during the notification', () => {
        const registry = createInputActionRegistry();
        const seen: string[][] = [];
        registry.subscribe(() => {
            seen.push(registry.getAll().map((action) => action.id));
        });

        registry.register(endTurnAction);

        expect(seen).toEqual([['game:end-turn']]);
    });
});
