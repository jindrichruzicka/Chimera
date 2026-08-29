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
     * Returns all registered actions in registration order.
     *
     * The array is FROZEN and STABLE: repeated reads with no registration
     * between them return the same reference, and a registration replaces it.
     * That is what makes this readable as a `useSyncExternalStore` snapshot —
     * a fresh array per call would re-render its consumer forever — and the
     * freeze is what keeps one shared array safe to hand out.
     */
    getAll(): readonly InputAction[];

    /**
     * Subscribe to registrations. The listener is called after each accepted
     * {@link InputActionRegistry.register}, with the new action already
     * readable through {@link InputActionRegistry.getAll}. Returns an
     * unsubscribe function.
     *
     * Registration is asynchronous — the app-boot registrar resolves a game's
     * shell payload before it can register anything — so a surface that LISTS
     * actions (the Settings rebind pane) has to be told when the list changed
     * rather than depending on some unrelated re-render to arrive later.
     */
    subscribe(listener: () => void): () => void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

class DefaultInputActionRegistry implements InputActionRegistry {
    private readonly actions = new Map<InputActionId, InputAction>();
    private readonly listeners = new Set<() => void>();
    /**
     * The `getAll()` snapshot, rebuilt lazily on the first read after a
     * registration. `null` means "stale"; it is never a legal snapshot value,
     * so an empty registry still memoizes its (frozen, empty) array.
     */
    private snapshot: readonly InputAction[] | null = null;

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
        this.snapshot = null;
        // Notified AFTER the map write and the snapshot invalidation, so a
        // listener that reads `getAll()` from inside the callback sees the
        // action it is being told about.
        for (const listener of this.listeners) {
            listener();
        }
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
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
        this.snapshot ??= Object.freeze(Array.from(this.actions.values()));
        return this.snapshot;
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
