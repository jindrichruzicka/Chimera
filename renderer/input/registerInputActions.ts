/**
 * renderer/input/registerInputActions.ts
 *
 * The ONE way a game's declared input actions enter the app-lifetime
 * {@link InputActionRegistry} (§4.26).
 *
 * A game declares its action table once and the engine registers it from more
 * than one site — app boot reads it off the shell payload, `GameShell` reads it
 * off the game payload — so the register step has to be idempotent, and every
 * site has to be idempotent the SAME way. This function is that step; the sites
 * hold no copy of it.
 *
 * Idempotent means: an id already in the registry is left exactly as it is —
 * the first registration's object stays the one `get()` returns — and a
 * re-registration whose metadata DIFFERS throws. Last-write-win is the failure
 * this rules out: a game shipping one description to the shell and another to
 * the match would silently show whichever site ran last in the rebind pane,
 * and the binding a player edited would belong to an action they never saw.
 *
 * Invariant #65: renderer-only. Never imported by `simulation/` or `ai/`.
 */

import type { InputAction } from './InputAction.js';
import type { InputActionRegistry } from './InputActionRegistry.js';

/**
 * Register each action that the registry does not already hold, asserting that
 * a repeat carries the same metadata.
 *
 * @param registry - the app-lifetime registry to populate.
 * @param actions - the game's declared table, or `undefined` for a game that
 *                  declares none (the no-action path costs one branch).
 * @throws when an id is already registered with different metadata.
 */
export function registerInputActions(
    registry: InputActionRegistry,
    actions: readonly InputAction[] | undefined,
): void {
    if (actions === undefined) {
        return;
    }

    for (const action of actions) {
        if (registry.has(action.id)) {
            assertSameInputAction(registry.get(action.id), action);
            continue;
        }

        registry.register(action);
    }
}

/**
 * The identity assert — the safety net the JSDoc above names. Compares the
 * three metadata fields beside the id; `id` itself is what looked the pair up.
 */
function assertSameInputAction(existing: InputAction, next: InputAction): void {
    if (
        existing.description !== next.description ||
        existing.category !== next.category ||
        existing.oneShot !== next.oneShot
    ) {
        throw new Error(`Input action '${next.id}' is already registered with different metadata.`);
    }
}
