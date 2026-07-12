/**
 * Bridges the client snapshot stream to the SessionTicketStore.
 *
 * The composition root (`electron/main/index.ts`) calls the returned function
 * from its `onClientSnapshotReceived` hook. The first snapshot carrying a
 * `matchId` records `{matchId, playerId: viewerId, gameId, updatedAt}`;
 * identical repeats are deduped in-memory so the store is not rewritten on
 * every frame, and a match or seat change records again.
 *
 * Recording is fire-and-forget: the snapshot hook is synchronous and feeds
 * the live renderer egress, so a store failure is logged and swallowed —
 * mirroring the perspective-recorder discipline in the same hook.
 */

import type { Logger } from '../logging/logger.js';
import { createNoopLogger } from '../logging/logger.js';
import type { SessionTicketStore } from './SessionTicketStore.js';

/**
 * The slice of the wire `PlayerSnapshot` the recorder needs — structural so
 * `session/` does not depend on the networking package's snapshot types.
 */
export interface TicketSourceSnapshot {
    readonly matchId?: string;
    readonly viewerId: string;
}

export interface CreateSnapshotTicketRecorderOptions {
    readonly store: SessionTicketStore;
    /** Game the hosting app runs; stamped into every ticket. */
    readonly gameId: string;
    /** Clock injection for deterministic tests. Defaults to `Date.now`. */
    readonly now?: () => number;
    readonly logger?: Logger;
}

/** Build the per-snapshot callback wired into `onClientSnapshotReceived`. */
export function createSnapshotTicketRecorder(
    options: CreateSnapshotTicketRecorderOptions,
): (snapshot: TicketSourceSnapshot) => void {
    const { store, gameId } = options;
    const now = options.now ?? Date.now;
    const log = options.logger ?? createNoopLogger();

    let lastMatchId: string | null = null;
    let lastPlayerId: string | null = null;

    return (snapshot: TicketSourceSnapshot): void => {
        const { matchId, viewerId } = snapshot;
        if (matchId === undefined) return;
        if (matchId === lastMatchId && viewerId === lastPlayerId) return;

        lastMatchId = matchId;
        lastPlayerId = viewerId;

        void store
            .record({ matchId, playerId: viewerId, gameId, updatedAt: now() })
            .catch((err: unknown) => {
                log.warn('failed to record session ticket', {
                    matchId,
                    gameId,
                    error: err instanceof Error ? err.message : String(err),
                });
            });
    };
}
