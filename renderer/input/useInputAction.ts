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
 * - `options.enabled === false` registers NOTHING, so the action is not merely
 *   ignored on press — a caller that cannot offer the action leaves the hook
 *   call itself unconditional (rules of hooks) and gates the effect instead.
 */

import { useEffect, useRef } from 'react';

import type { InputActionId, InputEvent } from './InputAction.js';
import { useInputManager } from './InputManagerContext.js';

/** Per-call options for {@link useInputAction}. */
export interface UseInputActionOptions {
    /**
     * Whether to subscribe at all. Defaults to `true`; `false` leaves the action
     * unsubscribed until it flips back, at which point the subscription is
     * established (and torn down again when it flips off).
     */
    readonly enabled?: boolean;
}

export function useInputAction(
    id: InputActionId,
    callback: (event: InputEvent) => void,
    options?: UseInputActionOptions,
): void {
    const inputManager = useInputManager();
    const enabled = options?.enabled ?? true;

    // Always keep a ref to the latest callback so that re-subscribing on every
    // render is unnecessary — the stable forwarding function reads this ref.
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        const unsubscribe = inputManager.onAction(id, (event) => {
            callbackRef.current(event);
        });
        return unsubscribe;
        // `enabled` is read as a primitive, not off `options`, so a caller
        // passing a fresh object literal each render does not re-subscribe.
    }, [inputManager, id, enabled]);
}
