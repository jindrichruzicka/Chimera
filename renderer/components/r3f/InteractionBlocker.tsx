'use client';
// renderer/components/r3f/InteractionBlocker.tsx
//
// InteractionBlocker provider for §4.23 pointer interactions.
// Reads sceneTransition from gameStore and blocks interactions during active
// scene transitions.
//
// Context and hook live in interactionContext.ts (plain .ts) so that
// non-JSX renderer modules can import them without a jsx tsconfig flag.
//
// Invariant #58: blocking state never leaks to simulation.
// Invariant #83: context uses null default; consumer throws on null.

import React from 'react';
import type { ReactNode } from 'react';
import { useGameStore } from '../../state/gameStore.js';
import { InteractionContext } from './interactionContext.js';

export { InteractionContext, useInteractionContext } from './interactionContext.js';

export function InteractionBlocker({ children }: { children: ReactNode }): React.ReactElement {
    const sceneTransition = useGameStore((s) => s.snapshot?.sceneTransition);
    return (
        <InteractionContext.Provider value={{ isBlocked: sceneTransition != null }}>
            {children}
        </InteractionContext.Provider>
    );
}
