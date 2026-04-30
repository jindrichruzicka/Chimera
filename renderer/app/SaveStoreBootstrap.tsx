'use client';

/**
 * renderer/app/SaveStoreBootstrap.tsx
 *
 * Thin client component that wires the chimera:saves:slot-update push
 * channel into the saveStore on mount and triggers the initial
 * `saves.list(activeGameId)` fetch. Renders nothing.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Issue: review BLOCK-1 follow-up
 *
 * Invariants upheld:
 *   #1 — Only SaveSlotMeta (never GameSnapshot) crosses the IPC boundary.
 */

import { useEffect } from 'react';
import { bootstrapSaveStore } from '../state/saveStoreBootstrap';
import type { SavesAPI } from '@chimera/electron/preload/api-types.js';

/**
 * Default game identifier used by the initial `list()` fetch when no
 * route-specific override is supplied. Only `'tactics'` is registered at
 * M1; later milestones can route this through a shared "active game" store.
 */
const DEFAULT_ACTIVE_GAME_ID = 'tactics';

export interface SaveStoreBootstrapProps {
    /**
     * Game identifier passed to `bootstrapSaveStore`. Defaults to
     * `'tactics'` so the root layout can mount this component without
     * threading the active game through props.
     */
    readonly activeGameId?: string;
}

export function SaveStoreBootstrap({
    activeGameId = DEFAULT_ACTIVE_GAME_ID,
}: SaveStoreBootstrapProps = {}): null {
    useEffect(() => {
        const chimera = (globalThis as { __chimera?: { saves?: SavesAPI } }).__chimera;
        if (!chimera?.saves) return;
        const unsubscribe = bootstrapSaveStore(chimera.saves, activeGameId);
        return unsubscribe;
    }, [activeGameId]);

    return null;
}
