'use client';

/**
 * Thin client component that wires the chimera:saves:slot-update and
 * chimera:saves:restore-status push channels into the saveStore on mount
 * and triggers the initial `saves.list(activeGameId)` fetch. Renders
 * nothing. Mounting this at app bootstrap is load-bearing for the restore
 * slice: restore-status is push-only (no pull twin), so the subscription
 * must exist before any load can be issued.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 *
 * Invariants upheld:
 *   Invariant #1 — Only SaveSlotMeta (never GameSnapshot) crosses the IPC boundary.
 */

import { useEffect } from 'react';
import { bootstrapSaveStore } from '../state/saveStoreBootstrap';
import type { SavesAPI } from '@chimera-engine/simulation/bridge/api-types.js';

/**
 * Default game identifier used by the initial `list()` fetch when no
 * route-specific override is supplied. Only `'tactics'` is registered so
 * far; later this can route through a shared "active game" store.
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
