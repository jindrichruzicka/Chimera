/**
 * electron/main/lobby/SpectatorRegistry.ts
 *
 * Host-local ledger of admitted spectators and the seat each one follows.
 * A spectator is a read-only session viewer (Invariant #114): it never
 * appears in `GameSnapshot.players`, holds no seat and no agent, and its
 * visibility is the followed seat's projection. This registry is pure host
 * orchestration state — it never enters the simulation, never advances
 * `tick`, and is absent from saves and replays (Invariants #3/#71).
 *
 * Architecture: §4.6 — State Projection; §4.14 — StateBroadcaster.
 */

import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';

export class SpectatorRegistry {
    private readonly log: Logger;
    /** spectatorId → followed seat, iterated in insertion order. */
    private readonly followedSeatBySpectator = new Map<PlayerId, PlayerId>();

    constructor(logger: Logger) {
        this.log = logger.child({ module: 'spectator-registry' });
    }

    /**
     * Register a spectator following the given seat. Registering an existing
     * spectator re-points its followed seat.
     */
    add(spectatorId: PlayerId, followedPlayerId: PlayerId): void {
        this.followedSeatBySpectator.set(spectatorId, followedPlayerId);
        this.log.info('spectator registered', { spectatorId, followedPlayerId });
    }

    /** Deregister a spectator; returns whether an entry existed. */
    remove(spectatorId: PlayerId): boolean {
        const removed = this.followedSeatBySpectator.delete(spectatorId);
        if (removed) {
            this.log.info('spectator deregistered', { spectatorId });
        }
        return removed;
    }

    has(spectatorId: PlayerId): boolean {
        return this.followedSeatBySpectator.has(spectatorId);
    }

    /** The seat the given spectator follows, or undefined when not registered. */
    followedBy(spectatorId: PlayerId): PlayerId | undefined {
        return this.followedSeatBySpectator.get(spectatorId);
    }

    /** Snapshot of `[spectatorId, followedPlayerId]` pairs in insertion order. */
    entries(): readonly (readonly [PlayerId, PlayerId])[] {
        return [...this.followedSeatBySpectator.entries()];
    }

    /**
     * Re-point every spectator following `departedSeatId` to `nextSeatId`,
     * so no spectator keeps following a seat whose player deliberately left.
     * Returns the number of spectators re-pointed.
     */
    repointFollowersOf(departedSeatId: PlayerId, nextSeatId: PlayerId): number {
        let repointed = 0;
        for (const [spectatorId, followed] of this.followedSeatBySpectator) {
            if (followed === departedSeatId) {
                this.followedSeatBySpectator.set(spectatorId, nextSeatId);
                repointed += 1;
            }
        }
        if (repointed > 0) {
            this.log.info('spectators re-pointed after seat departure', {
                departedSeatId,
                nextSeatId,
                repointed,
            });
        }
        return repointed;
    }

    get size(): number {
        return this.followedSeatBySpectator.size;
    }

    clear(): void {
        this.followedSeatBySpectator.clear();
    }
}
