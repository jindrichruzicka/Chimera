'use client';

import React from 'react';

import type { InputManager } from './InputManager.js';
import { InputManagerContext } from './InputManagerContext.js';

export interface InputManagerProviderProps {
    readonly inputManager: InputManager;
    readonly children: React.ReactNode;
}

/**
 * Publishes an {@link InputManager} to `useInputManager()` and `useInputAction()`
 * consumers.
 *
 * This component only publishes. It constructs nothing and it calls neither
 * `start()` nor `stop()`: the manager is an app-lifetime singleton whose one
 * owner is `renderer/app/providers.tsx`; §4.26 records what a second live one
 * would cost.
 *
 * It exists as a component rather than a bare exported context because it is
 * part of the public `@chimera-engine/renderer/input` barrel: an adopting game's
 * tests have to mount whatever satisfies `useInputAction()`, and shipping a
 * provider keeps the context object itself internal — the same shape as
 * `AssetManagerProvider` and `AudioManagerProvider`. Nothing here weakens the
 * throwing-hook contract of Invariant #83: outside a provider `useInputManager()`
 * still throws.
 */
export function InputManagerProvider({
    inputManager,
    children,
}: InputManagerProviderProps): React.ReactElement {
    return (
        <InputManagerContext.Provider value={inputManager}>{children}</InputManagerContext.Provider>
    );
}
