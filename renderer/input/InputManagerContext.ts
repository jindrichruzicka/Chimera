'use client';

/**
 * renderer/input/InputManagerContext.ts
 *
 * React context that carries the singleton `InputManager` instance.
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Invariant #65: InputManager is renderer-only. Never imported by
 *                simulation/ or ai/.
 *
 * Lifecycle owner: renderer/app/providers.tsx creates the InputManager and
 * calls start() inside a useEffect, stop() in the cleanup. It publishes the
 * instance through <InputManagerProvider>, the component the public
 * `@chimera-engine/renderer/input` barrel ships; this context object itself
 * stays internal.
 */

import { createContext, useContext } from 'react';

import type { InputManager } from './InputManager.js';

export const InputManagerContext = createContext<InputManager | null>(null);

export function useInputManager(): InputManager {
    const manager = useContext(InputManagerContext);
    if (manager === null) {
        throw new Error('useInputManager() must be used within the app root (inside <Providers>).');
    }
    return manager;
}
