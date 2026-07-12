/**
 * renderer/input/InputActionRegistry.ts
 *
 * Registry for named InputAction objects, keyed by InputActionId.
 *
 * Architecture reference: §4.26 — Input & Keybindings
 *
 * Invariants upheld:
 *   #65 — InputManager is renderer-only. This registry must never be
 *           imported by simulation/ or ai/.
 */

import type { InputAction, InputActionId } from './InputAction.js';

// ─── Errors ───────────────────────────────────────────────────────────────────

export class DuplicateInputActionError extends Error {
    constructor(public readonly actionId: InputActionId) {
        super(`Input action already registered for id '${actionId}'.`);
        this.name = 'DuplicateInputActionError';
    }
}

export class UnknownInputActionError extends Error {
    constructor(public readonly actionId: InputActionId) {
        super(`No input action registered for id '${actionId}'.`);
        this.name = 'UnknownInputActionError';
    }
}

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Holds all registered InputAction objects keyed by InputActionId.
 *
 * The engine registers its built-in actions at startup; games register their
 * actions before InputManager.start(). This registry is consumed by
 * InputManager.
 */
export interface InputActionRegistry {
    /**
     * Register an action. Throws DuplicateInputActionError if an action with
     * the same id has already been registered.
     */
    register(action: InputAction): void;

    /**
     * Retrieve a registered action by id. Throws UnknownInputActionError if
     * no action with that id has been registered.
     */
    get(id: InputActionId): InputAction;

    /** Returns true when an action with the given id has been registered. */
    has(id: InputActionId): boolean;

    /**
     * Returns all registered actions in registration order as a fresh array
     * copy. Mutating the returned array does not affect the registry.
     */
    getAll(): readonly InputAction[];
}

// ─── Implementation ───────────────────────────────────────────────────────────

class DefaultInputActionRegistry implements InputActionRegistry {
    private readonly actions = new Map<InputActionId, InputAction>();

    constructor(actions: readonly InputAction[] = []) {
        for (const action of actions) {
            this.register(action);
        }
    }

    register(action: InputAction): void {
        if (this.actions.has(action.id)) {
            throw new DuplicateInputActionError(action.id);
        }
        this.actions.set(action.id, action);
    }

    get(id: InputActionId): InputAction {
        const action = this.actions.get(id);
        if (action === undefined) {
            throw new UnknownInputActionError(id);
        }
        return action;
    }

    has(id: InputActionId): boolean {
        return this.actions.has(id);
    }

    getAll(): readonly InputAction[] {
        return Array.from(this.actions.values());
    }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a new InputActionRegistry, optionally pre-seeded with the given
 * actions. Each action in the seed array is registered in order; a duplicate
 * id throws DuplicateInputActionError.
 */
export function createInputActionRegistry(
    actions: readonly InputAction[] = [],
): InputActionRegistry {
    return new DefaultInputActionRegistry(actions);
}
