'use client';

/**
 * renderer/input/useRegisteredInputActions.ts
 *
 * The registered action table, as React state (§4.26).
 *
 * A surface that LISTS actions — the Settings > Controls rebind pane — cannot
 * read `InputActionRegistry.getAll()` during render and stop there: game
 * actions register at app boot from an async shell-payload load, so on a direct
 * boot to `/settings` the list lands AFTER the pane's first commit, and nothing
 * else re-renders it.
 *
 * `useSyncExternalStore` over the registry's own `subscribe`/`getAll` is what
 * closes that. It relies on the snapshot being STABLE between registrations,
 * which `getAll()` guarantees.
 *
 * Deliberately NOT on the public `@chimera-engine/renderer/input` barrel
 * (Invariant #96): the registry is engine-internal, and a game reads no action
 * list — it declares one.
 *
 * Invariant #65: renderer-only. Never imported by `simulation/` or `ai/`.
 */

import { useCallback, useSyncExternalStore } from 'react';

import type { InputAction } from './InputAction.js';
import { useInputActionRegistry } from './InputActionRegistryContext.js';

/** Every action registered right now, in registration order. */
export function useRegisteredInputActions(): readonly InputAction[] {
    const registry = useInputActionRegistry();

    // Bound through the registry identity rather than passed as bare method
    // references: `getAll`/`subscribe` are class methods, so an unbound
    // `registry.getAll` would lose `this`.
    const subscribe = useCallback(
        (onStoreChange: () => void) => registry.subscribe(onStoreChange),
        [registry],
    );
    const getSnapshot = useCallback(() => registry.getAll(), [registry]);

    // The server snapshot is the same read: the registry is a plain in-memory
    // map with no browser dependency, and `output: 'export'` prerenders these
    // pages, so omitting it would throw during the static export.
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
