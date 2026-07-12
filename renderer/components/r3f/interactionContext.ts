'use client';
// InteractionContext and useInteractionContext live in a plain .ts file so
// non-JSX modules (renderer/**/*.ts in the root tsconfig) can import from here
// without triggering the "jsx not set" TS error.
//
// InteractionBlocker.tsx re-exports everything from this file.
// Architecture: §4.23 — Pointer and Click Interactions
// Invariant #83: context uses null default; consumer throws on null.

import { createContext, useContext } from 'react';

export const InteractionContext = createContext<{ isBlocked: boolean } | null>(null);

/**
 * Returns the current interaction-blocked state from the nearest
 * {@link InteractionBlocker} ancestor.
 *
 * @throws if called outside an {@link InteractionBlocker} provider.
 */
export function useInteractionContext(): { isBlocked: boolean } {
    const ctx = useContext(InteractionContext);
    if (ctx === null) {
        throw new Error(
            'useInteractionContext must be called inside an <InteractionBlocker> provider. ' +
                'Wrap your game content with <InteractionBlocker> before using pointer interactions.',
        );
    }
    return ctx;
}
