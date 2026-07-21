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
import { useActiveShellGameId } from '../shell/useActiveShellGameId';
import type { SavesAPI } from '@chimera-engine/simulation/bridge/api-types.js';

/**
 * Save slots are game-scoped, so this bootstrap needs a concrete game to list
 * for. It takes that from {@link useActiveShellGameId} — the URL's `?gameId=`,
 * falling back to the live session — because the engine names and derives no
 * game of its own. With no game context there is nothing to list, so the
 * subscriptions stay unwired until a game is actually in play.
 */
export function SaveStoreBootstrap(): null {
    const activeGameId = useActiveShellGameId();

    useEffect(() => {
        if (activeGameId === null) return;
        const chimera = (globalThis as { __chimera?: { saves?: SavesAPI } }).__chimera;
        if (!chimera?.saves) return;
        const unsubscribe = bootstrapSaveStore(chimera.saves, activeGameId);
        return unsubscribe;
    }, [activeGameId]);

    return null;
}
