'use client';

/**
 * renderer/input/useInputAction.ts
 *
 * React hook that subscribes a component to a named InputAction callback.
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Invariant #65: InputManager is renderer-only. This hook must never be
 *                imported by simulation/ or ai/.
 *
 * Usage:
 *   useInputAction('engine:toggle-menu', (event) => { ... });
 *
 * - Calls InputManager.onAction(id, callback) on mount.
 * - Unsubscribes via the returned function on unmount.
 * - When `id` changes, the old subscription is torn down and a new one is
 *   established automatically.
 * - When only the callback identity changes the subscription is NOT
 *   re-established; the latest callback is always invoked through a ref.
 */

import { useEffect, useRef } from 'react';

import type { InputActionId, InputEvent } from './InputAction.js';
import { useInputManager } from './InputManagerContext.js';

export function useInputAction(id: InputActionId, callback: (event: InputEvent) => void): void {
    const inputManager = useInputManager();

    // Always keep a ref to the latest callback so that re-subscribing on every
    // render is unnecessary — the stable forwarding function reads this ref.
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {
        const unsubscribe = inputManager.onAction(id, (event) => {
            callbackRef.current(event);
        });
        return unsubscribe;
    }, [inputManager, id]);
}
